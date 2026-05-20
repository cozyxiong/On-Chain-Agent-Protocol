export function createRebalancePlan(input) {
  const portfolio = normalizeWeights(input.portfolio, "portfolio");
  const targetAllocation = normalizeWeights(input.targetAllocation, "targetAllocation");
  const thresholdBps = input.thresholdBps ?? 100;
  const baseToken = input.baseToken ?? pickBaseToken(targetAllocation);
  const totalValue = Object.values(portfolio).reduce((sum, asset) => sum + asset.valueUsd, 0);

  if (totalValue <= 0) {
    badRequest("Portfolio total value must be greater than zero");
  }

  const actions = [];

  for (const [symbol, targetPercent] of Object.entries(targetAllocation)) {
    const currentValue = portfolio[symbol]?.valueUsd ?? 0;
    const currentPercent = currentValue / totalValue * 100;
    const driftBps = Math.round((currentPercent - targetPercent) * 100);

    if (Math.abs(driftBps) < thresholdBps) {
      continue;
    }

    const deltaUsd = totalValue * (targetPercent - currentPercent) / 100;

    if (deltaUsd > 0 && symbol !== baseToken) {
      actions.push({
        type: "buy",
        tokenIn: baseToken,
        tokenOut: symbol,
        estimatedUsd: roundUsd(deltaUsd),
        driftBps
      });
    }

    if (deltaUsd < 0 && symbol !== baseToken) {
      actions.push({
        type: "sell",
        tokenIn: symbol,
        tokenOut: baseToken,
        estimatedUsd: roundUsd(Math.abs(deltaUsd)),
        driftBps
      });
    }
  }

  return {
    totalValueUsd: roundUsd(totalValue),
    thresholdBps,
    baseToken,
    actions
  };
}

export function rebalancePlanToSwapIntents(plan, context = {}) {
  return plan.actions.map((action, index) => ({
    intentId: `${context.intentId ?? "rebalance"}-swap-${index + 1}`,
    intentType: "swap",
    userId: context.userId,
    agentId: context.agentId,
    smartAccount: context.smartAccount,
    tokenIn: action.tokenIn,
    tokenOut: action.tokenOut,
    amountIn: estimateTokenAmount(action, context.prices ?? {}),
    slippageBps: context.slippageBps ?? 75,
    deadlineMinutes: context.deadlineMinutes ?? 20
  }));
}

function normalizeWeights(input, field) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    badRequest(`${field} must be an object`);
  }

  return input;
}

function pickBaseToken(targetAllocation) {
  if (targetAllocation.USDC !== undefined) {
    return "USDC";
  }

  const [first] = Object.keys(targetAllocation);
  return first;
}

function estimateTokenAmount(action, prices) {
  const price = prices[action.tokenIn] ?? 1;
  if (price <= 0) {
    badRequest(`Invalid price for ${action.tokenIn}`);
  }

  return String(roundToken(action.estimatedUsd / price));
}

function roundUsd(value) {
  return Math.round(value * 100) / 100;
}

function roundToken(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
