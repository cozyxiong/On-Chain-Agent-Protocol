import crypto from "node:crypto";

export function createExecutionPlanStore() {
  const plans = new Map();

  return {
    createPlan(plan) {
      const now = new Date().toISOString();
      const created = {
        planId: plan.planId ?? crypto.randomUUID(),
        status: plan.status ?? "PLANNED",
        createdAt: plan.createdAt ?? now,
        updatedAt: now,
        ...plan
      };
      plans.set(created.planId, structuredClone(created));
      return structuredClone(created);
    },

    listPlans() {
      return [...plans.values()]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((plan) => structuredClone(plan));
    },

    latestPlan() {
      return this.listPlans()[0] ?? null;
    }
  };
}
