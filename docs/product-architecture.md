# AI-Powered On-Chain Agent Protocol Product Architecture and Execution Plan

Version: final product architecture draft

## 1. Product Definition

AI-Powered On-Chain Agent Protocol is a multi-user, multi-agent intent execution
system. It accepts intents from users and AI agents, validates them, stores them
in a shared intent pool, optimizes compatible workflows, routes DeFi actions to
external liquidity when needed, and executes the final plan through smart
accounts, ERC-4337 bundling, or direct fallback execution.

The product focus is scalable on-chain agent execution:

- transfer
- swap
- rebalance
- DCA
- scheduled trading
- multi-agent trading workflows
- gas-saving batch execution
- internal matching plus external routing

## 2. Assessment of the v2 Proposal

### Accepted

The following ideas from the reviewed v2 document should be incorporated:

- Keep only `user` and `agent` as product-facing identities. Solver, relayer,
  bundler, and coordinator are internal system modules.
- Use Postgres from the start, with Supabase as the deployment target.
- Split validation into synchronous pre-store validation and asynchronous
  post-store validation.
- Use `SELECT ... FOR UPDATE SKIP LOCKED` for worker concurrency.
- Freeze intermediate data contracts between matching, routing, settlement
  planning, and batch construction.
- Include Exact Match and Partial Match in the first matching MVP. Exact-only
  matching is too weak for a real intent optimization layer.
- Separate optimization decisions from chain encoding:
  - Aggregator Engine decides the best execution plan.
  - Batch Builder encodes the executable package.
  - Execution Coordinator handles lifecycle and submission.
- Model fallback timing carefully. If a UserOperation has already been submitted
  to a bundler, do not immediately submit a direct transaction fallback because
  that can create duplicate execution or nonce conflicts.
- Use `pg_notify` and Supabase Realtime for MVP event updates before adding
  Redis or Kafka.
- Track adapter switches, validation errors, simulation failures, degradation,
  gas saved, match rate, and execution latency.

### Modified

The following ideas are useful but need adjustment:

- `partially_confirmed` should not be a top-level ERC-4337 bundle status in V1.
  In ERC-4337, each UserOperation has its own result inside a bundle. The plan
  can derive partial completion from child UserOperation statuses, but the top
  level should remain simpler.
- Direct Tx fallback should exist only for local demo, admin operations, or
  non-UserOperation settlement paths. The product path should prefer ERC-4337.
- `simulation_failed_degraded` is too implementation-specific as a primary
  user-visible state. Store degradation reason internally, but expose simple
  product statuses.
- The v2 four-week plan is too aggressive if it includes Postgres migration,
  matching, bundler integration, settlement contract, realtime, and full
  dashboard. The final plan below splits delivery into safer increments.

### Not Accepted for V1

The following should not be part of the first product-grade implementation:

- Multi-hop netting.
- Rebalance decomposition as a matching input.
- DCA aggregation across time windows.
- Automated UserOperation cancel flow.
- Kafka or Redis.
- Full multi-chain support.
- A large generic settlement contract before the off-chain plan format and
  matching behavior are proven.

These are valuable later, but they should not block a clean protocol
MVP.

## 3. Final System Architecture

```text
User / Agent
  |
  v
Intent Submission API
  |
  v
Pre-store Validation
  |
  v
Postgres Intent Pool
  |
  v
Post-store Validation Worker
  |
  v
Aggregator Engine
  |
  v
Batch Builder
  |
  v
Execution Coordinator
  |
  v
Execution Adapter
  |
  v
On-chain Settlement
  |
  v
Receipt, Metrics, Realtime
```

## 4. Product Identity Model

Only two actor types are exposed at the product layer:

```ts
type ActorType = "user" | "agent";

interface Actor {
  actorId: string;
  actorType: ActorType;
  walletAddress: string;
  smartAccount?: string;
  displayName?: string;
}
```

Internal modules are not actors:

- Aggregator Engine
- Batch Builder
- Execution Coordinator
- Bundler Adapter
- Direct Tx Adapter
- Settlement Engine

This avoids confusing users with infrastructure roles.

## 5. Core Data Model

### actors

