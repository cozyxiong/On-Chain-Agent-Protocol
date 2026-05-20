# AI-Powered On-Chain Agent Protocol

Foundry + Solidity implementation of an AI-powered intent batching protocol for
on-chain agents.

## Current Scope

The current implementation contains:

- `AgentRegistry`: multi-user agent registration and policy checks.
- `IntentManager`: intent lifecycle and replay protection.
- `BatchExecutor`: batched execution with per-intent result events.
- `MockERC20`: local token for protocol tests.
- `AgentSmartAccount`: ERC-4337-style smart account with owner execution,
  agent/session-wallet authorization, target/value/expiry limits, wildcard
  unlimited authorization, and `executeBatchAgentCalls`.
- `SignedIntentEscrow`: EIP-712 scheduled intent settlement with replay
  protection, deadline checks, escrow funding, and batch execution.
- `backend`: Node.js AI parser, coordinator worker, relayer, Agent executor,
  Uniswap integration, wallet transaction builder, and metrics API.
- AI intent parser using DeepSeek/OpenAI-compatible APIs, with backend
  validation before execution.
- Uniswap quote/calldata service for swap and spot buy/sell intents.
- Product frontend with wallet connect, AI chat, templates, preview, execution
  history, Etherscan links, Agent Wallet controls, and performance dashboard.
- Default EOA mode with direct wallet execution and EIP-712 scheduled intents.
- Advanced Agent Wallet mode where the Owner authorizes once and the backend
  demo Agent signer executes transfer, swap, rebalance, scheduled, and batch
  workflows without additional Owner signatures.
- Coordinator job storage, due-time scanning, retries, receipt tracking, signed
  call batching, and scheduled Agent Wallet batching.

## Execution Modes

### Default EOA Mode

Users connect an EOA wallet and sign transactions directly. For scheduled
intents, users sign EIP-712 typed data now, optionally fund escrow, and the
coordinator relayer executes later.

### Advanced Agent Wallet Mode

Users create or select a smart account, fund it, and authorize an Agent/session
wallet. After authorization, the Agent can execute permitted calls through the
smart account without asking the Owner to sign every action.

In this demo, the backend simulates the Agent signer with `AGENT_PRIVATE_KEY`
or falls back to `PRIVATE_KEY`. The frontend `Agent/session wallet` must match:

```text
GET /agent/status
```

Production deployments should replace this demo private-key signer with an
external Agent node, MPC/KMS/HSM, TEE runtime, or ERC-4337 session-key signer.

## Batching

The strongest live batching path is:

```text
Same Smart Account + authorized Agent signer + multiple compatible intents
  -> executeBatchAgentCalls
  -> one Sepolia transaction
```

The project also supports EIP-712 signed scheduled batching through
`SignedIntentEscrow.executeBatchSignedCalls`.

Current limitation: the code supports batching through one authorized executing
Agent at a time. True "same Smart Account / multiple independent Agent signers"
aggregation would require either a shared executor Agent or a new multi-agent
batch signature format.

## Commands

```bash
forge build
forge test
```

```bash
cd backend
npm test
npm start
```

Backend API defaults to `http://localhost:8787`.

```bash
cd frontend
npm start
```

Dashboard defaults to `http://localhost:5173`.

Current backend test suite:

```text
40 tests passing
```

## Sepolia Deployment

See [docs/sepolia-deployment.md](docs/sepolia-deployment.md).

Useful endpoints:

- `POST /ai/parse-intent`
- `POST /intents`
- `POST /batches/build`
- `POST /coordinator/simulate-execution`
- `GET /coordinator/jobs`
- `POST /coordinator/jobs`
- `GET /scheduler/due`
- `POST /rebalance/plan`
- `POST /uniswap/quote`
- `POST /uniswap/prepare-swap`
- `POST /wallet/prepare-transaction`
- `POST /wallet/prepare-agent-intent-execution`
- `POST /wallet/prepare-agent-intent-batch-execution`
- `POST /wallet/prepare-authorize-agent`
- `POST /wallet/prepare-revoke-agent`
- `POST /wallet/agent-permission`
- `GET /agent/status`
- `POST /agent/execute-intent`
- `POST /agent/execute-batch-intents`
- `POST /settlement/prepare-scheduled-workflow`
- `POST /settlement/execute-signed-call`
- `POST /settlement/execute-batch-signed-calls`
- `GET /metrics`

## Report

The full project report is in:

```text
report/final-report.md
```
