// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AgentRegistry } from "../registry/AgentRegistry.sol";

contract IntentManager {
    enum IntentStatus {
        None,
        Queued,
        Batched,
        Executed,
        Failed,
        Cancelled,
        Expired
    }

    struct IntentRecord {
        bytes32 agentId;
        address submitter;
        AgentRegistry.IntentType intentType;
        IntentStatus status;
        bytes32 payloadHash;
        uint256 amount;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct DailyUsage {
        uint256 day;
        uint256 spent;
    }

    AgentRegistry public immutable registry;
    address public owner;
    address public coordinator;

    mapping(bytes32 => IntentRecord) private intents;
    mapping(bytes32 => DailyUsage) private dailyUsage;

    event IntentCreated(
        bytes32 indexed intentId,
        bytes32 indexed agentId,
        address indexed submitter,
        AgentRegistry.IntentType intentType,
        bytes32 payloadHash,
        uint256 amount
    );
    event IntentStatusChanged(bytes32 indexed intentId, IntentStatus status);
    event CoordinatorUpdated(address indexed coordinator);
    event AgentDailyUsageRecorded(bytes32 indexed agentId, uint256 indexed day, uint256 spent);

    error NotOwner();
    error NotCoordinator();
    error IntentAlreadyExists();
    error IntentNotFound();
    error InvalidStatus();
    error UnauthorizedAgent();
    error DailyLimitExceeded();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCoordinator() {
        if (msg.sender != coordinator) revert NotCoordinator();
        _;
    }

    constructor(AgentRegistry registry_) {
        registry = registry_;
        owner = msg.sender;
        coordinator = msg.sender;
    }

    function setCoordinator(address coordinator_) external onlyOwner {
        coordinator = coordinator_;
        emit CoordinatorUpdated(coordinator_);
    }

    function createIntent(
        bytes32 intentId,
        bytes32 agentId,
        AgentRegistry.IntentType intentType,
        bytes32 payloadHash,
        uint256 amount
    ) external {
        if (intents[intentId].status != IntentStatus.None) revert IntentAlreadyExists();
        if (!registry.isRegisteredAgent(agentId, msg.sender)) revert UnauthorizedAgent();
        registry.canExecute(agentId, intentType, amount);
        _consumeDailyLimit(agentId, amount);

        intents[intentId] = IntentRecord({
            agentId: agentId,
            submitter: msg.sender,
            intentType: intentType,
            status: IntentStatus.Queued,
            payloadHash: payloadHash,
            amount: amount,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        emit IntentCreated(intentId, agentId, msg.sender, intentType, payloadHash, amount);
        emit IntentStatusChanged(intentId, IntentStatus.Queued);
    }

    function cancelIntent(bytes32 intentId) external {
        IntentRecord storage record = intents[intentId];
        if (record.status == IntentStatus.None) revert IntentNotFound();
        if (record.submitter != msg.sender) revert UnauthorizedAgent();
        if (record.status != IntentStatus.Queued) revert InvalidStatus();

        _setStatus(intentId, IntentStatus.Cancelled);
    }

    function markBatched(bytes32 intentId) external onlyCoordinator {
        IntentRecord storage record = intents[intentId];
        if (record.status == IntentStatus.None) revert IntentNotFound();
        if (record.status != IntentStatus.Queued) revert InvalidStatus();
        _setStatus(intentId, IntentStatus.Batched);
    }

    function markExecuted(bytes32 intentId) external onlyCoordinator {
        IntentRecord storage record = intents[intentId];
        if (record.status == IntentStatus.None) revert IntentNotFound();
        if (record.status != IntentStatus.Batched) revert InvalidStatus();
        _setStatus(intentId, IntentStatus.Executed);
    }

    function markFailed(bytes32 intentId) external onlyCoordinator {
        IntentRecord storage record = intents[intentId];
        if (record.status == IntentStatus.None) revert IntentNotFound();
        if (record.status != IntentStatus.Batched) revert InvalidStatus();
        _setStatus(intentId, IntentStatus.Failed);
    }

    function getIntent(bytes32 intentId) external view returns (IntentRecord memory) {
        if (intents[intentId].status == IntentStatus.None) revert IntentNotFound();
        return intents[intentId];
    }

    function getIntentStatus(bytes32 intentId) external view returns (IntentStatus) {
        return intents[intentId].status;
    }

    function getDailyUsage(bytes32 agentId) external view returns (DailyUsage memory) {
        return dailyUsage[agentId];
    }

    function _setStatus(bytes32 intentId, IntentStatus status) private {
        intents[intentId].status = status;
        intents[intentId].updatedAt = block.timestamp;
        emit IntentStatusChanged(intentId, status);
    }

    function _consumeDailyLimit(bytes32 agentId, uint256 amount) private {
        AgentRegistry.AgentPolicy memory policy = registry.getPolicy(agentId);
        if (policy.dailyLimit == 0) {
            return;
        }

        uint256 currentDay = block.timestamp / 1 days;
        DailyUsage storage usage = dailyUsage[agentId];

        // Daily limits reset on UTC-style chain days. This keeps enforcement
        // deterministic and avoids depending on off-chain timezone logic.
        if (usage.day != currentDay) {
            usage.day = currentDay;
            usage.spent = 0;
        }

        if (usage.spent > policy.dailyLimit || amount > policy.dailyLimit - usage.spent) {
            revert DailyLimitExceeded();
        }

        usage.spent += amount;
        emit AgentDailyUsageRecorded(agentId, currentDay, usage.spent);
    }
}
