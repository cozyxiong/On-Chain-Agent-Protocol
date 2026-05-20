import assert from "node:assert/strict";
import test from "node:test";
import { computeMetrics } from "../src/metrics/metrics.js";

test("computes execution and gas metrics", () => {
  const intents = [
    {
      intentId: "a",
      status: "EXECUTED",
      createdAt: "2026-01-01T00:00:00.000Z",
      executedAt: "2026-01-01T00:00:01.000Z",
      gasUsed: 32000
    },
    {
      intentId: "b",
      status: "FAILED",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:02.000Z"
    }
  ];

  const metrics = computeMetrics(intents, [{ batchId: "batch", size: 2 }]);

  assert.equal(metrics.totalIntents, 2);
  assert.equal(metrics.executedIntents, 1);
  assert.equal(metrics.failedIntents, 1);
  assert.equal(metrics.failureRate, 0.5);
  assert.equal(metrics.averageLatencyMs, 1000);
  assert.equal(metrics.averageGasPerIntent, 32000);
  assert.equal(metrics.coordinator.totalJobs, 0);
});

test("computes coordinator batching metrics from signed jobs", () => {
  const jobs = [
    {
      jobId: "job-a",
      status: "SUCCESS",
      runAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      submittedAt: "2026-01-01T00:00:08.000Z",
      confirmedAt: "2026-01-01T00:00:12.000Z",
      txHash: "0xaaa",
      receipt: { gasUsed: "0x30d40", status: "0x1" }
    },
    {
      jobId: "job-b",
      status: "SUCCESS",
      runAt: "2026-01-01T00:00:03.000Z",
      createdAt: "2026-01-01T00:00:01.000Z",
      submittedAt: "2026-01-01T00:00:08.000Z",
      confirmedAt: "2026-01-01T00:00:12.000Z",
      txHash: "0xaaa",
      receipt: { gasUsed: "0x30d40", status: "0x1" }
    },
    {
      jobId: "job-c",
      status: "FAILED",
      runAt: "2026-01-01T00:01:00.000Z",
      createdAt: "2026-01-01T00:00:50.000Z",
      updatedAt: "2026-01-01T00:01:10.000Z"
    }
  ];

  const metrics = computeMetrics([], [], jobs).coordinator;

  assert.equal(metrics.totalJobs, 3);
  assert.equal(metrics.successfulJobs, 2);
  assert.equal(metrics.failedJobs, 1);
  assert.equal(metrics.failureRate, 1 / 3);
  assert.equal(metrics.totalBatchTransactions, 1);
  assert.equal(metrics.averageBatchSize, 2);
  assert.equal(metrics.actualBatchGas, 200000);
  assert.equal(metrics.estimatedNonBatchedGas, 240000);
  assert.equal(metrics.estimatedGasSaved, 40000);
});
