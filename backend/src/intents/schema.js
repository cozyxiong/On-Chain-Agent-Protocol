import crypto from "node:crypto";

export const INTENT_TYPES = Object.freeze(["transfer", "swap", "rebalance", "scheduled"]);
export const INTENT_STATUSES = Object.freeze([
  "QUEUED",
  "BATCHED",
  "EXECUTED",
  "FAILED",
  "CANCELLED",
  "EXPIRED"
]);

export function validateIntentInput(input) {
  assertObject(input, "Intent payload must be an object");

  const intentType = requiredString(input.intentType, "intentType").toLowerCase();
  if (!INTENT_TYPES.includes(intentType)) {
    badRequest(`Unsupported intentType: ${intentType}`);
  }

  const base = {
    intentId: optionalString(input.intentId) ?? crypto.randomUUID(),
    intentType,
    userId: requiredString(input.userId, "userId"),
    agentId: requiredString(input.agentId, "agentId"),
    smartAccount: requiredAddressLike(input.smartAccount, "smartAccount"),
    status: "QUEUED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    txHash: null,
    gasUsed: null,
    failureReason: null
  };

  if (intentType === "transfer") {
    return {
      ...base,
      token: requiredString(input.token, "token"),
      amount: requiredPositiveAmount(input.amount, "amount"),
      recipient: requiredAddressLike(input.recipient, "recipient")
    };
  }

  if (intentType === "swap") {
    return {
      ...base,
      tokenIn: requiredString(input.tokenIn, "tokenIn"),
      tokenOut: requiredString(input.tokenOut, "tokenOut"),
      amountIn: requiredPositiveAmount(input.amountIn, "amountIn"),
      slippageBps: optionalInteger(input.slippageBps, 50),
      deadlineMinutes: optionalInteger(input.deadlineMinutes, 20)
    };
  }

  if (intentType === "rebalance") {
    assertObject(input.targetAllocation, "targetAllocation must be an object");
    return {
      ...base,
      portfolioId: requiredString(input.portfolioId, "portfolioId"),
      targetAllocation: normalizeAllocation(input.targetAllocation),
      thresholdBps: optionalInteger(input.thresholdBps, 100)
    };
  }

  return {
    ...base,
    taskType: requiredString(input.taskType, "taskType"),
    runAt: optionalIsoDate(input.runAt),
    intervalSeconds: optionalInteger(input.intervalSeconds, null),
    payload: assertObject(input.payload ?? {}, "payload must be an object")
  };
}

function normalizeAllocation(allocation) {
  const entries = Object.entries(allocation);
  if (entries.length === 0) {
    badRequest("targetAllocation cannot be empty");
  }

  let total = 0;
  const normalized = {};

  for (const [symbol, value] of entries) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      badRequest(`Invalid allocation for ${symbol}`);
    }

    total += numericValue;
    normalized[symbol] = numericValue;
  }

  if (Math.abs(total - 100) > 0.000001) {
    badRequest("targetAllocation must sum to 100");
  }

  return normalized;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    badRequest(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    badRequest("Optional string field must be a string");
  }
  return value;
}

function requiredAddressLike(value, field) {
  const address = requiredString(value, field);
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    badRequest(`${field} must be an EVM address`);
  }
  return address;
}

function requiredPositiveAmount(value, field) {
  const amount = requiredString(String(value ?? ""), field);
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) {
    badRequest(`${field} must be a positive decimal amount`);
  }
  return amount;
}

function optionalInteger(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    badRequest("Optional integer field must be a non-negative integer");
  }
  return parsed;
}

function optionalIsoDate(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    badRequest("runAt must be a valid date");
  }
  return date.toISOString();
}

function assertObject(value, message) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    badRequest(message);
  }
  return value;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
