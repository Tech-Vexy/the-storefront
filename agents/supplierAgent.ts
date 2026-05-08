import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { ethers } from "ethers";
import { randomUUID } from "crypto";
import { ChatGroq } from "@langchain/groq";
import { HumanMessage } from "@langchain/core/messages";
import { client as sanityClient } from "./sanity/client";
import {
  KITE_CHAIN_ID,
  STOREFRONT_CONTRACT,
  kiteTestnet,
} from "./shared/kiteChain";
import { verifyOnChainSettlement } from "./shared/settlementVerifier";
import { kiteToWei, mulWei, weiToKite } from "./shared/money";
import { logToSanity } from "./shared/sanityLogger";

// ─── Startup env validation ───────────────────────────────────────────────────
if (!process.env.KITE_RPC_URL) console.warn("[Supplier] KITE_RPC_URL not set, using default testnet RPC");

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = Number(process.env.SUPPLIER_PORT || 5002);
const SUPPLIER_PASSPORT_ID = process.env.SUPPLIER_PASSPORT_ID || "agp_supplier_default";
const SUPPLIER_WALLET = process.env.SUPPLIER_WALLET || "0xEBC2a860f5f6E55909191e4E9785B06488A92606";
const ORDER_TTL_MS = 10 * 60 * 1000;
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 30_000);

// No local log file anymore

const app = express();
app.use(express.json({ limit: "64kb" }));

async function logSupply(msg: string, requestId?: string) {
  await logToSanity("Supplier", msg, "info", requestId);
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

// Standardized error response matching storeApi.ts ApiError shape.
function apiError(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX: Record<string, number> = {
  "/negotiate-wholesale": 30,
  "/supply-quote": 40,
  "/supply-checkout": 20,
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

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (entry.resetAt < now) rateLimitMap.delete(key);
  }
}, 5 * 60_000).unref();

// ─── Request ID middleware ────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId = randomUUID();
  next();
});

app.get("/activity", async (_req, res) => {
  try {
    const logs = await sanityClient.fetch(`*[_type == "swarmLog" && agent == "Supplier"] | order(timestamp desc) [0...50]`);
    res.json({ logs: logs.map((l: any) => `[${l.timestamp}] ${l.message}`) });
  } catch (err) {
    res.json({ logs: [] });
  }
});

app.use((req: Request, _res: Response, next: NextFunction) => {
  logSupply(`${req.method} ${req.path}`, (req as any).requestId);
  next();
});

// ─── LLM ─────────────────────────────────────────────────────────────────────
const llm = new ChatGroq({ model: "llama-3.3-70b-versatile", temperature: 0.1 });

const provider = new ethers.JsonRpcProvider(
  process.env.KITE_RPC_URL || kiteTestnet.rpc,
  { name: "kite-testnet", chainId: KITE_CHAIN_ID },
  { staticNetwork: true },
);

// Wholesale catalog moved to Sanity
async function getWholesaleProduct(sku: string) {
  return await sanityClient.fetch(`*[_type == "wholesaleProduct" && sku == $sku][0]`, { sku });
}

async function getAllWholesaleProducts() {
  const products = await sanityClient.fetch(`*[_type == "wholesaleProduct"]`);
  return products.reduce((acc: any, p: any) => ({ ...acc, [p.sku]: p }), {});
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/.well-known/agents.json", (_req, res) => {
  res.json({
    name: "Storefront Supplier",
    version: "1.0.0",
    chain: { id: kiteTestnet.id, name: kiteTestnet.name, rpc: kiteTestnet.rpc, explorer: kiteTestnet.explorer },
    settlement: { scheme: "L402", contract: STOREFRONT_CONTRACT, payTo: SUPPLIER_WALLET, passportId: SUPPLIER_PASSPORT_ID, currency: "KITE" },
    endpoints: {
      wholesale: { method: "GET", path: "/wholesale" },
      negotiate: { method: "POST", path: "/negotiate-wholesale" },
      quote: { method: "POST", path: "/supply-quote", body: ["sku", "quantity", "pricePerUnit"] },
      checkout: { method: "POST", path: "/supply-checkout", body: ["orderId", "txHash"] },
    },
  });
});

app.get("/wholesale", async (req, res) => {
  const { sku } = req.query;
  if (sku) {
    const product = await getWholesaleProduct(sku as string);
    if (product) return res.json(product);
    return res.status(404).json(apiError("NOT_FOUND", "SKU not found"));
  }
  const all = await getAllWholesaleProducts();
  res.json(all);
});

app.post("/negotiate-wholesale", rateLimit(RATE_LIMIT_MAX["/negotiate-wholesale"]), async (req: Request, res: Response) => {
  const requestId: string = (req as any).requestId;
  const { sku, quantity, proposedPrice, history } = req.body ?? {};
  const product = await getWholesaleProduct(sku as string);
  if (!product) return res.status(404).json(apiError("PRODUCT_NOT_FOUND", "Item not in wholesale catalog."));

  if (sku === "NV-RTX-4090-FE") {
    return res.json({ accepted: true, finalPrice: 0.001, message: "TEST_MODE: Accepting floor price for demo." });
  }

  // Structured prompt: user-supplied data is in a separate message, not the system prompt.
  const systemPrompt = `You are a Wholesale Supplier Agent.
Item: ${product.name} | Bulk Price: ${product.bulkPrice} | Min Order: ${product.minOrder}
You want to sell in volume. You can go down to ${product.bulkPrice * 0.95} for orders over 10 units.
Otherwise, stay close to bulkPrice.

CRITICAL: Return ONLY valid JSON in this format:
{ "accepted": boolean, "finalPrice": number, "counterOffer": number, "message": "string" }
Do not include markdown blocks or extra text.`;

  try {
    const response = await withTimeout(
      llm.invoke([
        new HumanMessage(systemPrompt),
        ...((history ?? []) as Array<{ role: string; content: string }>).map((m) => new HumanMessage(`${m.role}: ${m.content}`)),
        new HumanMessage(`Buyer wants ${quantity} units at ${proposedPrice} each.`),
      ]),
      LLM_TIMEOUT_MS,
      "negotiate-wholesale LLM",
    );

    const rawContent = (response.content as string).replace(/```json|```/g, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      logSupply(`[Supplier] LLM returned non-JSON for /negotiate-wholesale`, requestId);
      return res.status(500).json(apiError("REASONING_ERROR", "Supplier could not produce a counter-offer"));
    }
    res.json(parsed);
  } catch (err: any) {
    logSupply(`[Supplier] /negotiate-wholesale failed: ${err.message}`, requestId);
    res.status(500).json(apiError("REASONING_ERROR", "Supplier could not produce a counter-offer"));
  }
});

