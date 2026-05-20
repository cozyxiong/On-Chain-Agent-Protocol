import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_PATH = path.resolve(process.cwd(), "data/coordinator-jobs.json");

export function createCoordinatorJobStore(options = {}) {
  const filePath = options.filePath ?? DEFAULT_PATH;
  let jobs = loadJobs(filePath);

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify([...jobs.values()], null, 2));
  }

  return {
    createJobs(inputJobs) {
      const created = [];
      for (const job of inputJobs) {
        const jobId = job.jobId ?? cryptoRandomId();
        const existing = jobs.get(jobId);
        if (existing) {
          created.push(structuredClone(existing));
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
        jobs.set(jobId, createdJob);
        created.push(structuredClone(createdJob));
      }
      persist();
      return created;
    },

    listJobs() {
      return [...jobs.values()].map((job) => structuredClone(job));
    },

    getJob(jobId) {
      const job = jobs.get(jobId);
      return job ? structuredClone(job) : null;
    },

    updateJob(jobId, patch) {
      const current = jobs.get(jobId);
      if (!current) return null;
      const updated = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString()
      };
      jobs.set(jobId, updated);
      persist();
      return structuredClone(updated);
    },

    dueJobs(now = new Date()) {
      return [...jobs.values()]
        .filter((job) => job.status === "QUEUED" || job.status === "RETRY")
        .filter((job) => new Date(job.runAt).getTime() <= now.getTime())
        .map((job) => structuredClone(job));
    },

    pendingReceiptJobs() {
      return [...jobs.values()]
        .filter((job) => job.status === "SUBMITTED" && job.txHash)
        .map((job) => structuredClone(job));
    }
  };
}

function loadJobs(filePath) {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return new Map(parsed.map((job) => [job.jobId, job]));
}

function cryptoRandomId() {
  return crypto.randomUUID();
}
