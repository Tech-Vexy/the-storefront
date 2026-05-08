import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Parameters (set via --parameters or hardhat.config):
 *   attestation  - deployed StorefrontAttestation address
 *   governance   - address that may freeze/unfreeze and tune minStake
 *   minStakeWei  - minimum stake (wei) for permissionless registerAgent
 */
export default buildModule("AgentTreasuryModule", (m) => {
  const attestation = m.getParameter<string>("attestation");
  const governance = m.getParameter<string>("governance");
  const minStakeWei = m.getParameter<bigint>("minStakeWei", 10n ** 16n); // 0.01 KITE

  const treasury = m.contract("AgentTreasury", [attestation, governance, minStakeWei]);

  return { treasury };
});
