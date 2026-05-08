import { client as sanityClient } from "../sanity/client";
import { logToSanity } from "./sanityLogger";

export interface HealContext {
  agentId: string;
  agentName: string;
  orderId: string;
  sku?: string;
}

export interface HealOptions {
  retries?: number; // additional attempts after the first try (default 1)
  gasMultiplier?: number; // applied to ethers overrides on retry (default 1.3)
}

/**
 * Wraps a settlement call so a transient revert doesn't require a human. On revert:
 *   1) log warning to swarmLog
 *   2) retry once with a higher gas budget (caller honours gasMultiplier in overrides)
 *   3) on second failure, mark the order failed in Sanity and emit an error log
 *
 * Pages no one. The swarmLog entry is the audit trail.
 */
export async function withSettlementHealing<T>(
  fn: (attempt: number, gasMultiplier: number) => Promise<T>,
  ctx: HealContext,
  options: HealOptions = {},
): Promise<T> {
  const retries = options.retries ?? 1;
  const gasMultiplier = options.gasMultiplier ?? 1.3;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt, attempt === 0 ? 1 : gasMultiplier);
    } catch (err: any) {
      lastErr = err;
      const reason = err?.shortMessage || err?.reason || err?.message || String(err);
      if (attempt < retries) {
        await logToSanity(
          ctx.agentName,
          `Settlement attempt ${attempt + 1} reverted (${reason}) — retrying with gas×${gasMultiplier}`,
          "warning",
          ctx.orderId,
        );
      } else {
        await markOrderFailed(ctx, reason);
        await logToSanity(
          ctx.agentName,
          `Settlement permanently failed for order ${ctx.orderId}: ${reason}`,
          "error",
          ctx.orderId,
        );
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function markOrderFailed(ctx: HealContext, reason: string): Promise<void> {
  try {
    const existing = await sanityClient.fetch(
      `*[_type == "order" && orderId == $orderId][0]{_id}`,
      { orderId: ctx.orderId },
    );
    if (existing?._id) {
      await sanityClient.patch(existing._id).set({ status: "failed", failureReason: reason }).commit();
    }
  } catch (err: any) {
    console.error(`[selfHealing] Could not flag order ${ctx.orderId} as failed: ${err?.message ?? err}`);
  }
}
