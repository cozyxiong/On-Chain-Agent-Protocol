export const INTENT_PARSER_SYSTEM_PROMPT = `
You convert user requests into safe blockchain intent proposals.

Rules:
- You must output valid JSON only.
- Return only data that matches the schema.
- Never claim an on-chain action was executed.
- Never invent private keys, signatures, balances, transaction hashes, or approvals.
- Use only these intent types: transfer, swap, rebalance, scheduled.
- Use token symbols when addresses are unknown.
- For rebalancing, express targetAllocation as an array of token/percent objects.
- For Sepolia demo rebalancing, if the user does not provide a portfolioId, use "sepolia-demo-portfolio".
- If a rebalance request says "tiny test amount" or "demo", do not require current holdings, tokenIn, or amount; the execution layer will use a capped test swap.
- Interpret relative times such as "today", "tomorrow", and "one minute later" using context.currentTimeIso and context.timezone.
- For scheduled sequential workflows, set intentType to "scheduled", set taskType to "sequential", set runAt to the first action time as an ISO string, set intervalSeconds when actions are evenly spaced, and put ordered actions in payload.actions.
- For multiple actions joined by words like "and", preserve the user's text order in payload.actions; do not mark "order of execution" as missing.
- If a required field is missing, set confidence below 0.7 and explain what is missing.
- The proposal is untrusted and will be validated by the backend before execution.

JSON output shape:
{
  "intentType": "transfer | swap | rebalance | scheduled",
  "confidence": 0.0,
  "rationale": "short reason",
  "missingFields": [],
  "intent": {
    "userId": null,
    "agentId": null,
    "smartAccount": null,
    "token": null,
    "amount": null,
    "recipient": null,
    "tokenIn": null,
    "tokenOut": null,
    "amountIn": null,
    "slippageBps": null,
    "deadlineMinutes": null,
    "portfolioId": null,
    "targetAllocation": null,
    "thresholdBps": null,
    "taskType": null,
    "runAt": null,
    "intervalSeconds": null,
    "payload": null
  }
}
`.trim();

export function buildIntentParserUserPrompt({ message, context = {} }) {
  return JSON.stringify(
    {
      userRequest: message,
      context: {
        userId: context.userId ?? null,
        agentId: context.agentId ?? null,
        smartAccount: context.smartAccount ?? null,
        currentTimeIso: context.currentTimeIso ?? new Date().toISOString(),
        timezone: context.timezone ?? "Asia/Shanghai",
        timezoneOffsetMinutes: context.timezoneOffsetMinutes ?? 480,
        availableTokens: context.availableTokens ?? ["ETH", "WETH", "USDC"],
        defaultSlippageBps: context.defaultSlippageBps ?? 50
      }
    },
    null,
    2
  );
}

export const INTENT_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intentType: {
      type: "string",
      enum: ["transfer", "swap", "rebalance", "scheduled"]
    },
    confidence: {
      type: "number"
    },
    rationale: {
      type: "string"
    },
    missingFields: {
      type: "array",
      items: {
        type: "string"
      }
    },
    intent: {
      type: "object",
      additionalProperties: false,
      properties: {
        userId: { type: ["string", "null"] },
        agentId: { type: ["string", "null"] },
        smartAccount: { type: ["string", "null"] },
        token: { type: ["string", "null"] },
        amount: { type: ["string", "null"] },
        recipient: { type: ["string", "null"] },
        tokenIn: { type: ["string", "null"] },
        tokenOut: { type: ["string", "null"] },
        amountIn: { type: ["string", "null"] },
        slippageBps: { type: ["integer", "null"] },
        deadlineMinutes: { type: ["integer", "null"] },
        portfolioId: { type: ["string", "null"] },
        targetAllocation: {
          anyOf: [
            {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  token: { type: "string" },
                  percent: { type: "number" }
                },
                required: ["token", "percent"]
              }
            },
            {
              type: "null"
            }
          ]
        },
        thresholdBps: { type: ["integer", "null"] },
        taskType: { type: ["string", "null"] },
        runAt: { type: ["string", "null"] },
        intervalSeconds: { type: ["integer", "null"] },
        payload: {
          type: ["object", "null"],
          additionalProperties: true,
          properties: {},
          required: []
        }
      },
      required: [
        "userId",
        "agentId",
        "smartAccount",
        "token",
        "amount",
        "recipient",
        "tokenIn",
        "tokenOut",
        "amountIn",
        "slippageBps",
        "deadlineMinutes",
        "portfolioId",
        "targetAllocation",
        "thresholdBps",
        "taskType",
        "runAt",
        "intervalSeconds",
        "payload"
      ]
    }
  },
  required: ["intentType", "confidence", "rationale", "missingFields", "intent"]
};
