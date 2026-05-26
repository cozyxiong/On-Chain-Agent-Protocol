# AI-Powered On-Chain Agent Protocol

Foundry + Solidity implementation of an AI-powered intent batching protocol for
on-chain agents.

## Project Deliverables

- Protocol contracts for agent registration, intent management, smart-account
  authorization, signed scheduled settlement, and batched execution.
- Node.js backend for AI intent parsing, Uniswap quote/calldata preparation,
  coordinator jobs, platform Agent execution, relayer flow, and metrics.
- Optional Supabase/Postgres persistence for intents, batches, and coordinator
  jobs.
- Product frontend with wallet connect, AI chat, intent templates, execution
  history, Etherscan links, Agent Wallet controls, and performance dashboard.
- Sepolia deployment notes and smoke-test flow in
  [docs/sepolia-deployment.md](docs/sepolia-deployment.md).
- Final project report in [report/final-report.md](report/final-report.md).
- Product architecture and future upgrade plan in
  [docs/product-architecture.md](docs/product-architecture.md).

## Current Scope

The current implementation contains:

- `AgentRegistry`: multi-user agent registration and policy checks.
- `IntentManager`: intent lifecycle and replay protection.
- `BatchExecutor`: batched execution with per-intent result events.
- `MockERC20`: local token for protocol tests.
- `AgentSmartAccount`: ERC-4337-style smart account with owner execution,
  platform Agent authorization, target/value/expiry limits, wildcard
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
- Supabase mirror storage for deployment-grade history and metrics durability.

## Execution Modes

### Default EOA Mode

Users connect an EOA wallet and sign transactions directly. For scheduled
intents, users sign EIP-712 typed data now, optionally fund escrow, and the
coordinator relayer executes later.

### Platform Agent Multi-User Mode

Each user connects their own EOA wallet, creates or selects their own smart
account, funds it, and authorizes the platform Agent signer returned by the
backend. After authorization, the platform Agent can execute permitted calls
through that user's smart account without asking the Owner to sign every action.

In this demo, the backend simulates the platform Agent signer with
`AGENT_PRIVATE_KEY` or falls back to `PRIVATE_KEY`. The frontend loads and locks
this address from:

```text
GET /agent/status
```

This makes the prototype usable by multiple people: users never provide an Agent
private key; they only authorize the shared platform Agent against their own
Smart Account. Production deployments should replace this demo private-key
signer with an external Agent node, MPC/KMS/HSM, TEE runtime, or ERC-4337
session-key signer.

## Batching

The strongest live batching path is:

```text
Same Smart Account + authorized platform Agent signer + multiple compatible intents
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

Current smart-contract test suite:

```text
23 tests passing
```

## Environment

Copy `.env.example` to `.env` and fill in Sepolia RPC, deployer key, platform
Agent key, contract addresses, AI provider key, and Uniswap API key as needed.
Do not commit `.env`.

For Supabase persistence, set:

```text
SUPABASE_URL=https://zjiagymfpemkdnvdiibc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

The backend writes to `aap_intents`, `aap_batches`, and
`aap_coordinator_jobs`. These tables have RLS enabled and are intended for
server-side `service_role` access only.

## Sepolia Deployment

See [docs/sepolia-deployment.md](docs/sepolia-deployment.md).

Useful endpoints:

- `POST /ai/parse-intent`
- `POST /intents`
- `POST /batches/build`
- `POST /aggregator/plan`
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

## Final Documentation

- [Final report](report/final-report.md)
- [Product architecture](docs/product-architecture.md)
- [Sepolia deployment guide](docs/sepolia-deployment.md)

## Supabase

The Supabase schema is stored in:

```text
supabase/migrations/202605250001_aap_storage.sql
```

It has been applied to project `zjiagymfpemkdnvdiibc`.
