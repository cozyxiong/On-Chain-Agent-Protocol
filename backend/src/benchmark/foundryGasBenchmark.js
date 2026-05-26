import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const DEFAULT_FORGE = process.env.FORGE_BIN ?? `${process.env.HOME}/.foundry/bin/forge`;
const BENCHMARKS = {
  "testBenchmarkNonBatchedAgentTransfers()": {
    name: "non-batched-agent-transfers",
    intentCount: 5,
    txCount: 5
  },
  "testBenchmarkBatchedAgentTransfers()": {
    name: "batched-agent-transfers",
    intentCount: 5,
    txCount: 1
  }
};
const TX_INTRINSIC_GAS = 21_000;

export async function runFoundryGasBenchmark(options = {}) {
  const forgeBin = options.forgeBin ?? DEFAULT_FORGE;
  const output =
    options.output ??
    (await execFileText(
      forgeBin,
      ["test", "--match-contract", "AgentGasBenchmarkTest", "--json"],
      {
        cwd: options.cwd ?? repoRoot
      }
    ));
  const payload = JSON.parse(output);
  const results = extractBenchmarkResults(payload);
  const nonBatched = results.find((result) => result.name === "non-batched-agent-transfers");
  const batched = results.find((result) => result.name === "batched-agent-transfers");

  if (!nonBatched || !batched) {
    throw new Error("Foundry benchmark output did not include both benchmark tests");
  }

  return {
    source: "foundry-local-evm",
    command: `${forgeBin} test --match-contract AgentGasBenchmarkTest --json`,
    generatedAt: new Date().toISOString(),
    intentCount: nonBatched.intentCount,
    nonBatched,
    batched,
    summary: {
      intentCount: nonBatched.intentCount,
      nonBatchedTxCount: nonBatched.txCount,
      batchedTxCount: batched.txCount,
      nonBatchedGas: nonBatched.totalGas,
      batchedGas: batched.totalGas,
      gasSaved: nonBatched.totalGas - batched.totalGas,
      gasSavedPercent: percentSaved(nonBatched.totalGas, batched.totalGas),
      txReductionPercent: percentSaved(nonBatched.txCount, batched.txCount),
      nonBatchedThroughputIntentsPerTx: nonBatched.intentCount / nonBatched.txCount,
      batchedThroughputIntentsPerTx: batched.intentCount / batched.txCount
    }
  };
}

export function extractBenchmarkResults(payload) {
  return Object.values(payload).flatMap((suite) =>
    Object.entries(suite.test_results ?? {})
      .filter(([testName]) => BENCHMARKS[testName])
      .map(([testName, testResult]) => normalizeBenchmarkTest(testName, testResult))
  );
}

function normalizeBenchmarkTest(testName, testResult) {
  const benchmark = BENCHMARKS[testName];
  const executionGas = Number(testResult.kind?.Unit?.gas);
  const txEnvelopeGas = benchmark.txCount * TX_INTRINSIC_GAS;

  if (!Number.isFinite(executionGas)) {
    throw new Error(`Foundry benchmark ${testName} did not include unit gas`);
  }

  return {
    name: benchmark.name,
    intentCount: benchmark.intentCount,
    txCount: benchmark.txCount,
    executionGas,
    txEnvelopeGas,
    totalGas: executionGas + txEnvelopeGas
  };
}

function execFileText(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function percentSaved(before, after) {
  if (before === 0) {
    return 0;
  }
  return Math.round((before - after) / before * 10_000) / 100;
}
