# AI-Powered On-Chain Agent Protocol with Intent Infrastructure

## 1. Executive Summary

This project implements an AI-powered intent execution network for on-chain
agents. Users describe goals in natural language, the backend turns them into
validated structured intents, and the coordinator executes them through either
direct EOA wallet transactions, EIP-712 signed scheduled intents, or delegated
smart-account agent execution.

The system targets the core scalability problem in autonomous on-chain agents:
agents may generate many swaps, transfers, rebalancing actions, and scheduled
tasks. If each action competes independently for blockspace, throughput is low
and gas overhead is high. This project improves execution by adding intent
batching, asynchronous coordinator jobs, relayer execution, and a live
performance dashboard.

The implementation includes:

- Foundry + Solidity smart contracts.
- AI natural-language intent parser using DeepSeek/OpenAI-compatible APIs.
- Uniswap quote and swap preparation service.
- EOA default mode with EIP-712 signed intent authorization.
- Advanced Agent Wallet mode with smart-account delegation.
- Coordinator worker with persistent job storage, due-time scanning, batching,
  retries, and receipt tracking.
- Backend Agent executor that simulates an autonomous agent signer for
  no-additional-owner-signature execution after authorization.
- Product frontend with wallet connection, AI chat, transaction history, and
  performance dashboard.
- Sepolia deployment and testnet execution flow.

## 2. Problem Statement

AI agents are different from normal blockchain users. A normal user may submit
one transaction at a time, while an AI agent can produce a stream of actions:
portfolio rebalancing, DCA, scheduled transfers, arbitrage monitoring, and
protocol interactions. Traditional execution creates bottlenecks:

- Each intent becomes a separate transaction.
- More intents compete for limited blockspace.
- Users must stay online to sign time-based actions.
- Gas overhead is repeated across many similar operations.
- Multi-step workflows are hard to monitor and retry.

The goal of this project is to build infrastructure that accepts user intents,
stores them asynchronously, batches compatible work, and executes them safely
without sacrificing correctness.

## 3. System Architecture

```text
User prompt
  -> Frontend AI chat
  -> Backend AI parser
  -> Schema validation and risk checks
  -> Intent execution planner
  -> Wallet signing or EIP-712 intent signing
  -> Coordinator job store
  -> Coordinator worker
  -> Single execution or batched execution
  -> Sepolia transaction
  -> Receipt tracking
  -> History and performance dashboard
```

The architecture separates proposal, authorization, execution, and monitoring:

- AI proposes an intent, but does not execute directly.
- The backend validates the intent shape and required fields.
- The user authorizes execution through wallet transaction signing or EIP-712
  typed-data signatures.
- The coordinator executes only jobs that are due and already authorized.
- The dashboard reports throughput, latency, failure rate, batch size, and gas.

## 4. Smart Contract Layer

### AgentRegistry

Registers autonomous agents and associates them with owners and smart accounts.
It provides the protocol-level identity and permission foundation for multi-user,
multi-agent execution.

### IntentManager

Tracks intent lifecycle and prevents duplicate execution. It supports creation
and status updates for transfer, swap, rebalance, and scheduled intents.

### BatchExecutor

Executes grouped calls and emits per-intent execution results. This is the
protocol batching layer used to reduce transaction count and coordinate grouped
settlement.

### AgentSmartAccount

Implements an ERC-4337-style smart account. It supports:

- Owner-controlled execution.
- EntryPoint-style validation.
- Platform Agent authorization.
- Target-specific delegated permissions.
- `executeBatchAgentCalls` for multiple delegated calls in one transaction.
- Wildcard unlimited authorization using the zero address target for all-target
  execution rights.

This gives users a production-like path where the user's EOA owns a smart
account, while the platform Agent can execute only the work the user authorized.

### SignedIntentEscrow

Implements EIP-712 signed scheduled execution for the default EOA user path.
Users sign typed data now, fund escrow if needed, and the relayer executes later
when the signed call becomes due.

Key functions:

- `depositFor(address owner)`
- `withdraw(uint256 amount)`
- `executeSignedCall(SignedCall call, bytes data, bytes signature)`
- `executeBatchSignedCalls(SignedCall[] calls, bytes[] data, bytes[] signatures)`

