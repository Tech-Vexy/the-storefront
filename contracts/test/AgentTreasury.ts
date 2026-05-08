import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther, keccak256, encodePacked, getAddress, toHex, padHex } from "viem";

describe("AgentTreasury", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [deployer, agentOwner, agentWallet, other] = await viem.getWalletClients();

  const PASSPORT_ID = "kite-passport-agent-001";
  const AGENT_ID = padHex(toHex("buyer-default"), { size: 32 });
  const POLICY_HASH = keccak256(encodePacked(["string"], ["policy-v1"]));
  const MIN_STAKE = parseEther("0.01");
  const DAILY_CAP = parseEther("1");
  const PER_TX_CAP = parseEther("0.5");

  async function deployBoth() {
    const attestation = await viem.deployContract("StorefrontAttestation", [deployer.account.address]);
    const treasury = await viem.deployContract("AgentTreasury", [
      attestation.address,
      deployer.account.address,
      MIN_STAKE,
    ]);
    // Wire treasury into attestation
    await attestation.write.setAgentTreasury([treasury.address]);
    return { attestation, treasury };
  }

  async function deployAndRegister() {
    const { attestation, treasury } = await deployBoth();
    await treasury.write.registerAgent(
      [AGENT_ID, agentWallet.account.address, DAILY_CAP, PER_TX_CAP, POLICY_HASH, PASSPORT_ID],
      { account: agentOwner.account, value: MIN_STAKE },
    );
    return { attestation, treasury };
  }

  // ─── Deployment ──────────────────────────────────────────────────────────────

  describe("deployment", async function () {
    it("sets governance to constructor arg", async function () {
      const { treasury } = await deployBoth();
      assert.equal(await treasury.read.governance(), getAddress(deployer.account.address));
    });

    it("sets minStake to constructor arg", async function () {
      const { treasury } = await deployBoth();
      assert.equal(await treasury.read.minStake(), MIN_STAKE);
    });
  });

  // ─── registerAgent ────────────────────────────────────────────────────────────

  describe("registerAgent", async function () {
    it("registers an agent with correct stake", async function () {
      const { treasury } = await deployAndRegister();
      const agent = await treasury.read.agents([AGENT_ID]);
      assert.equal(agent[0], getAddress(agentOwner.account.address)); // owner
      assert.equal(agent[1], getAddress(agentWallet.account.address)); // wallet
      assert.equal(agent[9], true); // active
      assert.equal(agent[10], true); // registered
    });

    it("auto-authenticates passport on attestation", async function () {
      const { attestation } = await deployAndRegister();
      const passportHash = keccak256(encodePacked(["string"], [PASSPORT_ID]));
      assert.equal(await attestation.read.isPassportAuthenticated([passportHash]), true);
    });

    it("emits AgentRegistered event", async function () {
      const { attestation, treasury } = await deployBoth();
      await viem.assertions.emitWithArgs(
        treasury.write.registerAgent(
          [AGENT_ID, agentWallet.account.address, DAILY_CAP, PER_TX_CAP, POLICY_HASH, PASSPORT_ID],
          { account: agentOwner.account, value: MIN_STAKE },
        ),
        treasury,
        "AgentRegistered",
        [AGENT_ID, getAddress(agentOwner.account.address), getAddress(agentWallet.account.address), MIN_STAKE],
      );
    });

    it("reverts on duplicate registration", async function () {
      const { treasury } = await deployAndRegister();
      await assert.rejects(
        treasury.write.registerAgent(
          [AGENT_ID, agentWallet.account.address, DAILY_CAP, PER_TX_CAP, POLICY_HASH, PASSPORT_ID],
          { account: agentOwner.account, value: MIN_STAKE },
        ),
        /Already registered/,
      );
    });

    it("reverts when stake is below minimum", async function () {
      const { treasury } = await deployBoth();
      await assert.rejects(
        treasury.write.registerAgent(
          [AGENT_ID, agentWallet.account.address, DAILY_CAP, PER_TX_CAP, POLICY_HASH, PASSPORT_ID],
          { account: agentOwner.account, value: parseEther("0.001") },
        ),
        /Stake below minimum/,
      );
    });

    it("reverts when perTxCap > dailyCap", async function () {
      const { treasury } = await deployBoth();
      await assert.rejects(
        treasury.write.registerAgent(
          [AGENT_ID, agentWallet.account.address, PER_TX_CAP, DAILY_CAP, POLICY_HASH, PASSPORT_ID],
          { account: agentOwner.account, value: MIN_STAKE },
        ),
        /Invalid caps/,
      );
    });
  });

  // ─── deposit ────────────────────────────────────────────────────────────────

  describe("deposit", async function () {
    it("increases agent balance", async function () {
      const { treasury } = await deployAndRegister();
      const deposit = parseEther("0.05");
      await treasury.write.deposit([AGENT_ID], { value: deposit });
      const agent = await treasury.read.agents([AGENT_ID]);
      assert.equal(agent[8], MIN_STAKE + deposit); // balance
    });

    it("reverts on zero deposit", async function () {
      const { treasury } = await deployAndRegister();
      await assert.rejects(
        treasury.write.deposit([AGENT_ID], { value: 0n }),
        /Zero deposit/,
      );
    });
  });

  // ─── withdraw ──────────────────────────────────────────────────────────────

  describe("withdraw", async function () {
    it("owner can withdraw from agent balance", async function () {
      const { treasury } = await deployAndRegister();
      const balBefore = await publicClient.getBalance({ address: agentOwner.account.address });
      await treasury.write.withdraw([AGENT_ID, MIN_STAKE], { account: agentOwner.account });
      const agent = await treasury.read.agents([AGENT_ID]);
      assert.equal(agent[8], 0n); // balance now 0
    });

    it("reverts when called by non-owner", async function () {
      const { treasury } = await deployAndRegister();
      await assert.rejects(
        treasury.write.withdraw([AGENT_ID, MIN_STAKE], { account: other.account }),
        /Not agent owner/,
      );
    });
  });

  // ─── freeze / unfreeze ───────────────────────────────────────────────────────

  describe("freeze/unfreeze", async function () {
    it("governance can freeze an agent", async function () {
      const { treasury } = await deployAndRegister();
      await treasury.write.freeze([AGENT_ID]);
      const agent = await treasury.read.agents([AGENT_ID]);
      assert.equal(agent[9], false); // active = false
    });

    it("governance can unfreeze an agent", async function () {
      const { treasury } = await deployAndRegister();
      await treasury.write.freeze([AGENT_ID]);
      await treasury.write.unfreeze([AGENT_ID]);
      const agent = await treasury.read.agents([AGENT_ID]);
      assert.equal(agent[9], true); // active = true
    });

    it("non-governance cannot freeze", async function () {
      const { treasury } = await deployAndRegister();
      await assert.rejects(
        treasury.write.freeze([AGENT_ID], { account: other.account }),
        /Not governance/,
      );
    });
  });

  // ─── governance ──────────────────────────────────────────────────────────────

  describe("governance", async function () {
    it("can update governance address", async function () {
      const { treasury } = await deployBoth();
      await treasury.write.setGovernance([other.account.address]);
      assert.equal(await treasury.read.governance(), getAddress(other.account.address));
    });

    it("can update minStake", async function () {
      const { treasury } = await deployBoth();
      const newStake = parseEther("0.1");
      await treasury.write.setMinStake([newStake]);
      assert.equal(await treasury.read.minStake(), newStake);
    });
  });
});
