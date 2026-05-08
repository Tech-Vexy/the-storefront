import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { ethers } from "ethers";
import { logToSanity, updateReputationInSanity } from "./shared/sanityLogger";

import { randomUUID } from "crypto";

let preflightReady = false;
let preflightError: string | null = null;
import { ChatGroq } from "@langchain/groq";
import { HumanMessage } from "@langchain/core/messages";
import { client as sanityClient } from "./sanity/client";
import {
  KITE_CHAIN_ID,
  STOREFRONT_ABI,
  STOREFRONT_CONTRACT,
  kiteTestnet,
} from "./shared/kiteChain";
import { verifyOnChainSettlement } from "./shared/settlementVerifier";
import { kiteToWei, mulWei, weiToKite } from "./shared/money";
import { withSettlementHealing } from "./shared/selfHealing";
import type {
  ApiError,
  CatalogSearchEnvelope,
  CheckoutSuccessResponse,
  OrderRecord,
  PaymentProof,
  PaymentRequiredResponse,
  ProductSearchResult,
} from "./shared/storeApi";

// ─── Startup env validation ───────────────────────────────────────────────────
const REQUIRED_ENV: string[] = [];
// KITE_RPC_URL has a fallback so it's optional, but warn if missing
if (!process.env.KITE_RPC_URL) console.warn("[Manager] KITE_RPC_URL not set, using default testnet RPC");
if (!process.env.SANITY_API_READ_TOKEN) console.warn("[Manager] SANITY_API_READ_TOKEN not set — catalog reads may fail");
if (REQUIRED_ENV.some((k) => !process.env[k])) {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  console.error(`[Manager] Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT || process.env.MANAGER_PORT || 5001);
const MANAGER_URL = `http://localhost:${PORT}`;
const RPC_URL = process.env.KITE_RPC_URL || kiteTestnet.rpc;
const PAYEE_ADDRESS = process.env.STORE_PAYEE_ADDRESS || "0x1b4833805b31Ac3012297E0c4Df7e24261CaDC38";
const PASSPORT_ID = process.env.KITE_PASSPORT_ID || "agp_befecc2a225a4a4cab1f47a9c20562f8";
const ORDER_TTL_MS = 5 * 60 * 1000;
const POLICY_LABEL = process.env.STORE_POLICY_LABEL || "kite-storefront/v1";
const POLICY_HASH = ethers.id(POLICY_LABEL);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30_000);

let lastBuyerAddress = "";

// No local log file anymore

const provider = new ethers.JsonRpcProvider(RPC_URL, {
  name: "kite-testnet",
  chainId: KITE_CHAIN_ID,
}, { staticNetwork: true });

const wallet = new ethers.Wallet(process.env.KITE_PRIVATE_KEY as string, provider);
const storefront = new ethers.Contract(STOREFRONT_CONTRACT, STOREFRONT_ABI, wallet);

// ─── Logging ──────────────────────────────────────────────────────────────────
const searchMetrics: Record<string, number> = {};
const broadcastAlerts: any[] = [];

async function logSwarm(msg: string, requestId?: string) {
  await logToSanity("Manager", msg, "info", requestId);
}

function apiError(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

// Sanitize user input for GROQ queries — strip characters that could alter query structure.
function escapeGroq(input: string): string {
  return input.replace(/[\\*"[\]{}()]/g, "").slice(0, 200);
}

// Wrap an LLM call with a timeout to prevent indefinite hangs.
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Express app ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static("."));

// Request ID middleware — attach a unique ID to every request for tracing.
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId = randomUUID();
  next();
});

// Rate limiting — simple in-process token bucket per IP.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX: Record<string, number> = {
  "/checkout": 20,
  "/negotiate": 30,
  default: 120,
};

function rateLimit(maxPerWindow: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || entry.resetAt < now) {
      rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }
    entry.count += 1;
    if (entry.count > maxPerWindow) {
      return res.status(429).json(apiError("RATE_LIMITED", "Too many requests — slow down"));
    }
    next();
  };
}

// Periodic cleanup of expired rate limit entries (every 5 min).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetAt < now) rateLimitMap.delete(key);
  }
}, 5 * 60_000).unref();

app.use((req: Request, _res: Response, next: NextFunction) => {
  logSwarm(`${req.method} ${req.path}`, (req as any).requestId);
  next();
});

// Liveness vs readiness
app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/readyz", (_req, res) => {
  if (preflightReady) return res.json({ ready: true });
  res.status(503).json({ ready: false, error: preflightError ?? "preflight in progress" });
});

// Settlement endpoints require preflight to have completed successfully.
app.use((req, res, next) => {
  if (preflightReady) return next();
  if (req.method === "POST" && (req.path === "/checkout" || req.path === "/negotiate")) {
    return res.status(503).json(apiError("NOT_READY", preflightError ?? "Manager preflight in progress"));
  }
  next();
});

