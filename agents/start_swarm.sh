#!/bin/bash
set -euo pipefail

# ─── Storefront Swarm Launcher ──────────────────────────────────────────────────
# Starts all agents in the correct dependency order with health checks.
# Usage:
#   ./start_swarm.sh           # Start all agents
#   ./start_swarm.sh --scam    # Include the scam supplier for security demo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

INCLUDE_SCAM=false
[[ "${1:-}" == "--scam" ]] && INCLUDE_SCAM=true

# Colors
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; NC='\033[0m'

cleanup() {
  echo -e "\n${Y}Shutting down swarm...${NC}"
  pkill -f "tsx supplierAgent.ts" 2>/dev/null || true
  pkill -f "tsx storeManager.ts" 2>/dev/null || true
  pkill -f "tsx restockAgent.ts" 2>/dev/null || true
  pkill -f "tsx dynamicPricingAgent.ts" 2>/dev/null || true
  pkill -f "tsx scamSupplier.ts" 2>/dev/null || true
  echo -e "${G}All agents stopped.${NC}"
}

# Clean up any existing processes
cleanup 2>/dev/null
trap cleanup EXIT
sleep 1

wait_for_port() {
  local port=$1 name=$2 timeout=${3:-15}
  echo -ne "  Waiting for ${name} on :${port}..."
  for i in $(seq 1 $timeout); do
    if curl -sf "http://localhost:${port}/healthz" > /dev/null 2>&1 || \
       curl -sf "http://localhost:${port}/" > /dev/null 2>&1; then
      echo -e " ${G}✓${NC}"
      return 0
    fi
    sleep 1
  done
  echo -e " ${R}✗ (timeout)${NC}"
  return 1
}

echo -e "${C}═══════════════════════════════════════════════════════${NC}"
echo -e "${C}       STOREFRONT SWARM — Autonomous Commerce         ${NC}"
echo -e "${C}═══════════════════════════════════════════════════════${NC}"
echo ""

# 1. Supplier (port 5002) — must start first, Manager doesn't depend on it but CFO does
echo -e "${Y}[1/4]${NC} Starting Supplier Agent..."
npx tsx supplierAgent.ts &
wait_for_port 5002 "Supplier" 15

# 1b. Scam Supplier (port 5003) — optional, for security demo
if $INCLUDE_SCAM; then
  echo -e "${Y}[1b]${NC}  Starting Scam Supplier (security demo)..."
  npx tsx scamSupplier.ts &
  wait_for_port 5003 "ScamSupplier" 10 || true
fi

# 2. Store Manager (port 5001) — core API, serves storefront + dashboard
echo -e "${Y}[2/4]${NC} Starting Store Manager..."
npx tsx storeManager.ts &
wait_for_port 5001 "Manager" 20

# 3. CFO / Restock Agent — no HTTP server, just a loop
echo -e "${Y}[3/4]${NC} Starting CFO Agent..."
npx tsx restockAgent.ts &
sleep 3

# 4. Dynamic Pricing Agent — no HTTP server, just a loop
echo -e "${Y}[4/4]${NC} Starting Dynamic Pricing Agent..."
npx tsx dynamicPricingAgent.ts &
sleep 2

echo ""
echo -e "${C}═══════════════════════════════════════════════════════${NC}"
echo -e "${G}  SWARM ONLINE${NC}"
echo -e "  Storefront:  ${C}http://localhost:5001/${NC}"
echo -e "  Dashboard:   ${C}http://localhost:5001/dashboard${NC}"
echo -e "  Manifest:    ${C}http://localhost:5001/.well-known/agents.json${NC}"
echo -e "  Supplier:    ${C}http://localhost:5002/wholesale${NC}"
echo -e "${C}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${Y}Press Ctrl+C to shut down all agents.${NC}"

# Wait for any background process to exit
wait
