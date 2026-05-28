# Demo Presentation Script

## Purpose

This script is aligned with the current 14-slide demo deck:
`docs/on-chain-agent-protocol-demo.pptx`.

The demo should present the project as a complete intent execution network for
AI-powered on-chain agents. The central message is:

> AI proposes actions, users authorize execution, smart contracts enforce
> permissions, and the coordinator scales execution through asynchronous
> batching and observable metrics.

## Recommended Timing

| Time | Segment | Slides | Main Message |
|---:|---|---|---|
| 0:00-0:45 | Opening | 1 | The project is an end-to-end execution network, not only a contract demo. |
| 0:45-1:30 | Requirement Coverage | 2 | All required project capabilities are implemented or clearly bounded. |
| 1:30-2:45 | Architecture + Lifecycle | 3-4 | Proposal, authorization, execution, storage, and observability are separated. |
| 2:45-4:00 | Backend + Contracts | 5-6 | Backend coordinates execution; contracts enforce identity and permissions. |
| 4:00-5:30 | Execution Modes + Batching | 7-8 | The system supports EOA/EIP-712 and delegated Agent Wallet execution. |
| 5:30-6:30 | Coordinator Storage | 9 | Postgres `SKIP LOCKED` prevents duplicate worker execution. |
| 6:30-7:30 | Code Proof | 10-11 | The key state transitions and permission checks are implemented in code. |
| 7:30-8:30 | Evidence | 12 | Tests, gas benchmarks, and dashboard metrics support the claims. |
| 8:30-10:00 | Live Demo / Video | 13-14 | Walk from prompt to authorization, execution, and observable result. |

## Pre-Demo Checklist

Start the backend:

```bash
cd /Users/mengziqi/IdeaProjects/On-Chain-Agent-Protocol/backend
npm start
```

Start the frontend:

```bash
cd /Users/mengziqi/IdeaProjects/On-Chain-Agent-Protocol/frontend
npm start
```

Open:

```text
http://localhost:8787/health
http://localhost:5173
```

Confirm before presenting:

- Backend health is online.
- Frontend reports backend status correctly.
- Wallet can connect to Sepolia.
- Contract addresses are configured in `.env`.
- If Supabase is used, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- If live swap routing is used, `UNISWAP_API_KEY` is set.
- If Sepolia is unstable, use the recorded video path on slide 14.

## Slide-By-Slide English Script

### Slide 1: Opening

Today we are presenting our AI-Powered On-Chain Agent Protocol.

The project builds a working execution network for AI agents on blockchain
systems. A user can express an intent in natural language, the backend parses
and validates it, the user authorizes execution, and the system can execute
single or batched actions asynchronously.

The key evidence is already visible here: 55 backend tests, 27 contract tests,
40 intents reduced to 8 batched transactions, and a 33.01 percent local gas
reduction in the Foundry benchmark.

One important boundary is also explicit: coordinator jobs use
Supabase/Postgres as primary storage, while intents and batches are mirrored to
Supabase for history.

### Slide 2: Requirement Coverage

The project requirements ask for five major capabilities.

First, a smart contract or protocol layer for autonomous agents. We implement
this through `AgentRegistry`, `IntentManager`, `AgentSmartAccount`, and
`SignedIntentEscrow`.

Second, an intent submission interface. The frontend and backend support AI
parsing, templates, wallet transaction builders, and scheduled workflow APIs.

Third, batching or aggregation. We support smart-account batches, EIP-712
scheduled batches, and an ETH/USDC matching planner.

Fourth, asynchronous execution. The coordinator scans due jobs, retries,
tracks receipts, and can claim jobs through Supabase/Postgres with
`SKIP LOCKED`.

Fifth, performance evidence. The dashboard, benchmark JSON, and test suites
report throughput, latency, failure rate, and gas savings.

### Slide 3: Current Architecture

This slide shows the current architecture.

On the left, the frontend console and wallet are the user-facing input layer.
The user enters a goal, reviews the structured result, and authorizes the
action.

In the backend control plane, the AI parser turns natural language into a
validated intent. The planner and batcher build execution plans, and the
coordinator worker executes due jobs, retries failed jobs, and records
receipts.

Storage is split deliberately. Supabase/Postgres is primary for coordinator
jobs, while local stores still hold intents and batches with Supabase mirror
writes for history.

On-chain, smart contracts enforce registry, intent, batch, smart account, and
signed escrow rules. Sepolia execution happens only after wallet, signature, or
Agent authorization.

The design rule is: AI proposes, users authorize, contracts enforce, and the
coordinator scales execution.

### Slide 4: Execution Lifecycle

Every on-chain action follows the same lifecycle.

The user starts with a prompt. The AI parser creates a structured proposal.
The backend normalizes and schema-validates it. Then the user authorizes the
action through a wallet transaction, an EIP-712 signature, or Agent Wallet
permission.

After authorization, the coordinator stores the job with a `runAt` time and
payload. When the job is due, the worker submits either a single or batched
transaction. Finally, receipt status updates the dashboard and metrics.

