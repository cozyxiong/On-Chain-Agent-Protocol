import { createIntentStore } from "./storage/intentStore.js";
import { validateIntentInput } from "./intents/schema.js";
import { buildBatches } from "./coordinator/batcher.js";
import { createCoordinatorJobStore } from "./coordinator/jobStore.js";
import { createCoordinatorWorker } from "./coordinator/worker.js";
import { computeMetrics } from "./metrics/metrics.js";
import { createAggregationPlan } from "./aggregator/matcher.js";
import { createIntentParser } from "./ai/intentParser.js";
import { listTokens } from "./tokens/tokenRegistry.js";
import { createUniswapService } from "./uniswap/uniswapService.js";
import { findDueScheduledIntents } from "./scheduler/scheduler.js";
import { createRebalancePlan, rebalancePlanToSwapIntents } from "./rebalance/rebalancePlanner.js";
import { createSepoliaExecutor } from "./sepolia/executor.js";
import {
  createWalletTransactionBuilder,
  prepareAgentBatchExecutionTransaction,
  prepareAgentExecutionTransaction,
  prepareAgentIntentBatchExecutionTransaction,
  prepareAgentIntentExecutionTransaction,
  prepareAuthorizeAgentTransaction,
  prepareCreateSmartAccountTransaction,
  prepareRevokeAgentTargetTransaction,
  prepareRevokeAgentTransaction
} from "./wallet/transactionBuilder.js";
import { createWalletQueryService } from "./wallet/walletQueryService.js";
import { createSettlementService } from "./settlement/settlementService.js";
import { createAgentExecutor } from "./agent/agentExecutor.js";
import { createSupabaseMirrorFromEnv } from "./storage/supabaseMirror.js";
import http from "node:http";

