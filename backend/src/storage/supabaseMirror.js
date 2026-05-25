import { createSupabaseRestClient } from "./supabaseRestClient.js";

export function createSupabaseMirrorFromEnv(env = process.env) {
  return createSupabaseMirror({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
  });
}

export function createSupabaseMirror(options = {}) {
  const client = options.client ?? createSupabaseRestClient(options);
  const enabled = Boolean(client);

  async function recordIntent(intent) {
    if (!enabled || !intent) return;
    await client.upsert("aap_intents", mapIntent(intent), { onConflict: "intent_id" });
  }

  async function recordBatch(batch) {
    if (!enabled || !batch) return;
    await client.upsert("aap_batches", mapBatch(batch), { onConflict: "batch_id" });
  }

  async function recordJob(job) {
    if (!enabled || !job) return;
    await client.upsert("aap_coordinator_jobs", mapJob(job), { onConflict: "job_id" });
  }

  async function recordJobs(jobs) {
    if (!enabled || !jobs?.length) return;
    await client.upsert("aap_coordinator_jobs", jobs.map(mapJob), { onConflict: "job_id" });
  }

  return {
    enabled,
    recordIntent,
    recordBatch,
    recordJob,
    recordJobs
  };
}

export function mirrorWrite(promise) {
  Promise.resolve(promise).catch((error) => {
    console.warn(`Supabase mirror write failed: ${error.message}`);
  });
}

function mapIntent(intent) {
  return {
    intent_id: intent.intentId,
    user_id: intent.userId ?? null,
    agent_id: intent.agentId ?? null,
    smart_account: intent.smartAccount ?? null,
    intent_type: intent.intentType ?? null,
    status: intent.status ?? null,
    tx_hash: intent.txHash ?? null,
    gas_used: toNumberOrNull(intent.gasUsed),
    created_at: intent.createdAt ?? new Date().toISOString(),
    updated_at: intent.updatedAt ?? intent.createdAt ?? new Date().toISOString(),
    data: intent
  };
}

function mapBatch(batch) {
  return {
    batch_id: batch.batchId,
    status: batch.status ?? null,
    size: batch.size ?? batch.intentIds?.length ?? 0,
    tx_hash: batch.txHash ?? null,
    gas_used: toNumberOrNull(batch.gasUsed),
    created_at: batch.createdAt ?? new Date().toISOString(),
    updated_at: batch.updatedAt ?? batch.createdAt ?? new Date().toISOString(),
    data: batch
  };
}

function mapJob(job) {
  return {
    job_id: job.jobId,
    kind: job.kind ?? null,
    batch_group_id: job.batchGroupId ?? null,
    status: job.status ?? null,
    run_at: job.runAt ?? null,
    attempts: toNumberOrNull(job.attempts) ?? 0,
    tx_hash: job.txHash ?? null,
    created_at: job.createdAt ?? new Date().toISOString(),
    updated_at: job.updatedAt ?? job.createdAt ?? new Date().toISOString(),
    data: job
  };
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
