# The Storefront Swarm: The Invisible DApp

**An Autonomous Agentic Commerce Ecosystem for the Kite AI Global Hackathon**

[![Kite AI](https://img.shields.io/badge/Chain-Kite%20AI%20Testnet-blue)](https://gokite.ai)
[![Protocol](https://img.shields.io/badge/Protocol-x402%20%2F%20AP2-orange)](https://gokite.ai/x402)

## 🚀 The Vision
The "Invisible DApp" pivot solves the single biggest friction point in Web3: **Adoption**. By moving the complex blockchain interactions (seed phrases, gas fees, and x402 settlements) into background agent operations, we enable local merchants and global vendors to utilize the Kite AI blockchain without a learning curve.

## 🏗️ Technical Architecture

### Agent Swarm (5 Autonomous Agents)

| Agent | Port | Role |
|-------|------|------|
| **Store Manager** | 5001 | Core API — catalog, negotiation, checkout, L402 settlement, dashboard |
| **Supplier** | 5002 | Wholesale M2M endpoint — quotes, negotiation, on-chain settlement verification |
| **Scam Supplier** | 5003 | Adversarial agent for testing reputation & security guardrails |
| **CFO / Restock** | — | Autonomous treasury — inventory audits, supplier negotiation, Coinbase off-ramp |
| **Dynamic Pricing** | — | Demand-driven price adjustments with floor/cost guardrails |

### Smart Contracts (Kite AI Testnet — Chain 2368)

| Contract | Purpose |
|----------|---------|
| **StorefrontAttestation** | Atomic L402 settlement, passport authentication, purchase attestation events |
| **AgentTreasury** | Per-agent custodied KITE, per-tx + daily spend caps, policy binding, permissionless registration via stake |

### Data Layer
- **Sanity CMS** — Product catalog, orders, swarm logs, reputation scores, agent registry, budget ledger
- **8 schema types**: `product`, `category`, `order`, `swarmLog`, `reputation`, `wholesaleProduct`, `agentRegistry`, `budgetLedger`

### Shared Infrastructure (`agents/shared/`)
- `kiteChain.ts` — Chain config + full contract ABIs
- `settlementVerifier.ts` — On-chain receipt verification with typed failure codes
- `treasury.ts` + `treasuryAbi.ts` — AgentTreasury spend path (AA + EOA fallback)
- `policy.ts` — Off-chain policy loading, hashing, and enforcement
- `selfHealing.ts` — Auto-retry with gas multiplier for transient reverts
- `money.ts` — Precision-safe wei ↔ KITE conversion (handles scientific notation, overflow)
- `sanityLogger.ts` — Centralized swarm logging + reputation scoring

## 🛡️ Security Architecture

### 1. Stake-to-Deploy (AgentTreasury)
Permissionless agent registration requires posting ≥ `minStake` KITE. The stake auto-authenticates the agent's Kite Passport on the attestation contract. Governance can freeze misbehaving agents.

### 2. On-Chain Guardrails
- **Per-transaction cap** — Hard ceiling on single spend
- **Rolling 24h daily cap** — Sliding window budget enforcement
- **Policy binding** — Off-chain policy hash must match on-chain proof
- **Order idempotency** — Duplicate settlement rejected at contract level

### 3. Reputation System
Agents track supplier/entity reputation in Sanity. Failed settlements incur -20 score; successful ones earn +5. The CFO agent uses reputation to select suppliers.

### 4. Rate Limiting
Token-bucket rate limiting on all agents (per-IP, per-endpoint). Periodic cleanup prevents memory leaks.

## 💳 The "Last Mile" Off-Ramp
1. CFO Agent monitors the settlement contract
2. Revenue is withdrawn and routed through **Coinbase CDP** to a linked bank account
3. Merchant receives on-chain notification of processed settlement and deposit.

## 📊 Interfaces

| Interface | URL | Description |
|-----------|-----|-------------|
| **Consumer Storefront** | `http://localhost:5001/` | Search, negotiate, buy hardware with on-chain settlement |
| **Swarm Dashboard** | `http://localhost:5001/dashboard` | Real-time revenue, on-chain stats, reputation matrix, activity stream |
| **Agent Manifest** | `http://localhost:5001/.well-known/agents.json` | Machine-readable discovery for external agents |

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+
- Kite AI Testnet wallet (funded via [faucet](https://faucet.gokite.ai))

### Installation
```bash
# Install dependencies
pnpm install

# Configure environment
cp agents/.env.example agents/.env
# Edit agents/.env with your keys

# Start the Swarm
cd agents && ./start_swarm.sh

# Include scam supplier for security demo
./start_swarm.sh --scam
```

### Smart Contract Deployment
```bash
cd contracts

# Deploy StorefrontAttestation
npx hardhat run scripts/deploy-storefront.ts --network kiteTestnet

# Deploy AgentTreasury (requires ATTESTATION_ADDRESS)
ATTESTATION_ADDRESS=0x... npx hardhat run scripts/deploy-treasury.ts --network kiteTestnet

# Run tests
npx hardhat test
```

## 🏆 Hackathon Tracks
- **Primary**: Agentic Commerce (Autonomous sales, restocking, and treasury management)

---
*Developed for the Kite AI Global Hackathon 2026.*
