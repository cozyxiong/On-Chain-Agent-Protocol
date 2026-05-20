import { createUniswapService } from "../uniswap/uniswapService.js";
import { createWalletQueryService } from "./walletQueryService.js";
import { resolveToken, toBaseUnits } from "../tokens/tokenRegistry.js";

export function createWalletTransactionBuilder(options = {}) {
  const uniswap = options.uniswap ?? createUniswapService(options.uniswapOptions ?? {});
  const walletQueries = options.walletQueries ?? createWalletQueryService(options.walletQueryOptions ?? {});

  return {
    async prepare(intent, walletAddress) {
      assertAddress(walletAddress, "walletAddress");
      const kind = String(intent.intentType ?? "").toLowerCase();

      if (kind === "transfer") {
        return prepareTransfer(intent, walletAddress);
      }

      if (kind === "swap") {
        return prepareSwap(uniswap, intent, walletAddress);
      }

      if (kind === "rebalance") {
        return prepareRebalance(uniswap, walletQueries, intent, walletAddress);
      }

      if (kind === "scheduled") {
        return prepareScheduled(intent, walletAddress);
      }

      badRequest(`Unsupported wallet intent type: ${intent.intentType}`);
    }
  };
}

export async function prepareAgentIntentExecutionTransaction(input, uniswap) {
  const intent = input.intent;
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");

  const call = await intentToSmartAccountCall(intent, smartAccount, uniswap);
  return {
    ...prepareAgentExecutionTransaction({
      smartAccount,
      agent,
      target: call.target,
      value: call.value,
      data: call.data
    }),
    call,
    target: call.target,
    value: call.value
  };
}

export async function prepareAgentIntentBatchExecutionTransaction(input, uniswap) {
  const intents = input.intents ?? [];
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");
  if (!Array.isArray(intents) || intents.length < 2) {
    badRequest("intents must contain at least two actions for batch execution");
  }

  const calls = [];
  for (const intent of intents) {
    calls.push(await intentToSmartAccountCall(intent, smartAccount, uniswap));
  }

  return {
    ...prepareAgentBatchExecutionTransaction({
      smartAccount,
      agent,
      calls
    }),
    calls,
    batchSize: calls.length,
    estimatedSeparateGas: calls.length * 120_000
  };
}

export function prepareAuthorizeAgentTransaction(input) {
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  const target = input.target;
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");
  assertAddress(target, "target");

  const maxValue = input.maxValueWei ?? "0";
  const validUntil = input.validUntil ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return {
    kind: "authorize-agent",
    description: "Authorize agent with scoped smart-account permission",
    tx: {
      from: input.owner,
      to: smartAccount,
      value: "0x0",
      data: encodeAuthorizeAgent(agent, target, maxValue, validUntil)
    }
  };
}

export function prepareRevokeAgentTransaction(input) {
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  assertAddress(input.owner, "owner");
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");

  return {
    kind: "revoke-agent",
    description: "Revoke agent smart-account permission",
    tx: {
      from: input.owner,
      to: smartAccount,
      value: "0x0",
      data: encodeRevokeAgent(agent)
    }
  };
}

export function prepareRevokeAgentTargetTransaction(input) {
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  const target = input.target;
  assertAddress(input.owner, "owner");
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");
  assertAddress(target, "target");

  return {
    kind: "revoke-agent-target",
    description: "Revoke agent target permission",
    tx: {
      from: input.owner,
      to: smartAccount,
      value: "0x0",
      data: encodeRevokeAgentTarget(agent, target)
    }
  };
}

export function prepareAgentExecutionTransaction(input) {
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  const target = input.target;
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");
  assertAddress(target, "target");

  return {
    kind: "agent-execute",
    description: "Agent executes a scoped smart-account call",
    target,
    value: input.value ?? "0",
    tx: {
      from: agent,
      to: smartAccount,
      value: "0x0",
      data: encodeExecuteAgentCall(target, input.value ?? "0", input.data ?? "0x")
    }
  };
}

export function prepareAgentBatchExecutionTransaction(input) {
  const smartAccount = input.smartAccount;
  const agent = input.agent;
  const calls = input.calls ?? [];
  assertAddress(smartAccount, "smartAccount");
  assertAddress(agent, "agent");
  for (const call of calls) {
    assertAddress(call.target, "target");
  }

  return {
    kind: "agent-batch-execute",
    description: `Agent executes ${calls.length} scoped smart-account calls`,
    calls,
    tx: {
      from: agent,
      to: smartAccount,
      value: "0x0",
      data: encodeExecuteBatchAgentCalls(calls)
    }
  };
}

