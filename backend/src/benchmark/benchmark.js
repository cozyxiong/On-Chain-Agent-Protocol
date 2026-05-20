import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBatches } from "../coordinator/batcher.js";
import { computeMetrics } from "../metrics/metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "../../../report/benchmark-results.json");

const config = {
  intentCount: Number.parseInt(process.env.BENCHMARK_INTENTS ?? "40", 10),
  batchSize: Number.parseInt(process.env.BENCHMARK_BATCH_SIZE ?? "5", 10),
  nonBatchedGasPerIntent: 77_000,
  batchBaseGas: 45_000,
  batchPerIntentGas: 32_000
};

const result = runBenchmark(config);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.summary, null, 2));

export function runBenchmark(options = config) {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const intents = createSyntheticIntents(options.intentCount, createdAt);
  const nonBatched = simulateNonBatched(intents, options);
  const batched = simulateBatched(intents, options);

  return {
    generatedAt: new Date().toISOString(),
    config: options,
    summary: {
      intentCount: options.intentCount,
      batchSize: options.batchSize,
      nonBatchedGas: nonBatched.metrics.totalGasUsed,
      batchedGas: batched.metrics.totalGasUsed,
      gasSaved: nonBatched.metrics.totalGasUsed - batched.metrics.totalGasUsed,
      gasSavedPercent: percentSaved(nonBatched.metrics.totalGasUsed, batched.metrics.totalGasUsed),
      nonBatchedTxCount: nonBatched.txCount,
      batchedTxCount: batched.txCount,
      txReductionPercent: percentSaved(nonBatched.txCount, batched.txCount),
      nonBatchedAverageLatencyMs: nonBatched.metrics.averageLatencyMs,
      batchedAverageLatencyMs: batched.metrics.averageLatencyMs,
      nonBatchedThroughputIntentsPerTx: options.intentCount / nonBatched.txCount,
      batchedThroughputIntentsPerTx: options.intentCount / batched.txCount
    },
    nonBatched,
    batched
  };
}

function createSyntheticIntents(count, createdAt) {
  return Array.from({ length: count }, (_, index) => ({
    intentId: `intent-${index + 1}`,
    intentType: index % 4 === 0 ? "swap" : "transfer",
    userId: `user-${index % 4}`,
    agentId: `agent-${index % 8}`,
    smartAccount: "0x1111111111111111111111111111111111111111",
    status: "QUEUED",
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString()
  }));
}

function simulateNonBatched(intents, options) {
  const executed = intents.map((intent, index) => {
    const executedAt = new Date(new Date(intent.createdAt).getTime() + (index + 1) * 1_000);
    return {
      ...intent,
      status: "EXECUTED",
      txHash: `non-batched-${index + 1}`,
      gasUsed: options.nonBatchedGasPerIntent,
      executedAt: executedAt.toISOString(),
      updatedAt: executedAt.toISOString()
    };
  });

  return {
    txCount: intents.length,
    intents: executed,
    batches: [],
    metrics: computeMetrics(executed, [])
  };
}

function simulateBatched(intents, options) {
  const batches = buildBatches(intents, { batchSize: options.batchSize });
  const executedById = new Map();

  batches.forEach((batch, batchIndex) => {
    const gasForBatch = options.batchBaseGas + batch.size * options.batchPerIntentGas;
    const gasPerIntent = Math.floor(gasForBatch / batch.size);
    const executedAt = new Date(new Date(intents[0].createdAt).getTime() + (batchIndex + 1) * 2_000);

    for (const intentId of batch.intentIds) {
      const intent = intents.find((candidate) => candidate.intentId === intentId);
      executedById.set(intentId, {
        ...intent,
        status: "EXECUTED",
        batchId: batch.batchId,
        txHash: `batched-${batch.batchId}`,
        gasUsed: gasPerIntent,
        executedAt: executedAt.toISOString(),
        updatedAt: executedAt.toISOString()
      });
    }
  });

  const executed = intents.map((intent) => executedById.get(intent.intentId));
  const executedBatches = batches.map((batch, index) => ({
    ...batch,
    status: "EXECUTED",
    txHash: `batched-${batch.batchId}`,
    gasUsed: options.batchBaseGas + batch.size * options.batchPerIntentGas,
    executedAt: new Date(new Date(intents[0].createdAt).getTime() + (index + 1) * 2_000).toISOString()
  }));

  return {
    txCount: batches.length,
    intents: executed,
    batches: executedBatches,
    metrics: computeMetrics(executed, executedBatches)
  };
}

function percentSaved(before, after) {
  if (before === 0) {
    return 0;
  }
  return Math.round((before - after) / before * 10_000) / 100;
}
