import assert from "node:assert/strict";
import test from "node:test";
import { runFoundryGasBenchmark } from "../src/benchmark/foundryGasBenchmark.js";

test("parses Foundry gas benchmark output", async () => {
  const benchmark = await runFoundryGasBenchmark({
    output: JSON.stringify({
      "test/AgentGasBenchmark.t.sol:AgentGasBenchmarkTest": {
        test_results: {
          "testBenchmarkNonBatchedAgentTransfers()": {
            kind: { Unit: { gas: 95000 } }
          },
          "testBenchmarkBatchedAgentTransfers()": {
            kind: { Unit: { gas: 69000 } }
          }
        }
      }
    })
  });

  assert.equal(benchmark.source, "foundry-local-evm");
  assert.equal(benchmark.intentCount, 5);
  assert.equal(benchmark.nonBatched.txCount, 5);
  assert.equal(benchmark.batched.txCount, 1);
  assert.equal(benchmark.summary.gasSaved, 110000);
  assert.equal(benchmark.summary.gasSavedPercent, 55);
});
