import { network } from "hardhat";

/**
 * Standalone helper: wires an already-deployed AgentTreasury into an existing
 * StorefrontAttestation. Useful if the contracts were deployed separately.
 *
 * Usage:
 *   ATTESTATION_ADDRESS=0x... TREASURY_ADDRESS=0x... \
 *   npx hardhat run scripts/set-treasury.ts --network kiteTestnet
 */
async function main() {
  const attestationAddress = process.env.ATTESTATION_ADDRESS as `0x${string}` | undefined;
  const treasuryAddress = process.env.TREASURY_ADDRESS as `0x${string}` | undefined;
  if (!attestationAddress || !treasuryAddress) {
    throw new Error("ATTESTATION_ADDRESS and TREASURY_ADDRESS env vars are required");
  }

  const { viem } = await network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const attestation = await viem.getContractAt("StorefrontAttestation", attestationAddress);

  const current = await attestation.read.agentTreasury();
  if (current && current !== "0x0000000000000000000000000000000000000000") {
    console.log("agentTreasury already set to", current, "— attestation rejects updates.");
    return;
  }

  console.log("Setting agentTreasury =", treasuryAddress);
  const tx = await attestation.write.setAgentTreasury([treasuryAddress]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
