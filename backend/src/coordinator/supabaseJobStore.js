import crypto from "node:crypto";
import { createSupabaseRestClient } from "../storage/supabaseRestClient.js";

export function createSupabaseCoordinatorJobStoreFromEnv(env = process.env) {
  return createSupabaseCoordinatorJobStore({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
  });
}

export function createSupabaseCoordinatorJobStore(options = {}) {
  const client = options.client ?? createSupabaseRestClient(options);
  if (!client) {
    return null;
  }

  return {
    enabled: true,
    storageKind: "supabase-postgres",

    async createJobs(inputJobs) {
      const ids = inputJobs.map((job) => job.jobId).filter(Boolean);
      const existing = ids.length ? await selectExistingJobs(client, ids) : new Map();
      const created = [];
      const rowsToInsert = [];

      for (const job of inputJobs) {
        const jobId = job.jobId ?? crypto.randomUUID();
        const existingJob = existing.get(jobId);
        if (existingJob) {
          created.push(existingJob);
          continue;
        }

        const now = new Date().toISOString();
        const createdJob = {
          jobId,
          kind: job.kind ?? "signed-call",
          batchGroupId: job.batchGroupId ?? jobId,
          status: job.status ?? "QUEUED",
          runAt: job.runAt,
          attempts: job.attempts ?? 0,
          maxAttempts: job.maxAttempts ?? 8,
          txHash: null,
          receipt: null,
          error: null,
          createdAt: now,
          updatedAt: now,
          payload: job.payload
        };
        created.push(structuredClone(createdJob));
        rowsToInsert.push(mapJobToRow(createdJob));
      }

      if (rowsToInsert.length > 0) {
        await client.upsert("aap_coordinator_jobs", rowsToInsert, { onConflict: "job_id" });
      }

      return created;
    },

    async listJobs() {
      const rows = await client.select(
        "aap_coordinator_jobs",
        "?select=*&order=created_at.desc"
      );
      return rows.map(mapRowToJob);
    },

    async getJob(jobId) {
      const rows = await client.select(
        "aap_coordinator_jobs",
        `?select=*&job_id=eq.${encodeURIComponent(jobId)}&limit=1`
      );
      return rows[0] ? mapRowToJob(rows[0]) : null;
    },

    async updateJob(jobId, patch) {
      const current = await this.getJob(jobId);
      if (!current) return null;

      const updated = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString()
      };
      await client.upsert("aap_coordinator_jobs", mapJobToRow(updated), {
        onConflict: "job_id"
      });
      return structuredClone(updated);
    },

    async dueJobs(now = new Date()) {
      // Claiming inside Postgres avoids two worker processes executing the same
      // due job when they poll at the same time.
      const rows = await client.rpc("aap_claim_due_coordinator_jobs", {
        p_now: now.toISOString(),
        p_limit: 50
      });
      return rows.map(mapRowToJob);
    },

    async pendingReceiptJobs() {
      const rows = await client.select(
        "aap_coordinator_jobs",
        "?select=*&status=eq.SUBMITTED&tx_hash=not.is.null&order=updated_at.asc"
      );
      return rows.map(mapRowToJob);
    }
  };
}

async function selectExistingJobs(client, ids) {
  if (ids.length === 0) return new Map();
  const encoded = ids.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",");
  const rows = await client.select("aap_coordinator_jobs", `?select=*&job_id=in.(${encoded})`);
  return new Map(rows.map((row) => {
    const job = mapRowToJob(row);
    return [job.jobId, job];
  }));
}

function mapJobToRow(job) {
  return {
    job_id: job.jobId,
    kind: job.kind ?? null,
    batch_group_id: job.batchGroupId ?? null,
    status: job.status ?? null,
    run_at: job.runAt ?? null,
    attempts: toNumber(job.attempts) ?? 0,
    tx_hash: job.txHash ?? null,
    created_at: job.createdAt ?? new Date().toISOString(),
    updated_at: job.updatedAt ?? job.createdAt ?? new Date().toISOString(),
    data: job
  };
}

function mapRowToJob(row) {
  const data = row.data ?? {};
  return {
    ...data,
    jobId: data.jobId ?? row.job_id,
    kind: data.kind ?? row.kind,
    batchGroupId: data.batchGroupId ?? row.batch_group_id,
    status: data.status ?? row.status,
    runAt: data.runAt ?? row.run_at,
    attempts: toNumber(data.attempts ?? row.attempts) ?? 0,
    maxAttempts: toNumber(data.maxAttempts) ?? 8,
    txHash: data.txHash ?? row.tx_hash ?? null,
    createdAt: data.createdAt ?? row.created_at,
    updatedAt: data.updatedAt ?? row.updated_at
  };
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
