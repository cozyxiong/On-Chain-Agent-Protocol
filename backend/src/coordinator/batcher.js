import crypto from "node:crypto";

export function buildBatches(intents, options = {}) {
  const batchSize = options.batchSize ?? 5;
  const now = options.now ?? new Date();
  const eligible = intents.filter((intent) => isEligible(intent, now));
  const groups = groupBy(eligible, (intent) => intent.intentType);
  const batches = [];

  for (const [intentType, group] of groups.entries()) {
    for (let index = 0; index < group.length; index += batchSize) {
      const chunk = group.slice(index, index + batchSize);
      if (chunk.length === 0) {
        continue;
      }

      const intentIds = chunk.map((intent) => intent.intentId);
      batches.push({
        batchId: createBatchId(intentType, intentIds),
        intentType,
        intentIds,
        size: intentIds.length
      });
    }
  }

  return batches;
}

function isEligible(intent, now) {
  if (intent.status !== "QUEUED") {
    return false;
  }

  if (intent.intentType !== "scheduled") {
    return true;
  }

  if (!intent.runAt) {
    return true;
  }

  return new Date(intent.runAt).getTime() <= now.getTime();
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function createBatchId(intentType, intentIds) {
  return crypto
    .createHash("sha256")
    .update(`${intentType}:${intentIds.join(",")}`)
    .digest("hex")
    .slice(0, 32);
}
