import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseMirror } from "../src/storage/supabaseMirror.js";

test("mirrors intents, batches, and coordinator jobs to Supabase tables", async () => {
  const writes = [];
  const mirror = createSupabaseMirror({
    client: {
      async upsert(table, rows, options) {
        writes.push({ table, rows, options });
      }
    }
  });

  await mirror.recordIntent({
    intentId: "intent-1",
    userId: "user-1",
    agentId: "agent-1",
    smartAccount: "0x1111111111111111111111111111111111111111",
    intentType: "transfer",
    status: "QUEUED",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z"
  });
  await mirror.recordBatch({
    batchId: "batch-1",
    intentIds: ["intent-1", "intent-2"],
    status: "READY",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z"
  });
  await mirror.recordJob({
    jobId: "job-1",
    kind: "agent-call",
    batchGroupId: "group-1",
    status: "QUEUED",
    runAt: "2026-05-25T00:01:00.000Z",
    attempts: 0,
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z"
  });

  assert.equal(writes.length, 3);
  assert.equal(writes[0].table, "aap_intents");
  assert.equal(writes[0].rows.intent_id, "intent-1");
  assert.equal(writes[0].options.onConflict, "intent_id");
  assert.equal(writes[1].table, "aap_batches");
  assert.equal(writes[1].rows.size, 2);
  assert.equal(writes[2].table, "aap_coordinator_jobs");
  assert.equal(writes[2].rows.job_id, "job-1");
});
