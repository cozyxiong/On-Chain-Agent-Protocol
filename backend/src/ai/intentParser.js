import { validateIntentInput } from "../intents/schema.js";
import { buildIntentParserUserPrompt } from "./prompts.js";
import { createOpenAIClient } from "./openaiClient.js";

export function createIntentParser(options = {}) {
  const aiClient = options.aiClient ?? createOpenAIClient(options.openAI ?? {});

  return {
    async parse(message, context = {}) {
      if (typeof message !== "string" || message.trim() === "") {
        const error = new Error("message is required");
        error.statusCode = 400;
        throw error;
      }

      const proposal = await aiClient.parseIntent(
        buildIntentParserUserPrompt({ message: message.trim(), context })
      );

      const normalizedInput = normalizeProposal(proposal, context, message.trim());
      const validation = validateProposal(normalizedInput, proposal);

      return {
        proposal,
        valid: validation.valid,
        intent: validation.intent,
        errors: validation.errors
      };
    }
  };
}

function normalizeProposal(proposal, context, message) {
  const intent = proposal.intent ?? {};
  const inferredRunAt =
    proposal.intentType === "scheduled" && !intent.runAt
      ? inferRunAtFromMessage(message, context)
      : null;

  if (inferredRunAt) {
    intent.runAt = inferredRunAt;
    proposal.missingFields = (proposal.missingFields ?? []).filter(
      (field) => !["runAt", "timezone"].includes(field)
    );
  } else if (context.timezone) {
    proposal.missingFields = (proposal.missingFields ?? []).filter((field) => field !== "timezone");
  }

  return pruneNullish({
    ...intent,
    intentType: proposal.intentType,
    userId: intent.userId ?? context.userId,
    agentId: intent.agentId ?? context.agentId,
    smartAccount: intent.smartAccount ?? context.smartAccount,
    payload: proposal.intentType === "scheduled" ? normalizeScheduledPayload(intent) : intent.payload,
    portfolioId: proposal.intentType === "rebalance" ? intent.portfolioId ?? "sepolia-demo-portfolio" : intent.portfolioId,
    targetAllocation: normalizeTargetAllocation(intent.targetAllocation)
  });
}

function normalizeScheduledPayload(intent) {
  const payload = intent.payload && typeof intent.payload === "object" ? { ...intent.payload } : {};
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    return payload;
  }

  const action = pruneNullish({
    type: inferScheduledActionType(intent, payload),
    token: payload.token ?? intent.token,
    amount: payload.amount ?? intent.amount,
    recipient: payload.recipient ?? payload.to ?? payload.target ?? intent.recipient,
    tokenIn: payload.tokenIn ?? intent.tokenIn,
    tokenOut: payload.tokenOut ?? intent.tokenOut,
    amountIn: payload.amountIn ?? intent.amountIn,
    slippageBps: payload.slippageBps ?? intent.slippageBps,
    deadlineMinutes: payload.deadlineMinutes ?? intent.deadlineMinutes
  });

  return Object.keys(action).length > 1 ? { ...payload, ...action } : payload;
}

function inferScheduledActionType(intent, payload) {
  const explicit = payload.type ?? payload.intentType ?? intent.taskType;
  if (explicit && !["sequential", "repeated", "scheduled"].includes(String(explicit).toLowerCase())) {
    return explicit;
  }
  if (payload.tokenIn ?? payload.tokenOut ?? intent.tokenIn ?? intent.tokenOut) return "swap";
  if (payload.recipient ?? payload.to ?? payload.target ?? intent.recipient) return "transfer";
  return explicit;
}

function inferRunAtFromMessage(message, context) {
  const match = String(message).match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (!match) {
    return null;
  }

  const offsetMinutes = Number.isFinite(Number(context.timezoneOffsetMinutes))
    ? Number(context.timezoneOffsetMinutes)
    : 480;
  const now = new Date(context.currentTimeIso ?? Date.now());
  if (Number.isNaN(now.getTime())) {
    return null;
  }

  const localNow = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  const localRun = new Date(localNow);
  localRun.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);

  if (/\btomorrow\b/i.test(message)) {
    localRun.setUTCDate(localRun.getUTCDate() + 1);
  }

  return new Date(localRun.getTime() - offsetMinutes * 60 * 1000).toISOString();
}

function normalizeTargetAllocation(allocation) {
  if (!Array.isArray(allocation)) {
    return allocation;
  }

  return Object.fromEntries(
    allocation
      .filter((entry) => entry && typeof entry.token === "string")
      .map((entry) => [entry.token, normalizePercent(entry.percent ?? entry.percentage ?? entry.weight)])
  );
}

function normalizePercent(value) {
  if (typeof value === "number") {
    return value;
  }
  const parsed = Number(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : value;
}

function validateProposal(input, proposal) {
  const errors = [];
  const missingFields = Array.isArray(proposal.missingFields)
    ? filterIgnorableMissingFields(proposal)
    : [];
  const canTrustOrderedWorkflow =
    hasOrderedActionWorkflow(proposal) &&
    missingFields.length === 0 &&
    typeof proposal.confidence === "number" &&
    proposal.confidence >= 0.5;

  if ((typeof proposal.confidence !== "number" || proposal.confidence < 0.7) && !canTrustOrderedWorkflow) {
    errors.push("AI confidence is below execution threshold");
  }

  if (missingFields.length > 0) {
    errors.push(`Missing fields: ${missingFields.join(", ")}`);
  }

  try {
    const intent = validateIntentInput(input);
    return {
      valid: errors.length === 0,
      intent,
      errors
    };
  } catch (error) {
    return {
      valid: false,
      intent: null,
      errors: [...errors, error.message]
    };
  }
}

function filterIgnorableMissingFields(proposal) {
  const missingFields = proposal.missingFields ?? [];

  return missingFields.filter((field) => {
    const normalized = String(field).toLowerCase();
    if (
      hasOrderedActionWorkflow(proposal) &&
      [
        "order",
        "order of execution",
        "execution order",
        "action order",
        "sequence",
        "sequence of actions"
      ].includes(normalized)
    ) {
      return false;
    }

    if (proposal.intentType !== "rebalance") {
      return true;
    }

    return ![
      "portfolioid",
      "amount",
      "amount (or tokenin/amountin)",
      "tokenin",
      "tokenin (source token)",
      "current holdings",
      "existing token amounts"
    ].includes(normalized);
  });
}

function hasOrderedActionWorkflow(proposal) {
  const actions = proposal.intent?.payload?.actions;
  return Array.isArray(actions) && actions.length > 1;
}

function pruneNullish(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined)
  );
}
