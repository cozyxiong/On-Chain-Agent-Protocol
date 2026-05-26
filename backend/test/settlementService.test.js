import assert from "node:assert/strict";
import test from "node:test";
import { keccak256Hex } from "../src/crypto/keccak.js";
import { createSettlementService } from "../src/settlement/settlementService.js";

const owner = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const escrowAddress = "0x3333333333333333333333333333333333333333";

test("computes Ethereum keccak256 hashes", () => {
  assert.equal(
    keccak256Hex("0x"),
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
  assert.equal(
    keccak256Hex(`0x${Buffer.from("abc", "utf8").toString("hex")}`),
    "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"
  );
});

test("prepares scheduled transfer typed data with calldata hash", async () => {
  const settlement = createSettlementService({ escrowAddress });
  const prepared = await settlement.prepareScheduledWorkflow({
    owner,
    intent: {
      intentType: "scheduled",
      taskType: "transfer",
      runAt: "2026-01-01T00:00:00.000Z",
      payload: {
        token: "ETH",
        amount: "0.000005",
        recipient
      }
    }
  });

  assert.equal(prepared.actions.length, 1);
  assert.equal(prepared.actions[0].executionData, "0x");
  assert.equal(
    prepared.actions[0].call.dataHash,
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  );
  assert.equal(prepared.actions[0].typedData.message.dataHash, prepared.actions[0].call.dataHash);
});
