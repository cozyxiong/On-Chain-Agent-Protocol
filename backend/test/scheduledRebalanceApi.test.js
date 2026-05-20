import assert from "node:assert/strict";
import test from "node:test";
import { createBackendServer } from "../src/server.js";

test("serves rebalance plans over HTTP", async () => {
  const server = createBackendServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/rebalance/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        portfolio: {
          WETH: { valueUsd: 800 },
          USDC: { valueUsd: 200 }
        },
        targetAllocation: {
          WETH: 50,
          USDC: 50
        },
        baseToken: "USDC",
        context: {
          intentId: "rebalance-api",
          userId: "user-1",
          agentId: "agent-1",
          smartAccount: "0x1111111111111111111111111111111111111111",
          prices: { WETH: 3000, USDC: 1 }
        }
      })
    }).then((res) => res.json());

    assert.equal(response.plan.actions.length, 1);
    assert.equal(response.swapIntents[0].intentType, "swap");
  } finally {
    server.close();
  }
});