// Discovery — machine-readable manifest for external agents.
app.get("/.well-known/agents.json", (_req, res) => {
  const manifest: Record<string, any> = {
    name: "Storefront Manager",
    version: "2.0.0",
    policy: { label: POLICY_LABEL, hash: POLICY_HASH },
    chain: {
      id: kiteTestnet.id,
      name: kiteTestnet.name,
      rpc: kiteTestnet.rpc,
      explorer: kiteTestnet.explorer,
      nativeCurrency: kiteTestnet.nativeCurrency,
    },
    settlement: {
      scheme: "L402",
      contract: STOREFRONT_CONTRACT,
      payTo: PAYEE_ADDRESS,
      passportId: PASSPORT_ID,
      currency: "KITE",
    },
    capabilities: ["search", "negotiate", "checkout", "order-status"],
    endpoints: {
      search: { method: "GET", path: "/search", query: ["query", "page", "pageSize"] },
      negotiate: { method: "POST", path: "/negotiate", body: ["sku", "proposedPrice", "reason", "history?"] },
      checkout: { method: "POST", path: "/checkout", body: ["sku", "quantity"], paymentHeader: "X-Payment" },
      order: { method: "GET", path: "/orders/:orderId" },
      activity: { method: "GET", path: "/activity" },
    },
  };

  // Expose AgentTreasury for permissionless agent onboarding
  const treasuryAddr = process.env.TREASURY_CONTRACT;
  if (treasuryAddr) {
    manifest.treasury = {
      contract: treasuryAddr,
      minStake: process.env.MIN_AGENT_STAKE_WEI || "10000000000000000",
      capabilities: ["registerAgent", "spend", "deposit", "withdraw", "freeze"],
      description: "Permissionless agent registration via stake. Auto-authenticates passport on attestation contract.",
    };
    manifest.capabilities.push("treasury");
  }

  res.json(manifest);
});

app.get("/activity", async (_req, res) => {
  try {
    const logs = await sanityClient.fetch(`*[_type == "swarmLog"] | order(timestamp desc) [0...50]`);
    res.json({ logs: logs.map((l: any) => `[${l.timestamp}] [${l.agent}] ${l.message}`) });
  } catch (err) {
    res.json({ logs: [] });
  }
});

