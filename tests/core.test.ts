import { describe, expect, it } from "vitest";
import { createContractFromVibe, validateContract } from "../src/core/contract.js";
import { derivePlan } from "../src/core/plan.js";
import { resolveConvergence } from "../src/core/converge.js";

describe("contract and plan", () => {
  it("creates a valid contract from vibe", () => {
    const contract = createContractFromVibe("build a todo app");
    const validation = validateContract(contract);
    expect(validation.valid).toBe(true);
  });

  it("derives plan with required step fields", () => {
    const contract = createContractFromVibe("test plan");
    const plan = derivePlan(contract);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]).toHaveProperty("id");
    expect(plan.steps[0]).toHaveProperty("riskLevel");
    expect(plan.steps[0]).toHaveProperty("expectedArtifacts");
    expect(plan.steps[0]).toHaveProperty("verification");
  });
});

describe("convergence", () => {
  it("returns approve on 2/3 approve votes", () => {
    const decision = resolveConvergence("plan", [
      { advisor: "codex", vote: "approve", summary: "ok" },
      { advisor: "claude", vote: "approve", summary: "ok" },
      { advisor: "gemini", vote: "reject", summary: "no" }
    ]);
    expect(decision.winner).toBe("approve");
    expect(decision.requiresHumanApproval).toBe(false);
  });

  it("requires human approval on split votes", () => {
    const decision = resolveConvergence("plan", [
      { advisor: "codex", vote: "approve", summary: "ok" },
      { advisor: "claude", vote: "reject", summary: "no" },
      { advisor: "gemini", vote: "abstain", summary: "skip" }
    ]);
    expect(decision.requiresHumanApproval).toBe(true);
  });
});
