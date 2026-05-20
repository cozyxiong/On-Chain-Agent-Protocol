import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUniswapService } from "../uniswap/uniswapService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const broadcastPath = path.join(
  repoRoot,
  "broadcast",
  "ExecuteSepoliaFrontendIntent.s.sol",
  "11155111",
  "run-latest.json"
);
const sensitiveCachePath = path.join(
  repoRoot,
  "cache",
  "ExecuteSepoliaFrontendIntent.s.sol",
  "11155111",
  "run-latest.json"
);

export function createSepoliaExecutor(options = {}) {
  const uniswap = options.uniswap ?? createUniswapService(options.uniswapOptions ?? {});

  return {
    async executeIntent(intent) {
      const kind = normalizeKind(intent.intentType);
      const env = await buildExecutionEnv(kind, intent, uniswap);
      const result = await runForgeScript(env);
      await removeSensitiveCache();

      return {
        kind,
        etherscanBaseUrl: "https://sepolia.etherscan.io/tx/",
        transactions: result.transactions,
        receipts: result.receipts,
        recipient: kind === "transfer" || kind === "scheduled" ? process.env.SMOKE_RECIPIENT : null,
        primaryTxHash: result.transactions.at(-1)?.hash ?? null
      };
    }
  };
}

async function buildExecutionEnv(kind, intent, uniswap) {
  const env = {
    ...process.env,
    FRONTEND_INTENT_KIND: kind,
    SMOKE_FRONTEND_NATIVE_AMOUNT_WEI: process.env.SMOKE_FRONTEND_NATIVE_AMOUNT_WEI ?? "5000000000000",
    SMOKE_FRONTEND_SWAP_AMOUNT_WEI: process.env.SMOKE_FRONTEND_SWAP_AMOUNT_WEI ?? "1000000000000"
  };

  if (kind === "swap" || kind === "rebalance") {
    const swapIntent = kind === "rebalance" ? rebalanceToSmallSwap(intent) : intent;
    const prepared = await uniswap.prepareSwapExecution({
      ...swapIntent,
      intentId: swapIntent.intentId ?? `${kind}-${Date.now()}`,
      tokenIn: swapIntent.tokenIn ?? "WETH",
      tokenOut: swapIntent.tokenOut ?? "USDC",
      amountIn: "0.000001",
      smartAccount: process.env.BATCH_EXECUTOR_ADDRESS,
      slippageBps: swapIntent.slippageBps ?? 100,
      deadlineMinutes: swapIntent.deadlineMinutes ?? 20
    });

    env.UNISWAP_SWAP_TARGET = prepared.executionCall.target;
    env.UNISWAP_SWAP_DATA = prepared.executionCall.data;
  }

  return env;
}

function rebalanceToSmallSwap(intent) {
  const targetAllocation = intent.targetAllocation ?? {};
  const wantsUsdc = targetAllocation.USDC === undefined || targetAllocation.USDC >= 50;
  return {
    ...intent,
    intentType: "swap",
    tokenIn: wantsUsdc ? "WETH" : "USDC",
    tokenOut: wantsUsdc ? "USDC" : "WETH"
  };
}

function normalizeKind(kind) {
  const normalized = String(kind ?? "").toLowerCase();
  if (!["transfer", "swap", "rebalance", "scheduled"].includes(normalized)) {
    const error = new Error(`Unsupported Sepolia execution intent type: ${kind}`);
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function runForgeScript(env) {
  await fs.rm(broadcastPath, { force: true });

  await new Promise((resolve, reject) => {
    const child = spawn(
      "forge",
      [
        "script",
        "script/ExecuteSepoliaFrontendIntent.s.sol:ExecuteSepoliaFrontendIntent",
        "--rpc-url",
        env.SEPOLIA_RPC_URL,
        "--broadcast"
      ],
      {
        cwd: repoRoot,
        env,
        shell: process.platform === "win32"
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(stderr || `forge script failed with code ${code}`);
      error.statusCode = 500;
      reject(error);
    });
  });

  const run = JSON.parse(await fs.readFile(broadcastPath, "utf8"));
  return {
    transactions: run.transactions.map((tx, index) => ({
      hash: tx.hash,
      label: labelTransaction(tx, index),
      function: tx.function,
      to: tx.transaction?.to ?? tx.contractAddress,
      value: tx.transaction?.value ?? "0x0",
      etherscanUrl: `https://sepolia.etherscan.io/tx/${tx.hash}`
    })),
    receipts: run.receipts.map((receipt) => ({
      transactionHash: receipt.transactionHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed
    }))
  };
}

function labelTransaction(tx, index) {
  if (index === 0 && !tx.function) {
    return "Fund BatchExecutor";
  }
  if (tx.function?.startsWith("createIntent")) {
    return "Register intent on-chain";
  }
  if (tx.function?.startsWith("executeBatch")) {
    return "Execute intent batch";
  }
  return tx.function ?? "On-chain call";
}

async function removeSensitiveCache() {
  await fs.rm(sensitiveCachePath, { force: true });
}