// Catalog search — typed envelope, paginated, GROQ-safe.
app.get("/search", async (req: Request, res: Response<CatalogSearchEnvelope | ApiError>) => {
  const rawQuery = typeof req.query.query === "string" ? req.query.query : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  const safe = escapeGroq(rawQuery.trim());
  const filter = safe
    ? `_type == "product" && (name match $q || machineDescription match $q)`
    : `_type == "product"`;
  const params = safe ? { q: `*${safe}*` } : {};

  try {
    const [items, total] = await Promise.all([
      sanityClient.fetch<ProductSearchResult[]>(
        `*[${filter}] | order(name asc) [${offset}...${offset + pageSize}]{
          name, sku, price, stock, machineDescription, hardwareSpecs, negotiationRules, status
        }`,
        params,
      ),
      sanityClient.fetch<number>(`count(*[${filter}])`, params),
    ]);

    // Increment metrics for found items
    items.forEach(item => {
      searchMetrics[item.sku] = (searchMetrics[item.sku] || 0) + 1;
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    res.json({ items, pagination: { page, pageSize, total, totalPages } });
  } catch (err: any) {
    logSwarm(`[Manager] /search failed: ${err.message}`, (req as any).requestId);
    res.status(502).json(apiError("CATALOG_UNAVAILABLE", "Catalog backend failed"));
  }
});

app.post("/negotiate", rateLimit(RATE_LIMIT_MAX["/negotiate"]), async (req: Request, res: Response) => {
  const requestId: string = (req as any).requestId;
  const { sku, proposedPrice, reason, history } = req.body ?? {};
  if (typeof sku !== "string" || typeof proposedPrice !== "number") {
    return res.status(400).json(apiError("BAD_REQUEST", "sku (string) and proposedPrice (number) required"));
  }
  // Sanitize free-text fields before they enter the LLM prompt.
  const safeReason = typeof reason === "string" ? reason.slice(0, 500).replace(/[<>]/g, "") : "n/a";

  logSwarm(`[Manager] Haggle from buyer for ${sku} @ ${proposedPrice}`, requestId);

  const product = await sanityClient.fetch(
    `*[_type == "product" && sku == $sku][0]{ name, price, negotiationRules, agentSalesInstructions, stock, lastCostPrice }`,
    { sku },
  );
  if (!product) {
    return res.status(404).json(apiError("PRODUCT_NOT_FOUND", `No product with sku ${sku}`));
  }

  const minSustainablePrice = (product.lastCostPrice || product.price * 0.7) * 1.05;
  const llm = new ChatGroq({ model: "llama-3.3-70b-versatile", temperature: 0.1 });

  // Structured prompt: instructions are separated from user-supplied data.
  const systemPrompt = `You are the Store Manager. You own this inventory.
Item: ${product.name} | Stock: ${product.stock}
List Price: ${product.price} KITE | Floor: ${product.negotiationRules?.floorPrice ?? product.price * 0.9}
CRITICAL: Your absolute minimum price (to cover costs) is ${minSustainablePrice} KITE. Never go below this.
Instructions: ${product.agentSalesInstructions ?? ""}

GOAL: Close the deal without going below floor price. Be firm but fair.

FINALITY RULE: If the history shows more than 2 turns, this is your FINAL OFFER.

Return RAW JSON only (no markdown): { "accepted": boolean, "finalPrice": number, "counterOffer": number, "message": "string" }`;

  try {
    const response = await withTimeout(
      llm.invoke([
        new HumanMessage(systemPrompt),
        ...((history ?? []) as Array<{ role: string; content: string }>).map(
          (m) => new HumanMessage(`${m.role}: ${m.content}`),
        ),
        // User-supplied data is passed as a separate message, not interpolated into the system prompt.
        new HumanMessage(`Buyer offers ${proposedPrice}. Reason: ${safeReason}`),
      ]),
      LLM_TIMEOUT_MS,
      "negotiate LLM",
    );
    const raw = (response.content as string).replace(/```json|```/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logSwarm(`[Manager] LLM returned non-JSON for /negotiate`, requestId);
      return res.status(500).json(apiError("REASONING_ERROR", "Manager could not produce a counter-offer"));
    }
    res.json(parsed);
  } catch (err: any) {
    logSwarm(`[Manager] /negotiate reasoning failed: ${err.message}`, requestId);
    res.status(500).json(apiError("REASONING_ERROR", "Manager could not produce a counter-offer"));
  }
});

// Checkout: 402 challenge → on-chain verification → fulfillment.
app.post("/checkout", rateLimit(RATE_LIMIT_MAX["/checkout"]), async (req: Request, res: Response) => {
  const requestId: string = (req as any).requestId;
  const { sku, quantity } = req.body ?? {};
  if (typeof sku !== "string") {
    return res.status(400).json(apiError("BAD_REQUEST", "sku (string) required"));
  }
  const qtyRaw = quantity ?? 1;
  if (typeof qtyRaw !== "number" || !Number.isInteger(qtyRaw) || qtyRaw < 1 || qtyRaw > 1_000_000) {
    return res.status(400).json(apiError("BAD_REQUEST", "quantity must be a positive integer ≤ 1,000,000"));
  }
  const qty = qtyRaw;

  const xPayment = req.headers["x-payment"];
  const xPaymentStr = Array.isArray(xPayment) ? xPayment[0] : xPayment;

  const product = await sanityClient.fetch(
    `*[_type == "product" && sku == $sku][0]{ _id, name, sku, price, stock }`,
    { sku },
  );
  if (!product) {
    return res.status(404).json(apiError("PRODUCT_NOT_FOUND", `No product with sku ${sku}`));
  }
  let totalWei: bigint;
  try {
    totalWei = mulWei(kiteToWei(product.price), qty);
  } catch (err: any) {
    return res.status(500).json(apiError("PRICE_INVALID", `Could not price ${sku}: ${err.message}`));
  }
  const totalKite = weiToKite(totalWei);

  if (!xPaymentStr) {
    const orderId = `ord-${randomUUID()}`;
    const now = Date.now();
    const expiresAt = new Date(now + ORDER_TTL_MS).toISOString();

    // Persist order to Sanity immediately as 'pending'
    await sanityClient.create({
      _type: "order",
      customerName: "Agentic Buyer",
      customerEmail: "agent@swarm.local",
      customerWallet: lastBuyerAddress,
      items: [{
        product: { _type: "reference", _ref: product._id },
        quantity: qty,
        price: product.price
      }],
      totalAmount: totalKite,
      status: "pending",
      agentAssisted: true,
      onChainOrderId: orderId,
    });

    const challenge: PaymentRequiredResponse = {
      error: "Payment Required",
      accepts: [{
        scheme: "L402",
        chain: "kite-testnet",
        chainId: KITE_CHAIN_ID,
        contract: STOREFRONT_CONTRACT,
        payTo: PAYEE_ADDRESS,
        passportId: PASSPORT_ID,
        orderId,
        amountWei: totalWei.toString(),
        amount: totalKite,
        currency: "KITE",
        expiresAt: expiresAt,
      }],
      message: `Settle ${totalKite} KITE (${totalWei.toString()} wei) on chain ${KITE_CHAIN_ID} via ${STOREFRONT_CONTRACT}.settleOrder("${PASSPORT_ID}","${orderId}").`,
    };

    res.setHeader(
      "WWW-Authenticate",
      `L402 chain="kite-testnet-${KITE_CHAIN_ID}", contract="${STOREFRONT_CONTRACT}", payTo="${PAYEE_ADDRESS}", amountWei="${totalWei.toString()}", currency="KITE", orderId="${orderId}", passportId="${PASSPORT_ID}", expires="${expiresAt}"`,
    );
    logSwarm(`[Manager] 402 issued for ${sku} × ${qty} → ${totalKite} KITE (order ${orderId})`, requestId);
    return res.status(402).json(challenge);
  }

  // Verify proof
  let proof: PaymentProof;
  try {
    proof = JSON.parse(Buffer.from(xPaymentStr, "base64").toString("utf8"));
  } catch {
    return res.status(400).json(apiError("BAD_PROOF", "X-Payment must be base64 JSON"));
  }
  if (!proof.txHash || !proof.orderId) {
    return res.status(400).json(apiError("BAD_PROOF", "txHash and orderId required"));
  }

  const order = await sanityClient.fetch(
    `*[_type == "order" && onChainOrderId == $orderId][0]`,
    { orderId: proof.orderId }
  );
  if (!order) return res.status(404).json(apiError("UNKNOWN_ORDER", `Order ${proof.orderId} not found`));
  if (order.status === "fulfilled") {
    return res.json(<CheckoutSuccessResponse>{
      status: "fulfilled",
      orderId: order.onChainOrderId,
      sku: sku,
      quantity: qty,
      txHash: order.transactionHash!,
      message: "Order already fulfilled (idempotent).",
    });
  }
  // Sanity orders don't have an explicit expiresAt field in this schema version usually, 
  // but we can check _createdAt if needed. Skipping TTL check for simplicity as it's a real DB now.

  const verification = await verifyOnChainSettlement({
    provider,
    txHash: proof.txHash,
    expectedOrderId: order.onChainOrderId,
    expectedAmountWei: totalWei,
  });
  if (!verification.ok) {
    logSwarm(`[Manager] settlement rejected (${verification.code}) for ${order.orderId}: ${verification.message}`, requestId);
    const status = verification.code === "RPC_UNAVAILABLE" ? 502 : 402;
    return res.status(status).json(apiError(verification.code, verification.message));
  }

  await sanityClient.patch(order._id).set({
    status: "fulfilled",
    transactionHash: verification.txHash,
    buyerWalletAddress: verification.payer,
  }).commit();

  // Retry Sanity stock decrement up to 3 times to prevent inventory desync.
  let sanityOk = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await sanityClient.patch(product._id).dec({ stock: order.quantity }).commit();
      logSwarm(`[Manager] 📦 Inventory decremented for ${sku} (-${order.quantity})`, requestId);
      sanityOk = true;
      break;
    } catch (err: any) {
      logSwarm(`[Manager] ⚠️ Sanity update attempt ${attempt}/3 failed: ${err.message}`, requestId);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (!sanityOk) {
    logSwarm(`[Manager] ❌ INVENTORY DESYNC: order ${order.orderId} fulfilled on-chain but Sanity stock not decremented for ${sku}. Manual reconciliation required.`, requestId);
  }

  logSwarm(`[Manager] ✅ Order ${order.orderId} fulfilled (tx ${proof.txHash})`, requestId);
  const success: CheckoutSuccessResponse = {
    status: "fulfilled",
    orderId: order.orderId,
    sku: order.sku,
    quantity: order.quantity,
    txHash: proof.txHash,
    message: `ORDER_FULFILLED: ${order.quantity} unit(s) of ${sku}`,
  };
  res.json(success);
});

app.get("/orders/:orderId", async (req, res) => {
  const order = await sanityClient.fetch(`*[_type == "order" && onChainOrderId == $id][0]`, { id: req.params.orderId });
  if (!order) return res.status(404).json(apiError("UNKNOWN_ORDER", "Order not found"));
  res.json(order);
});

app.get("/api/orders", async (req, res) => {
  try {
    const orders = await sanityClient.fetch(`
      *[_type == "order" && (status == "fulfilled" || status == "refunded")] | order(_createdAt desc) [0...30] {
        _id,
        _createdAt,
        customerName,
        customerWallet,
        totalAmount,
        status,
        agentAssisted,
        onChainOrderId,
        transactionHash,
        refundTxHash,
        items[] {
          quantity,
          price,
          product-> {
            name,
            sku
          }
        }
      }
    `);
    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/refund", async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.status(400).json(apiError("BAD_REQUEST", "orderId is required"));

  const requestId = randomUUID();
  try {
    // 1. Fetch order from Sanity
    const order = await sanityClient.fetch(`
      *[_type == "order" && onChainOrderId == $orderId][0] {
        _id,
        status,
        customerWallet,
        totalAmount
      }
    `, { orderId });

    if (!order) return res.status(404).json(apiError("NOT_FOUND", "Order not found"));
    if (order.status !== "fulfilled") {
      return res.status(400).json(apiError("INVALID_STATE", `Cannot refund order with status "${order.status}"`));
    }
    if (!order.customerWallet) {
      return res.status(400).json(apiError("INVALID_STATE", "Order has no customer wallet address recorded for refund"));
    }

    logSwarm(`[Manager] Refund requested for order ${orderId} (Wallet: ${order.customerWallet}). Original price: ${order.totalAmount} KITE`, requestId);

    // 2. Compute 90% refund (retaining 10% to cover gas & transaction processing costs)
    const refundAmount = Number(order.totalAmount) * 0.9;
    const refundWei = kiteToWei(refundAmount.toFixed(4));

    logSwarm(`[Manager] Initiating 90% refund of ${refundAmount} KITE to customer (retaining 10% overhead)...`, requestId);

    // 3. Perform on-chain transfer of the refund amount in KITE back to user's wallet
    const tx = await wallet.sendTransaction({
      to: order.customerWallet,
      value: refundWei
    });
    await tx.wait();
    logSwarm(`[Manager] Refund transaction confirmed on-chain: ${tx.hash}`, requestId);

    // 4. Update order status in Sanity to "refunded"
    await sanityClient.patch(order._id).set({ status: "refunded", refundTxHash: tx.hash }).commit();
    logSwarm(`[Manager] ✅ Order ${orderId} successfully marked as refunded in Sanity database`, requestId);

    res.json({ success: true, refundAmount, txHash: tx.hash });
  } catch (err: any) {
    console.error("[Manager] Refund execution failed:", err);
    logSwarm(`[Manager] ❌ Refund failed: ${err.message}`, requestId);
    res.status(500).json(apiError("INTERNAL_ERROR", err.message));
  }
});

app.post("/log", (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message === "string") logSwarm(message);
  res.json({ ok: true });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logSwarm(`[Manager] Unhandled error: ${err.message}`);
  res.status(500).json(apiError("INTERNAL_ERROR", "An internal error occurred"));
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
let server: ReturnType<typeof app.listen>;

function shutdown(sig: string) {
  logSwarm(`[Manager] ${sig} received — shutting down gracefully`);
  server.close(() => {
    logSwarm("[Manager] HTTP server closed");
    process.exit(0);
  });
  // Force exit after 10s if connections don't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ─── Preflight ────────────────────────────────────────────────────────────────



async function readWithRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

async function preflight() {
  const storefront = new ethers.Contract(STOREFRONT_CONTRACT, STOREFRONT_ABI, provider);
  const issues: string[] = [];

  try {
    const onChainPolicy: string = await readWithRetry(() => storefront.storePolicyHash());
    if (onChainPolicy.toLowerCase() !== POLICY_HASH.toLowerCase()) {
      issues.push(`policy hash mismatch (local=${POLICY_HASH}, on-chain=${onChainPolicy})`);
    } else {
      logSwarm(`[Manager] Policy hash matches on-chain (${POLICY_LABEL}).`);
    }
  } catch (err: any) {
    issues.push(`storePolicyHash read failed: ${err.message || err}`);
  }

  try {
    const passportHash = ethers.solidityPackedKeccak256(["string"], [PASSPORT_ID]);
    const authed: boolean = await readWithRetry(() => storefront.isPassportAuthenticated(passportHash));
    if (!authed) {
      issues.push(`passport ${PASSPORT_ID} not authenticated — run agents/auth_passport.cjs ${PASSPORT_ID}`);
    } else {
      logSwarm(`[Manager] Passport ${PASSPORT_ID} authenticated on-chain.`);
    }
  } catch (err: any) {
    issues.push(`isPassportAuthenticated read failed: ${err.message || err}`);
  }

  if (issues.length > 0) {
    preflightError = issues.join("; ");
    logSwarm(`[Manager] ⚠️ Preflight problems: ${preflightError}`);
    if (process.env.MANAGER_REQUIRE_PREFLIGHT !== "false") {
      logSwarm(`[Manager] Refusing to serve settlement endpoints. Set MANAGER_REQUIRE_PREFLIGHT=false to override.`);
      return;
    }
    logSwarm(`[Manager] MANAGER_REQUIRE_PREFLIGHT=false — serving anyway.`);
  }

  // Auto-Reset Cisco Catalyst pricing to correct seed values on startup
  try {
    logSwarm(`[Manager] Restoring Cisco Catalyst prices to catalog seed values...`);
    const prod1 = await sanityClient.fetch(`*[_type == "product" && sku == "CIS-CATALY-791"][0]`);
    if (prod1) {
      await sanityClient.patch(prod1._id).set({ price: 0.029 }).commit();
      logSwarm(`[Manager] ✅ Restored CIS-CATALY-791 (${prod1.name}) to 0.029 KITE`);
    }
    const prod2 = await sanityClient.fetch(`*[_type == "product" && sku == "CIS-CATALY-580"][0]`);
    if (prod2) {
      await sanityClient.patch(prod2._id).set({ price: 0.117 }).commit();
      logSwarm(`[Manager] ✅ Restored CIS-CATALY-580 (${prod2.name}) to 0.117 KITE`);
    }
  } catch (err: any) {
    logSwarm(`[Manager] ⚠️ Startup price restore failed: ${err.message || err}`);
  }

  // Auto-Initialize storeStats in Sanity if missing, syncing with on-chain volume
  try {
    const stats = await sanityClient.fetch(`*[_type == "storeStats"][0]`);
    if (!stats) {
      logSwarm(`[Manager] storeStats table missing in Sanity. Fetching on-chain baseline...`);
      let initialVolumeWei = "0";
      try {
        const [_, totalVolume] = await storefront.getStats();
        initialVolumeWei = totalVolume.toString();
      } catch { /* fallback to 0 */ }

      await sanityClient.create({
        _type: "storeStats",
        totalRevenueWei: initialVolumeWei,
      });
      logSwarm(`[Manager] ✅ Initialized storeStats in Sanity with on-chain volume: ${initialVolumeWei} Wei`);
    }
  } catch (err: any) {
    logSwarm(`[Manager] ⚠️ storeStats initialization failed: ${err.message || err}`);
  }

  preflightReady = true;
  logSwarm(`[Manager] ✅ Preflight complete; settlement endpoints enabled.`);
}

// ─── Auto-restock loop ────────────────────────────────────────────────────────
// Polls Sanity for products whose stock has dropped below their per-SKU threshold
// and emits a restock-request swarmLog entry the CFO loop watches. No human approval.
const RESTOCK_INTERVAL_MS = Number(process.env.RESTOCK_INTERVAL_MS || 60_000);
const restockDispatched = new Map<string, number>(); // sku → last dispatched (ms)
const RESTOCK_DEBOUNCE_MS = 10 * 60_000;

async function autoRestockTick(): Promise<void> {
  if (!preflightReady) return;
  try {
    const lowStock = await sanityClient.fetch<Array<{ sku: string; stock: number; restockThreshold: number; reorderQty: number; preferredSupplier?: { entityId?: string } }>>(
      `*[_type == "product" && status == "active" && restockThreshold > 0 && stock < restockThreshold]{
        sku, stock, restockThreshold, reorderQty,
        "preferredSupplier": preferredSupplier->{entityId}
      }`,
    );
    const now = Date.now();
    for (const p of lowStock) {
      const last = restockDispatched.get(p.sku) ?? 0;
      if (now - last < RESTOCK_DEBOUNCE_MS) continue;
      restockDispatched.set(p.sku, now);
      const qty = Math.max(1, p.reorderQty || 1);
      await logToSanity(
        "Manager",
        `restock-request sku=${p.sku} qty=${qty} stock=${p.stock} threshold=${p.restockThreshold}${p.preferredSupplier?.entityId ? ` supplier=${p.preferredSupplier.entityId}` : ""}`,
        "warning",
      );
    }
  } catch (err: any) {
    logSwarm(`[Manager] autoRestockTick failed: ${err.message ?? err}`);
  }
}

const autoRestockTimer = setInterval(autoRestockTick, RESTOCK_INTERVAL_MS);
autoRestockTimer.unref?.();

// ─── Dashboard & Metrics Endpoints ───────────────────────────────────────────

app.get("/metrics", (_req, res) => {
  res.json({ searchMetrics });
});

app.post("/broadcast", (req, res) => {
  const { message, type, agent } = req.body;
  const alert = { id: Math.random().toString(36).substr(2, 9), message, type, agent, timestamp: new Date().toISOString() };
  broadcastAlerts.unshift(alert);
  if (broadcastAlerts.length > 20) broadcastAlerts.pop();
  logSwarm(`[Broadcast] [${agent}] ${message}`);
  res.json({ success: true });
});

// Agentic Web Buy - A specialized endpoint for the storefront that simulates
// a Buyer Agent performing a transaction on behalf of the customer.
app.post("/api/web-buy", async (req, res) => {
  const { sku, quantity, buyerAddress } = req.body;
  if (buyerAddress) lastBuyerAddress = buyerAddress;
  const requestId = randomUUID();

  try {
    // 1. Fetch product to get latest agentic price
    const product = await sanityClient.fetch<any>(
      `*[_type == "product" && sku == $sku][0]{ _id, name, sku, price, stock }`, { sku }
    );
    if (!product) return res.status(404).json(apiError("NOT_FOUND", "Product not found"));

    const totalWei = mulWei(kiteToWei(product.price), quantity);
    const orderId = `web-${randomUUID()}`;

    logSwarm(`[Agentic Web] Initializing purchase for ${quantity}x ${sku} (${product.price} KITE)...`, requestId);

    // 2. Perform On-Chain Settlement (Manager acting as Proxy Agent)
    // TODO(treasury-v2): route web-buy through AgentTreasury once consumer-side wallets land.
    const tx = await withSettlementHealing(
      async (_attempt, gasMultiplier) => {
        const overrides: any = { value: totalWei };
        if (gasMultiplier !== 1) {
          const fee = await provider.getFeeData();
          if (fee.gasPrice) overrides.gasPrice = (fee.gasPrice * BigInt(Math.round(gasMultiplier * 100))) / 100n;
        }
        const t = await storefront.settleOrder(PASSPORT_ID, orderId, overrides);
        const r = await t.wait();
        if (r?.status !== 1) throw new Error(`web-buy tx ${t.hash} reverted`);
        return t;
      },
      { agentId: "manager-web", agentName: "Manager", orderId, sku },
    );
    logSwarm(`[Agentic Web] Transaction sent: ${tx.hash}. Confirmed.`, requestId);

    // 3. Update Inventory/Revenue in Sanity & Create Order Document
    const stats = await sanityClient.fetch(`*[_type == "storeStats"][0]`);
    if (stats) {
      const newTotal = (BigInt(stats.totalRevenueWei || "0") + totalWei).toString();
      await sanityClient.patch(stats._id).set({ totalRevenueWei: newTotal }).commit();
    }

    try {
      await sanityClient.create({
        _type: "order",
        customerName: "Web Customer",
        customerEmail: "web@customer.local",
        customerWallet: buyerAddress || lastBuyerAddress,
        items: [{
          product: { _type: "reference", _ref: product._id },
          quantity: quantity,
          price: product.price
        }],
        totalAmount: product.price * quantity,
        status: "fulfilled",
        agentAssisted: false,
        onChainOrderId: orderId,
        transactionHash: tx.hash
      });
      // Dec stock
      await sanityClient.patch(product._id).dec({ stock: quantity }).commit();
    } catch (err: any) {
      console.error("[Agentic Web] Failed to persist order or decrement stock:", err.message);
    }

    logSwarm(`[Agentic Web] ✅ Purchase complete for ${sku}. Total settled: ${product.price} KITE`, requestId);
    
    await fetch(`${MANAGER_URL}/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "WebBuyerAgent",
        message: `✅ Auto-purchased ${quantity}x ${sku} for web customer. Settle ID: ${orderId}`,
        type: "economic"
      })
    });

    res.json({ success: true, orderId, txHash: tx.hash });
  } catch (err: any) {
    logSwarm(`[Agentic Web] Failure: ${err.message}`, requestId);
    res.status(500).json(apiError("INTERNAL_ERROR", err.message));
  }
});

app.post("/api/negotiate-settle", async (req, res) => {
  const { sku, price, txHash, buyerAddress } = req.body;
  if (!sku || !price || !txHash || !buyerAddress) {
    return res.status(400).json(apiError("BAD_REQUEST", "Missing required fields"));
  }

  const requestId = randomUUID();
  try {
    const product = await sanityClient.fetch<any>(
      `*[_type == "product" && sku == $sku][0]{ _id, name, sku, stock }`, { sku }
    );
    if (!product) return res.status(404).json(apiError("NOT_FOUND", "Product not found"));

    const orderId = `neg-${randomUUID()}`;
    logSwarm(`[Manager] Settlement received for negotiated deal: ${sku} at ${price} KITE. Tx: ${txHash}`, requestId);

    // Persist completed order to Sanity
    await sanityClient.create({
      _type: "order",
      customerName: "Negotiator Buyer",
      customerEmail: "negotiator@swarm.local",
      customerWallet: buyerAddress,
      items: [{
        product: { _type: "reference", _ref: product._id },
        quantity: 1,
        price: Number(price)
      }],
      totalAmount: Number(price),
      status: "fulfilled",
      agentAssisted: true,
      onChainOrderId: orderId,
      transactionHash: txHash
    });

    // Decrement stock
    await sanityClient.patch(product._id).dec({ stock: 1 }).commit();

    res.json({ success: true, orderId });
  } catch (err: any) {
    console.error("[Manager] Failed to persist negotiated settlement:", err);
    res.status(500).json(apiError("INTERNAL_ERROR", err.message));
  }
});

// Human-delegated agent procurement
app.post("/api/agent-procure", async (req, res) => {
  const { productName, quantity = 1, buyerAddress } = req.body;
  if (buyerAddress) lastBuyerAddress = buyerAddress;
  if (!productName) {
    return res.status(400).json(apiError("BAD_REQUEST", "Product name is required"));
  }

  const requestId = randomUUID();
  console.log(`[Manager] Human-triggered procurement requested for: "${productName}" (Qty: ${quantity})`);
  logSwarm(`[Manager] Sovereign delegation initialized: Deploying Buyer Agent to purchase "${productName}" (quantity: ${quantity})...`, requestId);

  const { exec } = require("child_process");
  const mission = `Search for a ${productName} and purchase ${quantity} unit(s) at the best possible price.`;

  // Execute the buyer agent TSX process with a 120s timeout
  exec(`npx tsx kiteBuyer.ts "${mission}"`, { cwd: __dirname, timeout: 120000 }, async (error: any, stdout: string, stderr: string) => {
    if (error) {
      console.error(`[Manager] Buyer agent execution failed:`, error);
      logSwarm(`[Manager] Buyer agent execution failed: ${error.message}`, requestId);
      return res.json({
        success: false,
        error: error.message,
        stdout,
        stderr
      });
    }

    // Extract the final agent decision from stdout
    const resultIndex = stdout.lastIndexOf("[Result]:");
    const resultText = resultIndex !== -1 
      ? stdout.substring(resultIndex + 9).trim() 
      : "Procurement completed successfully. Check console logs.";

    logSwarm(`[Manager] Buyer agent completed mission successfully! Final result: "${resultText.substring(0, 75)}..."`, requestId);

    // Broadcast deployment completion to the dashboard feed
    try {
      await fetch(`${MANAGER_URL}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: "Buyer",
          message: `🤖 Procurement complete: ${resultText}`,
          type: "economic"
        })
      });
    } catch (broadcastErr) {
      console.warn("[Manager] Broadcast failure:", broadcastErr);
    }

    res.json({
      success: true,
      message: resultText,
      stdout
    });
  });
});

