import "dotenv/config";
import { ethers } from "ethers";
import { ChatGroq } from "@langchain/groq";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { KITE_CHAIN_ID, STOREFRONT_ABI, STOREFRONT_CONTRACT, TREASURY_CONTRACT, USE_TREASURY, kiteTestnet } from "./shared/kiteChain";
import { GAS_RESERVE_WEI, weiToKite } from "./shared/money";
import { logToSanity } from "./shared/sanityLogger";
import { Coinbase, Wallet } from "@coinbase/coinbase-sdk";
import { spendViaTreasury } from "./shared/treasury";
import { withSettlementHealing } from "./shared/selfHealing";
import { loadAgentPolicy, hashPolicy, assertWithinPolicy, PolicyViolation } from "./shared/policy";

// ─── Startup env validation ───────────────────────────────────────────────────
if (!process.env.KITE_PRIVATE_KEY) {
  console.error("[CFO] KITE_PRIVATE_KEY is required");
  process.exit(1);
}
if (!process.env.GROQ_API_KEY) console.warn("[CFO] GROQ_API_KEY not set — LLM calls will fail");
if (!process.env.KITE_RPC_URL) console.warn("[CFO] KITE_RPC_URL not set, using default testnet RPC");

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || "5001";
const MANAGER_URL = process.env.MANAGER_URL || `http://localhost:${PORT}`;
const RPC_URL = process.env.KITE_RPC_URL || kiteTestnet.rpc;

async function getSupplierReputation(url: string) {
  try {
    const res = await fetch(`${MANAGER_URL}/reputation`);
    const db = await res.json();
    return db[url] || { score: 100 };
  } catch (e) {
    return { score: 100 };
  }
}

const SUPPLIER_URLS = ["http://localhost:5002", "http://localhost:5003"];
const SUPPLIER_URL = SUPPLIER_URLS[0];
const TREASURY_PASSPORT_ID = process.env.TREASURY_PASSPORT_ID || process.env.KITE_PASSPORT_ID || "agp_treasury_default";
const CFO_AGENT_ID = process.env.CFO_AGENT_ID || "cfo-default";
if (USE_TREASURY && !TREASURY_CONTRACT) {
  console.error("[CFO] USE_TREASURY=true but TREASURY_CONTRACT not set");
  process.exit(1);
}
const POLL_INTERVAL_MS = Number(process.env.RESTOCK_INTERVAL_MS || 60_000);
const POLL_JITTER_MS = Number(process.env.RESTOCK_JITTER_MS || 10_000);
// Cap backoff so the agent never waits more than 5 minutes between retries.
const MAX_BACKOFF_MS = Number(process.env.RESTOCK_MAX_BACKOFF_MS || 5 * 60_000);
const RUN_ONCE = process.argv.includes("--once");

async function logSwarm(message: string) {
  await logToSanity("CFO", message, "info");
}

const provider = new ethers.JsonRpcProvider(RPC_URL, { name: "kite-testnet", chainId: KITE_CHAIN_ID }, { staticNetwork: true });
const treasuryWallet = new ethers.Wallet(process.env.KITE_PRIVATE_KEY as string, provider);

// ─── Tools ────────────────────────────────────────────────────────────────────
const getInventoryTool = new DynamicStructuredTool({
  name: "get_inventory",
  description: "Get the current inventory levels from the Store Manager.",
  schema: z.object({}),
  func: async () => {
    const res = await fetch(`${MANAGER_URL}/search`);
    const products = await res.json();
    return JSON.stringify(products);
  },
});

const checkTreasuryTool = new DynamicStructuredTool({
  name: "check_treasury",
  description: "Check the current balance of the Store Treasury wallet.",
  schema: z.object({}),
  func: async () => {
    const balance = await provider.getBalance(treasuryWallet.address);
    return `${weiToKite(balance)} KITE`;
  },
});

const negotiateWholesaleTool = new DynamicStructuredTool({
  name: "negotiate_wholesale",
  description: "Negotiate with the Supplier for bulk pricing.",
  schema: z.object({
    sku: z.string(),
    quantity: z.number(),
    proposedPrice: z.number(),
  }),
  func: async ({ sku, quantity, proposedPrice }) => {
    logSwarm(`[CFO] 🤝 Negotiating with Supplier for ${quantity}x ${sku} @ ${proposedPrice} KITE...`);
    const res = await fetch(`${SUPPLIER_URL}/negotiate-wholesale`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, quantity, proposedPrice, history: [] }),
    });
    return await res.text();
  },
});



