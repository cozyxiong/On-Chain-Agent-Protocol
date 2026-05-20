export function findDueScheduledIntents(intents, options = {}) {
  const now = options.now ?? new Date();
  return intents.filter((intent) => isDueScheduledIntent(intent, now));
}

export function computeNextRunAt(intent, options = {}) {
  const from = options.from ?? new Date();
  if (intent.intentType !== "scheduled" || !intent.intervalSeconds) {
    return null;
  }

  return new Date(from.getTime() + intent.intervalSeconds * 1000).toISOString();
}

export function materializeScheduledIntent(intent, options = {}) {
  const now = options.now ?? new Date();
  const nextRunAt = computeNextRunAt(intent, { from: now });

  return {
    ...intent,
    status: "QUEUED",
    runAt: nextRunAt,
    lastRunAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function isDueScheduledIntent(intent, now) {
  if (intent.intentType !== "scheduled" || intent.status !== "QUEUED") {
    return false;
  }

  if (!intent.runAt) {
    return true;
  }

  return new Date(intent.runAt).getTime() <= now.getTime();
}
