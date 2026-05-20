# Sepolia Deployment

## Required Environment

Create a local `.env` file from `.env.example`.

```bash
SEPOLIA_RPC_URL=
PRIVATE_KEY=
ETHERSCAN_API_KEY=
ENTRYPOINT_ADDRESS=0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
```

`PRIVATE_KEY` must be a Sepolia-funded deployer key. Do not commit `.env`.

## Build and Test

```bash
forge build
forge test
```

## Deploy

```bash
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

If verification is not needed:

```bash
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast
```

Copy the emitted contract addresses into `.env`:

```bash
AGENT_REGISTRY_ADDRESS=
INTENT_MANAGER_ADDRESS=
BATCH_EXECUTOR_ADDRESS=
SMART_ACCOUNT_FACTORY_ADDRESS=
```

## Smoke Test

```bash
forge script script/SmokeSepolia.s.sol:SmokeSepolia \
  --rpc-url $SEPOLIA_RPC_URL \
  --broadcast
```

The smoke script creates a smart account and registers one demo agent.

## Dashboard Demo

Run backend and dashboard locally:

```bash
cd backend
npm start
```

```bash
cd frontend
npm start
```

Open `http://localhost:5173`.
