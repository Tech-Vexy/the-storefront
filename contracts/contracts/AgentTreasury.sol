// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStorefrontAttestation {
    function settleOrder(string calldata kitePassportId, string calldata orderId) external payable;
    function authenticateViaTreasury(string calldata kitePassportId) external;
}

/**
 * @title AgentTreasury
 * @dev On-chain trust layer for autonomous agents on Kite Chain. Custodies native KITE per
 * agent, enforces per-tx and rolling-24h spend caps, binds an off-chain policy hash to each
 * agent, and forwards settlement to StorefrontAttestation. Permissionless registerAgent gates
 * onboarding behind a KITE stake instead of manual owner approval.
 */
contract AgentTreasury {
    struct Agent {
        address owner;
        address wallet;
        uint128 dailyCap;
        uint128 perTxCap;
        bytes32 policyHash;
        uint128 stake;
        uint64 windowStart;
        uint128 spentInWindow;
        uint128 balance;
        bool active;
        bool registered;
    }

    address public governance;
    IStorefrontAttestation public immutable attestation;
    uint128 public minStake;
    uint64 public constant WINDOW = 1 days;

    mapping(bytes32 => Agent) public agents;
    mapping(bytes32 => mapping(bytes32 => bool)) public settledOrders;

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, address wallet, uint128 stake);
    event Deposited(bytes32 indexed agentId, address indexed from, uint256 amount);
    event Withdrawn(bytes32 indexed agentId, address indexed to, uint256 amount);
    event Spent(
        bytes32 indexed agentId,
        bytes32 indexed orderId,
        address indexed recipient,
        uint256 amount,
        uint256 spentInWindow
    );
    event Frozen(bytes32 indexed agentId);
    event Unfrozen(bytes32 indexed agentId);
    event PolicyUpdated(bytes32 indexed agentId, bytes32 newPolicyHash);
    event CapsUpdated(bytes32 indexed agentId, uint128 dailyCap, uint128 perTxCap);
    event GovernanceUpdated(address indexed previous, address indexed next);
    event MinStakeUpdated(uint128 previous, uint128 next);

    modifier onlyGovernance() {
        require(msg.sender == governance, "Not governance");
        _;
    }

    modifier onlyAgentOwner(bytes32 agentId) {
        require(agents[agentId].registered, "Unknown agent");
        require(msg.sender == agents[agentId].owner, "Not agent owner");
        _;
    }

    constructor(address _attestation, address _governance, uint128 _minStake) {
        require(_attestation != address(0), "Invalid attestation");
        require(_governance != address(0), "Invalid governance");
        attestation = IStorefrontAttestation(_attestation);
        governance = _governance;
        minStake = _minStake;
    }

    /**
     * @dev Permissionless registration. Posting >= minStake KITE and a passport ID auto-
     * authenticates the passport on the attestation contract; no manual owner step.
     * The stake remains custodied here as the agent's opening balance.
     */
    function registerAgent(
        bytes32 agentId,
        address wallet,
        uint128 dailyCap,
        uint128 perTxCap,
        bytes32 policyHash,
        string calldata passportId
    ) external payable {
        require(!agents[agentId].registered, "Already registered");
        require(wallet != address(0), "Invalid wallet");
        require(perTxCap > 0 && dailyCap >= perTxCap, "Invalid caps");
        require(msg.value >= minStake, "Stake below minimum");
        require(msg.value <= type(uint128).max, "Stake overflow");

        agents[agentId] = Agent({
            owner: msg.sender,
            wallet: wallet,
            dailyCap: dailyCap,
            perTxCap: perTxCap,
            policyHash: policyHash,
            stake: uint128(msg.value),
            windowStart: uint64(block.timestamp),
            spentInWindow: 0,
            balance: uint128(msg.value),
            active: true,
            registered: true
        });

        attestation.authenticateViaTreasury(passportId);
        emit AgentRegistered(agentId, msg.sender, wallet, uint128(msg.value));
    }

    function deposit(bytes32 agentId) external payable {
        Agent storage a = agents[agentId];
        require(a.registered, "Unknown agent");
        require(msg.value > 0, "Zero deposit");
        require(uint256(a.balance) + msg.value <= type(uint128).max, "Balance overflow");
        a.balance += uint128(msg.value);
        emit Deposited(agentId, msg.sender, msg.value);
    }

    function withdraw(bytes32 agentId, uint256 amount) external onlyAgentOwner(agentId) {
        Agent storage a = agents[agentId];
        require(amount > 0 && amount <= a.balance, "Invalid amount");
        a.balance -= uint128(amount);
        (bool ok, ) = payable(a.owner).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit Withdrawn(agentId, a.owner, amount);
    }

    /**
     * @dev Authoritative spend path. Only the agent's wallet may invoke. Enforces:
     * agent active, perTxCap, rolling 24h dailyCap (sliding window), policyHash match,
     * order idempotency, sufficient balance. Forwards to attestation.settleOrder.
     */
    function spend(
        bytes32 agentId,
        address recipient,
        uint256 amount,
        bytes32 orderId,
        string calldata passportId,
        bytes32 policyProof
    ) external {
        Agent storage a = agents[agentId];
        require(a.registered, "Unknown agent");
        require(msg.sender == a.wallet, "Only agent wallet");
        require(a.active, "Agent frozen");
        require(amount > 0 && amount <= a.perTxCap, "PerTxCapExceeded");
        require(amount <= a.balance, "Insufficient balance");
        require(policyProof == a.policyHash, "Policy mismatch");
        require(!settledOrders[agentId][orderId], "Order already settled");
        require(recipient != address(0), "Invalid recipient");

        if (block.timestamp >= a.windowStart + WINDOW) {
            a.windowStart = uint64(block.timestamp);
            a.spentInWindow = 0;
        }
        require(uint256(a.spentInWindow) + amount <= a.dailyCap, "DailyCapExceeded");

        a.spentInWindow += uint128(amount);
        a.balance -= uint128(amount);
        settledOrders[agentId][orderId] = true;

        attestation.settleOrder{value: amount}(passportId, _bytes32ToString(orderId));

        emit Spent(agentId, orderId, recipient, amount, a.spentInWindow);
    }

    function freeze(bytes32 agentId) external onlyGovernance {
        require(agents[agentId].registered, "Unknown agent");
        agents[agentId].active = false;
        emit Frozen(agentId);
    }

    function unfreeze(bytes32 agentId) external onlyGovernance {
        require(agents[agentId].registered, "Unknown agent");
        agents[agentId].active = true;
        emit Unfrozen(agentId);
    }

    function setPolicyHash(bytes32 agentId, bytes32 newHash) external onlyAgentOwner(agentId) {
        agents[agentId].policyHash = newHash;
        emit PolicyUpdated(agentId, newHash);
    }

    function setCaps(bytes32 agentId, uint128 dailyCap, uint128 perTxCap) external onlyAgentOwner(agentId) {
        require(perTxCap > 0 && dailyCap >= perTxCap, "Invalid caps");
        agents[agentId].dailyCap = dailyCap;
        agents[agentId].perTxCap = perTxCap;
        emit CapsUpdated(agentId, dailyCap, perTxCap);
    }

    function setGovernance(address next) external onlyGovernance {
        require(next != address(0), "Invalid governance");
        emit GovernanceUpdated(governance, next);
        governance = next;
    }

    function setMinStake(uint128 next) external onlyGovernance {
        emit MinStakeUpdated(minStake, next);
        minStake = next;
    }

    function _bytes32ToString(bytes32 v) internal pure returns (string memory) {
        bytes memory out = new bytes(64);
        bytes memory hexChars = "0123456789abcdef";
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(v[i]);
            out[i * 2] = hexChars[b >> 4];
            out[i * 2 + 1] = hexChars[b & 0x0f];
        }
        return string(out);
    }
}
