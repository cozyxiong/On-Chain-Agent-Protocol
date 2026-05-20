import { resolveToken, toBaseUnits } from "../tokens/tokenRegistry.js";

const UNISWAP_API_BASE_URL = "https://trade-api.gateway.uniswap.org/v1";

export function createUniswapService(options = {}) {
  const apiKey = options.apiKey ?? process.env.UNISWAP_API_KEY;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? UNISWAP_API_BASE_URL;
  const chainId = options.chainId ?? Number(process.env.CHAIN_ID ?? "11155111");
  const allowMock = options.allowMock ?? process.env.UNISWAP_MOCK_FALLBACK !== "false";

  return {
    async quoteSwap(intent) {
      const request = buildQuoteRequest(intent, { chainId });

      if (!apiKey && allowMock) {
        return mockQuote(request);
      }

      if (!apiKey) {
        const error = new Error("UNISWAP_API_KEY is required for real Uniswap quotes");
        error.statusCode = 503;
        throw error;
      }

      return postJson(fetchImpl, `${baseUrl}/quote`, apiKey, request);
    },

    async createSwapTransaction(quoteResponse, options = {}) {
      const quote = quoteResponse.quote ?? quoteResponse;

      if (!apiKey && allowMock) {
        return mockSwap(quoteResponse);
      }

      if (!apiKey) {
        const error = new Error("UNISWAP_API_KEY is required for real Uniswap swap calldata");
        error.statusCode = 503;
        throw error;
      }

      const deadline =
        options.deadline ??
        Math.floor(Date.now() / 1000) + Number(options.deadlineSeconds ?? 20 * 60);

      const body = {
        quote,
        refreshGasPrice: true,
        simulateTransaction: options.simulateTransaction ?? false,
        safetyMode: "SAFE",
        deadline,
        urgency: options.urgency ?? "normal"
      };

      if (options.signature && quoteResponse.permitData) {
        body.permitData = quoteResponse.permitData;
        body.signature = options.signature;
      }

      return postJson(fetchImpl, `${baseUrl}/swap`, apiKey, body);
    },

    async prepareSwapExecution(intent, options = {}) {
      const quote = await this.quoteSwap(intent);
      const swap = await this.createSwapTransaction(quote, {
        deadlineSeconds: Number(intent.deadlineMinutes ?? 20) * 60,
        ...options
      });

      const tx = swap.swap ?? swap.transaction ?? swap;
      return {
        quote,
        swap,
        executionCall: {
          intentId: intent.intentId,
          target: tx.to,
          value: tx.value ?? "0",
          data: tx.data
        }
      };
    }
  };
}

export function buildQuoteRequest(intent, options = {}) {
  const chainId = options.chainId ?? 11155111;
  const tokenIn = resolveToken(intent.tokenIn, { chainId });
  const tokenOut = resolveToken(intent.tokenOut, { chainId });
  const amount = toBaseUnits(intent.amountIn, tokenIn.decimals);
  const slippageTolerance = Number(intent.slippageBps ?? 50) / 100;

  return {
    type: "EXACT_INPUT",
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    tokenIn: tokenIn.address,
    tokenOut: tokenOut.address,
    amount,
    swapper: intent.smartAccount,
    recipient: intent.smartAccount,
    slippageTolerance,
    routingPreference: "BEST_PRICE",
    protocols: ["V2", "V3", "V4"],
    urgency: "normal",
    permitAmount: "EXACT",
    generatePermitAsTransaction: false
  };
}

async function postJson(fetchImpl, url, apiKey, body) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": "2.0"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload.error?.message ??
      (response.status === 404
        ? "No Uniswap route found for this Sepolia swap"
        : "Uniswap API request failed");
    const error = new Error(message);
    error.statusCode = response.status;
    error.details = payload;
    throw error;
  }

  return payload;
}

function mockQuote(request) {
  const quoted = BigInt(request.amount) * 99n / 100n;
  const outputAmount = (quoted > 0n ? quoted : 1n).toString();
  return {
    requestId: "mock-quote",
    routing: "CLASSIC",
    quote: {
      chainId: request.tokenInChainId,
      input: {
        amount: request.amount,
        token: request.tokenIn
      },
      output: {
        amount: outputAmount,
        token: request.tokenOut,
        recipient: request.recipient
      },
      swapper: request.swapper,
      tradeType: request.type,
      slippage: request.slippageTolerance
    },
    permitData: null,
    mock: true
  };
}

function mockSwap(quoteResponse) {
  const quote = quoteResponse.quote ?? quoteResponse;
  return {
    requestId: "mock-swap",
    swap: {
      to: "0x9999999999999999999999999999999999999999",
      from: quote.swapper,
      data: "0x12345678",
      value: "0",
      gasLimit: "180000",
      chainId: quote.chainId
    },
    gasFee: "1800000000000000",
    mock: true
  };
}