The same lifecycle supports two authorization paths. In default EOA mode, the
user signs directly or signs EIP-712 typed data for later relayer execution.
In Advanced Agent Wallet mode, the owner authorizes the platform Agent once,
and the backend Agent signer executes allowed calls without requiring a new
owner signature every time.

### Slide 5: Backend Logic

The Node backend is the execution control plane for the demo.

The intent preparation layer contains the AI parser, schema validation, and
planning modules. This is where natural-language requests become structured,
deterministic execution plans.

The execution layer contains batching, the coordinator worker, transaction
building, and settlement preparation. This is where jobs are grouped,
submitted, retried, and confirmed.

The observability layer reads from coordinator jobs, batch records, and stored
execution plans. It reports throughput, latency, failure rate, gas saved, and
aggregation match rate. Importantly, metrics observe state; they do not mutate
execution state.

The API surface used by the frontend is wired through `backend/src/server.js`.

### Slide 6: Contract Layer

The contract layer enforces identity, permission, batching, and scheduled
execution.

`AgentRegistry` registers autonomous agents and their owner or policy
metadata. `IntentManager` tracks intent lifecycle, duplicate protection,
coordinator updates, and daily limits.

`AgentSmartAccount` is an owner-controlled account that supports authorized
Agent permissions and `executeBatchAgentCalls`.

`SignedIntentEscrow` supports EIP-712 signed scheduled calls, nonce replay
protection, and escrow-funded ETH execution.

`BatchExecutor` supports grouped calls with per-intent result events.

The boundary is important: we implement ERC-4337-style smart account behavior,
but we are not claiming a production bundler or paymaster integration.

### Slide 7: Execution Modes

The demo supports two execution modes.

The first mode is the default EOA plus EIP-712 path. The user signs a wallet
transaction or typed data. For scheduled tasks, the relayer executes the
signed call when it becomes due. This is useful when we want scheduled
transfer or swap workflows without exposing private keys.

The second mode is the Advanced Agent Wallet path. The owner EOA authorizes
the platform Agent with bounded permissions. Those permissions include target,
value, and expiry. After that, the Agent signer can execute allowed single or
batch calls.

This is the more autonomous path because the user does not need to sign every
individual action after granting bounded permission.

### Slide 8: Batching And Aggregation

This slide explains how the system reduces repeated execution overhead before
touching the chain.

Intents first enter the intent pool. Compatible jobs can go through the batch
builder, which groups work by type and batch size. Separately, the matcher can
plan exact or partial ETH/USDC matching.

The output is an execution package. Depending on the authorization mode, that
package can become a signed-call batch, an Agent-call batch, or an external
route.

The current implementation boundary is clear: the matching planner can create
internal-match, partial-match, and hybrid-match-route plans. Current chain
execution uses existing batch contracts and external Uniswap routing. A
dedicated settlement contract remains a future extension.

### Slide 9: Coordinator Storage

The coordinator storage design prevents duplicate execution when multiple
workers are running.

Worker A and Worker B can both poll for due jobs. They call the
`aap_claim_due_coordinator_jobs` Postgres RPC. The RPC selects queued or retry
jobs where `runAt` is due.

The important concurrency primitive is `FOR UPDATE SKIP LOCKED`. When one
worker claims a row, other workers skip that locked row instead of processing
the same job.

Before execution, the job status is flipped to `EXECUTING`, attempts are
incremented, and payload data is updated. This gives the system an auditable
state transition before any transaction is submitted.

Coordinator jobs use Supabase/Postgres as primary storage when configured.
Intents and batches remain in the local store with Supabase mirror writes.

### Slide 10: Core Backend Code

This slide connects the architecture to concrete backend code.

`supabaseJobStore.js` calls the Postgres RPC to claim due coordinator jobs.
The worker then groups due jobs by `batchGroupId` or by individual job ID.

For each group, the worker chooses the correct execution path. Signed jobs go
through signed-call execution. Agent Wallet jobs go through Agent-call
execution.

After submission, the worker writes a `SUBMITTED` state with the transaction
hash and submission timestamp. Later receipt polling turns that into success,
retry, or failure evidence.

This is why the coordinator is not just a timer. It is a stateful execution
layer.

### Slide 11: Core Contract Code

This slide shows the on-chain authorization checks.

`AgentSmartAccount` validates whether the Agent is authorized, whether the
target is allowed, whether the permission is active, whether it has expired,
and whether the value is within the permission limit.

`SignedIntentEscrow` validates scheduled execution. It checks nonce replay,
whether the call is due, whether the deadline has expired, whether calldata
matches the expected hash, whether the owner signature is valid, and whether
the escrow balance is sufficient.

This means AI-generated proposals cannot bypass wallet authorization. Critical
rules are enforced on-chain.

### Slide 12: Evidence

The evidence slide supports the performance claims.

The backend has 55 passing tests covering AI parsing, coordinator behavior,
metrics, and wallet preparation. The Foundry suite has 27 passing tests
covering registry, escrow, smart account, and batching behavior.

For the benchmark, 40 intents are reduced to 8 transactions, meaning 80 percent
fewer transactions. The estimated gas reduction is 46.75 percent.

