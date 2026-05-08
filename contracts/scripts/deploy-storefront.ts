import { network } from "hardhat";
import { writeDeployments } from "./deployments.js";

/**
 * Deploy StorefrontAttestation to the configured network and optionally
 * authenticate one or more agent passports + set the store policy hash.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-storefront.ts --network kiteTestnet
 *
 * Environment:
 *   STORE_POLICY_LABEL  - human label, hashed via keccak256 and set on-chain
 *   STORE_POLICY_CID    - optional IPFS CID for the canonical policy doc (recorded in deployments.json)
 *   KITE_PASSPORT_ID    - buyer passport to authenticate after deploy
 *   SUPPLIER_PASSPORT_ID, TREASURY_PASSPORT_ID - optional extras
 *
 * Output: writes contracts/deployments/<network>.json with addresses, tx hashes, policy info.
 */
async function main() {
  const conn = await network.getOrCreate();
  const { viem } = conn;
  const networkName = conn.networkName ?? "unknown";
  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const treasury = (process.env.TREASURY_ADDRESS as `0x${string}`) || deployer.account.address;
  console.log("Network:               ", networkName, `(chainId ${chainId})`);
  console.log("Deploying with account:", deployer.account.address);
  console.log("Treasury:              ", treasury);

  const contract = await viem.deployContract("StorefrontAttestation", [treasury]);
  console.log("StorefrontAttestation deployed to:", contract.address);

  const policyLabel = process.env.STORE_POLICY_LABEL || "kite-storefront/v1";
  const policyCid = process.env.STORE_POLICY_CID;
  const { keccak256, toUtf8Bytes } = await import("ethers");
  const policyHash = keccak256(toUtf8Bytes(policyLabel)) as `0x${string}`;
  console.log(`Setting policy hash for "${policyLabel}" → ${policyHash}`);
  if (policyCid) console.log(`Setting policy CID → ${policyCid}`);
  const policyTx = await contract.write.setStorePolicy([policyHash, policyCid ?? ""]);
  await publicClient.waitForTransactionReceipt({ hash: policyTx });

  const passportEnvs = ["KITE_PASSPORT_ID", "SUPPLIER_PASSPORT_ID", "TREASURY_PASSPORT_ID"] as const;
  const passports = Array.from(new Set(passportEnvs
    .map((k) => process.env[k])
    .filter((v): v is string => typeof v === "string" && v.length > 0)));

  for (const passportId of passports) {
    console.log(`Authenticating passport ${passportId}...`);
    const tx = await contract.write.authenticateAgentIdentity([passportId]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
  if (passports.length === 0) {
    console.log("No *_PASSPORT_ID env vars set — skipping passport authentication.");
    console.log(`Run: node scripts/authenticate_passport.cjs <passportId> --network ${networkName}`);
  }

  const record = writeDeployments(networkName, {
    chainId,
    attestation: {
      address: contract.address,
      deployer: deployer.account.address,
      treasury,
      policyLabel,
      policyHash,
      ...(policyCid ? { policyCid } : {}),
      deployedAt: new Date().toISOString(),
    },
  });
  console.log(`\nWrote deployments/${networkName}.json`);
  console.log("Verify on explorer: https://testnet.kitescan.ai/address/" + contract.address);
  return record;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