```sql
create table actors (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'agent')),
  wallet_address text not null,
  smart_account text,
  display_name text,
  created_at timestamptz not null default now()
);
```

### intents

```sql
create table intents (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references actors(id),
  user_id uuid references actors(id),
  source_agent_id uuid references actors(id),
  smart_account text not null,
  chain_id int not null,
  intent_type text not null check (intent_type in ('swap', 'rebalance', 'dca', 'scheduled')),
  status text not null default 'pending_validation',
  token_in text,
  token_out text,
  amount_in numeric,
  min_amount_out numeric,
  target_allocation jsonb,
  constraints jsonb not null default '{}',
  deadline timestamptz not null,
  validation_attempts int not null default 0,
  last_validation_error text,
  signature_verified_at timestamptz,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### execution_plans

```sql
create table execution_plans (
  id uuid primary key default gen_random_uuid(),
  plan_type text not null,
  status text not null default 'planned',
  chain_id int not null,
  estimated_gas bigint,
  estimated_gas_saved bigint,
  estimated_surplus_usd numeric,
  matched_volume_usd numeric,
  external_routed_volume_usd numeric,
  degradation_depth int not null default 0,
  degradation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### plan_intents

```sql
create table plan_intents (
  plan_id uuid not null references execution_plans(id),
  intent_id uuid not null references intents(id),
  role text not null default 'included',
  primary key (plan_id, intent_id)
);
```

### user_operations

```sql
create table user_operations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references execution_plans(id),
  smart_account text not null,
  user_op_hash text,
  status text not null default 'prepared',
  call_data text,
  gas_estimate jsonb,
  receipt jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### transactions

```sql
create table transactions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references execution_plans(id),
  tx_hash text,
  adapter text not null,
  status text not null default 'submitted',
  receipt jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
```

### adapter_switches

```sql
create table adapter_switches (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references execution_plans(id),
  triggered_at timestamptz not null default now(),
  trigger_reason text not null,
  switch_timing text not null,
  from_adapter text not null,
  to_adapter text not null,
  conflict_handled boolean not null default false
);
```

## 6. Intent Lifecycle

Product-facing status:

```text
draft
pending_validation
validated
planning
planned
submitted
confirmed
failed
rejected
```

Internal execution details:

```text
simulating
retrying
degraded
stale_userop
```

The UI should show simple statuses. Internal states should be visible only in
debug panels, logs, or admin views.

## 7. Validation Layer

### Pre-store validation

Runs synchronously during submission. Target response budget: below 50 ms.

Checks:

- schema shape
- required fields
- token address format
- supported chain
- deadline range
- signature field presence
- basic rate limit
- idempotency key / nonce format

Failures return immediately and are not inserted into the intent pool.

### Post-store validation

Runs asynchronously from Postgres:

```sql
select *
from intents
where status = 'pending_validation'
order by created_at asc
limit 20
for update skip locked;
```

Checks:

- ERC-1271 or EOA signature verification
- smart account permission
- balance
- allowance
- quote sanity
- oracle deviation threshold
- simulation precheck

Output:

```text
pending_validation -> validated
pending_validation -> rejected
```

## 8. Aggregator Engine

The Aggregator Engine is the system's optimization brain. It does not encode
calldata or submit transactions.

Pipeline:

```text
Intent Normalizer
  -> Match Engine
  -> Route Optimizer
  -> Settlement Planner
  -> OptimizedExecutionPlan
```

### Intent Normalizer

Responsibilities:

- normalize token aliases
- convert rebalance/DCA into candidate swap legs when enabled
- standardize constraints
- group compatible intents by chain and token pair

### Match Engine

V1 scope:

- ETH/USDC exact match
- ETH/USDC partial match

Not V1:

- multi-hop circular netting
- rebalance decomposition
- DCA aggregation

Output:

```ts
interface MatchResult {
  matchedPairs: IntentPair[];
  unmatchedIntents: Intent[];
  internalTransfers: Transfer[];
  matchRate: number;
  matchedVolumeUsd: string;
}
```

### Route Optimizer

Only processes unmatched intents from the Match Engine.

Output:

```ts
interface RouteResult {
  externalSwaps: SwapRoute[];
  estimatedGas: string;
  priceImpactBps: number;
  externalRoutedVolumeUsd: string;
}
```

### Settlement Planner

Combines matching and routing:

```ts
interface OptimizedExecutionPlan {
  planId: string;
  planType:
    | "internal-match"
    | "partial-match"
    | "external-route"
    | "hybrid-match-route"
    | "smart-account-batch"
    | "userop-bundle";
  intents: Intent[];
  internalTransfers: Transfer[];
  externalSwaps: SwapRoute[];
  settlementCalls: SettlementCall[];
  estimatedGas: string;
  estimatedGasSaved: string;
  estimatedSurplusUsd: string;
}
```

## 9. Batch Builder

The Batch Builder converts an optimized plan into the lowest-cost executable
package.

Priority order:

1. Internal match where possible.
2. Same Smart Account calls through `executeBatchAgentCalls`.
3. Multi Smart Account execution through ERC-4337 UserOperations.
4. Residual external DEX routes.
5. Single execution fallback for high-risk or simulation-failing intents.

Output:

```ts
interface BatchPackage {
  packageType:
    | "single-smart-account-batch"
    | "multi-smart-account-userop-bundle"
    | "internal-settlement"
    | "hybrid-settlement"
    | "single-fallback";
  userOperations: UserOperation[];
  directCalls: DirectCall[];
  settlementCalldata?: string;
  simulationResult?: SimulationResult;
  gasEstimate?: GasEstimate;
}
```

## 10. Execution Coordinator

The Execution Coordinator manages lifecycle, simulation, retries, degradation,
and submission.

Plan lifecycle:

```text
planned
  -> simulating
  -> ready
  -> submitted
  -> confirmed
```

Failure paths:

```text
simulating -> rejected
simulating -> degraded -> simulating
submitted -> stale_userop
submitted -> failed
```

Degradation policy:

```ts
const degradationPolicy = {
  maxRetryAttempts: 3,
  maxDegradationDepth: 2
};
```

Failure handling:

- `nonce_too_low`: retry after refreshing nonce.
- `insufficient_balance`: reject.
- `simulation_revert`: split batch once, then split to single if needed.
- `bundler_unavailable` before submission: fallback to Direct Tx Adapter.
- timeout after submission: query UserOperation receipt; do not direct-submit
  duplicate transactions automatically.

## 11. Execution Adapter

The product exposes one execution path:

```text
Execution Adapter
```

Internally:

```text
Primary: ERC-4337 Bundler Adapter
Fallback: Direct Tx Adapter
```

The fallback is not a second product path. It is infrastructure resilience.

### Bundler Adapter

Required RPC methods:

- `eth_supportedEntryPoints`
- `eth_estimateUserOperationGas`
- `eth_sendUserOperation`
- `eth_getUserOperationReceipt`

### Direct Tx Adapter

Allowed use cases:

- local development
- admin operations
- settlement calls that are not yet expressible as UserOperations
- pre-submission fallback when bundler is unavailable

Not allowed:

- automatic direct fallback after a UserOperation has already been sent and is
  merely slow. That risks duplicate execution.

## 12. On-chain Settlement

Current contracts retained:

- `AgentSmartAccount`
- `SignedIntentEscrow`
- `BatchExecutor`
- `EntryPoint`

Recommended new contract after off-chain planner is stable:

```solidity
contract IntentSettlement {
    function settleBatch(SettlementCall[] calldata calls, bytes calldata solverData) external;
}
```

V1 should avoid overbuilding this contract. First prove:

- internal match format
- partial match accounting
- route residual format
- event model
- per-intent receipt mapping

Then add the settlement contract.

## 13. Realtime and Metrics

Use Postgres `pg_notify` and Supabase Realtime for V1.

Example:

```sql
create or replace function notify_intent_event()
returns trigger as $$
begin
  perform pg_notify('intent_events', row_to_json(new)::text);
  return new;
end;
$$ language plpgsql;
```

Core metrics:

- total intents
- validated intents
- rejected intents
- match rate
- matched volume
- external routed volume
- average batch size
- UserOperation bundle size
- gas saved
- price improvement
- execution latency
- p95 latency
- failed simulation rate
- degradation rate
- adapter switch count

MVP targets:

```text
match_rate > 5%
gas_saved > 15%
submission_success > 95%
p95_latency < 30s on Sepolia/local demo conditions
```

## 14. API Surface

### Submission

```text
POST /intents/submit
POST /agents/:agentId/intents
POST /intents/preview
```

### Validation

```text
POST /validation/intent
POST /validation/simulate
GET /validation/errors
```

### Pool and Plans

```text
GET /intents
GET /intents/:id
GET /plans
GET /plans/:id
POST /plans/:id/simulate
POST /plans/:id/execute
```

### Execution

```text
POST /bundler/user-operation
GET /bundler/user-operation/:hash
POST /coordinator/tick
GET /transactions/:hash
```

### Metrics

```text
GET /metrics
GET /metrics/matching
GET /metrics/execution
```

## 15. Execution Roadmap

### Phase 1: Product Naming and Postgres Foundation

Deliverables:

- Keep product docs/UI aligned with AI-Powered On-Chain Agent Protocol.
- Add Supabase/Postgres schema.
- Use Supabase/Postgres as the coordinator job source of truth, while keeping
  the local JSON store as a development fallback.
- Complete the remaining source-of-truth migration for intents and execution
  plans.
- Add migration files.
- Add `SKIP LOCKED` worker claiming for due coordinator jobs.
- Add Realtime notification triggers.

Acceptance:

- Coordinator jobs persist in Postgres when Supabase is configured.
- Multiple coordinator workers do not double-process the same due job.
- Frontend status updates from API and Realtime.

### Phase 2: Validation Layer

Deliverables:

- Pre-store validation middleware.
- Async post-store validation worker.
- Signature verification placeholder plus ERC-1271 implementation path.
- Balance/allowance checks.
- Simulation precheck interface.

Acceptance:

- Invalid intents do not pollute executable pool.
- Rejected intents have clear reasons.
- Validated intents are eligible for aggregation.

### Phase 3: Aggregator Engine MVP

Deliverables:

- Intent Normalizer.
- ETH/USDC Exact Match.
- ETH/USDC Partial Match.
- Route Optimizer for unmatched volume to Uniswap.
- Settlement Planner and `OptimizedExecutionPlan`.

Acceptance:

- Opposite-direction intents can be internally matched.
- Partial match creates matched and external-routed portions.
- Plan records show matched volume and external routed volume.

### Phase 4: Batch Builder MVP

Deliverables:

- Smart-account batch package builder.
- UserOperation package builder.
- Simulation and degradation logic.
- Batch package persistence.

Acceptance:

- Same Smart Account intents batch with `executeBatchAgentCalls`.
- Multiple Smart Account plans produce UserOperation records.
- Simulation failures split or reject according to policy.

### Phase 5: ERC-4337 Bundler Adapter

Deliverables:

- Bundler client.
- `eth_estimateUserOperationGas`.
- `eth_sendUserOperation`.
- `eth_getUserOperationReceipt`.
- Bundle status tracking.

Acceptance:

- At least two Smart Accounts produce UserOperations.
- Bundler submits and confirms the operations.
- Dashboard shows bundle size and per-intent status.

### Phase 6: Settlement and Metrics Productization

Deliverables:

- Per-intent settlement event mapping.
- Metrics dashboards for match rate, gas saved, route savings, latency.
- Adapter switch logging.
- Optional `IntentSettlement` contract if the off-chain plan format is stable.

Acceptance:

- Dashboard can explain why a plan saved gas or improved execution.
- Every intent maps to a transaction, UserOperation, or settlement event.
- Report can compare non-aggregated vs aggregated execution.

## 16. Recommended MVP Boundary

Must include:

- Postgres/Supabase intent pool.
- Two-stage validation.
- ETH/USDC exact and partial matching.
- Unmatched route to Uniswap.
- Same Smart Account batch.
- Multi Smart Account UserOperation construction.
- Bundler adapter.
- Realtime metrics.

Must not include yet:

- Multi-hop netting.
- Cross-chain intents.
- DCA time-window aggregation.
- Full rebalance decomposition.
- Automated UserOperation cancellation.
- Kafka/Redis.
- Full generic settlement protocol before the planner is proven.

This boundary keeps the project product-grade while protecting it from
over-expansion.
