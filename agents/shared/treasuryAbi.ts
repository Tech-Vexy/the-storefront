// ABI fragment for AgentTreasury — only the functions and events agents need.
// Full ABI lives in contracts/artifacts after `npx hardhat compile`.
export const TREASURY_ABI = [
  "function spend(bytes32 agentId, address recipient, uint256 amount, bytes32 orderId, string passportId, bytes32 policyProof) external",
  "function deposit(bytes32 agentId) external payable",
  "function withdraw(bytes32 agentId, uint256 amount) external",
  "function registerAgent(bytes32 agentId, address wallet, uint128 dailyCap, uint128 perTxCap, bytes32 policyHash, string passportId) external payable",
  "function agents(bytes32) view returns (address owner, address wallet, uint128 dailyCap, uint128 perTxCap, bytes32 policyHash, uint128 stake, uint64 windowStart, uint128 spentInWindow, uint128 balance, bool active, bool registered)",
  "function settledOrders(bytes32, bytes32) view returns (bool)",
  "event Spent(bytes32 indexed agentId, bytes32 indexed orderId, address indexed recipient, uint256 amount, uint256 spentInWindow)",
  "event AgentRegistered(bytes32 indexed agentId, address indexed owner, address wallet, uint128 stake)",
] as const;
