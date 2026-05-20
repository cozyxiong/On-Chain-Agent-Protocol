import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextRunAt,
  findDueScheduledIntents,
  materializeScheduledIntent
} from "../src/scheduler/scheduler.js";

test("finds due scheduled intents", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const intents = [
    scheduled("due", "2025-12-31T23:59:59.000Z"),
    scheduled("future", "2026-01-01T00:01:00.000Z"),
    { ...scheduled("done", "2025-12-31T23:59:59.000Z"), status: "EXECUTED" }
  ];

  const due = findDueScheduledIntents(intents, { now });

  assert.deepEqual(due.map((intent) => intent.intentId), ["due"]);
});

test("computes next run for repeated scheduled tasks", () => {
  const nextRunAt = computeNextRunAt(
    {
      intentType: "scheduled",
      intervalSeconds: 60
    },
    { from: new Date("2026-01-01T00:00:00.000Z") }
  );

  assert.equal(nextRunAt, "2026-01-01T00:01:00.000Z");
});

test("materializes scheduled intent after execution", () => {
  const materialized = materializeScheduledIntent(
    {
      ...scheduled("repeat", "2026-01-01T00:00:00.000Z"),
      intervalSeconds: 120
    },
    { now: new Date("2026-01-01T00:00:00.000Z") }
  );

  assert.equal(materialized.runAt, "2026-01-01T00:02:00.000Z");
  assert.equal(materialized.lastRunAt, "2026-01-01T00:00:00.000Z");
});

function scheduled(intentId, runAt) {
  return {
    intentId,
    intentType: "scheduled",
    status: "QUEUED",
    runAt
  };
}
