import assert from "node:assert/strict";
import test from "node:test";
import { validateIntentInput } from "../src/intents/schema.js";

const base = {
  userId: "user-1",
  agentId: "agent-1",
  smartAccount: "0x1111111111111111111111111111111111111111"
};

test("validates transfer intents", () => {
  const intent = validateIntentInput({
    ...base,
    intentType: "transfer",
    token: "USDC",
    amount: "10",
    recipient: "0x2222222222222222222222222222222222222222"
  });

  assert.equal(intent.intentType, "transfer");
  assert.equal(intent.status, "QUEUED");
  assert.equal(intent.amount, "10");
});

test("rejects unsupported intent types", () => {
  assert.throws(
    () => validateIntentInput({ ...base, intentType: "borrow" }),
    /Unsupported intentType/
  );
});

test("requires rebalance allocation to sum to 100", () => {
  assert.throws(
    () =>
      validateIntentInput({
        ...base,
        intentType: "rebalance",
        portfolioId: "portfolio-1",
        targetAllocation: { WETH: 40, USDC: 40 }
      }),
    /sum to 100/
  );
});
