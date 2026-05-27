# Demo Presentation Script

## Purpose

This document defines the recommended demo flow for presenting the
AI-Powered On-Chain Agent Protocol. The goal is to demonstrate the project as a
complete execution system, not only as a smart contract or frontend prototype.

The demo should prove five outcomes:

- Natural-language user intents can be parsed into structured actions.
- Users explicitly authorize execution through wallet signatures, EIP-712
  signed intents, or Agent Wallet permissions.
- Compatible work can be grouped into fewer execution transactions.
- The coordinator supports asynchronous execution, retries, receipt tracking,
  and Supabase/Postgres job claiming.
- The dashboard and tests provide measurable evidence for throughput, latency,
  failure rate, and gas savings.

## Recommended Demo Timing

| Time | Segment | What to Show | Main Message |
|---:|---|---|---|
| 0:00-0:45 | Opening | PPT slides 1-2 | Project goal and requirement coverage |
| 0:45-2:00 | Architecture | PPT slides 3-4 | Proposal, authorization, execution, observability |
| 2:00-4:30 | Product Flow | Frontend at `http://localhost:5173` | AI intent parsing and wallet-facing workflow |
| 4:30-6:30 | Execution | Agent Wallet / coordinator jobs / history | Async execution and batching behavior |
| 6:30-7:30 | Metrics | Performance dashboard | Throughput, latency, failure rate, gas savings |
| 7:30-8:45 | Code Proof | PPT code slides or IDE snippets | Worker, Supabase `SKIP LOCKED`, contract checks |
| 8:45-10:00 | Testing and Close | Test counts, benchmark result, video fallback | Reliability and implementation boundary |

## Pre-Demo Checklist

Before recording or presenting, confirm the following:

```bash
cd /Users/mengziqi/IdeaProjects/On-Chain-Agent-Protocol/backend
npm start
```

```bash
cd /Users/mengziqi/IdeaProjects/On-Chain-Agent-Protocol/frontend
npm start
```

Open:

```text
http://localhost:8787/health
http://localhost:5173
```

Recommended checks:

- Backend health returns `ok: true`.
- Frontend shows backend online status.
- Wallet can connect to Sepolia.
- Agent status loads from `GET /agent/status`.
- Contract addresses are configured in `.env`.
- If using Supabase, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- If using live swaps, `UNISWAP_API_KEY` is set; otherwise mock fallback is
  acceptable for local demo.

## Live Demo Flow

### 1. Start With Backend Health

Open:

```text
http://localhost:8787/health
```

Point out:

- backend is live
- storage mode is visible
- coordinator job storage reports either `supabase-postgres` or `local-json`

### 2. Open the Frontend Console

Open:

```text
http://localhost:5173
```

Point out:

- wallet connection panel
- AI chat panel
- intent templates
- Agent Wallet controls
- execution history
- performance dashboard

### 3. Submit a Simple AI Intent

Use this example prompt:

```text
Send 0.000005 ETH on Sepolia to 0x97B59071Fd586f381254828Eb1e0C0f64B77b9BE.
```

Show:

- AI intent parsing
- structured preview JSON
- deterministic backend validation
- wallet transaction preparation

Key message:

> The AI layer proposes the action, but it cannot execute funds by itself. The
> parsed result must pass backend validation and still requires user
> authorization.

### 4. Show Scheduled / EIP-712 Flow

Use this example prompt:

```text
Send 0.000005 ETH on Sepolia to 0x97B59071Fd586f381254828Eb1e0C0f64B77b9BE at 19:55 today.
```

Show:

- scheduled intent parsing
- EIP-712 typed data preparation
- user signature
- coordinator job registration

Key message:

> Scheduled tasks are authorized now and executed later by the relayer when the
> job becomes due.

### 5. Show Agent Wallet Flow

Show the Advanced Agent Wallet mode:

- smart account selection or creation
- platform Agent address loaded from backend
- owner authorizes the platform Agent
- permission includes target, value, and expiry boundaries

Then submit compatible actions so the Agent Wallet path can use:

```text
executeBatchAgentCalls
```

Key message:

> After one bounded owner authorization, the platform Agent can execute allowed
> calls without asking the owner to sign every individual action.

### 6. Show Coordinator Jobs

Open or trigger:

```text
GET /coordinator/jobs
POST /coordinator/tick
```

Show job statuses:

```text
QUEUED -> EXECUTING -> SUBMITTED -> SUCCESS
QUEUED -> EXECUTING -> RETRY -> EXECUTING
QUEUED -> EXECUTING -> FAILED
```

