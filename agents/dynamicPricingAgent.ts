import dotenv from "dotenv";
import { client as sanityClient } from "./sanity/client";

dotenv.config();

const PORT = process.env.PORT || "5001";
const MANAGER_URL = process.env.MANAGER_URL || `http://localhost:${PORT}`;
const PRICING_INTERVAL_MS = Number(process.env.PRICING_INTERVAL_MS || 60_000);
const PRICE_STEP = Number(process.env.PRICE_STEP || 0.01);

import { logToSanity } from "./shared/sanityLogger";

async function logPricing(message: string) {
  await logToSanity("PricingAgent", message, "economic");
}

// Broadcast pricing alerts to the dashboard
async function broadcastPricing(message: string) {
  try {
    await fetch(`${MANAGER_URL}/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: "PricingAgent", message, type: "economic" }),
    });
  } catch { /* non-critical */ }
}

async function runPricingLoop() {
  logPricing("Autonomous Pricing Swarm initiated. Monitoring market demand...");

  while (true) {
    try {
      // 1. Get metrics from Manager
      const metricsRes = await fetch(`${MANAGER_URL}/metrics`);
      const { searchMetrics: metrics } = await metricsRes.json();

      // 2. Fetch current products
      const products = await sanityClient.fetch(`*[_type == "product"]{ _id, sku, name, price, negotiationRules }`);

      for (const product of products) {
        const hits = metrics[product.sku] || 0;
        const floor = product.negotiationRules?.floorPrice || 0.05;
        const costPrice = product.lastCostPrice || 0;
        // Never price below floor or cost
        const minPrice = Math.max(floor, costPrice);
        let newPrice = product.price;
        let action = "";

        if (hits > 5) {
          // High demand → Price hike (use round to avoid float drift)
          newPrice = Math.round((product.price + PRICE_STEP) * 100) / 100;
          action = `📈 High demand for ${product.name} (${hits} hits). Hiking price to ${newPrice} KITE.`;
        } else if (hits === 0 && product.price > minPrice + PRICE_STEP) {
          // No demand → Discount (but never below floor/cost)
          newPrice = Math.round((product.price - PRICE_STEP) * 100) / 100;
          if (newPrice < minPrice) newPrice = minPrice;
          action = `📉 No demand for ${product.name}. Applying auto-discount to ${newPrice} KITE.`;
        }

        if (action && newPrice !== product.price) {
          // Update Sanity
          await sanityClient
            .patch(product._id)
            .set({ price: newPrice })
            .commit();
          
          await logPricing(action);
          await broadcastPricing(action);
        }
      }

      // Reset metrics on manager (simulated by just waiting)
    } catch (err: any) {
      console.error("[Pricing Agent] Loop error:", err.message);
    }

    await new Promise(r => setTimeout(r, PRICING_INTERVAL_MS));
  }
}

runPricingLoop();
