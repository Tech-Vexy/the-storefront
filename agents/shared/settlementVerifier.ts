import { ethers } from "ethers";
import { KITE_CHAIN_ID, STOREFRONT_ABI, STOREFRONT_CONTRACT } from "./kiteChain";
import { weiToKite } from "./money";

const storefrontIface = new ethers.Interface(STOREFRONT_ABI);

export type VerificationFailure =
  | "PAYMENT_NOT_MINED"
  | "PAYMENT_NOT_FOUND"
  | "WRONG_CHAIN"
  | "WRONG_CONTRACT"
  | "UNDERPAID"
  | "ATTESTATION_MISSING"
  | "RPC_UNAVAILABLE";

export interface VerificationOk {
  ok: true;
  txHash: string;
  payer: string;
  amountWei: bigint;
  passportId: string;
  orderId: string;
}

export interface VerificationErr {
  ok: false;
  code: VerificationFailure;
  message: string;
}

export type VerificationResult = VerificationOk | VerificationErr;

export interface VerifyParams {
  provider: ethers.JsonRpcProvider;
  txHash: string;
  expectedOrderId: string;
  /** Canonical quoted amount in wei. tx.value must be >= this. */
  expectedAmountWei: bigint;
  contract?: string;
}

export async function verifyOnChainSettlement(
  { provider, txHash, expectedOrderId, expectedAmountWei, contract = STOREFRONT_CONTRACT }: VerifyParams,
): Promise<VerificationResult> {
  let receipt: ethers.TransactionReceipt | null;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (err: any) {
    return { ok: false, code: "RPC_UNAVAILABLE", message: err.message ?? "RPC failure" };
  }
  if (!receipt || receipt.status !== 1) {
    return { ok: false, code: "PAYMENT_NOT_MINED", message: "Transaction not mined or reverted" };
  }

  const tx = await provider.getTransaction(txHash);
  if (!tx) return { ok: false, code: "PAYMENT_NOT_FOUND", message: "Transaction missing" };
  if (Number(tx.chainId) !== KITE_CHAIN_ID) {
    return { ok: false, code: "WRONG_CHAIN", message: `Settlement must be on Kite chain ${KITE_CHAIN_ID}` };
  }
  if ((tx.to ?? "").toLowerCase() !== contract.toLowerCase()) {
    return { ok: false, code: "WRONG_CONTRACT", message: `Payment must target ${contract}` };
  }

  if (tx.value < expectedAmountWei) {
    return {
      ok: false,
      code: "UNDERPAID",
      message: `Need ${weiToKite(expectedAmountWei)} KITE, got ${weiToKite(tx.value)} KITE`,
    };
  }

  const attested = receipt.logs
    .map((log) => {
      try { return storefrontIface.parseLog(log); } catch { return null; }
    })
    .find((p) => p?.name === "PurchaseAttested" && p.args.orderId === expectedOrderId);

  if (!attested) {
    return { ok: false, code: "ATTESTATION_MISSING", message: `PurchaseAttested(${expectedOrderId}) not found` };
  }

  return {
    ok: true,
    txHash,
    payer: attested.args.operatorWallet as string,
    amountWei: attested.args.amountPaidWei as bigint,
    passportId: attested.args.kitePassportId as string,
    orderId: attested.args.orderId as string,
  };
}