Key message:

> The coordinator is an asynchronous execution layer. It scans due jobs, groups
> compatible work, submits transactions, polls receipts, and updates job state.

### 7. Show Supabase/Postgres Claiming

If Supabase is configured, explain the RPC:

```sql
aap_claim_due_coordinator_jobs(p_now, p_limit)
```

The important concurrency primitive is:

```sql
for update skip locked
```

Key message:

> Multiple workers can poll at the same time without double-executing the same
> job, because Postgres locks claimed rows and other workers skip them.

### 8. Show Dashboard Evidence

Open the performance dashboard and point out:

- total coordinator jobs
- successful jobs
- failed execution rate
- average batch size
- throughput per minute
- average latency
- estimated non-batched gas
- actual batch gas
- estimated gas saved
- recent batch transactions
- aggregation match rate

Benchmark evidence to mention:

- 40 intents reduced from 40 transactions to 8 transactions.
- Estimated gas reduced by 46.75%.
- Local-EVM benchmark reduced five AgentSmartAccount transfer intents from five
  transactions to one.
- Comparable local-EVM gas reduced by 33.01%.

### 9. Show Code Proof

Recommended code snippets:

- `backend/src/coordinator/worker.js`
- `backend/src/coordinator/supabaseJobStore.js`
- `supabase/migrations/202605250001_aap_storage.sql`
- `contracts/account/AgentSmartAccount.sol`
- `contracts/settlement/SignedIntentEscrow.sol`

Key implementation points:

- `worker.js` groups due jobs by `batchGroupId`.
- `supabaseJobStore.js` calls the Postgres RPC to claim due jobs.
- migration SQL uses `FOR UPDATE SKIP LOCKED`.
- `AgentSmartAccount` checks agent authorization, target scope, expiry, and
  value limits.
- `SignedIntentEscrow` checks nonce replay, run time, deadline, calldata hash,
  owner signature, and escrow balance.

## English Speaking Script

### Opening

Today we are presenting our AI-Powered On-Chain Agent Protocol.

The goal of this project is to build scalable infrastructure for autonomous
on-chain agents. Instead of sending every agent action as a separate
transaction, our system accepts user intents, validates them, batches compatible
work, executes asynchronously, and reports execution performance.

This is not only a smart contract demo. It includes Solidity contracts, a
Node.js backend, AI intent parsing, a coordinator worker, Supabase/Postgres job
storage, a frontend agent console, and a performance dashboard.

### Requirement Coverage

The project requirements ask for five key capabilities: an agent protocol
layer, an intent submission interface, batching or aggregation, asynchronous
coordinator execution, and performance reporting.

Our implementation covers all five. The contracts enforce identity and
permissions. The frontend and backend submit intents. The coordinator batches
and retries jobs. The dashboard reports throughput, latency, failure rate, and
gas evidence.

### Architecture

At a high level, the system is split into four layers.

The frontend is where users describe goals and authorize actions. The backend
parses and validates intents, builds execution plans, and coordinates jobs.
Supabase/Postgres is used as the primary coordinator job store when configured,
while intents and batches are mirrored for history. The on-chain layer enforces
permissions and executes signed or delegated calls.

The key security boundary is simple: AI proposes, users authorize, smart
contracts enforce, and the coordinator scales execution.

### Lifecycle

Every action follows the same lifecycle.

A user enters a prompt. The AI parser turns it into a structured intent. The
backend validates the schema. The user authorizes execution either through a
wallet transaction, an EIP-712 signature, or Agent Wallet permission.

Then the coordinator stores the job, executes it when due, and updates the
dashboard after the transaction receipt is confirmed.

### Live Product Demo

I will now switch to the live application.

First, I check the backend health endpoint to show that the API is running.
Then I open the frontend agent console.

Here, the user can connect a wallet and submit an intent in natural language. I
will use a simple Sepolia transfer prompt. The backend parses the message and
returns a structured intent preview.

This preview is important because the AI output is not trusted directly. It
must pass deterministic backend validation before execution.

Next, the user chooses an execution mode. In default EOA mode, the user signs
directly. For scheduled tasks, the user signs EIP-712 typed data and the
relayer executes later.

In Advanced Agent Wallet mode, the owner authorizes the platform Agent once,
and then the Agent can execute permitted calls without asking for a new owner
signature each time.

### Batching and Coordinator

Now I will show the batching and coordinator part.

