import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { createCoordinatorJobStore } from "../src/coordinator/jobStore.js";
import { createCoordinatorWorker } from "../src/coordinator/worker.js";

test("coordinator worker batches due signed jobs", async () => {
  const store = createCoordinatorJobStore({ filePath: tempPath("batch") });
  store.createJobs([
    signedJob("job-1", "batch-1"),
    signedJob("job-2", "batch-1")
  ]);

  const calls = [];
  const worker = createCoordinatorWorker({
    store,
    getReceipt: async () => null,
    settlement: {
      async executeBatchSignedCalls(input) {
        calls.push(input);
        return { primaryTxHash: "0x" + "a".repeat(64) };
      }
    }
  });

  await worker.tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].calls.length, 2);
  assert.equal(store.getJob("job-1").status, "SUBMITTED");
  assert.equal(store.getJob("job-2").txHash, "0x" + "a".repeat(64));
});

test("coordinator worker retries failed jobs", async () => {
  const store = createCoordinatorJobStore({ filePath: tempPath("retry") });
  store.createJobs([signedJob("job-3", "batch-2")]);

  const worker = createCoordinatorWorker({
    store,
    getReceipt: async () => null,
    settlement: {
      async executeSignedCall() {
        throw new Error("temporary relayer failure");
      }
    }
  });

  await worker.tick();

  const job = store.getJob("job-3");
  assert.equal(job.status, "RETRY");
  assert.equal(job.attempts, 1);
  assert.match(job.error, /temporary relayer failure/);
});

test("coordinator worker executes due agent jobs as smart-account batch", async () => {
  const store = createCoordinatorJobStore({ filePath: tempPath("agent-batch") });
  store.createJobs([
    agentJob("agent-job-1", "agent-batch-1", transferIntent("0.0001")),
    agentJob("agent-job-2", "agent-batch-1", transferIntent("0.0002"))
  ]);

  const calls = [];
  const worker = createCoordinatorWorker({
    store,
    getReceipt: async () => null,
    settlement: {},
    agentExecutor: {
      async executeBatchAgentIntents(input) {
        calls.push(input);
        return { primaryTxHash: "0x" + "b".repeat(64) };
      }
    }
  });

  await worker.tick();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].intents.length, 2);
  assert.equal(calls[0].smartAccount, "0x1111111111111111111111111111111111111111");
  assert.equal(calls[0].agent, "0x2222222222222222222222222222222222222222");
  assert.equal(store.getJob("agent-job-1").status, "SUBMITTED");
  assert.equal(store.getJob("agent-job-2").txHash, "0x" + "b".repeat(64));
});

function signedJob(jobId, batchGroupId) {
  return {
    jobId,
    kind: "signed-call",
    batchGroupId,
    runAt: new Date(Date.now() - 1000).toISOString(),
    payload: {
      call: { owner: "0xowner" },
      executionData: "0x",
      signature: "0xsig"
    }
  };
}

function agentJob(jobId, batchGroupId, intent) {
  return {
    jobId,
    kind: "agent-call",
    batchGroupId,
    runAt: new Date(Date.now() - 1000).toISOString(),
    payload: {
      smartAccount: "0x1111111111111111111111111111111111111111",
      agent: "0x2222222222222222222222222222222222222222",
      intent
    }
  };
}

function transferIntent(amount) {
  return {
    intentType: "transfer",
    token: "ETH",
    amount,
    recipient: "0x3333333333333333333333333333333333333333"
  };
}

function tempPath(label) {
  return `./data/aap-worker-${label}-${crypto.randomUUID()}.json`;
}
