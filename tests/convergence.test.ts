import { describe, expect, it } from "vitest";
import { resolveConvergence } from "../src/core/converge.js";

describe("convergence policy", () => {
  it("rejects when two advisors reject", () => {
    const decision = resolveConvergence("plan", [
      { advisor: "codex", vote: "reject", summary: "bad" },
      { advisor: "claude", vote: "reject", summary: "bad" },
      { advisor: "gemini", vote: "approve", summary: "ok" }
    ]);

    expect(decision.winner).toBe("reject");
    expect(decision.requiresHumanApproval).toBe(false);
  });

  it("flags invalid advisor responses as conflicts", () => {
    const decision = resolveConvergence("exec", [
      { advisor: "codex", vote: "approve", summary: "ok", parseStatus: "ok", evidenceRef: "a.json" },
      { advisor: "claude", vote: "abstain", summary: "n/a", parseStatus: "invalid", evidenceRef: "b.json" },
      { advisor: "gemini", vote: "abstain", summary: "n/a", parseStatus: "ok", evidenceRef: "c.json" }
    ]);

    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.conflicts.some((c) => c.includes("invalid advisor response"))).toBe(true);
  });
});
