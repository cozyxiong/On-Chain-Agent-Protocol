# Video Demo Script

Target length: 5 to 8 minutes.

## 1. Opening

Introduce the project:

```text
This is an AI-powered on-chain agent protocol with intent infrastructure.
It supports AI-generated intents, batching, ERC-4337-style smart accounts,
Uniswap swap preparation, scheduled tasks, rebalancing, dashboard metrics,
and Sepolia deployment.
```

## 2. Architecture Walkthrough

Show the repository structure:

```text
contracts/
backend/
frontend/
script/
report/
docs/
```

Explain the flow:

```text
Natural language -> AI parser -> validated intent -> batch -> smart account execution -> metrics.
```

## 3. Contract Tests

Run:

```bash
forge test
```

Mention:

- Agent registration.
- Intent lifecycle.
- Batch execution.
- ERC-4337-style validation.

## 4. Backend Tests

Run:

```bash
cd backend
npm test
```

Mention:

- AI parser validation.
- Batching.
- Metrics.
- Scheduled tasks.
- Rebalance planning.
- Uniswap quote/calldata service.

## 5. Dashboard Demo

Start backend:

```bash
cd backend
npm start
```

Start dashboard:

```bash
cd frontend
npm start
```

Open:

```text
http://localhost:5173
```

Demo sequence:

1. Show backend online status.
2. Parse an AI intent.
3. Show the created intent in the queue.
4. Prepare a Uniswap swap.
5. Create a rebalance plan.
6. Build batches.
7. Simulate execution.
8. Show metrics update.

## 6. Sepolia Deployment

Show:

```text
deployments/sepolia.json
```

Highlight:

```text
AgentRegistry
IntentManager
BatchExecutor
SmartAccountFactory
SmartAccount
AgentId
```

Mention that the deployment and smoke test were successfully broadcast to
Sepolia.

## 7. Benchmark

Run:

```bash
cd backend
npm run benchmark
```

Explain:

```text
For 40 intents and batch size 5, batching reduced transaction count from 40 to 8
and reduced estimated gas by about 46.75%.
```

## 8. Closing

Summarize trade-offs:

```text
Batching improves throughput and gas efficiency, but introduces coordinator
trust assumptions, scheduling delay, and reliance on robust validation.
The system keeps AI as a proposal layer and uses smart contracts plus backend
schema checks to protect execution correctness.
```