export function prepareCreateSmartAccountTransaction(input) {
  const owner = input.owner;
  const factory = input.factory;
  assertAddress(owner, "owner");
  assertAddress(factory, "factory");
  const salt = normalizeBytes32(input.salt ?? "0x01");

  return {
    kind: "create-smart-account",
    description: "Create deterministic agent smart account",
    tx: {
      from: owner,
      to: factory,
      value: "0x0",
      data: encodeCreateAccount(owner, salt)
    }
  };
}

function prepareTransfer(intent, walletAddress) {
  const token = resolveToken(intent.token ?? "ETH");
  const recipient = intent.recipient;
  assertAddress(recipient, "recipient");
  const amount = toBaseUnits(intent.amount ?? "0", token.decimals);

  if (token.native) {
    return {
      kind: "transfer",
      description: `Transfer ${intent.amount} ETH to ${recipient}`,
      tx: {
        from: walletAddress,
        to: recipient,
        value: toHex(amount),
        data: "0x"
      }
    };
  }

  return {
    kind: "transfer",
    description: `Transfer ${intent.amount} ${token.symbol} to ${recipient}`,
    tx: {
      from: walletAddress,
      to: token.address,
      value: "0x0",
      data: encodeErc20Transfer(recipient, amount)
    }
  };
}

async function prepareSwap(uniswap, intent, walletAddress) {
  const prepared = await uniswap.prepareSwapExecution({
    ...intent,
    smartAccount: walletAddress
  });

  return {
    kind: "swap",
    description: `Swap ${intent.amountIn} ${intent.tokenIn} to ${intent.tokenOut}`,
    quote: prepared.quote,
    tx: {
      from: walletAddress,
      to: prepared.executionCall.target,
      value: normalizeHexValue(prepared.executionCall.value),
      data: prepared.executionCall.data
    }
  };
}

async function prepareRebalance(uniswap, walletQueries, intent, walletAddress) {
  const plan = await buildRebalanceSwapIntent(walletQueries, intent, walletAddress);
  const prepared = await uniswap.prepareSwapExecution({
    ...plan.swapIntent,
    smartAccount: walletAddress
  });
  const tokenIn = resolveToken(plan.swapIntent.tokenIn);
  const amountInBaseUnits = toBaseUnits(plan.swapIntent.amountIn, tokenIn.decimals);
  const approvalTx = tokenIn.native
    ? null
    : {
        label: `Approve ${plan.swapIntent.amountIn} ${tokenIn.symbol}`,
        description: `Approve ${plan.swapIntent.amountIn} ${tokenIn.symbol} for swap execution`,
        tx: {
          from: walletAddress,
          to: tokenIn.address,
          value: "0x0",
          data: encodeErc20Approve(prepared.executionCall.target, amountInBaseUnits)
        }
      };
  const swapTx = {
    label: `Swap ${plan.swapIntent.amountIn} ${plan.swapIntent.tokenIn} to ${plan.swapIntent.tokenOut}`,
    description: `Swap ${plan.swapIntent.amountIn} ${plan.swapIntent.tokenIn} to ${plan.swapIntent.tokenOut}`,
    tx: {
      from: walletAddress,
      to: prepared.executionCall.target,
      value: normalizeHexValue(prepared.executionCall.value),
      data: prepared.executionCall.data
    }
  };

  return {
    kind: "rebalance",
    description: `Rebalance by swapping ${plan.swapIntent.amountIn} ${plan.swapIntent.tokenIn} to ${plan.swapIntent.tokenOut}`,
    plan,
    quote: prepared.quote,
    transactions: [approvalTx, swapTx].filter(Boolean),
    tx: (approvalTx ?? swapTx).tx
  };
}