Safety checks include owner validation, target validation, nonce replay
protection, due-time checks, deadline checks, calldata hash matching, signature
recovery, and escrow balance checks.

## 5. Intent Types

The product supports the required intent types:

| Intent | Description | Execution path |
|---|---|---|
| Transfer | Send ETH or ERC20 tokens | Wallet tx, signed call, or agent smart account |
| Swap | Buy/sell through Uniswap quote/calldata | Wallet tx or smart-account call |
| Rebalance | Convert target allocation into swap intents | Planner plus swap execution |
| Scheduled task | Execute transfer/swap later or in sequence | EIP-712 signed jobs plus coordinator |

The frontend also supports utility queries:

- Sepolia ETH balance.
- WETH/USDC/custom ERC20 balance.
- Execution history.
- Current agent permission.
- Spot-style commands such as `buy USDC with 0.0005 ETH`.

## 6. AI Integration

The AI layer parses natural language into structured intent proposals. The
current implementation supports DeepSeek through an OpenAI-compatible chat API
and can also use OpenAI-style structured outputs.

Important design choice: AI is only a proposal layer. It cannot directly spend
funds or bypass validation. Every AI proposal must pass backend schema checks
and then receive user wallet authorization.

Example prompts:

```text
Send 0.000005 ETH on Sepolia to 0x97B59071Fd586f381254828Eb1e0C0f64B77b9BE.
Swap 0.0005 ETH to USDC on Sepolia.
Rebalance my Sepolia portfolio to 60% WETH and 40% USDC using a tiny test amount.
Send 0.0005 ETH on Sepolia to 0x97B59071Fd586f381254828Eb1e0C0f64B77b9BE at 19:55 today.
```

## 7. Execution Modes

### Default Mode: EOA EIP-712 Intent Signature

This is the recommended path for normal EOA users.

Flow:

```text
Connect wallet
  -> User enters scheduled intent
  -> Backend prepares SignedCall typed data
  -> User signs EIP-712 message
  -> User funds escrow if native ETH is needed
  -> Coordinator stores signed job
  -> Worker scans due jobs
  -> Relayer submits executeSignedCall or executeBatchSignedCalls
  -> Dashboard updates after receipt
```

Benefits:

- User does not expose private keys.
- User can authorize future execution immediately.
- The relayer can execute at the scheduled time.
- Multiple due signed calls can be merged into one transaction.

Trade-off:

- Native ETH scheduled transfers require escrow funding before execution.

### Advanced Mode: Platform Agent Multi-User Authorization

This path is designed for a more productized agent-wallet experience.

Flow:

```text
EOA creates or controls smart account
  -> Frontend loads the platform Agent address from backend
  -> EOA authorizes the platform Agent
  -> Permission includes target, value limit, and expiry
  -> Backend-simulated platform Agent signer or external Agent submits execution
  -> Smart account checks permission
  -> Agent can execute one call or batch calls
```

Benefits:

- Better long-term agent model.
- Compatible with account-abstraction style products.
- Agent can operate without repeatedly asking the owner EOA to sign every
  transaction.
- Immediate transfer, swap, rebalance, and multi-action workflows can be
  executed without additional Owner wallet signatures after the initial
  authorization.
- Multiple immediate actions are submitted through `executeBatchAgentCalls`,
  giving the clearest live demonstration of gas-saving batch execution.

Trade-off:

- Users need to understand smart-account delegation and permission limits.
- The current demo uses `AGENT_PRIVATE_KEY` to simulate the autonomous Agent
  signer. In a production deployment, this signer should be replaced by an
  external agent node, MPC/KMS/HSM, TEE runtime, or ERC-4337 session-key
  signer.

The current configured demo Agent signer is exposed by:

```text
GET /agent/status
```

For Sepolia testing, the frontend now loads and locks the platform Agent address
from the backend signer. Each user only connects their own EOA and authorizes
that shared platform Agent for their own Smart Account.

## 8. Coordinator Worker

The backend coordinator worker is responsible for asynchronous execution.

Implemented behavior:

- Stores coordinator jobs in JSON-backed persistent storage.
- Scans due jobs on an interval.
- Groups jobs by `batchGroupId`.
- Executes one due job with `executeSignedCall`.
- Executes multiple due jobs with `executeBatchSignedCalls`.
- Executes due Agent Wallet jobs with `executeAgentCall`.
- Executes multiple due Agent Wallet jobs with `executeBatchAgentCalls`.
- Tracks submitted tx hashes.
- Polls receipts and marks jobs as `SUCCESS` or `FAILED`.
- Retries failed submissions up to `maxAttempts`.

Core statuses:

```text
QUEUED -> EXECUTING -> SUBMITTED -> SUCCESS
QUEUED -> EXECUTING -> RETRY -> EXECUTING
QUEUED -> EXECUTING -> FAILED
```

This directly addresses asynchronous task handling and relayer/coordinator
requirements.

## 9. Batching Design

The project implements two batching paths:

### EIP-712 Signed Batch

`SignedIntentEscrow.executeBatchSignedCalls` takes arrays of signed calls,
calldata, and signatures. Every call is independently verified, then executed in
one relayer transaction.

This is used by the default EOA scheduled mode.

### Agent Smart Account Batch

`AgentSmartAccount.executeBatchAgentCalls` allows the authorized platform Agent
to execute multiple permitted calls through the smart account in one
transaction.

This is used by the advanced smart-account mode for both immediate multi-action
intents and scheduled Agent Wallet jobs that become due together. The
implementation was validated against Foundry `cast calldata` to ensure the
dynamic `Call[]` ABI encoding is byte-for-byte correct. During integration
testing, an incorrect dynamic-array offset caused batch transactions to revert
even though the same calls succeeded individually; fixing this encoding made
both two-transfer batches and transfer-plus-swap batches estimate successfully
on Sepolia.

Example Sepolia gas estimates after the fix:

| Batch type | Estimated gas |
|---|---:|
| 2 ETH transfers through `executeBatchAgentCalls` | 65,389 |
| 1 ETH transfer + 1 ETH-to-USDC swap through `executeBatchAgentCalls` | 202,318 |

This path is the strongest live gas-saving demonstration in the current product
because a single authorized Agent transaction carries multiple user intents.

## 10. Uniswap Integration

Swap and spot buy/sell intents use the backend Uniswap service. It:

- Resolves token symbols and custom token addresses.
- Converts user decimal amounts into base units.
- Requests Uniswap quote/swap data when `UNISWAP_API_KEY` is configured.
- Falls back to mock calldata when local demo mode is enabled.

Supported Sepolia token registry:

- ETH
- WETH
- USDC
- Custom ERC20 address input

## 11. Frontend Product

The frontend is a product-style agent console instead of a local testing module.

Main modules:

- Wallet Access: connect EOA wallet and optionally open Advanced Agent Wallet.
- AI Chat: user types intents and sees assistant-style execution messages.
- Intent Templates: Transfer, Scheduled, Swap, Rebalance.
- Preview: shows parsed JSON without sending.
- Send: signs or submits execution.
- Recent Results: shows status and clickable Etherscan tx hashes.
- Performance Dashboard: shows live coordinator metrics.

The product uses wallet signing instead of private-key entry in the frontend.

## 12. Performance Dashboard

The dashboard reports both historical benchmark results and live coordinator
execution metrics.

Live metrics include:

- Total coordinator jobs.
- Successful jobs.
- Failure rate.
- Average batch size.
- Throughput per minute. Very small non-zero values are shown as `<0.01/min`
  instead of being rounded to `0/min`.
- Average latency.
- Estimated no-batch gas.
- Actual batch gas from receipts.
- Estimated gas saved.
- Recent batch transactions.

The dashboard combines:

- Coordinator jobs, including EIP-712 signed scheduled jobs and scheduled Agent
  Wallet jobs.
- Local immediate `agent-batch-execute` records from the frontend history, so
  live smart-account batch executions contribute to gas-saved and throughput
  metrics.

Benchmark configuration:

```json
{
  "intentCount": 40,
  "batchSize": 5,
  "nonBatchedGasPerIntent": 77000,
  "batchBaseGas": 45000,
  "batchPerIntentGas": 32000
}
```

Benchmark summary:

| Metric | Non-batched | Batched |
|---|---:|---:|
| Intent count | 40 | 40 |
| Transaction count | 40 | 8 |
| Total gas estimate | 3,080,000 | 1,640,000 |
| Average throughput | 1 intent/tx | 5 intents/tx |
| Average latency | 20,500 ms | 9,000 ms |

Result:

- Transaction count reduced by 80%.
- Estimated gas reduced by 46.75%.
- Throughput increased to 5 intents per transaction.

The detailed benchmark output is stored in:

```text
report/benchmark-results.json
```

## 13. Sepolia Deployment

Current Sepolia deployment:

| Contract | Address |
|---|---|
| EntryPoint | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| AgentRegistry | `0xFEC031f7A3BdeE9d21c2F6f2faBD25F9d39b44a7` |
| IntentManager | `0xC0a9cc1Abb5151ce7fF706fCe3f845Beab0391A2` |
| BatchExecutor | `0xD7071786Eb55997fa08db97893CB736CBa4A2e4a` |
| SmartAccountFactory | `0xA1E3DE4e214E0C58cc45013717970b5Af72B4216` |
| SignedIntentEscrow | `0xE8690fF6b9Ba606DC1691983BBC06A886e5c200f` |

Example Sepolia transactions observed during testing:

| Purpose | Transaction |
|---|---|
| Transfer funding/call | `0xbcc7d8c47f683bcc222479c505763a7061d21c7009ec2e3f938a00462556a147` |
| Create intent | `0x9d75ad8f47ee13a1d16c5fa50f94320b3a949577d60d98808683d4ca45f95b88` |
| Execute batch | `0xbc1270417ff53fa477f432f2c1bf64e80e9c65a11628d89819215a476dfe4f5f` |
| Scheduled escrow deposit | `0x9bc0b1e7...05f7c0` |
| Scheduled relayer execution | `0x2fc85ef9...b7ef93` |
| Agent scheduled execution | `0xbfc4a93439140cb4a9c2c253a4afbea331614fda47465f899660561edba23352` |

The full current deployment config is stored in:

```text
deployments/sepolia.json
```

## 14. Testing

### Solidity Tests

Run:

```bash
forge test -q
```

Covered behavior:

- Agent registration.
- Intent lifecycle.
- Batch execution.
- Smart account owner execution.
- ERC-4337-style validation.
- Agent authorization.
- `executeBatchAgentCalls`.
- EIP-712 signed escrow execution.
- `executeBatchSignedCalls`.

### Backend Tests

Run:

```bash
cd backend
npm test
```

Current result:

```text
40 tests passing
```

Covered behavior:

- AI parser validation.
- Scheduled time inference.
- Ordered multi-action workflow handling.
- Intent schema validation.
- Token amount conversion.
- Uniswap quote and fallback behavior.
- Rebalance planning.
- Coordinator worker batching.
- Coordinator Agent Wallet job batching.
- Coordinator retry behavior.
- Metrics calculation.
- Wallet transaction preparation.
- Agent authorization preparation.
- Smart-account agent batch transaction preparation.

### Frontend Smoke Check

Run:

```bash
cd backend
npm start
```

```bash
cd frontend
npm start
```

Open:

```text
http://127.0.0.1:5173
```

The frontend was checked for:

- Backend online status.
- AI chat layout.
- Wallet access panel.
- Performance Dashboard visibility.
- Recent Results table.

## 15. API Surface