The local EVM gas benchmark measures five authorized AgentSmartAccount ERC20
transfer intents. With batching, five transactions collapse to one comparable
transaction, and comparable gas falls from 240,226 to 160,922.

The dashboard reports coordinator jobs, success and failure rate, average
batch size, throughput, latency, estimated no-batch gas, actual batch gas, and
aggregation match rate.

### Slide 13: Demo Runbook

The live walkthrough follows one clean path from prompt to observable result.

First, start the backend and frontend. Second, connect an EOA wallet to
Sepolia and confirm that the backend is online. Third, create an intent through
the AI chat or a template.

Fourth, authorize the action through a wallet transaction, EIP-712 signature,
or Agent Wallet permission. Fifth, execute through the coordinator or Agent
path. Sixth, show evidence through history, Etherscan links, and dashboard
metrics.

The local frontend is `http://localhost:5173`, and the backend defaults to
`http://localhost:8787`.

### Slide 14: Demo Video Placeholder

This final slide is the fallback or embedded-video slot.

The suggested recording should show the same path as the live demo: connect
wallet, parse intent, authorize, execute, show Etherscan or history, and show
dashboard metrics.

If Sepolia or wallet signing is unstable during the presentation, we can still
use this video to prove the full workflow.

## Live Demo Flow

### 1. Backend Health

Open:

```text
http://localhost:8787/health
```

Point out:

- backend is live
- storage mode is visible
- coordinator job storage reports either `supabase-postgres` or `local-json`

### 2. Frontend Console

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

### 3. Simple AI Intent

Use this prompt:

```text
Send 0.000005 ETH on Sepolia to 0x97B59071Fd586f381254828Eb1e0C0f64B77b9BE.
```

Show:

- AI intent parsing
- structured intent preview
- deterministic backend validation
- wallet transaction preparation

Key message:

> The AI layer proposes the action, but it cannot execute funds by itself.
> The parsed result must pass backend validation and still requires user
> authorization.

### 4. Scheduled / EIP-712 Intent

Use this prompt:

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

### 5. Advanced Agent Wallet

Show:

- smart account selection or creation
- platform Agent address loaded from backend
- owner authorizes the platform Agent
- permission boundaries: target, value, expiry
- compatible actions executed through `executeBatchAgentCalls`

Key message:

> After one bounded owner authorization, the platform Agent can execute allowed
> calls without asking the owner to sign every individual action.

### 6. Coordinator Jobs

Open or trigger:

```text
GET /coordinator/jobs
POST /coordinator/tick
```

Show job states:

```text
QUEUED -> EXECUTING -> SUBMITTED -> SUCCESS
QUEUED -> EXECUTING -> RETRY -> EXECUTING
QUEUED -> EXECUTING -> FAILED
```

Key message:

> The coordinator scans due jobs, groups compatible work, submits transactions,
> polls receipts, and writes explicit state transitions.

### 7. Dashboard Evidence

Show:

- total coordinator jobs
- successful jobs
- failed execution rate
- average batch size
- throughput per minute
- average latency
- estimated no-batch gas
- actual batch gas
- estimated gas saved
- aggregation match rate

Mention:

- 40 intents reduced to 8 transactions.
- Estimated gas reduced by 46.75 percent.
- Five local AgentSmartAccount transfer intents collapsed from five
  transactions to one.
- Comparable local EVM gas reduced from 240,226 to 160,922.

## Backup Plan If Sepolia Is Unstable

If Sepolia RPC, wallet signing, or testnet liquidity becomes unreliable, use
this fallback sequence:

1. Show backend health and frontend page.
2. Show AI parsing and structured preview.
3. Show prepared transaction data without broadcasting.
4. Show coordinator job list and dashboard metrics.
5. Show existing execution history or Etherscan links.
6. Show the recorded demo video placeholder slide.
7. Close with tests and benchmark evidence.

Backup script:

> If the testnet is unstable during the live session, we can still demonstrate
> the system deterministically. The important parts are visible before
> broadcasting: AI parsing, schema validation, wallet transaction construction,
> coordinator job creation, batching logic, and dashboard metrics. The recorded
> transaction evidence and automated tests show that the same flow has already
> been verified end to end.

## Short 5-Minute Version

1. Problem: AI agents can generate too many independent on-chain actions.
2. Architecture: AI proposes, users authorize, contracts enforce, coordinator
   scales.
3. Flow: prompt -> parse -> authorize -> store job -> execute -> observe.
4. Modes: EOA/EIP-712 for direct or scheduled execution; Agent Wallet for
   delegated execution.
5. Scaling: batching and coordinator storage reduce transaction overhead and
   prevent duplicate execution.
6. Evidence: 55 backend tests, 27 contract tests, 40 -> 8 transaction
   benchmark, 46.75 percent estimated gas reduction, and 33.01 percent local
   gas reduction.

Short closing:

> The main contribution is an end-to-end intent execution network for
> AI-powered on-chain agents. It combines AI intent parsing, explicit user
> authorization, smart-contract enforcement, asynchronous batching, and
> measurable performance reporting.
