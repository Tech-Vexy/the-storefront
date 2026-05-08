// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title StorefrontAttestation
 * @dev Optimized settlement layer for Agent-to-Machine (A2M) and Machine-to-Machine (M2M) commerce.
 * Handles sovereign identity verification, payment settlement, and on-chain purchase attestation.
 */
contract StorefrontAttestation {
    address public owner;
    address public treasury;
    address public agentTreasury;
    uint256 private _totalPurchases;
    uint256 private _totalVolume;

    // Store Policy Hash: Allows agents to verify they are interacting with the correct terms.
    bytes32 public storePolicyHash;

    // Store Policy CID: IPFS/IPLD CID of the canonical policy document, so agents
    // can fetch and verify the doc rather than only the commit-to hash.
    string public storePolicyCid;

    // Idempotency: Maps keccak256(orderId) to settlement status
    mapping(bytes32 => bool) public isOrderSettled;

    // Identity: Maps keccak256(kitePassportId) to authentication status
    mapping(bytes32 => bool) public isPassportAuthenticated;

    event PurchaseAttested(
        address indexed operatorWallet,
        string kitePassportId,
        string orderId,
        uint256 amountPaidWei,
        uint256 totalPurchases
    );

    event AgentAuthenticated(string kitePassportId, bool status);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event AgentTreasuryUpdated(address indexed oldAgentTreasury, address indexed newAgentTreasury);
    event PolicyUpdated(bytes32 newPolicyHash, string newPolicyCid);

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    constructor(address _treasury) {
        owner = msg.sender;
        treasury = _treasury;
    }

    /**
     * @dev Sets the store policy hash and the IPFS CID of the canonical policy doc.
     * Pass an empty string for `_policyCid` to leave the CID unchanged (e.g. when
     * rotating only the hash); pass a non-empty string to update both.
     */
    function setStorePolicy(bytes32 _policyHash, string calldata _policyCid) external onlyOwner {
        storePolicyHash = _policyHash;
        if (bytes(_policyCid).length != 0) {
            storePolicyCid = _policyCid;
        }
        emit PolicyUpdated(_policyHash, storePolicyCid);
    }

    /**
     * @dev Updates the treasury address.
     */
    function updateTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid treasury address");
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    /**
     * @dev One-shot setter for the AgentTreasury contract that may auto-authenticate
     * passports during permissionless agent registration. Owner-only and irrevocable
     * once set, to bound blast radius if AgentTreasury is later compromised: rotation
     * requires a new attestation deploy.
     */
    function setAgentTreasury(address _agentTreasury) external onlyOwner {
        require(agentTreasury == address(0), "AgentTreasury already set");
        require(_agentTreasury != address(0), "Invalid agent treasury");
        emit AgentTreasuryUpdated(agentTreasury, _agentTreasury);
        agentTreasury = _agentTreasury;
    }

    /**
     * @dev Core authentication layer: Registers and verifies a Kite Passport.
     * In production, this would involve ZK-proof or cryptographic signature verification.
     */
    function authenticateAgentIdentity(string calldata kitePassportId) external onlyOwner {
        bytes32 passportHash = keccak256(abi.encodePacked(kitePassportId));
        isPassportAuthenticated[passportHash] = true;
        emit AgentAuthenticated(kitePassportId, true);
    }

    /**
     * @dev Permissionless onboarding hook: AgentTreasury invokes this inside registerAgent
     * after a stake check, removing the manual owner approval step.
     */
    function authenticateViaTreasury(string calldata kitePassportId) external {
        require(msg.sender == agentTreasury, "Only AgentTreasury");
        bytes32 passportHash = keccak256(abi.encodePacked(kitePassportId));
        isPassportAuthenticated[passportHash] = true;
        emit AgentAuthenticated(kitePassportId, true);
    }

    /**
     * @dev Settles an order atomically with native payment.
     * Optimized for agentic execution with idempotency and value checks.
     */
    function settleOrder(
        string calldata kitePassportId,
        string calldata orderId
    ) external payable {
        bytes32 passportHash = keccak256(abi.encodePacked(kitePassportId));
        bytes32 orderHash = keccak256(abi.encodePacked(orderId));

        // 1. Checks
        require(isPassportAuthenticated[passportHash], "Kite Passport not authenticated");
        require(msg.value > 0, "Settlement requires native value");
        require(!isOrderSettled[orderHash], "Order already settled");

        // 2. Effects
        isOrderSettled[orderHash] = true;
        _totalPurchases += 1;
        _totalVolume += msg.value;

        // 3. Interactions
        emit PurchaseAttested(
            msg.sender,
            kitePassportId,
            orderId,
            msg.value,
            _totalPurchases
        );
    }

    /**
     * @dev Returns total purchase count and volume.
     */
    function getStats() external view returns (uint256 count, uint256 volume) {
        return (_totalPurchases, _totalVolume);
    }

    /**
     * @dev Securely withdraws funds to the treasury using the pull pattern.
     */
    function withdraw() external {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");
        
        (bool success, ) = payable(treasury).call{value: balance}("");
        require(success, "Withdrawal failed");
    }

    /**
     * @dev Fallback to receive ETH.
     */
    receive() external payable {}
}