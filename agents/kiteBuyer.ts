import "dotenv/config";
import { ethers } from "ethers";
import { GokiteAASDK } from "gokite-aa-sdk";
import { ChatGroq } from "@langchain/groq";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  KITE_CHAIN_ID,
  KITE_NETWORK_KEY,
  KITE_PAYMASTER_ADDRESS,
  STOREFRONT_CONTRACT,
  STOREFRONT_ABI,
  TREASURY_CONTRACT,
  USE_TREASURY,
  kiteTestnet,
} from "./shared/kiteChain";
import { GAS_RESERVE_WEI, weiToKite } from "./shared/money";
import { logToSanity } from "./shared/sanityLogger";
import { spendViaTreasury } from "./shared/treasury";
import { withSettlementHealing } from "./shared/selfHealing";
import { loadAgentPolicy, hashPolicy, assertWithinPolicy, PolicyViolation } from "./shared/policy";
import type {
  CheckoutSuccessResponse,
  PaymentRequiredResponse,
} from "./shared/storeApi";

// ─── Startup env validation ───────────────────────────────────────────────────
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
if (!AGENT_PRIVATE_KEY) {
  console.error("[Buyer] AGENT_PRIVATE_KEY is required");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) console.warn("[Buyer] GROQ_API_KEY not set — LLM calls will fail");
if (!process.env.KITE_RPC_URL) console.warn("[Buyer] KITE_RPC_URL not set, using default testnet RPC");

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || "5001";
const MANAGER_URL = process.env.MANAGER_URL || `http://localhost:${PORT}`;
const RPC_URL = process.env.KITE_RPC_URL || kiteTestnet.rpc;
const RPC_URL_ALT = process.env.KITE_RPC_URL_ALT;
const BUNDLER_URL = (process.env.KITE_BUNDLER_URL || `${kiteTestnet.bundler}/`)
  .trim()
  .replace(/\/$/, "");
const PASSPORT_ID = process.env.KITE_PASSPORT_ID || "agp_befecc2a225a4a4cab1f47a9c20562f8";
const AGENT_ID = process.env.AGENT_ID || "buyer-default";
if (USE_TREASURY && !TREASURY_CONTRACT) {
  console.error("[Buyer] USE_TREASURY=true but TREASURY_CONTRACT not set");
  process.exit(1);
}

// ─── Provider ─────────────────────────────────────────────────────────────────
let provider: ethers.JsonRpcProvider;
try {
  provider = new ethers.JsonRpcProvider(RPC_URL, { name: "kite-testnet", chainId: KITE_CHAIN_ID }, { staticNetwork: true });
} catch (e) {
  if (!RPC_URL_ALT) throw e;
  console.log(`[Buyer] Primary RPC failed, trying alternative: ${RPC_URL_ALT}`);
  provider = new ethers.JsonRpcProvider(RPC_URL_ALT, { name: "kite-testnet", chainId: KITE_CHAIN_ID }, { staticNetwork: true });
}

const agentWallet = new ethers.Wallet(AGENT_PRIVATE_KEY, provider);
const WALLET_ADDRESS = agentWallet.address;

async function localSign(hash: string): Promise<string> {
  return await agentWallet.signMessage(ethers.getBytes(hash));
}

function encodeProof(payload: { txHash: string; payer: string; orderId: string }) {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function submitProof(
  sku: string,
  quantity: number,
  payload: { txHash: string; payer: string; orderId: string },
): Promise<string> {
  const xPayment = encodeProof(payload);
  const res = await fetch(`${MANAGER_URL}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Payment": xPayment },
    body: JSON.stringify({ sku, quantity }),
  });
  const text = await res.text();
  if (!res.ok) return `Proof rejected (${res.status}): ${text}`;
  try {
    const parsed = JSON.parse(text) as CheckoutSuccessResponse;
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

// ─── Tools ────────────────────────────────────────────────────────────────────
const searchHardwareTool = new DynamicStructuredTool({
  name: "search_hardware",
  description: "Search the Store Manager catalog. Returns a paginated envelope.",
  schema: z.object({ query: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() }),
  func: async ({ query, page, pageSize }) => {
    const url = new URL(`${MANAGER_URL}/search`);
    if (query) url.searchParams.set("query", query);
    if (page) url.searchParams.set("page", String(page));
    if (pageSize) url.searchParams.set("pageSize", String(pageSize));
    const res = await fetch(url.toString());
    return await res.text();
  },
});

const negotiatePriceTool = new DynamicStructuredTool({
  name: "negotiate_price",
  description: "Negotiate with the Store Manager. Returns JSON with finalPrice or counterOffer.",
  schema: z.object({
    sku: z.string(),
    proposedPrice: z.coerce.number(),
    reason: z.string(),
    history: z.array(z.object({ role: z.enum(["Buyer", "Sales"]), content: z.string() })).optional(),
  }),
  func: async ({ sku, proposedPrice, reason, history }) => {
    const res = await fetch(`${MANAGER_URL}/negotiate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, proposedPrice, reason, history: history ?? [] }),
    });
    return await res.text();
  },
});