async function buildRebalanceSwapIntent(walletQueries, intent, walletAddress) {
  const targetAllocation = intent.targetAllocation ?? {};
  const symbols = Object.keys(targetAllocation);
  if (symbols.length < 2) {
    badRequest("Rebalance requires at least two target assets");
  }

  const normalizedTargets = normalizeTargetAllocation(targetAllocation);
  const tokens = symbols.map((symbol) => resolveToken(symbol));
  if (tokens.some((token) => token.native)) {
    badRequest("Rebalance currently supports ERC20 assets such as WETH and USDC");
  }

  const balances = await walletQueries.balances({
    address: walletAddress,
    tokens: symbols
  });
  const assets = balances.balances.map((balance) => {
    const priceUsd = priceFor(balance.symbol);
    const amount = Number(balance.formatted);
    const valueUsd = amount * priceUsd;
    return {
      symbol: balance.symbol,
      decimals: balance.decimals,
      raw: balance.raw,
      amount,
      priceUsd,
      valueUsd,
      targetPercent: normalizedTargets[balance.symbol] ?? 0
    };
  });
  const totalValueUsd = assets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  if (totalValueUsd <= 0) {
    badRequest("Portfolio has no WETH/USDC value to rebalance");
  }

  const thresholdBps = Number(intent.thresholdBps ?? 100);
  const evaluated = assets.map((asset) => {
    const currentPercent = asset.valueUsd / totalValueUsd * 100;
    const driftBps = Math.round((currentPercent - asset.targetPercent) * 100);
    return {
      ...asset,
      currentPercent,
      driftBps,
      targetValueUsd: totalValueUsd * asset.targetPercent / 100
    };
  });
  const overweight = evaluated
    .filter((asset) => asset.driftBps > thresholdBps)
    .sort((a, b) => b.driftBps - a.driftBps)[0];
  const underweight = evaluated
    .filter((asset) => asset.driftBps < -thresholdBps)
    .sort((a, b) => a.driftBps - b.driftBps)[0];

  if (!overweight || !underweight) {
    badRequest("Portfolio is already within rebalance threshold");
  }

  const maxTradeUsd = Number(intent.maxTradeUsd ?? process.env.REBALANCE_MAX_TRADE_USD ?? "0.1");
  const tradeValueUsd = Math.min(
    overweight.valueUsd - overweight.targetValueUsd,
    underweight.targetValueUsd - underweight.valueUsd,
    Number.isFinite(maxTradeUsd) && maxTradeUsd > 0 ? maxTradeUsd : Number.POSITIVE_INFINITY
  );
  const amountIn = decimalAmount(tradeValueUsd / overweight.priceUsd, overweight.decimals);
  if (Number(amountIn) <= 0) {
    badRequest("Calculated rebalance amount is too small to execute");
  }

  return {
    totalValueUsd,
    thresholdBps,
    assets: evaluated.map((asset) => ({
      symbol: asset.symbol,
      amount: asset.amount,
      valueUsd: roundNumber(asset.valueUsd, 4),
      currentPercent: roundNumber(asset.currentPercent, 4),
      targetPercent: asset.targetPercent,
      driftBps: asset.driftBps
    })),
    swapIntent: {
      ...intent,
      intentType: "swap",
      tokenIn: overweight.symbol,
      tokenOut: underweight.symbol,
      amountIn,
      slippageBps: intent.slippageBps ?? 75,
      deadlineMinutes: intent.deadlineMinutes ?? 20
    }
  };
}

function prepareScheduled(intent, walletAddress) {
  const payload = intent.payload ?? {};
  return prepareTransfer(
    {
      intentType: "transfer",
      token: payload.token ?? intent.token ?? "ETH",
      amount: payload.amount ?? intent.amount ?? "0.000005",
      recipient: payload.recipient ?? intent.recipient ?? walletAddress
    },
    walletAddress
  );
}

async function intentToSmartAccountCall(intent, smartAccount, uniswap) {
  const kind = String(intent.intentType ?? "").toLowerCase();

  if (kind === "transfer") {
    const token = resolveToken(intent.token ?? "ETH");
    const recipient = intent.recipient;
    assertAddress(recipient, "recipient");
    const amount = toBaseUnits(intent.amount ?? "0", token.decimals);

    if (token.native) {
      return {
        target: recipient,
        value: amount,
        data: "0x"
      };
    }

    return {
      target: token.address,
      value: "0",
      data: encodeErc20Transfer(recipient, amount)
    };
  }

  if (kind === "swap" || kind === "rebalance") {
    const swapIntent = kind === "rebalance" ? rebalanceToSwap(intent) : intent;
    const prepared = await uniswap.prepareSwapExecution({
      ...swapIntent,
      smartAccount
    });
    return {
      target: prepared.executionCall.target,
      value: prepared.executionCall.value ?? "0",
      data: prepared.executionCall.data
    };
  }

  if (kind === "scheduled") {
    return intentToSmartAccountCall(
      {
        intentType: "transfer",
        token: intent.payload?.token ?? intent.token ?? "ETH",
        amount: intent.payload?.amount ?? intent.amount ?? "0.000005",
        recipient: intent.payload?.recipient ?? intent.payload?.to ?? intent.payload?.target ?? intent.recipient ?? smartAccount
      },
      smartAccount,
      uniswap
    );
  }

  badRequest(`Unsupported agent execution intent type: ${intent.intentType}`);
}