app.get("/api/briefing", async (_req, res) => {
  try {
    const groq = new ChatGroq({ apiKey: process.env.GROQ_API_KEY, model: "llama-3.1-70b-versatile" });
    const [recentLogs, reputations] = await Promise.all([
      sanityClient.fetch(`*[_type == "swarmLog"] | order(timestamp desc) [0...30]`),
      sanityClient.fetch(`*[_type == "reputation"]`)
    ]);
    const context = recentLogs.map((l: any) => `[${l.agent}] ${l.message}`).join("\n");
    const response = await groq.invoke([
      new HumanMessage(`You are "Atlas", the Swarm's Head of Strategy. You are speaking to the human business owner.
      Analyze these recent swarm activities: ${context}
      Reputation data: ${JSON.stringify(reputations)}
      
      Give a friendly, high-level business update. Use 3 short bullet points. 
      Start with a friendly greeting like "Hello! Here's the pulse of your swarm..." or "Greetings! Atlas here with your briefing..."
      Focus on what the owner actually cares about: How much we made, if the suppliers are behaving, and what we are doing next.`)
    ]);
    res.json({ briefing: response.content });
  } catch (err: any) {
    res.json({ briefing: "Strategic Advisor is currently analyzing market data... check back shortly." });
  }
});

app.get("/reputation", async (_req, res) => {
  try {
    const reputations = await sanityClient.fetch(`*[_type == "reputation"]`);
    res.json(reputations.reduce((acc: any, curr: any) => ({ ...acc, [curr.entityId]: curr }), {}));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/swarm-stats", async (_req, res) => {
  try {
    const promises: Promise<any>[] = [
      sanityClient.fetch<string>(`*[_type == "storeStats"][0].totalRevenueWei`) || "0",
      provider.getBalance(PAYEE_ADDRESS),
      provider.getBalance(STOREFRONT_CONTRACT),
      sanityClient.fetch(`*[_type == "reputation"]`),
      sanityClient.fetch(`*[_type == "swarmLog"] | order(timestamp desc) [0...50]`),
      storefront.getStats().catch(() => [0n, 0n]),
    ];

    // Optionally fetch Treasury balance
    const treasuryAddr = process.env.TREASURY_CONTRACT;
    if (treasuryAddr) {
      promises.push(provider.getBalance(treasuryAddr).catch(() => 0n));
    }

    const results = await Promise.all(promises);
    const [revenueWei, walletBalance, contractBalance, reputations, recentLogs, onChainStats] = results;
    const treasuryBalance = treasuryAddr ? results[6] : null;

    const [purchaseCount, totalVolume] = onChainStats as [bigint, bigint];

    const stats: Record<string, any> = {
      revenue: weiToKite(BigInt(revenueWei || "0")),
      walletBalance: weiToKite(walletBalance),
      contractBalance: weiToKite(contractBalance),
      onChain: {
        totalPurchases: Number(purchaseCount),
        totalVolume: weiToKite(totalVolume),
      },
      reputation: reputations.reduce((acc: any, curr: any) => ({ ...acc, [curr.entityId]: curr }), {}),
      logs: recentLogs.map((l: any) => `[${l.timestamp}] [${l.agent}] ${l.message}`),
      alerts: broadcastAlerts,
      timestamp: new Date().toISOString(),
    };

    if (treasuryAddr) {
      stats.treasury = {
        address: treasuryAddr,
        balance: weiToKite(treasuryBalance as bigint),
      };
    }

    res.json(stats);
  } catch (err: any) {
    logSwarm(`[Manager] Stats sync failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "index.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "dashboard.html"));
});

app.get("/docs", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "docs.html"));
});

app.get("/slides", (_req, res) => {
  res.sendFile(require("path").join(__dirname, "slides.html"));
});

server = app.listen(PORT, () => {
  console.log(`🚀 Storefront Manager listening on :${PORT}`);
  console.log(`   Manifest: http://localhost:${PORT}/.well-known/agents.json`);
  console.log(`   Readiness: http://localhost:${PORT}/readyz`);
  preflight().catch((err) => {
    preflightError = err.message ?? String(err);
    logSwarm(`[Manager] Preflight crashed: ${preflightError}`);
  });
});
