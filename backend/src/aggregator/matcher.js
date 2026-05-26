const DEFAULT_ETH_PRICE_USDC = 3000;
const EPSILON = 1e-9;

export function createAggregationPlan(intents, options = {}) {
  if (!Array.isArray(intents)) {
    badRequest("intents must be an array");
  }

  const ethPriceUsdc = positiveNumber(
    options.ethPriceUsdc ?? process.env.PRICE_WETH_USDC ?? DEFAULT_ETH_PRICE_USDC,
    "ethPriceUsdc"
  );
  const normalized = intents.map((intent, index) => normalizeIntent(intent, index, ethPriceUsdc));
  const matchable = normalized.filter((intent) => intent.matchable);
  const unsupported = normalized.filter((intent) => !intent.matchable);
  const ethToUsdc = matchable.filter((intent) => intent.direction === "ETH_TO_USDC");
  const usdcToEth = matchable.filter((intent) => intent.direction === "USDC_TO_ETH");

  const matchedPairs = [];
  const internalTransfers = [];
  let matchedVolumeUsd = 0;
  let sellIndex = 0;
  let buyIndex = 0;

  while (sellIndex < ethToUsdc.length && buyIndex < usdcToEth.length) {
    const sell = ethToUsdc[sellIndex];
    const buy = usdcToEth[buyIndex];
    const matchedUsd = Math.min(sell.remainingUsd, buy.remainingUsd);
    if (matchedUsd <= EPSILON) break;

    const pairType = Math.abs(sell.remainingUsd - buy.remainingUsd) <= EPSILON ? "exact" : "partial";
    const ethAmount = matchedUsd / ethPriceUsdc;
    const usdcAmount = matchedUsd;
    matchedVolumeUsd += matchedUsd;

    matchedPairs.push({
      type: pairType,
      sellIntentId: sell.intentId,
      buyIntentId: buy.intentId,
      matchedVolumeUsd: round(matchedUsd),
      ethAmount: decimalString(ethAmount),
      usdcAmount: decimalString(usdcAmount)
    });

    // A real settlement contract would custody assets. The planner records the
    // two internal transfer legs so later encoding can avoid external DEX volume.
    internalTransfers.push(
      {
        fromIntentId: sell.intentId,
        toIntentId: buy.intentId,
        token: "ETH",
        amount: decimalString(ethAmount),
        valueUsd: round(matchedUsd)
      },
      {
        fromIntentId: buy.intentId,
        toIntentId: sell.intentId,
        token: "USDC",
        amount: decimalString(usdcAmount),
        valueUsd: round(matchedUsd)
      }
    );

    sell.remainingUsd -= matchedUsd;
    buy.remainingUsd -= matchedUsd;
    if (sell.remainingUsd <= EPSILON) sellIndex += 1;
    if (buy.remainingUsd <= EPSILON) buyIndex += 1;
  }

  const residual = [...ethToUsdc, ...usdcToEth]
    .filter((intent) => intent.remainingUsd > EPSILON)
    .map((intent) => residualIntent(intent, ethPriceUsdc));
  const unmatchedIntents = [
    ...residual,
    ...unsupported.map((intent) => ({
      intentId: intent.intentId,
      intentType: intent.intentType,
      tokenIn: intent.tokenIn,
      tokenOut: intent.tokenOut,
      amountIn: intent.amountIn,
      reason: intent.reason ?? "unsupported-intent"
    }))
  ];
  const externalRoutedVolumeUsd = unmatchedIntents.reduce(
    (sum, intent) => sum + Number(intent.residualVolumeUsd ?? intent.volumeUsd ?? 0),
    0
  );
  const optimizableVolumeUsd = matchedVolumeUsd + externalRoutedVolumeUsd;

  return {
    planType: classifyPlan(matchedPairs, unmatchedIntents),
    priceModel: {
      ETH_USDC: ethPriceUsdc
    },
    intentCount: intents.length,
    matchedPairs,
    internalTransfers,
    unmatchedIntents,
    matchRate: optimizableVolumeUsd > 0 ? round(matchedVolumeUsd / optimizableVolumeUsd) : 0,
    matchedVolumeUsd: round(matchedVolumeUsd),
    externalRoutedVolumeUsd: round(externalRoutedVolumeUsd)
  };
}

function normalizeIntent(intent, index, ethPriceUsdc) {
  const intentType = String(intent.intentType ?? "").toLowerCase();
  const tokenIn = normalizeToken(intent.tokenIn);
  const tokenOut = normalizeToken(intent.tokenOut);
  const amountIn = Number(intent.amountIn);
  const base = {
    intent,
    intentId: intent.intentId ?? `intent-${index + 1}`,
    intentType,
    tokenIn,
    tokenOut,
    amountIn: intent.amountIn
  };

  if (intentType !== "swap" || !Number.isFinite(amountIn) || amountIn <= 0) {
    return { ...base, matchable: false, reason: "unsupported-intent" };
  }

  if (tokenIn === "ETH" && tokenOut === "USDC") {
    const volumeUsd = amountIn * ethPriceUsdc;
    return {
      ...base,
      matchable: true,
      direction: "ETH_TO_USDC",
      volumeUsd,
      remainingUsd: volumeUsd
    };
  }

  if (tokenIn === "USDC" && tokenOut === "ETH") {
    return {
      ...base,
      matchable: true,
      direction: "USDC_TO_ETH",
      volumeUsd: amountIn,
      remainingUsd: amountIn
    };
  }

  return { ...base, matchable: false, reason: "unsupported-pair" };
}

function residualIntent(intent, ethPriceUsdc) {
  const residualAmountIn =
    intent.direction === "ETH_TO_USDC"
      ? intent.remainingUsd / ethPriceUsdc
      : intent.remainingUsd;

  return {
    intentId: intent.intentId,
    intentType: intent.intentType,
    tokenIn: intent.tokenIn,
    tokenOut: intent.tokenOut,
    residualAmountIn: decimalString(residualAmountIn),
    residualVolumeUsd: round(intent.remainingUsd),
    reason: "residual-external-route"
  };
}

function classifyPlan(matchedPairs, unmatchedIntents) {
  if (matchedPairs.length === 0) return "external-route";
  if (unmatchedIntents.length === 0 && matchedPairs.every((pair) => pair.type === "exact")) {
    return "internal-match";
  }
  if (unmatchedIntents.length === 0) return "partial-match";
  return "hybrid-match-route";
}

function normalizeToken(value) {
  const token = String(value ?? "").trim().toUpperCase();
  return token === "WETH" ? "ETH" : token;
}

function decimalString(value) {
  return round(value).toString();
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e9) / 1e9;
}

function positiveNumber(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    badRequest(`${field} must be a positive number`);
  }
  return numeric;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
