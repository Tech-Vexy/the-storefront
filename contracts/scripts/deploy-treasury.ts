import { network } from "hardhat";
import { readDeployments, writeDeployments } from "./deployments.js";

/**
 * Deploys AgentTreasury and wires it into an existing StorefrontAttestation by
 * calling setAgentTreasury(...). One-shot setter; once set, it cannot be changed
 * on the attestation contract.
 *
 * Usage:
 *   ATTESTATION_ADDRESS=0x...   \  # optional, falls back to deployments/<network>.json
 *   GOVERNANCE_ADDRESS=0x...    \  # optional, defaults to deployer
 *   MIN_AGENT_STAKE_WEI=10000000000000000 \  # optional, defaults to 0.01 KITE
 *   npx hardhat run scripts/deploy-treasury.ts --network kiteTestnet
 */
async function main() {
  const conn = await network.getOrCreate();
  const { viem } = conn;
  const networkName = conn.networkName ?? "unknown";

  const fromEnv = process.env.ATTESTATION_ADDRESS as `0x${string}` | undefined;
  const fromFile = readDeployments(networkName).attestation?.address;
  const attestationAddress = fromEnv ?? fromFile;
  if (!attestationAddress) {
    throw new Error(
      `ATTESTATION_ADDRESS env var is required (no deployments/${networkName}.json found either)`,
    );
  }

  const [deployer] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const governance = (process.env.GOVERNANCE_ADDRESS as `0x${string}`) || deployer.account.address;
  const minStakeWei = BigInt(process.env.MIN_AGENT_STAKE_WEI ?? 10n ** 16n);

  console.log("Network:     ", networkName);
  console.log("Deployer:    ", deployer.account.address);
  console.log("Attestation: ", attestationAddress, fromEnv ? "(env)" : "(deployments.json)");
  console.log("Governance:  ", governance);
  console.log("minStake wei:", minStakeWei.toString());

  const treasury = await viem.deployContract("AgentTreasury", [attestationAddress, governance, minStakeWei]);
  console.log("AgentTreasury deployed to:", treasury.address);

  const attestation = await viem.getContractAt("StorefrontAttestation", attestationAddress);
  console.log("Calling setAgentTreasury on attestation...");
  const tx = await attestation.write.setAgentTreasury([treasury.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("Attestation now trusts AgentTreasury for passport auto-auth.");

  writeDeployments(networkName, {
    agentTreasury: {
      address: treasury.address,
      governance,
      minStakeWei: minStakeWei.toString(),
      deployedAt: new Date().toISOString(),
    },
  });
  console.log(`\nWrote deployments/${networkName}.json`);
  console.log("Verify on explorer: https://testnet.kitescan.ai/address/" + treasury.address);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
