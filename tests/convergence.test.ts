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

  it("blocks conflicting majority when approve and reject both meet threshold", () => {
    const decision = resolveConvergence("plan", [
      { advisor: "codex", vote: "approve", summary: "ok", parseStatus: "ok", evidenceRef: "a.json" },
      { advisor: "claude", vote: "approve", summary: "ok", parseStatus: "ok", evidenceRef: "b.json" },
      { advisor: "gemini", vote: "reject", summary: "bad", parseStatus: "ok", evidenceRef: "c.json" },
      { advisor: "chatgpt", vote: "reject", summary: "bad", parseStatus: "ok", evidenceRef: "d.json" }
    ]);

    expect(decision.winner).toBe("abstain");
    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.conflicts.some((c) => c.includes("Conflicting majority"))).toBe(true);
  });

  it("enforces strict external advisor contract", () => {
    const decision = resolveConvergence(
      "plan",
      [
        { advisor: "codex", vote: "approve", summary: "ok", parseStatus: "ok", evidenceRef: "plan.json" },
        { advisor: "claude", vote: "approve", summary: "ok", parseStatus: "fallback", evidenceRef: "c.txt" },
        { advisor: "gemini", vote: "abstain", summary: "n/a", parseStatus: "ok" },
        { advisor: "chatgpt", vote: "abstain", summary: "n/a", parseStatus: "invalid" }
      ],
      { external: true, strictExternal: true }
    );

    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.winner).toBe("abstain");
    expect(decision.conflicts.some((c) => c.includes("strict external"))).toBe(true);
  });

  it("allows strict external when at least one external advisor succeeds", () => {
    const decision = resolveConvergence(
      "plan",
      [
        { advisor: "codex", vote: "approve", summary: "ok", parseStatus: "ok", evidenceRef: "plan.json" },
        { advisor: "claude", vote: "abstain", summary: "timeout", parseStatus: "invalid", evidenceRef: "c.txt" },
        { advisor: "gemini", vote: "abstain", summary: "unavailable", parseStatus: "invalid", evidenceRef: "g.txt" },
        { advisor: "chatgpt", vote: "approve", summary: "ok", parseStatus: "ok", evidenceRef: "o.txt" }
      ],
      { external: true, strictExternal: true }
    );

    expect(decision.winner).toBe("approve");
    expect(decision.requiresHumanApproval).toBe(false);
  });
});
