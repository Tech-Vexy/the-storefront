import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther, keccak256, encodePacked, getAddress } from "viem";

describe("StorefrontAttestation", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, treasury, buyer, other] = await viem.getWalletClients();

  const PASSPORT_ID = "kite-passport-001";
  const ORDER_ID = "order-abc-123";

  async function deploy() {
    return viem.deployContract("StorefrontAttestation", [treasury.account.address]);
  }

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("deployment", async function () {
    it("sets owner to deployer", async function () {
      const contract = await deploy();
      assert.equal(await contract.read.owner(), getAddress(owner.account.address));
    });

    it("sets treasury to constructor arg", async function () {
      const contract = await deploy();
      assert.equal(await contract.read.treasury(), getAddress(treasury.account.address));
    });

    it("initialises stats to zero", async function () {
      const contract = await deploy();
      const [count, volume] = await contract.read.getStats();
      assert.equal(count, 0n);
      assert.equal(volume, 0n);
    });
  });

  // ─── setStorePolicy ────────────────────────────────────────────────────────

  describe("setStorePolicy", async function () {
    const CID = "bafybeibwzifw7l5wlqv3xq4q3gqf6c5j7nq3a5b6c7d8e9f0g1h2i3j4k5";

    it("owner can set the policy hash and CID", async function () {
      const contract = await deploy();
      const hash = keccak256(encodePacked(["string"], ["my-policy-v1"]));
      await contract.write.setStorePolicy([hash, CID]);
      assert.equal(await contract.read.storePolicyHash(), hash);
      assert.equal(await contract.read.storePolicyCid(), CID);
    });

    it("empty CID leaves storePolicyCid unchanged", async function () {
      const contract = await deploy();
      const hash1 = keccak256(encodePacked(["string"], ["v1"]));
      const hash2 = keccak256(encodePacked(["string"], ["v2"]));
      await contract.write.setStorePolicy([hash1, CID]);
      await contract.write.setStorePolicy([hash2, ""]);
      assert.equal(await contract.read.storePolicyHash(), hash2);
      assert.equal(await contract.read.storePolicyCid(), CID);
    });

    it("emits PolicyUpdated with hash and current CID", async function () {
      const contract = await deploy();
      const hash = keccak256(encodePacked(["string"], ["my-policy-v1"]));
      await viem.assertions.emitWithArgs(
        contract.write.setStorePolicy([hash, CID]),
        contract,
        "PolicyUpdated",
        [hash, CID],
      );
    });

    it("reverts when called by non-owner", async function () {
      const contract = await deploy();
      const hash = keccak256(encodePacked(["string"], ["my-policy-v1"]));
      await assert.rejects(
        contract.write.setStorePolicy([hash, CID], { account: other.account }),
        /Caller is not the owner/,
      );
    });
  });

  // ─── updateTreasury ────────────────────────────────────────────────────────

  describe("updateTreasury", async function () {
    it("owner can update treasury", async function () {
      const contract = await deploy();
      await contract.write.updateTreasury([other.account.address]);
      assert.equal(await contract.read.treasury(), getAddress(other.account.address));
    });

    it("emits TreasuryUpdated with old and new addresses", async function () {
      const contract = await deploy();
      await viem.assertions.emitWithArgs(
        contract.write.updateTreasury([other.account.address]),
        contract,
        "TreasuryUpdated",
        [getAddress(treasury.account.address), getAddress(other.account.address)],
      );
    });

    it("reverts on zero address", async function () {
      const contract = await deploy();
      await assert.rejects(
        contract.write.updateTreasury(["0x0000000000000000000000000000000000000000"]),
        /Invalid treasury address/,
      );
    });

    it("reverts when called by non-owner", async function () {
      const contract = await deploy();
      await assert.rejects(
        contract.write.updateTreasury([other.account.address], { account: other.account }),
        /Caller is not the owner/,
      );
    });
  });

  // ─── authenticateAgentIdentity ─────────────────────────────────────────────

  describe("authenticateAgentIdentity", async function () {
    it("marks passport as authenticated", async function () {
      const contract = await deploy();
      await contract.write.authenticateAgentIdentity([PASSPORT_ID]);
      const hash = keccak256(encodePacked(["string"], [PASSPORT_ID]));
      assert.equal(await contract.read.isPassportAuthenticated([hash]), true);
    });

    it("emits AgentAuthenticated", async function () {
      const contract = await deploy();
      await viem.assertions.emitWithArgs(
        contract.write.authenticateAgentIdentity([PASSPORT_ID]),
        contract,
        "AgentAuthenticated",
        [PASSPORT_ID, true],
      );
    });

    it("reverts when called by non-owner", async function () {
      const contract = await deploy();
      await assert.rejects(
        contract.write.authenticateAgentIdentity([PASSPORT_ID], { account: other.account }),
        /Caller is not the owner/,
      );
    });
  });

  // ─── settleOrder ───────────────────────────────────────────────────────────

  describe("settleOrder", async function () {
    async function deployAndAuthenticate() {
      const contract = await deploy();
      await contract.write.authenticateAgentIdentity([PASSPORT_ID]);
      return contract;
    }

    it("settles an order and emits PurchaseAttested", async function () {
      const contract = await deployAndAuthenticate();
      const value = parseEther("0.01");
      await viem.assertions.emitWithArgs(
        contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
          account: buyer.account,
          value,
        }),
        contract,
        "PurchaseAttested",
        [getAddress(buyer.account.address), PASSPORT_ID, ORDER_ID, value, 1n],
      );
    });

    it("increments stats after settlement", async function () {
      const contract = await deployAndAuthenticate();
      const value = parseEther("0.05");
      await contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
        account: buyer.account,
        value,
      });
      const [count, volume] = await contract.read.getStats();
      assert.equal(count, 1n);
      assert.equal(volume, value);
    });

    it("accumulates volume across multiple orders", async function () {
      const contract = await deployAndAuthenticate();
      const v1 = parseEther("0.01");
      const v2 = parseEther("0.02");
      await contract.write.settleOrder([PASSPORT_ID, "order-1"], {
        account: buyer.account,
        value: v1,
      });
      await contract.write.settleOrder([PASSPORT_ID, "order-2"], {
        account: buyer.account,
        value: v2,
      });
      const [count, volume] = await contract.read.getStats();
      assert.equal(count, 2n);
      assert.equal(volume, v1 + v2);
    });

    it("marks order as settled (idempotency)", async function () {
      const contract = await deployAndAuthenticate();
      await contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
        account: buyer.account,
        value: parseEther("0.01"),
      });
      const orderHash = keccak256(encodePacked(["string"], [ORDER_ID]));
      assert.equal(await contract.read.isOrderSettled([orderHash]), true);
    });

    it("reverts on duplicate order id", async function () {
      const contract = await deployAndAuthenticate();
      const value = parseEther("0.01");
      await contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
        account: buyer.account,
        value,
      });
      await assert.rejects(
        contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
          account: buyer.account,
          value,
        }),
        /Order already settled/,
      );
    });

    it("reverts when passport is not authenticated", async function () {
      const contract = await deploy();
      await assert.rejects(
        contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
          account: buyer.account,
          value: parseEther("0.01"),
        }),
        /Kite Passport not authenticated/,
      );
    });

    it("reverts when no value is sent", async function () {
      const contract = await deployAndAuthenticate();
      await assert.rejects(
        contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
          account: buyer.account,
          value: 0n,
        }),
        /Settlement requires native value/,
      );
    });
  });

  // ─── withdraw ──────────────────────────────────────────────────────────────

  describe("withdraw", async function () {
    it("sends contract balance to treasury", async function () {
      const contract = await deploy();
      await contract.write.authenticateAgentIdentity([PASSPORT_ID]);
      const value = parseEther("0.1");
      await contract.write.settleOrder([PASSPORT_ID, ORDER_ID], {
        account: buyer.account,
        value,
      });

      const balanceBefore = await publicClient.getBalance({ address: treasury.account.address });
      await contract.write.withdraw();
      const balanceAfter = await publicClient.getBalance({ address: treasury.account.address });

      // treasury balance should have increased by the settled amount (minus gas, which treasury doesn't pay)
      assert.ok(balanceAfter > balanceBefore, "treasury balance did not increase");
    });

    it("reverts when there are no funds", async function () {
      const contract = await deploy();
      await assert.rejects(contract.write.withdraw(), /No funds to withdraw/);
    });
  });

  // ─── receive ───────────────────────────────────────────────────────────────

  describe("receive", async function () {
    it("accepts plain ETH transfers", async function () {
      const contract = await deploy();
      await buyer.sendTransaction({
        to: contract.address,
        value: parseEther("0.5"),
      });
      const balance = await publicClient.getBalance({ address: contract.address });
      assert.equal(balance, parseEther("0.5"));
    });
  });
});