Compatible jobs are grouped by `batchGroupId`. If multiple signed jobs are due,
the worker can call `executeBatchSignedCalls`. If multiple Agent Wallet jobs
share the same smart account and Agent, the worker can call
`executeBatchAgentCalls`.

The coordinator does not fire transactions blindly. It tracks job status
through `QUEUED`, `EXECUTING`, `SUBMITTED`, `SUCCESS`, `RETRY`, or `FAILED`. It
also polls receipts and updates the job state after confirmation.

### Supabase and SKIP LOCKED

One important scalability improvement is the Supabase/Postgres coordinator job
store.

When Supabase credentials are configured, due jobs are claimed through a
Postgres RPC using `FOR UPDATE SKIP LOCKED`. This means multiple workers can
poll at the same time without executing the same job twice.

This is the key concurrency mechanism in our asynchronous execution layer.

### Dashboard Evidence

After execution, the dashboard shows performance evidence.

It reports total coordinator jobs, successful jobs, failed execution rate,
average batch size, throughput per minute, average latency, estimated
non-batched gas, actual batch gas, gas saved, and aggregation match rate.

The benchmark result shows that for 40 intents, batching reduces transaction
count from 40 to 8. In the local EVM gas benchmark, five AgentSmartAccount ERC20
transfer intents are reduced from five transactions to one, with a comparable
gas reduction of 33.01%.

### Code Proof

To connect the demo to the implementation, the backend worker claims due jobs,
groups them, chooses signed-call or Agent-call execution, and updates submitted
transaction hashes.

The Supabase job store calls the `aap_claim_due_coordinator_jobs` RPC.

On-chain, `AgentSmartAccount` checks Agent permissions, target scope, expiry,
and value limit. `SignedIntentEscrow` checks nonce replay, run time, deadline,
calldata hash, signature, and escrow balance.

So correctness is not only handled by the backend. Critical authorization rules
are enforced on-chain.

### Testing

We also verified the implementation with automated tests.

The backend test suite currently has 55 passing tests, covering AI parsing,
scheduling, coordinator behavior, Supabase job storage, metrics, wallet
transaction preparation, and Uniswap fallback.

The Foundry suite has 27 passing smart contract tests covering registry logic,
intent management, smart-account authorization, batching, and signed escrow
execution.

### Closing

To summarize, this project delivers an end-to-end AI-powered on-chain agent
execution prototype.

It accepts natural-language intents, validates them, supports signed and
delegated authorization, batches compatible work, executes asynchronously, and
reports measurable performance improvements.

The current boundary is clear: this is a strong demo-grade protocol
implementation. Production extensions would include a full ERC-4337
bundler/paymaster integration, full Supabase source-of-truth migration for all
stores, and a dedicated on-chain settlement contract for internal matching.

## Backup Plan If Sepolia Is Unstable

If Sepolia RPC, wallet signing, or testnet liquidity becomes unreliable during
the live demo, use this fallback sequence:

1. Show backend health and frontend page.
2. Show AI parsing and preview JSON.
3. Show prepared transaction data without broadcasting.
4. Show existing execution history or Etherscan links.
5. Show coordinator job list and dashboard metrics.
6. Show the recorded demo video placeholder slide.
7. Close with tests and benchmark evidence.

Backup script:

> If the testnet is unstable during the live session, we can still demonstrate
> the system deterministically. The important parts are visible before
> broadcasting: AI parsing, schema validation, wallet transaction construction,
> coordinator job creation, batching logic, and dashboard metrics. The recorded
> transaction evidence and tests show that the same flow has already been
> verified end to end.

## Short Version For a 5-Minute Demo

Use this if the presentation time is limited:

1. Problem: AI agents generate too many independent on-chain actions.
2. Architecture: AI proposes, users authorize, contracts enforce, coordinator
   scales.
3. Live flow: parse one transfer or scheduled task from natural language.
4. Execution: show EOA/EIP-712 or Agent Wallet path.
5. Batching: explain `executeBatchSignedCalls` and `executeBatchAgentCalls`.
6. Storage: explain Supabase/Postgres coordinator jobs and `SKIP LOCKED`.
7. Evidence: show dashboard, 55 backend tests, 27 contract tests, and gas
   reduction.

Short closing:

> The main contribution is an end-to-end intent execution network for on-chain
> agents. It combines AI intent parsing, explicit user authorization,
> smart-contract enforcement, asynchronous batching, and measurable performance
> reporting.