export function createBackendServer(options = {}) {
  const supabaseMirror = options.supabaseMirror ?? createSupabaseMirrorFromEnv();
  const store = options.store ?? createIntentStore({ mirror: supabaseMirror });
  const batchSize = options.batchSize ?? 5;
  const intentParser = options.intentParser ?? createIntentParser(options.ai ?? {});
  const uniswap = options.uniswap ?? createUniswapService(options.uniswapOptions ?? {});
  const sepoliaExecutor =
    options.sepoliaExecutor ?? createSepoliaExecutor({ uniswap, ...(options.sepolia ?? {}) });
  const walletTxBuilder =
    options.walletTxBuilder ?? createWalletTransactionBuilder({ uniswap });
  const walletQueries = options.walletQueries ?? createWalletQueryService();
  const settlement = options.settlement ?? createSettlementService({ uniswap });
  const agentExecutor = options.agentExecutor ?? createAgentExecutor({ uniswap });
  const coordinatorJobs =
    options.coordinatorJobs ??
    createCoordinatorJobStore({ ...(options.coordinatorJobStore ?? {}), mirror: supabaseMirror });
  const coordinatorWorker =
    options.coordinatorWorker ??
    createCoordinatorWorker({
      store: coordinatorJobs,
      settlement,
      agentExecutor,
      getReceipt: getTransactionReceipt,
      intervalMs: options.coordinatorIntervalMs ?? 10_000,
      dueGraceMs: options.coordinatorDueGraceMs ?? 20_000
    });

  if (options.startCoordinatorWorker !== false) {
    coordinatorWorker.start();
  }

  return http.createServer(async (req, res) => {
    try {
      setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        return sendJson(res, 204, {});
      }

      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/health") {
        return sendJson(res, 200, {
          ok: true,
          service: "aap-agent-backend",
          storage: {
            supabase: supabaseMirror.enabled
          },
          timestamp: new Date().toISOString()
        });
      }

      if (req.method === "GET" && url.pathname === "/storage/status") {
        return sendJson(res, 200, {
          supabase: {
            enabled: supabaseMirror.enabled,
            url: process.env.SUPABASE_URL ? redactSupabaseUrl(process.env.SUPABASE_URL) : null
          }
        });
      }

      if (req.method === "GET" && url.pathname === "/intents") {
        return sendJson(res, 200, { intents: store.listIntents() });
      }

      if (req.method === "GET" && url.pathname === "/tokens") {
        return sendJson(res, 200, { tokens: listTokens() });
      }

      if (req.method === "POST" && url.pathname === "/intents") {
        const body = await readJson(req);
        const intent = validateIntentInput(body);
        const created = store.createIntent(intent);
        return sendJson(res, 201, { intent: created });
      }

      if (req.method === "POST" && url.pathname === "/ai/parse-intent") {
        const body = await readJson(req);
        const parsed = await intentParser.parse(body.message, body.context ?? {});

        if (body.createIntent === true) {
          if (!parsed.valid || !parsed.intent) {
            return sendJson(res, 422, parsed);
          }

          const created = store.createIntent(parsed.intent);
          return sendJson(res, 201, { ...parsed, intent: created });
        }

        return sendJson(res, 200, parsed);
      }

      if (req.method === "GET" && url.pathname === "/batches") {
        return sendJson(res, 200, { batches: store.listBatches() });
      }

      if (req.method === "POST" && url.pathname === "/batches/build") {
        const batches = buildBatches(store.listIntents(), { batchSize, now: new Date() });
        const created = batches.map((batch) => store.createBatch(batch));
        return sendJson(res, 201, { batches: created });
      }

      if (req.method === "POST" && url.pathname === "/aggregator/plan") {
        const body = await readJson(req);
        const plan = createAggregationPlan(body.intents ?? store.listIntents(), {
          ethPriceUsdc: body.ethPriceUsdc
        });
        return sendJson(res, 200, { plan });
      }

      if (req.method === "POST" && url.pathname === "/uniswap/quote") {
        const body = await readJson(req);
        const quote = await uniswap.quoteSwap(body);
        return sendJson(res, 200, { quote });
      }

      if (req.method === "POST" && url.pathname === "/uniswap/prepare-swap") {
        const body = await readJson(req);
        const prepared = await uniswap.prepareSwapExecution(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/coordinator/simulate-execution") {
        const batches = store.listBatches().filter((batch) => batch.status === "READY");
        const executed = batches.map((batch) => store.markBatchExecuted(batch.batchId));
        return sendJson(res, 200, { batches: executed });
      }

      if (req.method === "GET" && url.pathname === "/coordinator/jobs") {
        return sendJson(res, 200, { jobs: coordinatorJobs.listJobs() });
      }

      if (req.method === "POST" && url.pathname === "/coordinator/jobs") {
        const body = await readJson(req);
        const jobs = coordinatorJobs.createJobs(body.jobs ?? [body]);
        return sendJson(res, 201, { jobs });
      }

      if (req.method === "POST" && url.pathname === "/coordinator/tick") {
        const summary = await coordinatorWorker.tick();
        return sendJson(res, 200, { summary, jobs: coordinatorJobs.listJobs() });
      }

      if (req.method === "GET" && url.pathname === "/scheduler/due") {
        return sendJson(res, 200, {
          intents: findDueScheduledIntents(store.listIntents(), { now: new Date() })
        });
      }

      if (req.method === "POST" && url.pathname === "/rebalance/plan") {
        const body = await readJson(req);
        const plan = createRebalancePlan(body);
        const swapIntents = rebalancePlanToSwapIntents(plan, body.context ?? {});
        return sendJson(res, 200, { plan, swapIntents });
      }

      if (req.method === "POST" && url.pathname === "/sepolia/execute-intent") {
        const body = await readJson(req);
        const result = await sepoliaExecutor.executeIntent(body.intent ?? body);
        const updatedIntent = store.markLatestIntentExecuted({
          txHash: result.primaryTxHash,
          gasUsed: Number.parseInt(result.receipts.at(-1)?.gasUsed ?? "0", 16)
        });
        result.updatedIntent = updatedIntent;
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-transaction") {
        const body = await readJson(req);
        const prepared = await walletTxBuilder.prepare(body.intent, body.walletAddress);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "GET" && url.pathname === "/wallet/transaction-receipt") {
        const receipt = await getTransactionReceipt(url.searchParams.get("hash"));
        return sendJson(res, 200, { receipt });
      }

      if (req.method === "POST" && url.pathname === "/wallet/balances") {
        const body = await readJson(req);
        const balances = await walletQueries.balances(body);
        return sendJson(res, 200, balances);
      }

      if (req.method === "POST" && url.pathname === "/wallet/agent-permission") {
        const body = await readJson(req);
        const permission = await walletQueries.agentPermission(body);
        return sendJson(res, 200, permission);
      }

      if (req.method === "POST" && url.pathname === "/settlement/prepare-scheduled-workflow") {
        const body = await readJson(req);
        const prepared = await settlement.prepareScheduledWorkflow(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/settlement/prepare-execute-signed-call") {
        const body = await readJson(req);
        const prepared = settlement.prepareExecuteSignedCall(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/settlement/execute-signed-call") {
        const body = await readJson(req);
        const executed = await settlement.executeSignedCall(body);
        return sendJson(res, 200, executed);
      }

      if (req.method === "POST" && url.pathname === "/settlement/prepare-execute-batch-signed-calls") {
        const body = await readJson(req);
        const prepared = settlement.prepareExecuteBatchSignedCalls(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/settlement/execute-batch-signed-calls") {
        const body = await readJson(req);
        const executed = await settlement.executeBatchSignedCalls(body);
        return sendJson(res, 200, executed);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-authorize-agent") {
        const body = await readJson(req);
        const prepared = prepareAuthorizeAgentTransaction(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-revoke-agent") {
        const body = await readJson(req);
        const prepared = prepareRevokeAgentTransaction(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-revoke-agent-target") {
        const body = await readJson(req);
        const prepared = prepareRevokeAgentTargetTransaction(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-create-smart-account") {
        const body = await readJson(req);
        const prepared = prepareCreateSmartAccountTransaction(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/predict-smart-account") {
        const body = await readJson(req);
        const predicted = await predictSmartAccountAddress(body);
        return sendJson(res, 200, predicted);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-agent-execution") {
        const body = await readJson(req);
        const prepared = prepareAgentExecutionTransaction(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-agent-batch-execution") {
        const body = await readJson(req);
        const prepared = prepareAgentBatchExecutionTransaction(body);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-agent-intent-execution") {
        const body = await readJson(req);
        const prepared = await prepareAgentIntentExecutionTransaction(body, uniswap);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "POST" && url.pathname === "/wallet/prepare-agent-intent-batch-execution") {
        const body = await readJson(req);
        const prepared = await prepareAgentIntentBatchExecutionTransaction(body, uniswap);
        return sendJson(res, 200, prepared);
      }

      if (req.method === "GET" && url.pathname === "/agent/status") {
        return sendJson(res, 200, await agentExecutor.status());
      }

      if (req.method === "POST" && url.pathname === "/agent/execute-intent") {
        const body = await readJson(req);
        const executed = await agentExecutor.executeAgentIntent(body);
        return sendJson(res, 200, executed);
      }

      if (req.method === "POST" && url.pathname === "/agent/execute-batch-intents") {
        const body = await readJson(req);
        const executed = await agentExecutor.executeBatchAgentIntents(body);
        return sendJson(res, 200, executed);
      }

      if (req.method === "GET" && url.pathname === "/metrics") {
        return sendJson(res, 200, {
          metrics: computeMetrics(store.listIntents(), store.listBatches(), coordinatorJobs.listJobs())
        });
      }

      return sendJson(res, 404, { error: "Route not found" });
    } catch (error) {
      const status = error.statusCode ?? 500;
      return sendJson(res, status, {
        error: error.message ?? "Internal server error"
      });
    }
  });
}

async function getTransactionReceipt(hash) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash ?? "")) {
    const error = new Error("A valid transaction hash is required");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(process.env.SEPOLIA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [hash]
    })
  });
  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error.message ?? "Failed to fetch transaction receipt");
    error.statusCode = 500;
    throw error;
  }
  return payload.result;
}

async function predictSmartAccountAddress(body) {
  const factory = body.factory;
  const owner = body.owner;
  const salt = String(body.salt ?? "0x01").replace(/^0x/, "").padStart(64, "0");
  const data = `0x7ac4ed64${owner.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${salt}`;
  const response = await fetch(process.env.SEPOLIA_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: factory, data }, "latest"]
    })
  });
  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error.message ?? "Failed to predict smart account");
    error.statusCode = 500;
    throw error;
  }
  return {
    smartAccount: `0x${payload.result.slice(-40)}`
  };
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

function redactSupabaseUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "configured";
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}
