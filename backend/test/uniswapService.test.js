import assert from "node:assert/strict";
import test from "node:test";
import { buildQuoteRequest, createUniswapService } from "../src/uniswap/uniswapService.js";

const swapIntent = {
  intentId: "swap-1",
  tokenIn: "WETH",
  tokenOut: "USDC",
  amountIn: "0.01",
  slippageBps: 50,
  smartAccount: "0x1111111111111111111111111111111111111111"
};

test("builds Sepolia Uniswap quote requests from swap intents", () => {
  const request = buildQuoteRequest(swapIntent);

  assert.equal(request.tokenInChainId, 11155111);
  assert.equal(request.tokenOutChainId, 11155111);
  assert.equal(request.amount, "10000000000000000");
  assert.equal(request.slippageTolerance, 0.5);
  assert.deepEqual(request.protocols, ["V2", "V3", "V4"]);
});

test("uses mock quote and swap calldata when API key is absent", async () => {
  const uniswap = createUniswapService({ apiKey: "", allowMock: true });

  const prepared = await uniswap.prepareSwapExecution(swapIntent);

  assert.equal(prepared.quote.mock, true);
  assert.equal(prepared.swap.mock, true);
  assert.equal(prepared.executionCall.intentId, "swap-1");
  assert.equal(prepared.executionCall.data, "0x12345678");
});

test("calls Uniswap quote endpoint with API key", async () => {
  const requests = [];
  const uniswap = createUniswapService({
    apiKey: "test-key",
    allowMock: false,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({
        requestId: "quote",
        routing: "CLASSIC",
        quote: {
          chainId: 11155111,
          input: { amount: "1", token: "0x1" },
          output: { amount: "1", token: "0x2" },
          swapper: swapIntent.smartAccount
        }
      });
    }
  });

  const quote = await uniswap.quoteSwap(swapIntent);

  assert.equal(quote.requestId, "quote");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/quote$/);
  assert.equal(requests[0].options.headers["x-api-key"], "test-key");
});
