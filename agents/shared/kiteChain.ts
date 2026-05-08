export const KITE_CHAIN_ID = 2368;
export const KITE_CHAIN_HEX = "0x940";
export const KITE_NETWORK_KEY = "kite_testnet";

export const kiteTestnet = {
  id: KITE_CHAIN_ID,
  name: "KiteAI Testnet",
  rpc: "https://rpc-testnet.gokite.ai",
  bundler: "https://bundler-service.staging.gokite.ai/rpc",
  explorer: "https://testnet.kitescan.ai",
  nativeCurrency: { name: "Kite", symbol: "KITE", decimals: 18 },
} as const;

export const STOREFRONT_CONTRACT = "0x2aa194bef6ad273ade4530f5f34633890ee99e76";

export const STOREFRONT_ABI = [
  "function settleOrder(string kitePassportId, string orderId) external payable",
  "function storePolicyHash() view returns (bytes32)",
  "function isPassportAuthenticated(bytes32) view returns (bool)",
  "function withdraw() external",
  "function getStats() view returns (uint256 count, uint256 volume)",
  "function authenticateAgentIdentity(string kitePassportId) external",
  "function authenticateViaTreasury(string kitePassportId) external",
  "function setAgentTreasury(address _agentTreasury) external",
  "function agentTreasury() view returns (address)",
  "function setStorePolicy(bytes32 _policyHash, string _policyCid) external",
  "function storePolicyCid() view returns (string)",
  "function updateTreasury(address _newTreasury) external",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
  "function isOrderSettled(bytes32) view returns (bool)",
  "event PurchaseAttested(address indexed operatorWallet, string kitePassportId, string orderId, uint256 amountPaidWei, uint256 totalPurchases)",
  "event AgentAuthenticated(string kitePassportId, bool status)",
  "event AgentTreasuryUpdated(address indexed oldAgentTreasury, address indexed newAgentTreasury)",
] as const;

// AgentTreasury — populated after deploy-treasury.ts. Empty string means agents
// run in pre-Treasury direct-settle mode (USE_TREASURY=false).
export const TREASURY_CONTRACT = (process.env.TREASURY_CONTRACT ?? "").toLowerCase();
export const USE_TREASURY = process.env.USE_TREASURY === "true";
