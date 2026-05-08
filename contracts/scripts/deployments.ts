import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DeploymentRecord = {
  network: string;
  chainId?: number;
  attestation?: {
    address: `0x${string}`;
    deployer: `0x${string}`;
    treasury: `0x${string}`;
    deployTx?: `0x${string}`;
    policyLabel?: string;
    policyHash?: `0x${string}`;
    policyCid?: string;
    deployedAt: string;
  };
  agentTreasury?: {
    address: `0x${string}`;
    governance: `0x${string}`;
    minStakeWei: string;
    deployTx?: `0x${string}`;
    deployedAt: string;
  };
};

const ROOT = resolve(import.meta.dirname, "..");

export function deploymentsPath(network: string): string {
  return resolve(ROOT, "deployments", `${network}.json`);
}

export function readDeployments(network: string): DeploymentRecord {
  const path = deploymentsPath(network);
  if (!existsSync(path)) return { network };
  return JSON.parse(readFileSync(path, "utf8")) as DeploymentRecord;
}

export function writeDeployments(network: string, patch: Partial<DeploymentRecord>): DeploymentRecord {
  const path = deploymentsPath(network);
  mkdirSync(dirname(path), { recursive: true });
  const current = readDeployments(network);
  const merged: DeploymentRecord = { ...current, ...patch, network };
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}
