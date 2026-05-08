import { ethers } from "ethers";
import { client as sanityClient } from "../sanity/client";

export interface AgentPolicy {
  agentId: string;
  vendorAllowlist: string[];
  categoryLimits: Record<string, number>;
  maxNegotiationRounds: number;
  perTxCapKite: number;
  dailyCapKite: number;
  status: "active" | "frozen" | "deregistered";
}

const EMPTY_POLICY: Omit<AgentPolicy, "agentId"> = {
  vendorAllowlist: [],
  categoryLimits: {},
  maxNegotiationRounds: 3,
  perTxCapKite: 0,
  dailyCapKite: 0,
  status: "active",
};

/**
 * Loads a registered agent's caps + off-chain policy from Sanity.
 * Returns null if the agent is not registered, so callers can decide whether to
 * abort or operate in pre-Treasury legacy mode.
 */
export async function loadAgentPolicy(agentId: string): Promise<AgentPolicy | null> {
  const doc = await sanityClient.fetch(
    `*[_type == "agentRegistry" && agentId == $agentId][0]{
      agentId, status, dailyCap, perTxCap,
      "policy": policyJson{
        vendorAllowlist,
        "categoryLimits": categoryLimits[]{category, maxKite},
        maxNegotiationRounds
      }
    }`,
    { agentId },
  );
  if (!doc) return null;

  const categoryLimits: Record<string, number> = {};
  for (const e of doc.policy?.categoryLimits ?? []) {
    if (e?.category && typeof e.maxKite === "number") {
      categoryLimits[e.category] = e.maxKite;
    }
  }

  return {
    agentId: doc.agentId,
    vendorAllowlist: (doc.policy?.vendorAllowlist ?? []).map((a: string) => a.toLowerCase()),
    categoryLimits,
    maxNegotiationRounds: doc.policy?.maxNegotiationRounds ?? EMPTY_POLICY.maxNegotiationRounds,
    perTxCapKite: doc.perTxCap ?? 0,
    dailyCapKite: doc.dailyCap ?? 0,
    status: doc.status ?? "active",
  };
}

/**
 * Canonical-JSON keccak256 of the on-chain-relevant policy fields. Must match the
 * value passed to AgentTreasury.spend(...policyProof). Order of keys is fixed.
 */
export function hashPolicy(p: AgentPolicy): string {
  const canonical = JSON.stringify({
    vendorAllowlist: [...p.vendorAllowlist].map((a) => a.toLowerCase()).sort(),
    categoryLimits: Object.fromEntries(
      Object.entries(p.categoryLimits).sort(([a], [b]) => a.localeCompare(b)),
    ),
    maxNegotiationRounds: p.maxNegotiationRounds,
  });
  return ethers.id(canonical);
}

export interface SpendContext {
  vendor?: string;
  category?: string;
  amountKite: number;
  negotiationRound?: number;
}

export class PolicyViolation extends Error {
  constructor(public readonly reason: string) {
    super(`PolicyViolation: ${reason}`);
  }
}

export function assertWithinPolicy(p: AgentPolicy, ctx: SpendContext): void {
  if (p.status !== "active") {
    throw new PolicyViolation(`agent ${p.agentId} status=${p.status}`);
  }
  if (ctx.vendor && p.vendorAllowlist.length > 0) {
    if (!p.vendorAllowlist.includes(ctx.vendor.toLowerCase())) {
      throw new PolicyViolation(`vendor ${ctx.vendor} not in allowlist`);
    }
  }
  if (ctx.category && p.categoryLimits[ctx.category] !== undefined) {
    if (ctx.amountKite > p.categoryLimits[ctx.category]) {
      throw new PolicyViolation(
        `amount ${ctx.amountKite} KITE exceeds category cap ${p.categoryLimits[ctx.category]} for ${ctx.category}`,
      );
    }
  }
  if (typeof ctx.negotiationRound === "number" && ctx.negotiationRound > p.maxNegotiationRounds) {
    throw new PolicyViolation(`negotiation round ${ctx.negotiationRound} > max ${p.maxNegotiationRounds}`);
  }
  if (p.perTxCapKite > 0 && ctx.amountKite > p.perTxCapKite) {
    throw new PolicyViolation(`amount ${ctx.amountKite} KITE > perTxCap ${p.perTxCapKite}`);
  }
}

// TODO(tee): integrate Phala/Marlin TEE attestation so the agent process can prove
// it's running unmodified before any spend. For now this is a no-op gate.
export async function verifyTeeAttestation(_agentId: string): Promise<boolean> {
  return true;
}
