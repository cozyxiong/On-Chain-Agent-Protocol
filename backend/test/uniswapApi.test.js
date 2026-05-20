import assert from "node:assert/strict";
import test from "node:test";
import { createBackendServer } from "../src/server.js";

test("serves token list and prepares mock swap execution calls", async () => {
  const server = createBackendServer({
    uniswapOptions: {
      apiKey: "",
      allowMock: true
    }
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const tokens = await fetch(`${baseUrl}/tokens`).then((response) => response.json());
    assert.equal(tokens.tokens.some((token) => token.symbol === "USDC"), true);

    const prepared = await fetch(`${baseUrl}/uniswap/prepare-swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intentId: "swap-api",
        tokenIn: "WETH",
        tokenOut: "USDC",
        amountIn: "0.01",
        smartAccount: "0x1111111111111111111111111111111111111111"
      })
    }).then((response) => response.json());

    assert.equal(prepared.executionCall.intentId, "swap-api");
    assert.equal(prepared.quote.mock, true);
  } finally {
    server.close();
  }
});
