// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentRegistry {
    enum IntentType {
        Transfer,
        Swap,
        Rebalance,
        Scheduled
    }

    struct Agent {
        address owner;
        address agent;
        address smartAccount;
        bool active;
        uint256 createdAt;
        string metadataURI;
    }

    struct AgentPolicy {
        bool allowTransfer;
        bool allowSwap;
        bool allowRebalance;
        bool allowScheduled;
        uint256 maxAmountPerTx;
        uint256 dailyLimit;
    }

    mapping(bytes32 => Agent) private agents;
    mapping(bytes32 => AgentPolicy) private policies;
    mapping(address => bytes32[]) private ownerAgents;

    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed owner,
        address indexed agent,
        address smartAccount,
        string metadataURI
    );
    event AgentDeactivated(bytes32 indexed agentId);
    event AgentPolicyUpdated(bytes32 indexed agentId);

    error InvalidAddress();
    error AgentAlreadyExists();
    error AgentNotFound();
    error NotAgentOwner();
    error AgentInactive();
    error IntentTypeNotAllowed();
    error AmountExceedsPolicy();

    modifier onlyAgentOwner(bytes32 agentId) {
        Agent storage agentRecord = agents[agentId];
        if (agentRecord.owner == address(0)) revert AgentNotFound();
        if (agentRecord.owner != msg.sender) revert NotAgentOwner();
        _;
    }

    function registerAgent(
        address agent,
        address smartAccount,
        AgentPolicy calldata policy,
        string calldata metadataURI
    ) external returns (bytes32 agentId) {
        if (agent == address(0) || smartAccount == address(0)) revert InvalidAddress();

        agentId = computeAgentId(msg.sender, agent, smartAccount);
        if (agents[agentId].owner != address(0)) revert AgentAlreadyExists();

        agents[agentId] = Agent({
            owner: msg.sender,
            agent: agent,
            smartAccount: smartAccount,
            active: true,
            createdAt: block.timestamp,
            metadataURI: metadataURI
        });
        policies[agentId] = policy;
        ownerAgents[msg.sender].push(agentId);

        emit AgentRegistered(agentId, msg.sender, agent, smartAccount, metadataURI);
    }

    function deactivateAgent(bytes32 agentId) external onlyAgentOwner(agentId) {
        agents[agentId].active = false;
        emit AgentDeactivated(agentId);
    }

    function updatePolicy(bytes32 agentId, AgentPolicy calldata policy)
        external
        onlyAgentOwner(agentId)
    {
        policies[agentId] = policy;
        emit AgentPolicyUpdated(agentId);
    }

    function canExecute(bytes32 agentId, IntentType intentType, uint256 amount)
        external
        view
        returns (bool)
    {
        Agent storage agentRecord = agents[agentId];
        if (agentRecord.owner == address(0)) revert AgentNotFound();
        if (!agentRecord.active) revert AgentInactive();

        AgentPolicy storage policy = policies[agentId];
        bool allowed = intentType == IntentType.Transfer
            ? policy.allowTransfer
            : intentType == IntentType.Swap
                ? policy.allowSwap
                : intentType == IntentType.Rebalance ? policy.allowRebalance : policy.allowScheduled;

        if (!allowed) revert IntentTypeNotAllowed();
        if (policy.maxAmountPerTx > 0 && amount > policy.maxAmountPerTx) {
            revert AmountExceedsPolicy();
        }

        return true;
    }

    function isRegisteredAgent(bytes32 agentId, address agent) external view returns (bool) {
        Agent storage agentRecord = agents[agentId];
        return agentRecord.owner != address(0) && agentRecord.agent == agent && agentRecord.active;
    }

    function getAgent(bytes32 agentId) external view returns (Agent memory) {
        if (agents[agentId].owner == address(0)) revert AgentNotFound();
        return agents[agentId];
    }

    function getPolicy(bytes32 agentId) external view returns (AgentPolicy memory) {
        if (agents[agentId].owner == address(0)) revert AgentNotFound();
        return policies[agentId];
    }

    function getOwnerAgents(address owner) external view returns (bytes32[] memory) {
        return ownerAgents[owner];
    }

    function computeAgentId(address owner, address agent, address smartAccount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(owner, agent, smartAccount));
    }
}
