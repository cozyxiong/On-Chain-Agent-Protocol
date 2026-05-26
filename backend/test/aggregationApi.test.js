import assert from "node:assert/strict";
import test from "node:test";
import { createBackendServer } from "../src/server.js";

test("builds aggregation plans from the intent pool and exposes metrics", async () => {
  const server = createBackendServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await createIntent(baseUrl, swapIntent("sell-eth", "ETH", "USDC", "0.02"));
    await createIntent(baseUrl, swapIntent("sell-usdc", "USDC", "ETH", "30"));

    const built = await fetch(`${baseUrl}/plans/build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ethPriceUsdc: 3000 })
    }).then((response) => response.json());

    assert.equal(built.plan.planType, "hybrid-match-route");
    assert.equal(built.plan.matchRate, 0.5);
    assert.equal(built.plan.matchedPairs.length, 1);

    const listed = await fetch(`${baseUrl}/plans`).then((response) => response.json());
    assert.equal(listed.plans.length, 1);
    assert.equal(listed.plans[0].planId, built.plan.planId);

    const metrics = await fetch(`${baseUrl}/metrics`).then((response) => response.json());
    assert.equal(metrics.metrics.aggregation.totalPlans, 1);
    assert.equal(metrics.metrics.aggregation.latestPlanType, "hybrid-match-route");
    assert.equal(metrics.metrics.aggregation.latestMatchRate, 0.5);
    assert.equal(metrics.metrics.aggregation.latestMatchedVolumeUsd, 30);
    assert.equal(metrics.metrics.aggregation.latestExternalRoutedVolumeUsd, 30);
  } finally {
    server.close();
  }
});

test("batch building records an aggregation plan for queued swap intents", async () => {
  const server = createBackendServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await createIntent(baseUrl, swapIntent("sell-eth", "ETH", "USDC", "0.01"));
    await createIntent(baseUrl, swapIntent("sell-usdc", "USDC", "ETH", "30"));

    const built = await fetch(`${baseUrl}/batches/build`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    }).then((response) => response.json());

    assert.equal(built.aggregationPlan.planType, "internal-match");
    assert.equal(built.aggregationPlan.matchRate, 1);
    assert.equal(built.batches.length, 1);

    const listed = await fetch(`${baseUrl}/plans`).then((response) => response.json());
    assert.equal(listed.plans.length, 1);
    assert.equal(listed.plans[0].source, "batches-build");
  } finally {
    server.close();
  }
});

async function createIntent(baseUrl, intent) {
  const response = await fetch(`${baseUrl}/intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(intent)
  });
  assert.equal(response.status, 201);
  return response.json();
}

function swapIntent(intentId, tokenIn, tokenOut, amountIn) {
  return {
    intentId,
    intentType: "swap",
    userId: "user-1",
    agentId: "agent-1",
    smartAccount: "0x1111111111111111111111111111111111111111",
    tokenIn,
    tokenOut,
    amountIn
  };
}