function rebalanceToSwap(intent) {
  return {
    ...intent,
    intentType: "swap",
    tokenIn: "ETH",
    tokenOut: "USDC",
    amountIn: "0.000001",
    slippageBps: intent.slippageBps ?? 100,
    deadlineMinutes: intent.deadlineMinutes ?? 20
  };
}

function normalizeTargetAllocation(allocation) {
  const entries = Object.entries(allocation);
  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
  if (!Number.isFinite(total) || Math.abs(total - 100) > 0.000001) {
    badRequest("targetAllocation must sum to 100");
  }
  return Object.fromEntries(entries.map(([symbol, value]) => [symbol.toUpperCase(), Number(value)]));
}

function priceFor(symbol) {
  const prices = {
    WETH: Number(process.env.PRICE_WETH_USDC ?? "3000"),
    ETH: Number(process.env.PRICE_WETH_USDC ?? "3000"),
    USDC: 1
  };
  const price = prices[String(symbol).toUpperCase()];
  if (!Number.isFinite(price) || price <= 0) {
    badRequest(`No USD price configured for ${symbol}`);
  }
  return price;
}

function decimalAmount(value, decimals) {
  const scale = 10 ** Math.min(decimals, 12);
  const roundedDown = Math.floor(value * scale) / scale;
  return roundedDown.toFixed(Math.min(decimals, 12)).replace(/\.?0+$/, "");
}

function roundNumber(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function encodeErc20Transfer(recipient, amount) {
  return `0xa9059cbb${padAddress(recipient)}${padUint(amount)}`;
}

function encodeErc20Approve(spender, amount) {
  return `0x095ea7b3${padAddress(spender)}${padUint(amount)}`;
}

function encodeAuthorizeAgent(agent, target, maxValue, validUntil) {
  return `0x0f7be1da${padAddress(agent)}${padAddress(target)}${padUint(maxValue)}${padUint(validUntil)}`;
}

function encodeRevokeAgent(agent) {
  return `0x7da6ac0d${padAddress(agent)}`;
}

function encodeRevokeAgentTarget(agent, target) {
  return `0x695611f5${padAddress(agent)}${padAddress(target)}`;
}

function encodeCreateAccount(owner, salt) {
  return `0xf14ddffc${padAddress(owner)}${normalizeBytes32(salt).replace(/^0x/, "")}`;
}

function encodeExecuteAgentCall(target, value, data) {
  const cleanData = String(data).replace(/^0x/, "");
  const head = `${padAddress(target)}${padUint(value)}${padUint(96)}`;
  const body = `${padUint(cleanData.length / 2)}${cleanData.padEnd(Math.ceil(cleanData.length / 64) * 64, "0")}`;
  return `0x953e17a9${head}${body}`;
}

function encodeExecuteBatchAgentCalls(calls) {
  const arrayData = encodeAgentCallArray(calls);
  return `0x16da711b${padUint(32)}${arrayData}`;
}

function encodeAgentCallArray(calls) {
  const headSize = calls.length * 32;
  let tail = "";
  const offsets = [];
  for (const call of calls) {
    offsets.push(headSize + tail.length / 2);
    tail += encodeAgentCallTuple(call);
  }
  return `${padUint(calls.length)}${offsets.map(padUint).join("")}${tail}`;
}

function encodeAgentCallTuple(call) {
  const cleanData = String(call.data ?? "0x").replace(/^0x/, "");
  return `${padAddress(call.target)}${padUint(call.value ?? "0")}${padUint(96)}${padUint(cleanData.length / 2)}${cleanData.padEnd(Math.ceil(cleanData.length / 64) * 64, "0")}`;
}

function padAddress(address) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function toHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function normalizeHexValue(value) {
  if (!value || value === "0") {
    return "0x0";
  }
  if (typeof value === "string" && value.startsWith("0x")) {
    return value;
  }
  return toHex(value);
}

function assertAddress(value, field) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(value ?? ""))) {
    badRequest(`${field} must be an EVM address`);
  }
}

function normalizeBytes32(value) {
  const raw = String(value ?? "").replace(/^0x/, "");
  if (!/^[a-fA-F0-9]+$/.test(raw) || raw.length > 64) {
    badRequest("salt must be a bytes32-compatible hex value");
  }
  return `0x${raw.padStart(64, "0")}`;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
}
