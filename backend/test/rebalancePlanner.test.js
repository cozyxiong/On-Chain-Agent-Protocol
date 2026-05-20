import assert from "node:assert/strict";
import test from "node:test";
import {
  createRebalancePlan,
  rebalancePlanToSwapIntents
} from "../src/rebalance/rebalancePlanner.js";

test("creates sell actions for overweight assets", () => {
  const plan = createRebalancePlan({
    portfolio: {
      WETH: { valueUsd: 800 },
      USDC: { valueUsd: 200 }
    },
    targetAllocation: {
      WETH: 50,
      USDC: 50
    },
    baseToken: "USDC",
    thresholdBps: 100
  });

  assert.equal(plan.totalValueUsd, 1000);
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].type, "sell");
  assert.equal(plan.actions[0].tokenIn, "WETH");
  assert.equal(plan.actions[0].tokenOut, "USDC");
  assert.equal(plan.actions[0].estimatedUsd, 300);
});

test("skips actions inside drift threshold", () => {
  const plan = createRebalancePlan({
    portfolio: {
      WETH: { valueUsd: 505 },
      USDC: { valueUsd: 495 }
    },
    targetAllocation: {
      WETH: 50,
      USDC: 50
    },
    baseToken: "USDC",
    thresholdBps: 100
  });

  assert.deepEqual(plan.actions, []);
});

test("converts rebalance actions into swap intents", () => {
  const plan = {
    actions: [
      {
        type: "sell",
        tokenIn: "WETH",
        tokenOut: "USDC",
        estimatedUsd: 300
      }
    ]
  };

  const swapIntents = rebalancePlanToSwapIntents(plan, {
    intentId: "rebalance-1",
    userId: "user-1",
    agentId: "agent-1",
    smartAccount: "0x1111111111111111111111111111111111111111",
    prices: { WETH: 3000 }
  });

  assert.equal(swapIntents.length, 1);
  assert.equal(swapIntents[0].intentId, "rebalance-1-swap-1");
  assert.equal(swapIntents[0].intentType, "swap");
  assert.equal(swapIntents[0].amountIn, "0.1");
});
