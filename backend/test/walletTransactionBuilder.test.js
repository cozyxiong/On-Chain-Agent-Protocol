import assert from "node:assert/strict";
import test from "node:test";
import {
  createWalletTransactionBuilder,
  prepareAgentIntentBatchExecutionTransaction,
  prepareAgentIntentExecutionTransaction,
  prepareAgentExecutionTransaction,
  prepareAuthorizeAgentTransaction,
  prepareCreateSmartAccountTransaction
} from "../src/wallet/transactionBuilder.js";

const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";

test("prepares native ETH transfer wallet transactions", async () => {
  const builder = createWalletTransactionBuilder();
  const prepared = await builder.prepare(
    {
      intentType: "transfer",
      token: "ETH",
      amount: "0.000005",
      recipient
    },
    wallet
  );

  assert.equal(prepared.kind, "transfer");
  assert.equal(prepared.tx.from, wallet);
  assert.equal(prepared.tx.to, recipient);
  assert.equal(prepared.tx.value, "0x48c27395000");
  assert.equal(prepared.tx.data, "0x");
});

test("prepares swap wallet transactions through Uniswap service", async () => {
  const builder = createWalletTransactionBuilder({
    uniswap: {
      async prepareSwapExecution() {
        return {
          quote: { mock: true },
          executionCall: {
            target: "0x3333333333333333333333333333333333333333",
            value: "0",
            data: "0x12345678"
          }
        };
      }
    }
  });

  const prepared = await builder.prepare(
    {
      intentType: "swap",
      tokenIn: "ETH",
      tokenOut: "USDC",
      amountIn: "0.000001"
    },
    wallet
  );

  assert.equal(prepared.kind, "swap");
  assert.equal(prepared.tx.from, wallet);
  assert.equal(prepared.tx.to, "0x3333333333333333333333333333333333333333");
  assert.equal(prepared.tx.data, "0x12345678");
});

test("prepares smart-account agent authorization transactions", () => {
  const prepared = prepareAuthorizeAgentTransaction({
    owner: wallet,
    smartAccount: "0x3333333333333333333333333333333333333333",
    agent: "0x4444444444444444444444444444444444444444",
    target: "0x5555555555555555555555555555555555555555",
    maxValueWei: "100",
    validUntil: 123456
  });

  assert.equal(prepared.kind, "authorize-agent");
  assert.equal(prepared.tx.from, wallet);
  assert.equal(prepared.tx.to, "0x3333333333333333333333333333333333333333");
  assert.equal(prepared.tx.data.startsWith("0x0f7be1da"), true);
});

test("prepares agent execution transactions", () => {
  const prepared = prepareAgentExecutionTransaction({
    smartAccount: "0x3333333333333333333333333333333333333333",
    agent: "0x4444444444444444444444444444444444444444",
    target: "0x5555555555555555555555555555555555555555",
    value: "0",
    data: "0x12345678"
  });

  assert.equal(prepared.kind, "agent-execute");
  assert.equal(prepared.tx.from, "0x4444444444444444444444444444444444444444");
  assert.equal(prepared.tx.to, "0x3333333333333333333333333333333333333333");
  assert.equal(prepared.tx.data.startsWith("0x953e17a9"), true);
});

test("prepares smart account creation transactions", () => {
  const prepared = prepareCreateSmartAccountTransaction({
    owner: wallet,
    factory: "0x3333333333333333333333333333333333333333",
    salt: "0x01"
  });

  assert.equal(prepared.kind, "create-smart-account");
  assert.equal(prepared.tx.from, wallet);
  assert.equal(prepared.tx.to, "0x3333333333333333333333333333333333333333");
  assert.equal(prepared.tx.data.startsWith("0xf14ddffc"), true);
});

test("prepares agent intent execution transactions for transfers", async () => {
  const prepared = await prepareAgentIntentExecutionTransaction(
    {
      smartAccount: "0x3333333333333333333333333333333333333333",
      agent: "0x4444444444444444444444444444444444444444",
      intent: {
        intentType: "transfer",
        token: "ETH",
        amount: "0.000005",
        recipient
      }
    },
    {
      async prepareSwapExecution() {
        throw new Error("not used");
      }
    }
  );

  assert.equal(prepared.kind, "agent-execute");
  assert.equal(prepared.tx.from, "0x4444444444444444444444444444444444444444");
  assert.equal(prepared.tx.to, "0x3333333333333333333333333333333333333333");
  assert.equal(prepared.tx.data.startsWith("0x953e17a9"), true);
});

test("prepares agent batch execution transactions from multiple intents", async () => {
  const prepared = await prepareAgentIntentBatchExecutionTransaction(
    {
      smartAccount: "0x3333333333333333333333333333333333333333",
      agent: "0x4444444444444444444444444444444444444444",
      intents: [
        {
          intentType: "transfer",
          token: "ETH",
          amount: "0.000005",
          recipient
        },
        {
          intentType: "swap",
          tokenIn: "ETH",
          tokenOut: "USDC",
          amountIn: "0.000001"
        }
      ]
    },
    {
      async prepareSwapExecution() {
        return {
          quote: { mock: true },
          executionCall: {
            target: "0x5555555555555555555555555555555555555555",
            value: "100",
            data: "0x12345678"
          }
        };
      }
    }
  );

  assert.equal(prepared.kind, "agent-batch-execute");
  assert.equal(prepared.batchSize, 2);
  assert.equal(prepared.estimatedSeparateGas, 240000);
  assert.equal(prepared.calls.length, 2);
  assert.equal(prepared.tx.from, "0x4444444444444444444444444444444444444444");
  assert.equal(prepared.tx.to, "0x3333333333333333333333333333333333333333");
  assert.equal(prepared.tx.data.startsWith("0x16da711b"), true);
});
