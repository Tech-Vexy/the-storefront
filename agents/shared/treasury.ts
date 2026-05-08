import { ethers } from "ethers";
import { GokiteAASDK } from "gokite-aa-sdk";
import { KITE_NETWORK_KEY, TREASURY_CONTRACT, kiteTestnet } from "./kiteChain";
import { TREASURY_ABI } from "./treasuryAbi";

export interface SpendArgs {
  agentId: string;
  recipient: string;
  amountWei: bigint;
  orderId: string; // string form; passed to attestation. Hashed for treasury idempotency.
  passportId: string;
  policyHash: string; // bytes32 hex
  signer: ethers.Wallet;
  rpcUrl?: string;
  bundlerUrl?: string;
  preferAA?: boolean;
}

export interface SpendResult {
  txHash: string;
  payer: string;
  via: "aa" | "eoa";
}

// TODO(session-keys): replace raw private key signers (`SpendArgs.signer`) with
// ERC-4337 session keys so a leaked agent key has bounded blast radius. Treasury
// already enforces caps; session keys would close the rotation gap.
export async function spendViaTreasury(args: SpendArgs): Promise<SpendResult> {
  if (!TREASURY_CONTRACT) {
    throw new Error("TREASURY_CONTRACT not configured. Run scripts/deploy-treasury.ts first.");
  }
  const agentIdBytes32 = ethers.id(args.agentId);
  const orderIdBytes32 = ethers.id(args.orderId);

  const iface = new ethers.Interface(TREASURY_ABI);
  const callData = iface.encodeFunctionData("spend", [
    agentIdBytes32,
    args.recipient,
    args.amountWei,
    orderIdBytes32,
    args.passportId,
    args.policyHash,
  ]);

  const rpcUrl = args.rpcUrl || kiteTestnet.rpc;
  const bundlerUrl = (args.bundlerUrl || `${kiteTestnet.bundler}/`).trim().replace(/\/$/, "");
  const walletAddress = args.signer.address;

  // Treasury custodies the funds, so the spend(...) call carries no value — only
  // gas. That makes the AA path strictly an authorisation tx, not a value transfer.
  if (args.preferAA !== false) {
    try {
      const aa = new GokiteAASDK(KITE_NETWORK_KEY, rpcUrl, bundlerUrl);
      const result = await aa.sendUserOperationAndWait(
        walletAddress,
        {
          targets: [TREASURY_CONTRACT],
          values: [0n],
          callDatas: [callData],
        },
        async (hash) => args.signer.signMessage(ethers.getBytes(hash)),
      );
      if (result.status.status === "success" && result.status.transactionHash) {
        return { txHash: result.status.transactionHash, payer: walletAddress, via: "aa" };
      }
      console.warn(`[Treasury] AA spend failed: ${result.status.reason ?? "unknown"} — falling back to EOA`);
    } catch (err: any) {
      console.warn(`[Treasury] AA error: ${err?.message ?? err} — falling back to EOA`);
    }
  }

  const contract = new ethers.Contract(TREASURY_CONTRACT, TREASURY_ABI, args.signer);
  const tx = await contract.spend(
    agentIdBytes32,
    args.recipient,
    args.amountWei,
    orderIdBytes32,
    args.passportId,
    args.policyHash,
  );
  const receipt = await tx.wait();
  if (receipt?.status !== 1) {
    throw new Error(`EOA spend failed (tx ${tx.hash})`);
  }
  return { txHash: tx.hash, payer: walletAddress, via: "eoa" };
}
