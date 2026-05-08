import { client as sanityClient } from "../sanity/client";

export type LogType = "info" | "success" | "warning" | "error" | "economic";

let disableSanityWrites = false;

export async function logToSanity(agent: string, message: string, type: LogType = "info", requestId?: string) {
  console.log(`[${agent}] ${message}`);

  if (disableSanityWrites) return;

  try {
    await sanityClient.create({
      _type: "swarmLog",
      timestamp: new Date().toISOString(),
      agent,
      message,
      type,
      requestId,
    });
  } catch (err: any) {
    if (err.message?.includes("Insufficient permissions") || err.message?.includes("permission")) {
      disableSanityWrites = true;
      console.warn(`[SanityLogger] ⚠️ Sanity writes disabled: Your token is read-only. Provide SANITY_API_WRITE_TOKEN in .env with write access to enable on-chain dashboard logs.`);
    } else {
      console.error(`[SanityLogger] Failed to write log: ${err.message}`);
    }
  }
}

export async function updateReputationInSanity(entityId: string, success: boolean, agentName: string) {
  if (disableSanityWrites) {
    return { score: 100, successfulOrders: 0, failedOrders: 0 };
  }
  try {
    // 1. Fetch current reputation
    const existing = await sanityClient.fetch(
      `*[_type == "reputation" && entityId == $entityId][0]`,
      { entityId }
    );

    let doc;
    if (existing) {
      const scoreChange = success ? 5 : -20;
      const newScore = Math.max(0, Math.min(100, (existing.score || 100) + scoreChange));
      
      doc = await sanityClient
        .patch(existing._id)
        .set({
          score: newScore,
          lastUpdated: new Date().toISOString()
        })
        .inc({
          successfulOrders: success ? 1 : 0,
          failedOrders: success ? 0 : 1
        })
        .commit();
    } else {
      doc = await sanityClient.create({
        _type: "reputation",
        entityId,
        score: success ? 100 : 80,
        successfulOrders: success ? 1 : 0,
        failedOrders: success ? 0 : 1,
        lastUpdated: new Date().toISOString()
      });
    }

    await logToSanity(
      agentName,
      `Reputation updated for ${entityId}: Score=${doc.score} (S:${doc.successfulOrders} F:${doc.failedOrders})`,
      "info"
    );
    return doc;
  } catch (err: any) {
    if (err.message?.includes("Insufficient permissions") || err.message?.includes("permission")) {
      disableSanityWrites = true;
      console.warn(`[SanityLogger] ⚠️ Sanity writes disabled: Your token is read-only. Provide SANITY_API_WRITE_TOKEN in .env with write access to enable on-chain dashboard logs.`);
    } else {
      console.error(`[SanityLogger] Failed to update reputation: ${err.message}`);
    }
    return { score: 100, successfulOrders: 0, failedOrders: 0 };
  }
}