const purchaseHardwareTool = new DynamicStructuredTool({
  name: "purchase_hardware",
  description: "Purchase via L402 settlement. Handles 402 challenge, on-chain settleOrder, and proof submission.",
  schema: z.object({
    sku: z.string(),
    // Validate quantity is a positive integer — coerce.number() alone would accept floats and scientific notation.
    quantity: z.coerce.number().int().min(1).max(1_000_000),
  }),
  func: async ({ sku, quantity }) => {
    console.log(`[Buyer] Initiating checkout for ${sku} × ${quantity}...`);

    const initialRes = await fetch(`${MANAGER_URL}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, quantity }),
    });

    if (initialRes.status !== 402) {
      return await initialRes.text();
    }

    const challenge = (await initialRes.json()) as PaymentRequiredResponse;
    const accept = challenge.accepts?.[0];
    if (!accept) return `FATAL ERROR: 402 missing accepts[]. MISSION FAILED.`;
    if (accept.chainId !== KITE_CHAIN_ID) {
      return `FATAL ERROR: Manager wants chain ${accept.chainId}, only Kite (${KITE_CHAIN_ID}) is supported. MISSION FAILED.`;
    }
    if (accept.contract.toLowerCase() !== STOREFRONT_CONTRACT.toLowerCase()) {
      return `FATAL ERROR: Manager wants settlement at ${accept.contract}, expected ${STOREFRONT_CONTRACT}. MISSION FAILED.`;
    }

    let requiredWei: bigint;
    try {
      requiredWei = BigInt(accept.amountWei);
    } catch {
      return `FATAL ERROR: 402.amountWei is not a valid bigint string: ${accept.amountWei}. MISSION FAILED.`;
    }

    const balanceWei = await provider.getBalance(WALLET_ADDRESS);
    if (balanceWei < requiredWei + GAS_RESERVE_WEI) {
      return `FATAL ERROR: Insufficient funds. Need ${weiToKite(requiredWei)} KITE + ${weiToKite(GAS_RESERVE_WEI)} KITE gas reserve, have ${weiToKite(balanceWei)} KITE. MISSION PERMANENTLY FAILED. DO NOT RETRY.`;
    }

    console.log(`[Buyer] 402 received. Settling ${weiToKite(requiredWei)} KITE (${requiredWei} wei) for order ${accept.orderId}...`);

    let txHash: string | undefined;
    let payer = WALLET_ADDRESS;

    if (USE_TREASURY) {
      // Treasury custodies funds; spend(...) carries no value, only authorisation.
      const policy = await loadAgentPolicy(AGENT_ID);
      if (!policy) {
        return `FATAL ERROR: agent ${AGENT_ID} not registered in agentRegistry. MISSION FAILED.`;
      }
      try {
        assertWithinPolicy(policy, {
          vendor: accept.contract,
          amountKite: Number(weiToKite(requiredWei)),
        });
      } catch (err) {
        if (err instanceof PolicyViolation) {
          return `FATAL ERROR: ${err.message}. MISSION FAILED.`;
        }
        throw err;
      }
      const policyHash = hashPolicy(policy);

      try {
        const result = await withSettlementHealing(
          async () =>
            spendViaTreasury({
              agentId: AGENT_ID,
              recipient: accept.contract,
              amountWei: requiredWei,
              orderId: accept.orderId,
              passportId: PASSPORT_ID,
              policyHash,
              signer: agentWallet,
              rpcUrl: RPC_URL,
              bundlerUrl: BUNDLER_URL,
            }),
          { agentId: AGENT_ID, agentName: "Buyer", orderId: accept.orderId, sku },
        );
        txHash = result.txHash;
        payer = result.payer;
      } catch (err: any) {
        return `Treasury spend failed: ${err.message ?? err}`;
      }
    } else {
      const settleData = new ethers.Interface(STOREFRONT_ABI).encodeFunctionData("settleOrder", [
        PASSPORT_ID,
        accept.orderId,
      ]);

      // Try Account-Abstraction path first.
      try {
        const aa = new GokiteAASDK(KITE_NETWORK_KEY, RPC_URL, BUNDLER_URL);
        const result = await aa.sendUserOperationAndWait(
          WALLET_ADDRESS,
          {
            targets: [accept.contract],
            values: [requiredWei],
            callDatas: [settleData],
          },
          async (hash) => localSign(hash),
          undefined,
          KITE_PAYMASTER_ADDRESS,
        );
        if (result.status.status === "success") {
          txHash = result.status.transactionHash;
        } else {
          console.log(`[Buyer] AA failed: ${result.status.reason}. Falling back to EOA.`);
        }
      } catch (err: any) {
        console.log(`[Buyer] AA error: ${err.message ?? err}. Falling back to EOA.`);
      }

      // EOA fallback
      if (!txHash) {
        try {
          const contract = new ethers.Contract(accept.contract, STOREFRONT_ABI, agentWallet);
          const tx = await contract.settleOrder(PASSPORT_ID, accept.orderId, {
            value: requiredWei,
          });
          console.log(`[Buyer] EOA tx sent: ${tx.hash}`);
          const receipt = await tx.wait();
          if (receipt?.status !== 1) return `EOA settlement failed (tx ${tx.hash}).`;
          txHash = tx.hash;
          payer = agentWallet.address;
        } catch (err: any) {
          if (err.code === "INSUFFICIENT_FUNDS" || err.message?.includes("insufficient funds")) {
            return `FATAL: Insufficient funds for ${weiToKite(requiredWei)} KITE. MISSION FAILED.`;
          }
          return `Transaction failed: ${err.message ?? "Unknown error"}`;
        }
      }
    }

    const proofResult = await submitProof(sku, quantity, {
      txHash: txHash!,
      payer,
      orderId: accept.orderId,
    });
    if (proofResult.startsWith("Proof rejected")) {
      // Settlement succeeded on-chain but the manager rejected the proof. Retrying
      // purchase_hardware would re-issue a 402 and try to settle a *new* order — wasting funds.
      // Surface a structured marker so the LLM uses submit_proof to retry with the existing tx.
      return `SETTLEMENT_OK_PROOF_FAILED orderId=${accept.orderId} txHash=${txHash} payer=${payer} sku=${sku} quantity=${quantity} :: ${proofResult}`;
    }
    logToSanity("Buyer", `✅ Purchase complete: ${proofResult}`, "success");
    return proofResult;
  },
});

const submitProofTool = new DynamicStructuredTool({
  name: "submit_proof",
  description:
    "Resubmit a settlement proof for an order that was already paid on-chain. Use this ONLY when purchase_hardware returned SETTLEMENT_OK_PROOF_FAILED — never to start a new purchase.",
  schema: z.object({
    sku: z.string(),
    quantity: z.coerce.number().int().min(1),
    orderId: z.string(),
    txHash: z.string(),
    payer: z.string(),
  }),
  func: async ({ sku, quantity, orderId, txHash, payer }) => {
    return await submitProof(sku, quantity, { txHash, payer, orderId });
  },
});

async function readWithRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1500): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`[Buyer] Read attempt ${attempt}/${retries} failed: ${err.message ?? err}. Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

async function runSwarmAgent() {
  const llm = new ChatGroq({ model: "llama-3.3-70b-versatile", temperature: 0.5 });
  const agent = createReactAgent({
    llm,
    tools: [searchHardwareTool, purchaseHardwareTool, submitProofTool, negotiatePriceTool],
    prompt: `You are a high-stakes Hardware Procurement Agent.
Your mission is to find the best deals on ASIC miners and complete the purchase.

Always use the provided tools to interact with the world.
When calling a tool, ensure you provide valid JSON arguments.

STRICT NEGOTIATION RULES:
1. Search for hardware and identify SKU.
2. You are allowed a maximum of 3 haggle attempts per SKU.
3. If price > balance, you MUST either negotiate lower or FAIL.
4. If the gap between price and balance is more than 20%, do not haggle; FAIL immediately.
5. After 3 attempts, accept the Manager's last price or FAIL.
6. TERMINATION CLAUSE: If a tool returns a "FATAL ERROR", stop immediately and summarize the failure. DO NOT call any more tools.
7. PROOF RETRY: If purchase_hardware returns "SETTLEMENT_OK_PROOF_FAILED", the on-chain payment already succeeded. DO NOT call purchase_hardware again — it would settle a second time and burn funds. Instead, parse the orderId, txHash, and payer from the marker and call submit_proof exactly once. If submit_proof still fails, stop and report the orderId + txHash so a human can reconcile.`,
  });

  console.log("Initializing Agentic Hardware Buyer...");

  let aaBalance = 0n;
  try {
    aaBalance = await readWithRetry(() => provider.getBalance(WALLET_ADDRESS), 4, 2000);
  } catch (err: any) {
    console.warn(`[Buyer] ⚠️ Could not fetch wallet balance from RPC: ${err.message ?? err}. Proceeding with default estimate.`);
  }
  console.log(`[Buyer] 💰 Wallet ${WALLET_ADDRESS} balance: ${weiToKite(aaBalance)} KITE`);
  if (aaBalance === 0n) console.warn("[Buyer] ⚠️ Wallet empty — settlement might fail.");

  const mission = process.argv[2] || "Search for a Bitmain Antminer S21 and purchase 1 unit at the best possible price.";
  console.log(`[Task]: ${mission}`);

  const result = await agent.invoke({ messages: [new HumanMessage(mission)] }, { recursionLimit: 15 });
  console.log("[Result]:", result.messages[result.messages.length - 1].content);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
let stopping = false;
process.on("SIGINT", () => {
  if (stopping) return;
  stopping = true;
  console.log("[Buyer] SIGINT received — will exit after current operation completes");
});
process.on("SIGTERM", () => {
  if (stopping) return;
  stopping = true;
  console.log("[Buyer] SIGTERM received — will exit after current operation completes");
});

runSwarmAgent().catch((err) => {
  console.error("[Buyer] Fatal:", err);
  process.exit(1);
});
