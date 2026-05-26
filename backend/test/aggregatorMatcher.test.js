import assert from "node:assert/strict";
import test from "node:test";
import { createAggregationPlan } from "../src/aggregator/matcher.js";

test("matches opposite ETH and USDC swap intents exactly", () => {
  const plan = createAggregationPlan(
    [
      swap("sell-eth", "ETH", "USDC", "0.01"),
      swap("sell-usdc", "USDC", "ETH", "30")
    ],
    { ethPriceUsdc: 3000 }
  );

  assert.equal(plan.planType, "internal-match");
  assert.equal(plan.matchRate, 1);
  assert.equal(plan.matchedVolumeUsd, 30);
  assert.equal(plan.unmatchedIntents.length, 0);
  assert.equal(plan.internalTransfers.length, 2);
  assert.deepEqual(plan.matchedPairs[0], {
    type: "exact",
    sellIntentId: "sell-eth",
    buyIntentId: "sell-usdc",
    matchedVolumeUsd: 30,
    ethAmount: "0.01",
    usdcAmount: "30"
  });
});

test("creates residual routes for partial ETH and USDC matches", () => {
  const plan = createAggregationPlan(
    [
      swap("large-eth", "ETH", "USDC", "0.02"),
      swap("small-usdc", "USDC", "ETH", "30")
    ],
    { ethPriceUsdc: 3000 }
  );

  assert.equal(plan.planType, "hybrid-match-route");
  assert.equal(plan.matchedPairs[0].type, "partial");
  assert.equal(plan.matchedVolumeUsd, 30);
  assert.equal(plan.externalRoutedVolumeUsd, 30);
  assert.deepEqual(plan.unmatchedIntents, [
    {
      intentId: "large-eth",
      intentType: "swap",
      tokenIn: "ETH",
      tokenOut: "USDC",
      residualAmountIn: "0.01",
      residualVolumeUsd: 30,
      reason: "residual-external-route"
    }
  ]);
});

test("keeps unsupported intent pairs for external routing", () => {
  const plan = createAggregationPlan(
    [
      swap("eth-usdc", "ETH", "USDC", "0.01"),
      swap("eth-weth", "ETH", "WETH", "0.01")
    ],
    { ethPriceUsdc: 3000 }
  );

  assert.equal(plan.planType, "external-route");
  assert.equal(plan.matchedPairs.length, 0);
  assert.equal(plan.unmatchedIntents.length, 2);
  assert.equal(plan.unmatchedIntents[1].reason, "unsupported-pair");
});

function swap(intentId, tokenIn, tokenOut, amountIn) {
  return {
    intentId,
    intentType: "swap",
    tokenIn,
    tokenOut,
    amountIn
  };
}