Important backend endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /ai/parse-intent` | Parse natural language into structured intent |
| `POST /wallet/prepare-transaction` | Prepare direct EOA wallet transaction |
| `POST /wallet/prepare-agent-intent-execution` | Prepare smart-account agent execution |
| `POST /wallet/prepare-agent-batch-execution` | Prepare raw smart-account batch execution |
| `POST /wallet/prepare-agent-intent-batch-execution` | Prepare smart-account batch execution from intents |
| `GET /agent/status` | Return configured backend Agent signer address |
| `POST /agent/execute-intent` | Backend Agent executes one authorized intent |
| `POST /agent/execute-batch-intents` | Backend Agent executes multiple intents in one smart-account batch |
| `POST /settlement/prepare-scheduled-workflow` | Prepare EIP-712 signed scheduled calls |
| `POST /settlement/execute-signed-call` | Relayer executes one signed call |
| `POST /settlement/execute-batch-signed-calls` | Relayer executes batched signed calls |
| `GET /coordinator/jobs` | List coordinator jobs |
| `POST /coordinator/jobs` | Register signed coordinator jobs |
| `POST /coordinator/tick` | Manually run one worker tick |
| `GET /metrics` | Dashboard performance metrics |
| `POST /wallet/balances` | Query ETH/ERC20 balances |
| `POST /wallet/agent-permission` | Query smart-account agent permission |
| `POST /rebalance/plan` | Build rebalance plan |
| `POST /uniswap/quote` | Get Uniswap quote |

## 16. Security Analysis

Implemented controls:

- No frontend private-key requirement.
- Wallet signing for user authorization.
- EIP-712 typed data for scheduled intents.
- Nonce replay protection in `SignedIntentEscrow`.
- Due-time and deadline enforcement.
- Calldata hash binding before execution.
- Escrow balance checks.
- Smart-account agent permissions with target, value, and expiry.
- Unlimited Agent mode authorizes the zero-address wildcard target and
  `uint256.max` value, while limited mode keeps target and value scoped.
- Backend Agent execution checks that the requested Agent address matches the
  configured backend signer before submitting, preventing unclear
  `AgentNotAuthorized` reverts.
- Backend schema validation after AI parsing.
- Receipt-based status updates.
- Retry limit for coordinator jobs.

Remaining risks:

- Coordinator/relayer is currently centralized.
- JSON file storage is suitable for prototype/demo, not high-scale production.
- Uniswap execution depends on API availability and testnet liquidity.
- The demo backend can hold an Agent private key for simulation. Production
  deployments should move signing into an external agent runtime, KMS/HSM,
  MPC/TSS, TEE, or session-key infrastructure.
- Smart-account factory address may need redeployment when account bytecode is
  upgraded.
- Real production ERC-4337 bundler/paymaster integration is not fully automated.

## 17. Decentralization, Efficiency, and Trust Trade-offs

Batching improves efficiency, but introduces coordination decisions:

- More batching means lower gas per intent, but potentially more waiting time.
- A centralized relayer is easier to build, but creates liveness trust.
- Smart-account delegation improves UX, but users must understand permissions.
- EIP-712 signed intents keep EOA UX simple, but escrow is needed for future ETH
  transfers.
- AI makes intent input easier, but must remain behind deterministic validation.

The current design chooses a practical product path: AI for interpretation,
wallet signatures for authorization, smart contracts for enforcement, and the
coordinator for scalable asynchronous execution.

## 18. How to Run

Contracts:

```bash
forge build
forge test
```

Backend:

```bash
cd backend
npm test
npm start
```

Frontend:

```bash
cd frontend
npm start
```

Open:

```text
http://127.0.0.1:5173
```

Benchmark:

```bash
cd backend
npm run benchmark
```

## 19. Future Work

- Replace JSON job storage with Postgres or another production database.
- Add decentralized relayer or solver competition.
- Integrate a production ERC-4337 bundler and paymaster.
- Support multiple independent Agent nodes submitting intents concurrently.
- Extend batching across multiple smart accounts using ERC-4337 UserOperation
  bundling or a shared settlement contract.
- Add solver-style matching for swap intents, such as CoW-style internal
  crossing before falling back to Uniswap.
- Replace demo Agent private-key storage with MPC/KMS/HSM/TEE or external
  self-signing Agent infrastructure.
- Add event indexing for richer Sepolia history.
- Add per-user risk limits and policy UI.
- Add multi-chain support and cross-chain intents.
- Add formal verification or invariant tests for escrow and smart-account
  authorization logic.

## 20. Conclusion

The project delivers a full AI Coding implementation of an AI-powered on-chain
agent protocol: requirements analysis, Solidity protocol contracts, AI parser,
Uniswap integration, EOA and smart-account execution modes, scheduled execution,
batching, coordinator worker, Sepolia deployment, frontend product UI, tests,
metrics dashboard, and report.

The strongest result is the end-to-end path from natural language intent to
verifiable Sepolia transaction, while preserving a clear security boundary:
AI proposes, users authorize, contracts enforce, and the coordinator scales
execution.
