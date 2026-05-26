export function createCoordinatorWorker(options) {
  const store = options.store;
  const settlement = options.settlement;
  const agentExecutor = options.agentExecutor;
  const getReceipt = options.getReceipt;
  const intervalMs = options.intervalMs ?? 10_000;
  const dueGraceMs = options.dueGraceMs ?? 0;
  let running = false;

  async function tick() {
    if (running) return { skipped: true };
    running = true;
    const summary = {
      submittedBatches: 0,
      submittedJobs: 0,
      confirmedJobs: 0,
      failedJobs: 0
    };

    try {
      await confirmPendingReceipts(summary);
      await executeDueJobs(summary);
      return summary;
    } finally {
      running = false;
    }
  }

  async function confirmPendingReceipts(summary) {
    for (const job of store.pendingReceiptJobs()) {
      const receipt = await getReceipt(job.txHash);
      if (!receipt) continue;

      const status = receipt.status === "0x1" ? "SUCCESS" : "FAILED";
      store.updateJob(job.jobId, {
        status,
        receipt: summarizeReceipt(receipt),
        confirmedAt: new Date().toISOString()
      });
      if (status === "SUCCESS") summary.confirmedJobs += 1;
      else summary.failedJobs += 1;
    }
  }

  async function executeDueJobs(summary) {
    const due = store.dueJobs(new Date(Date.now() - dueGraceMs));
    const groups = groupBy(due, (job) => job.batchGroupId ?? job.jobId);

    for (const jobs of groups.values()) {
      await executeSignedJobs(jobs, summary);
      await executeAgentJobs(jobs, summary);
    }
  }

  async function executeSignedJobs(jobs, summary) {
    const executable = jobs.filter((job) => job.kind === "signed-call" && job.payload);
    if (!executable.length) return;
    await executeJobSet(executable, summary, async () =>
      executable.length > 1
        ? settlement.executeBatchSignedCalls({
            calls: executable.map((job) => job.payload.call),
            executionData: executable.map((job) => job.payload.executionData),
            signatures: executable.map((job) => job.payload.signature)
          })
        : settlement.executeSignedCall({
            signedCall: executable[0].payload.call,
            executionData: executable[0].payload.executionData,
            signature: executable[0].payload.signature
          })
    );
  }

  async function executeAgentJobs(jobs, summary) {
    const executable = jobs.filter((job) => job.kind === "agent-call" && job.payload);
    if (!executable.length) return;
    if (!agentExecutor) {
      await failJobSet(executable, summary, new Error("Agent executor is not configured"));
      return;
    }

    const { compatibleGroups, invalidJobs } = groupCompatibleAgentJobs(executable);
    if (invalidJobs.length > 0) {
      await failJobSet(
        invalidJobs,
        summary,
        new Error("Agent jobs require valid smartAccount and agent addresses")
      );
    }

    for (const compatible of compatibleGroups) {
      await executeJobSet(compatible, summary, async () =>
        compatible.length > 1
          ? agentExecutor.executeBatchAgentIntents({
              smartAccount: compatible[0].payload.smartAccount,
              agent: compatible[0].payload.agent,
              intents: compatible.map((job) => job.payload.intent)
            })
          : agentExecutor.executeAgentIntent({
              smartAccount: compatible[0].payload.smartAccount,
              agent: compatible[0].payload.agent,
              intent: compatible[0].payload.intent
            })
      );
    }
  }

  async function executeJobSet(executable, summary, execute) {
    for (const job of executable) {
      store.updateJob(job.jobId, {
        status: "EXECUTING",
        attempts: job.attempts + 1,
        lastAttemptAt: new Date().toISOString()
      });
    }

    try {
      const result = await execute();
      for (const job of executable) {
        store.updateJob(job.jobId, {
          status: "SUBMITTED",
          txHash: result.primaryTxHash,
          submittedAt: new Date().toISOString(),
          error: null
        });
        summary.submittedJobs += 1;
      }
      summary.submittedBatches += 1;
    } catch (error) {
      await failJobSet(executable, summary, error);
    }
  }

  async function failJobSet(executable, summary, error) {
    for (const job of executable) {
      const attempts = job.attempts + 1;
      store.updateJob(job.jobId, {
        status: attempts >= job.maxAttempts ? "FAILED" : "RETRY",
        attempts,
        error: error.message
      });
      if (attempts >= job.maxAttempts) summary.failedJobs += 1;
    }
  }

  function start() {
    const timer = setInterval(() => {
      tick().catch(() => {});
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  return { start, tick };
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

function groupCompatibleAgentJobs(jobs) {
  const groups = new Map();
  const invalidJobs = [];

  for (const job of jobs) {
    const smartAccount = job.payload?.smartAccount;
    const agent = job.payload?.agent;

    if (!isAddress(smartAccount) || !isAddress(agent)) {
      invalidJobs.push(job);
      continue;
    }

    // batchGroupId is a scheduling hint. Execution batching still has to respect
    // the smart-account permission boundary enforced by AgentSmartAccount.
    const key = [
      smartAccount.toLowerCase(),
      agent.toLowerCase(),
      String(job.payload?.chainId ?? "")
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(job);
    groups.set(key, group);
  }

  return {
    compatibleGroups: [...groups.values()],
    invalidJobs
  };
}

function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value ?? ""));
}

function summarizeReceipt(receipt) {
  return {
    transactionHash: receipt.transactionHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed
  };
}