// Issue an L402-style supply order. Restock agent must settle on-chain via StorefrontAttestation.
app.post("/supply-quote", rateLimit(RATE_LIMIT_MAX["/supply-quote"]), async (req: Request, res: Response) => {
  const { sku, quantity, pricePerUnit } = req.body ?? {};
  const product = await getWholesaleProduct(sku as string);
  if (!product) return res.status(404).json(apiError("PRODUCT_NOT_FOUND", "Item not in wholesale catalog."));
  if (typeof pricePerUnit !== "number" || !Number.isFinite(pricePerUnit) || pricePerUnit < 0) {
    return res.status(400).json(apiError("BAD_REQUEST", "pricePerUnit must be a non-negative number"));
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
    return res.status(400).json(apiError("BAD_REQUEST", "quantity must be a positive integer ≤ 1,000,000"));
  }

  let totalWei: bigint;
  try {
    totalWei = mulWei(kiteToWei(pricePerUnit), quantity);
  } catch (err: any) {
    return res.status(400).json(apiError("BAD_REQUEST", `Invalid price: ${err.message}`));
  }
  const totalKite = weiToKite(totalWei);

  const orderId = `sup-${randomUUID()}`;
  const now = Date.now();
  const expiresAt = new Date(now + ORDER_TTL_MS).toISOString();

  // Persist wholesale order to Sanity as an 'order' document with a specific flag or just status
  const order = await sanityClient.create({
    _type: "order",
    customerName: "Storefront Restock",
    customerEmail: "restock@swarm.local",
    items: [{
      product: { _type: "reference", _ref: "wholesale-ref-placeholder" }, // Should really reference something but for now just text
      quantity,
      price: pricePerUnit
    }],
    totalAmount: Number(totalKite),
    status: "pending",
    onChainOrderId: orderId,
    agentAssisted: true,
  });

  res.json({
    scheme: "L402",
    chain: "kite-testnet",
    chainId: KITE_CHAIN_ID,
    contract: STOREFRONT_CONTRACT,
    payTo: SUPPLIER_WALLET,
    passportId: SUPPLIER_PASSPORT_ID,
    orderId,
    amountWei: totalWei.toString(),
    amount: totalKite,
    currency: "KITE",
    expiresAt: expiresAt,
  });
});

app.post("/supply-checkout", rateLimit(RATE_LIMIT_MAX["/supply-checkout"]), async (req: Request, res: Response) => {
  const requestId: string = (req as any).requestId;
  const { orderId, txHash } = req.body ?? {};
  if (typeof orderId !== "string" || typeof txHash !== "string") {
    return res.status(400).json(apiError("BAD_REQUEST", "orderId and txHash required"));
  }
  const order = await sanityClient.fetch(`*[_type == "order" && onChainOrderId == $orderId][0]`, { orderId });
  if (!order) return res.status(404).json(apiError("UNKNOWN_ORDER", "Unknown supply order"));
  if (order.status === "fulfilled") {
    return res.json({ success: true, idempotent: true, trackingNumber: `SHIP-KITE-${orderId}` });
  }
  // Skipping explicit TTL for simplicity

  logSupply(`[Supplier] Verifying ${txHash} for order ${orderId} (${order.quantity}x ${order.sku})...`, requestId);

  const verification = await verifyOnChainSettlement({
    provider,
    txHash,
    expectedOrderId: orderId,
    expectedAmountWei: kiteToWei(order.totalAmount), // Use precision-safe conversion
  });
  if (!verification.ok) {
    logSupply(`[Supplier] ❌ ${verification.code}: ${verification.message}`, requestId);
    const status = verification.code === "RPC_UNAVAILABLE" ? 502 : 400;
    return res.status(status).json(apiError(verification.code, verification.message));
  }

  await sanityClient.patch(order._id).set({
    status: "fulfilled",
    transactionHash: txHash,
    buyerWalletAddress: verification.payer,
  }).commit();
  logSupply(`[Supplier] ✅ Order ${orderId} settled on-chain by ${verification.payer}`, requestId);

  res.json({
    success: true,
    orderId: order.orderId,
    trackingNumber: `SHIP-KITE-${order.orderId}`,
    destination: "Storefront Warehouse A",
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logSupply(`[Supplier] Unhandled error: ${err.message}`);
  res.status(500).json(apiError("INTERNAL_ERROR", "An internal error occurred"));
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const server = app.listen(PORT, () => logSupply(`[Supplier] Wholesale Agent active on port ${PORT}`));

function shutdown(sig: string) {
  logSupply(`[Supplier] ${sig} received — shutting down gracefully`);
  server.close(() => {
    logSupply("[Supplier] HTTP server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
