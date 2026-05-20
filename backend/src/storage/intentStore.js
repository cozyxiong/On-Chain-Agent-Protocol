export function createIntentStore() {
  const intents = new Map();
  const batches = new Map();

  return {
    createIntent(intent) {
      if (intents.has(intent.intentId)) {
        const error = new Error("Intent already exists");
        error.statusCode = 409;
        throw error;
      }

      intents.set(intent.intentId, structuredClone(intent));
      return structuredClone(intent);
    },

    listIntents() {
      return [...intents.values()].map((intent) => structuredClone(intent));
    },

    updateIntent(intentId, patch) {
      const current = intents.get(intentId);
      if (!current) {
        const error = new Error("Intent not found");
        error.statusCode = 404;
        throw error;
      }

      const updated = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString()
      };
      intents.set(intentId, updated);
      return structuredClone(updated);
    },

    createBatch(batch) {
      if (batches.has(batch.batchId)) {
        return structuredClone(batches.get(batch.batchId));
      }

      const created = {
        ...batch,
        status: "READY",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        executedAt: null,
        txHash: null
      };

      for (const intentId of created.intentIds) {
        const intent = intents.get(intentId);
        if (intent?.status === "QUEUED") {
          intents.set(intentId, {
            ...intent,
            status: "BATCHED",
            batchId: created.batchId,
            updatedAt: new Date().toISOString()
          });
        }
      }

      batches.set(created.batchId, created);
      return structuredClone(created);
    },

    listBatches() {
      return [...batches.values()].map((batch) => structuredClone(batch));
    },

    markBatchExecuted(batchId, result = {}) {
      const batch = batches.get(batchId);
      if (!batch) {
        const error = new Error("Batch not found");
        error.statusCode = 404;
        throw error;
      }

      const now = new Date().toISOString();
      const updatedBatch = {
        ...batch,
        status: "EXECUTED",
        executedAt: now,
        updatedAt: now,
        txHash: result.txHash ?? `simulated-${batchId}`,
        gasUsed: result.gasUsed ?? estimateGas(batch.intentIds.length)
      };

      for (const intentId of batch.intentIds) {
        const intent = intents.get(intentId);
        if (intent) {
          intents.set(intentId, {
            ...intent,
            status: "EXECUTED",
            txHash: updatedBatch.txHash,
            gasUsed: Math.floor(updatedBatch.gasUsed / batch.intentIds.length),
            updatedAt: now,
            executedAt: now
          });
        }
      }

      batches.set(batchId, updatedBatch);
      return structuredClone(updatedBatch);
    },

    markLatestIntentExecuted(result = {}) {
      const latestQueued = [...intents.values()]
        .filter((intent) => intent.status === "QUEUED" || intent.status === "BATCHED")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      if (!latestQueued) {
        return null;
      }

      const now = new Date().toISOString();
      const updated = {
        ...latestQueued,
        status: "EXECUTED",
        txHash: result.txHash ?? latestQueued.txHash,
        executedAt: now,
        updatedAt: now,
        gasUsed: result.gasUsed ?? latestQueued.gasUsed
      };

      intents.set(updated.intentId, updated);
      return structuredClone(updated);
    }
  };
}

function estimateGas(intentCount) {
  return 45_000 + intentCount * 32_000;
}
