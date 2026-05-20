import assert from "node:assert/strict";
import test from "node:test";
import { createIntentParser } from "../src/ai/intentParser.js";
import { parseDeepSeekResponse, parseResponsePayload } from "../src/ai/openaiClient.js";

const context = {
  userId: "user-1",
  agentId: "agent-1",
  smartAccount: "0x1111111111111111111111111111111111111111"
};

test("parses high-confidence AI transfer proposals into validated intents", async () => {
  const parser = createIntentParser({
    aiClient: {
      async parseIntent() {
        return {
          intentType: "transfer",
          confidence: 0.91,
          rationale: "User requested a token transfer.",
          missingFields: [],
          intent: {
            userId: null,
            agentId: null,
            smartAccount: null,
            token: "USDC",
            amount: "10",
            recipient: "0x2222222222222222222222222222222222222222"
          }
        };
      }
    }
  });

  const parsed = await parser.parse("send 10 USDC", context);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.intent.intentType, "transfer");
  assert.equal(parsed.intent.userId, "user-1");
  assert.deepEqual(parsed.errors, []);
});

test("marks low-confidence proposals as invalid even when schema fields exist", async () => {
  const parser = createIntentParser({
    aiClient: {
      async parseIntent() {
        return {
          intentType: "swap",
          confidence: 0.5,
          rationale: "The request is ambiguous.",
          missingFields: ["tokenOut"],
          intent: {
            userId: null,
            agentId: null,
            smartAccount: null,
            tokenIn: "WETH",
            tokenOut: "USDC",
            amountIn: "0.01"
          }
        };
      }
    }
  });

  const parsed = await parser.parse("swap some ETH", context);

  assert.equal(parsed.valid, false);
  assert.match(parsed.errors.join("\n"), /confidence/);
  assert.match(parsed.errors.join("\n"), /Missing fields/);
});

test("normalizes AI rebalance allocation arrays", async () => {
  const parser = createIntentParser({
    aiClient: {
      async parseIntent() {
        return {
          intentType: "rebalance",
          confidence: 0.93,
          rationale: "User provided target allocation.",
          missingFields: [],
          intent: {
            userId: null,
            agentId: null,
            smartAccount: null,
            portfolioId: "main",
            targetAllocation: [
              { token: "WETH", percent: 50 },
              { token: "USDC", percent: 50 }
            ],
            thresholdBps: 100
          }
        };
      }
    }
  });

  const parsed = await parser.parse("rebalance to 50/50", context);

  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.intent.targetAllocation, { WETH: 50, USDC: 50 });
});

test("infers scheduled runAt from local time context", async () => {
  const parser = createIntentParser({
    aiClient: {
      async parseIntent() {
        return {
          intentType: "scheduled",
          confidence: 0.7,
          rationale: "User requested a sequential scheduled workflow.",
          missingFields: ["runAt", "timezone"],
          intent: {
            userId: null,
            agentId: null,
            smartAccount: null,
            taskType: "sequential",
            runAt: null,
            intervalSeconds: 60,
            payload: {
              actions: [
                {
                  type: "transfer",
                  token: "ETH",
                  amount: "0.0005",
                  recipient: "0x2222222222222222222222222222222222222222"
                },
                {
                  type: "swap",
                  tokenIn: "ETH",
                  tokenOut: "USDC",
                  amountIn: "0.0005",
                  slippageBps: 50
                }
              ]
            }
          }
        };
      }
    }
  });

  const parsed = await parser.parse("send at 16:25 today and swap one minute later", {
    ...context,
    currentTimeIso: "2026-05-11T08:20:00.000Z",
    timezone: "Asia/Shanghai",
    timezoneOffsetMinutes: 480
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.intent.runAt, "2026-05-11T08:25:00.000Z");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.intent.payload.actions.length, 2);
});

test("normalizes single scheduled transfer fields into payload", async () => {
  const parser = createIntentParser({
    aiClient: {
      async parseIntent() {
        return {
          intentType: "scheduled",
          confidence: 0.9,
          rationale: "User requested a scheduled transfer.",
          missingFields: [],
          intent: {
            userId: null,
            agentId: null,
            smartAccount: null,
            token: "ETH",
            amount: "0.0001",
            recipient: "0x2222222222222222222222222222222222222222",
            taskType: "transfer",
            runAt: "2026-05-20T07:14:00.000Z",
            intervalSeconds: null,
            payload: null
          }
        };
      }
    }
  });

  const parsed = await parser.parse("send 0.0001 ETH at 15:14 today", context);

  assert.equal(parsed.valid, true);
  assert.equal(parsed.intent.payload.type, "transfer");
  assert.equal(parsed.intent.payload.amount, "0.0001");
  assert.equal(parsed.intent.payload.recipient, "0x2222222222222222222222222222222222222222");
});

test("accepts ordered multi-action workflows without explicit order field", async () => {
  const parser = createIntentParser({
    aiClient: {
      async parseIntent() {
        return {
          intentType: "scheduled",
          confidence: 0.65,
          rationale: "The user requested transfer and swap actions in text order.",
          missingFields: ["order of execution"],
          intent: {
            userId: null,
            agentId: null,
            smartAccount: null,
            taskType: "sequential",
            runAt: null,
            intervalSeconds: 0,
            payload: {
              actions: [
                {
                  type: "transfer",
                  token: "ETH",
                  amount: "0.0001",
                  recipient: "0x2222222222222222222222222222222222222222"
                },
                {
                  type: "swap",
                  tokenIn: "ETH",
                  tokenOut: "USDC",
                  amountIn: "0.0001",
                  slippageBps: 50
                }
              ]
            }
          }
        };
      }
    }
  });

  const parsed = await parser.parse("send 0.0001 ETH and swap 0.0001 ETH to USDC", context);

  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.intent.payload.actions.length, 2);
});

test("extracts Responses API output text payloads", () => {
  const parsed = parseResponsePayload({
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              intentType: "transfer",
              confidence: 1,
              rationale: "ok",
              missingFields: [],
              intent: {}
            })
          }
        ]
      }
    ]
  });

  assert.equal(parsed.intentType, "transfer");
});

test("extracts DeepSeek chat completion JSON payloads", () => {
  const parsed = parseDeepSeekResponse({
    choices: [
      {
        message: {
          content: JSON.stringify({
            intentType: "swap",
            confidence: 0.9,
            rationale: "ok",
            missingFields: [],
            intent: {}
          })
        }
      }
    ]
  });

  assert.equal(parsed.intentType, "swap");
});
