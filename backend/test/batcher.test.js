import assert from "node:assert/strict";
import test from "node:test";
import { buildBatches } from "../src/coordinator/batcher.js";

test("groups queued intents by type and batch size", () => {
  const intents = [
    intent("a", "transfer"),
    intent("b", "transfer"),
    intent("c", "transfer"),
    intent("d", "swap")
  ];

  const batches = buildBatches(intents, { batchSize: 2, now: new Date() });

  assert.equal(batches.length, 3);
  assert.deepEqual(batches.map((batch) => batch.size), [2, 1, 1]);
  assert.deepEqual(batches[0].intentIds, ["a", "b"]);
});

test("does not batch scheduled intents before runAt", () => {
  const batches = buildBatches(
    [
      {
        ...intent("future", "scheduled"),
        runAt: "2099-01-01T00:00:00.000Z"
      }
    ],
    { batchSize: 5, now: new Date("2026-01-01T00:00:00.000Z") }
  );

  assert.equal(batches.length, 0);
});

function intent(intentId, intentType) {
  return {
    intentId,
    intentType,
    status: "QUEUED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
