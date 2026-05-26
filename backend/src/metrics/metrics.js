export function computeMetrics(intents, batches, coordinatorJobs = [], executionPlans = []) {
  const executed = intents.filter((intent) => intent.status === "EXECUTED");
  const failed = intents.filter((intent) => intent.status === "FAILED");
  const latencies = executed
    .map((intent) => diffMs(intent.createdAt, intent.executedAt ?? intent.updatedAt))
    .filter((latency) => latency >= 0);
  const gasValues = executed.map((intent) => intent.gasUsed).filter((gas) => Number.isFinite(gas));

  return {
    totalIntents: intents.length,
    queuedIntents: intents.filter((intent) => intent.status === "QUEUED").length,
    batchedIntents: intents.filter((intent) => intent.status === "BATCHED").length,
    executedIntents: executed.length,
    failedIntents: failed.length,
    failureRate: intents.length === 0 ? 0 : failed.length / intents.length,
    totalBatches: batches.length,
    averageBatchSize: average(batches.map((batch) => batch.size)),
    averageLatencyMs: average(latencies),
    totalGasUsed: gasValues.reduce((sum, gas) => sum + gas, 0),
    averageGasPerIntent: average(gasValues),
    estimatedNonBatchedGas: intents.length * 77_000,
    estimatedBatchGas: batches.reduce((sum, batch) => sum + 45_000 + batch.size * 32_000, 0),
    coordinator: computeCoordinatorMetrics(coordinatorJobs),
    aggregation: computeAggregationMetrics(executionPlans)
  };
}

export function computeAggregationMetrics(plans) {
  const latestPlan = [...plans].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  )[0];
  const totals = plans.reduce(
    (sum, plan) => ({
      matchedPairs: sum.matchedPairs + Number(plan.matchedPairs?.length ?? 0),
      matchedVolumeUsd: sum.matchedVolumeUsd + Number(plan.matchedVolumeUsd ?? 0),
      externalRoutedVolumeUsd:
        sum.externalRoutedVolumeUsd + Number(plan.externalRoutedVolumeUsd ?? 0)
    }),
    { matchedPairs: 0, matchedVolumeUsd: 0, externalRoutedVolumeUsd: 0 }
  );

  return {
    totalPlans: plans.length,
    latestPlanId: latestPlan?.planId ?? null,
    latestPlanType: latestPlan?.planType ?? null,
    latestMatchRate: Number(latestPlan?.matchRate ?? 0),
    latestMatchedPairs: Number(latestPlan?.matchedPairs?.length ?? 0),
    latestMatchedVolumeUsd: Number(latestPlan?.matchedVolumeUsd ?? 0),
    latestExternalRoutedVolumeUsd: Number(latestPlan?.externalRoutedVolumeUsd ?? 0),
    totalMatchedPairs: totals.matchedPairs,
    totalMatchedVolumeUsd: totals.matchedVolumeUsd,
    totalExternalRoutedVolumeUsd: totals.externalRoutedVolumeUsd
  };
}

export function computeCoordinatorMetrics(jobs) {
  const totalJobs = jobs.length;
  const statusCounts = countBy(jobs, (job) => normalizeStatus(job.status));
  const terminal = jobs.filter((job) => ["SUCCESS", "FAILED"].includes(normalizeStatus(job.status)));
  const successful = jobs.filter((job) => normalizeStatus(job.status) === "SUCCESS");
  const failed = jobs.filter((job) => normalizeStatus(job.status) === "FAILED");
  const submitted = jobs.filter((job) => job.txHash);
  const txGroups = groupBy(submitted, (job) => job.txHash);
  const batchTransactions = [...txGroups.entries()].map(([txHash, txJobs]) => {
    const receipt = txJobs.find((job) => job.receipt)?.receipt ?? null;
    const gasUsed = parseGas(receipt?.gasUsed);
    const runTimes = txJobs.map((job) => new Date(job.runAt).getTime()).filter(Number.isFinite);
    const submittedTimes = txJobs.map((job) => new Date(job.submittedAt ?? job.updatedAt).getTime()).filter(Number.isFinite);

    return {
      txHash,
      size: txJobs.length,
      status: summarizeBatchStatus(txJobs),
      gasUsed,
      estimatedNonBatchedGas: txJobs.length * 120_000,
      latencyMs:
        runTimes.length && submittedTimes.length
          ? Math.max(...submittedTimes) - Math.min(...runTimes)
          : 0,
      jobIds: txJobs.map((job) => job.jobId)
    };
  });

  const confirmedTxs = batchTransactions.filter((tx) => tx.gasUsed > 0);
  const actualBatchGas = confirmedTxs.reduce((sum, tx) => sum + tx.gasUsed, 0);
  const submittedJobsWithReceipts = confirmedTxs.reduce((sum, tx) => sum + tx.size, 0);
  const estimatedNonBatchedGas = submittedJobsWithReceipts * 120_000;
  const estimatedGasSaved = Math.max(0, estimatedNonBatchedGas - actualBatchGas);
  const latencyValues = successful
    .map((job) => diffMs(job.runAt ?? job.createdAt, job.confirmedAt ?? job.submittedAt ?? job.updatedAt))
    .filter((latency) => latency >= 0);
  const throughputWindowMs = computeThroughputWindowMs(successful);

  return {
    totalJobs,
    queuedJobs: statusCounts.QUEUED ?? 0,
    retryJobs: statusCounts.RETRY ?? 0,
    executingJobs: statusCounts.EXECUTING ?? 0,
    submittedJobs: statusCounts.SUBMITTED ?? 0,
    successfulJobs: successful.length,
    failedJobs: failed.length,
    failureRate: terminal.length === 0 ? 0 : failed.length / terminal.length,
    totalBatchTransactions: batchTransactions.length,
    averageBatchSize: average(batchTransactions.map((tx) => tx.size)),
    throughputPerMinute:
      throughputWindowMs > 0 ? successful.length / (throughputWindowMs / 60_000) : successful.length,
    averageLatencyMs: average(latencyValues),
    estimatedNonBatchedGas,
    actualBatchGas,
    estimatedGasSaved,
    estimatedGasSavedPercent:
      estimatedNonBatchedGas === 0 ? 0 : estimatedGasSaved / estimatedNonBatchedGas,
    batchTransactions: batchTransactions
      .sort((a, b) => b.size - a.size)
      .slice(0, 12)
  };
}

function diffMs(start, end) {
  return new Date(end).getTime() - new Date(start).getTime();
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeStatus(status) {
  return String(status ?? "QUEUED").toUpperCase();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function parseGas(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value);
  if (text.startsWith("0x")) return Number.parseInt(text, 16);
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeBatchStatus(jobs) {
  const statuses = jobs.map((job) => normalizeStatus(job.status));
  if (statuses.every((status) => status === "SUCCESS")) return "SUCCESS";
  if (statuses.some((status) => status === "FAILED")) return "FAILED";
  if (statuses.some((status) => status === "SUBMITTED")) return "SUBMITTED";
  return statuses[0] ?? "QUEUED";
}

function computeThroughputWindowMs(jobs) {
  const times = jobs
    .flatMap((job) => [job.createdAt, job.confirmedAt ?? job.submittedAt])
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (times.length < 2) return 0;
  return Math.max(...times) - Math.min(...times);
}
