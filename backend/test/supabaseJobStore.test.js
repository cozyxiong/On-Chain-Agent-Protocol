import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseCoordinatorJobStore } from "../src/coordinator/supabaseJobStore.js";

test("creates and lists coordinator jobs through Supabase storage", async () => {
  const client = createFakeClient();
  const store = createSupabaseCoordinatorJobStore({ client });

  const created = await store.createJobs([
    {
      jobId: "job-1",
      kind: "agent-call",
      batchGroupId: "group-1",
      runAt: "2026-01-01T00:00:00.000Z",
      payload: { intent: { intentType: "transfer" } }
    }
  ]);
  const duplicate = await store.createJobs([{ jobId: "job-1" }]);
  const listed = await store.listJobs();

  assert.equal(created[0].jobId, "job-1");
  assert.equal(created[0].status, "QUEUED");
  assert.equal(duplicate[0].payload.intent.intentType, "transfer");
  assert.equal(listed.length, 1);
  assert.equal(client.upserts.length, 1);
});

test("claims due coordinator jobs through SKIP LOCKED rpc", async () => {
  const client = createFakeClient();
  const store = createSupabaseCoordinatorJobStore({ client });
  await store.createJobs([
    {
      jobId: "job-1",
      kind: "signed-call",
      runAt: "2026-01-01T00:00:00.000Z",
      payload: { call: {} }
    }
  ]);

  const due = await store.dueJobs(new Date("2026-01-01T00:01:00.000Z"));
  const current = await store.getJob("job-1");

  assert.equal(client.rpcs[0].name, "aap_claim_due_coordinator_jobs");
  assert.equal(due.length, 1);
  assert.equal(due[0].status, "EXECUTING");
  assert.equal(due[0].attempts, 1);
  assert.equal(current.status, "EXECUTING");
});

test("updates submitted jobs and returns pending receipt jobs", async () => {
  const client = createFakeClient();
  const store = createSupabaseCoordinatorJobStore({ client });
  await store.createJobs([{ jobId: "job-1", runAt: "2026-01-01T00:00:00.000Z" }]);
  await store.updateJob("job-1", {
    status: "SUBMITTED",
    txHash: "0x" + "a".repeat(64)
  });

  const pending = await store.pendingReceiptJobs();

  assert.equal(pending.length, 1);
  assert.equal(pending[0].txHash, "0x" + "a".repeat(64));
});

function createFakeClient() {
  const rows = new Map();
  const client = {
    upserts: [],
    rpcs: [],

    async upsert(table, inputRows) {
      client.upserts.push({ table, inputRows });
      const items = Array.isArray(inputRows) ? inputRows : [inputRows];
      for (const row of items) {
        rows.set(row.job_id, structuredClone(row));
      }
    },

    async select(table, query = "") {
      assert.equal(table, "aap_coordinator_jobs");
      let selected = [...rows.values()];
      const idMatch = query.match(/job_id=eq\.([^&]+)/);
      if (idMatch) {
        selected = selected.filter((row) => row.job_id === decodeURIComponent(idMatch[1]));
      }
      const inMatch = query.match(/job_id=in\.\(([^)]+)\)/);
      if (inMatch) {
        const ids = inMatch[1].split(",").map((id) => id.replace(/^"|"$/g, ""));
        selected = selected.filter((row) => ids.includes(row.job_id));
      }
      if (query.includes("status=eq.SUBMITTED")) {
        selected = selected.filter((row) => row.status === "SUBMITTED" && row.tx_hash);
      }
      return selected.map((row) => structuredClone(row));
    },

    async rpc(name, body) {
      client.rpcs.push({ name, body });
      if (name !== "aap_claim_due_coordinator_jobs") return [];

      const now = new Date(body.p_now).getTime();
      const claimed = [...rows.values()]
        .filter((row) => ["QUEUED", "RETRY"].includes(row.status))
        .filter((row) => new Date(row.run_at).getTime() <= now)
        .slice(0, body.p_limit ?? 50);

      for (const row of claimed) {
        row.status = "EXECUTING";
        row.attempts += 1;
        row.updated_at = new Date().toISOString();
        row.data = {
          ...row.data,
          status: row.status,
          attempts: row.attempts,
          updatedAt: row.updated_at
        };
        rows.set(row.job_id, row);
      }

      return claimed.map((row) => structuredClone(row));
    }
  };
  return client;
}