const offrampToBankTool = new DynamicStructuredTool({
  name: "offramp_to_bank",
  description: "Move revenue from the store's crypto wallet to the merchant's fiat bank account using Coinbase CDP.",
  schema: z.object({
    amountUsdc: z.number(),
    currency: z.string().default("USD"),
  }),
  func: async ({ amountUsdc, currency }) => {
    logSwarm(`[CFO] 🏦 Initiating Coinbase CDP Off-Ramp for ${amountUsdc} USDC...`);
    
    try {
      // Configure CDP
      const apiKeyName = process.env.CDP_API_KEY_NAME;
      const apiKeyPrivate = process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n");

      if (!apiKeyName || !apiKeyPrivate) {
        throw new Error("CDP_API_KEY_NAME and CDP_API_KEY_PRIVATE_KEY are required for real off-ramp.");
      }

      Coinbase.configure({ apiKeyName, privateKey: apiKeyPrivate });

      // In a real scenario, we'd fetch the existing wallet or create one.
      // This is a "real-ready" implementation using the SDK.
      const wallet = await Wallet.create();
      logSwarm(`[CFO] Created/Fetched CDP Wallet: ${wallet.getId()}`);

      // TODO(fiat): replace placeholder bank account ID with merchant onboarding flow
      const transfer = await wallet.createTransfer({
        amount: amountUsdc,
        assetId: "usdc",
        destination: "merchant-bank-account-id",
      });

      await transfer.wait();
      
      const message = `✅ Off-ramp successful. Tx: ${transfer.getTransactionHash()}. ${amountUsdc} USDC routed to merchant bank account via Coinbase CDP.`;
      logSwarm(`[CFO] ${message}`);
      
      await fetch(`${MANAGER_URL}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "CFO Agent",
          message,
          type: "economic"
        })
      });

      return message;
    } catch (err: any) {
      const errorMsg = `❌ CDP Off-ramp failed: ${err.message}`;
      logSwarm(`[CFO] ${errorMsg}`);
      return errorMsg;
    }
  },
});

const withdrawRevenueTool = new DynamicStructuredTool({
  name: "withdraw_revenue",
  description: "Withdraw accumulated sales revenue from the StorefrontAttestation contract to the treasury wallet.",
  schema: z.object({}),
  func: async () => {
    try {
      const contract = new ethers.Contract(STOREFRONT_CONTRACT, STOREFRONT_ABI, treasuryWallet);
      const balance = await provider.getBalance(STOREFRONT_CONTRACT);
      if (balance === 0n) return "No revenue to withdraw.";
      
      logSwarm(`[CFO] 🏧 Withdrawing ${weiToKite(balance)} KITE in revenue from contract...`);
      const tx = await contract.withdraw();
      await tx.wait();
      return `Successfully withdrew ${weiToKite(balance)} KITE to treasury wallet.`;
    } catch (err: any) {
      return `Withdrawal failed: ${err.message}`;
    }
  },
});

const paySupplierTool = new DynamicStructuredTool({
  name: "pay_supplier",
  description: "Settle a restock order on-chain via StorefrontAttestation. Quotes the supplier, calls settleOrder on Kite, then submits the proof.",
  schema: z.object({
    sku: z.string(),
    quantity: z.number(),
    pricePerUnit: z.number(),
  }),
  func: async ({ sku, quantity, pricePerUnit }) => {
    const totalCost = pricePerUnit * quantity;
    logSwarm(`[CFO] 💳 Settling ${quantity}x ${sku} (${totalCost} KITE) on Kite chain ${KITE_CHAIN_ID}...`);

    let quote: {
      orderId: string; amountWei: string; amount: string;
      chainId: number; contract: string; passportId: string; expiresAt: string;
    };
    try {
      const quoteRes = await fetch(`${SUPPLIER_URL}/supply-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, quantity, pricePerUnit }),
      });
      if (!quoteRes.ok) return `Quote rejected (${quoteRes.status}): ${await quoteRes.text()}`;
      quote = await quoteRes.json() as any;
    } catch (err: any) {
      return `Quote failed: ${err.message ?? err}`;
    }

    if (quote.chainId !== KITE_CHAIN_ID) {
      return `FATAL: Supplier wants chain ${quote.chainId}, only Kite (${KITE_CHAIN_ID}) is supported.`;
    }
    if (quote.contract.toLowerCase() !== STOREFRONT_CONTRACT.toLowerCase()) {
      return `FATAL: Supplier wants settlement at ${quote.contract}, expected ${STOREFRONT_CONTRACT}.`;
    }

    let requiredWei: bigint;
    try {
      requiredWei = BigInt(quote.amountWei);
    } catch {
      return `FATAL: Supplier quote.amountWei is not a valid bigint string: ${quote.amountWei}`;
    }

    let txHash: string;
    if (USE_TREASURY) {
      const policy = await loadAgentPolicy(CFO_AGENT_ID);
      if (!policy) return `FATAL: agent ${CFO_AGENT_ID} not registered in agentRegistry.`;
      try {
        assertWithinPolicy(policy, {
          vendor: quote.contract,
          category: "wholesale",
          amountKite: Number(weiToKite(requiredWei)),
        });
      } catch (err) {
        if (err instanceof PolicyViolation) return `FATAL: ${err.message}`;
        throw err;
      }
      const policyHash = hashPolicy(policy);
      try {
        const result = await withSettlementHealing(
          async () =>
            spendViaTreasury({
              agentId: CFO_AGENT_ID,
              recipient: quote.contract,
              amountWei: requiredWei,
              orderId: quote.orderId,
              passportId: TREASURY_PASSPORT_ID,
              policyHash,
              signer: treasuryWallet,
              rpcUrl: RPC_URL,
            }),
          { agentId: CFO_AGENT_ID, agentName: "CFO", orderId: quote.orderId, sku },
        );
        txHash = result.txHash;
        logSwarm(`[CFO] 🔗 Treasury spend tx (${result.via}): ${txHash}`);
      } catch (err: any) {
        logSwarm(`[CFO] ❌ Treasury spend error: ${err.message}`);
        return `Treasury spend failed: ${err.message ?? err}`;
      }
    } else {
      const balance = await provider.getBalance(treasuryWallet.address);
      if (balance < requiredWei + GAS_RESERVE_WEI) {
        return `FATAL: Treasury has ${weiToKite(balance)} KITE, needs ${weiToKite(requiredWei)} KITE + ${weiToKite(GAS_RESERVE_WEI)} KITE gas reserve.`;
      }
      try {
        const contract = new ethers.Contract(quote.contract, STOREFRONT_ABI, treasuryWallet);
        const tx = await contract.settleOrder(TREASURY_PASSPORT_ID, quote.orderId, { value: requiredWei });
        logSwarm(`[CFO] 🔗 settleOrder tx: ${tx.hash}`);
        const receipt = await tx.wait();
        if (receipt?.status !== 1) return `settleOrder failed (tx ${tx.hash}).`;
        txHash = tx.hash;
      } catch (err: any) {
        logSwarm(`[CFO] ❌ settleOrder error: ${err.message}`);
        return `settleOrder failed: ${err.message ?? err}`;
      }
    }

    const supplyRes = await fetch(`${SUPPLIER_URL}/supply-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: quote.orderId, txHash }),
    });
    return await supplyRes.text();
  },
});

// ─── Agent loop ───────────────────────────────────────────────────────────────
async function runRestockAgent() {
  const llm = new ChatGroq({ model: "llama-3.3-70b-versatile", temperature: 0.2 });
  const agent = createReactAgent({
    llm,
    tools: [getInventoryTool, checkTreasuryTool, negotiateWholesaleTool, paySupplierTool, withdrawRevenueTool, offrampToBankTool],
    prompt: `You are the CFO and Logistics Agent for the Storefront Swarm.
    Your mission is to ensure the store never runs out of stock while maintaining profitability.
    
    MISSION PARAMETERS:
    1. Check inventory levels regularly.
    2. If any item has stock < 10 units, initiate a restock.
    3. Check the treasury balance first. You must have enough KITE to cover the order.
    4. Negotiate with the Supplier for the best bulk price.
    5. Pay the Supplier once a deal is reached.
    6. Report the tracking number to the swarm.
    7. If the treasury balance is low, use withdraw_revenue to pull sales proceeds from the contract.
    8. Use offramp_to_bank periodically to convert excess crypto revenue into fiat for the merchant.
    
    STRICT FINANCIAL RULES:
    - Never pay more than 80% of the retail price (found in inventory logs).
    - If treasury is below 500 KITE, alert the swarm and stop restocking high-value items.
    
    Current Date: ${new Date().toLocaleDateString()}`,
  });

  console.log("🚀 Agentic Restock CFO is ONLINE...");

  let consecutiveFailures = 0;
  let stop = false;

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`[CFO] ${sig} received, finishing current audit then exiting...`);
      stop = true;
    });
  }

  while (!stop) {
    console.log("\n[CFO] Starting supply chain audit...");
    try {
      const result = await agent.invoke({
        messages: [new HumanMessage("Perform a supply chain audit. Check inventory and restock if needed.")],
      }, { recursionLimit: 20 });
      console.log("[CFO Result]:", result.messages[result.messages.length - 1].content);
      consecutiveFailures = 0;
    } catch (err: any) {
      consecutiveFailures += 1;
      console.error(`[CFO] Audit failed (${consecutiveFailures}): ${err.message ?? err}`);
    }

    if (RUN_ONCE) break;

    // Exponential backoff capped at MAX_BACKOFF_MS to prevent excessively long waits.
    const backoffFactor = Math.min(consecutiveFailures, 6);
    const base = Math.min(POLL_INTERVAL_MS * Math.pow(2, backoffFactor), MAX_BACKOFF_MS);
    const jitter = Math.floor(Math.random() * POLL_JITTER_MS);
    const wait = base + jitter;
    console.log(`[CFO] Next audit in ${Math.round(wait / 1000)}s.`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait);
      // Allow the process to exit cleanly if stop is set while waiting.
      if (stop) { clearTimeout(timer); resolve(); }
    });
  }

  console.log("[CFO] Shutting down.");
}

runRestockAgent().catch((err) => {
  console.error("[CFO] Fatal:", err);
  process.exit(1);
});
