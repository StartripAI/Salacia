/**
 * File 4: Convergence Protocol (14 tests)
 * Proves: Multi-advisor voting, conflict detection, human-in-the-loop triggers.
 */
import { describe, expect, it } from "vitest";
import { resolveConvergence } from "../../src/core/converge.js";
import type { AdvisorOpinion } from "../../src/core/types.js";

function opinion(advisor: AdvisorOpinion["advisor"], vote: AdvisorOpinion["vote"], opts: { parse?: "ok" | "fallback" | "invalid"; ref?: string } = {}): AdvisorOpinion {
    return { advisor, vote, summary: `${vote} from ${advisor}`, parseStatus: opts.parse ?? "ok", ...(opts.ref ? { evidenceRef: opts.ref } : {}) };
}

describe("Convergence Protocol", () => {
    it("G01: 3 approve → winner=approve, no human approval", () => {
        const d = resolveConvergence("plan", [opinion("claude", "approve"), opinion("gemini", "approve"), opinion("codex", "approve")]);
        expect(d.winner).toBe("approve");
        expect(d.requiresHumanApproval).toBe(false);
    });

    it("G02: 3 reject → winner=reject", () => {
        const d = resolveConvergence("plan", [opinion("claude", "reject"), opinion("gemini", "reject"), opinion("codex", "reject")]);
        expect(d.winner).toBe("reject");
    });

    it("G03: 3 abstain → requiresHumanApproval=true", () => {
        const d = resolveConvergence("exec", [opinion("claude", "abstain"), opinion("gemini", "abstain"), opinion("codex", "abstain")]);
        expect(d.winner).toBe("abstain");
        expect(d.requiresHumanApproval).toBe(true);
    });

    it("G04: 2 approve, 1 reject → winner=approve", () => {
        const d = resolveConvergence("plan", [opinion("claude", "approve"), opinion("gemini", "approve"), opinion("codex", "reject")]);
        expect(d.winner).toBe("approve");
    });

    it("G05: 2 reject, 1 approve → winner=reject", () => {
        const d = resolveConvergence("plan", [opinion("claude", "reject"), opinion("gemini", "reject"), opinion("codex", "approve")]);
        expect(d.winner).toBe("reject");
    });

    it("G06: 1/1/1 split → requiresHumanApproval=true", () => {
        const d = resolveConvergence("plan", [opinion("claude", "approve"), opinion("gemini", "reject"), opinion("codex", "abstain")]);
        expect(d.requiresHumanApproval).toBe(true);
        expect(d.conflicts.length).toBeGreaterThan(0);
    });

    it("G07: empty advisors → requiresHumanApproval=true", () => {
        const d = resolveConvergence("exec", []);
        expect(d.requiresHumanApproval).toBe(true);
    });

    it("G08: single advisor → not enough for majority", () => {
        const d = resolveConvergence("plan", [opinion("claude", "approve")]);
        // Single advisor can't form 2/3 majority
        expect(d.requiresHumanApproval).toBe(true);
    });

    it("G09: invalid parseStatus → counted as conflict", () => {
        const d = resolveConvergence("plan", [
            opinion("claude", "approve", { parse: "ok" }),
            opinion("gemini", "approve", { parse: "invalid" }),
            opinion("codex", "approve", { parse: "invalid" }),
        ]);
        expect(d.conflicts.length).toBeGreaterThanOrEqual(2);
    });

    it("G10: all invalid → all conflicts", () => {
        const d = resolveConvergence("plan", [
            opinion("claude", "abstain", { parse: "invalid" }),
            opinion("gemini", "abstain", { parse: "invalid" }),
            opinion("codex", "abstain", { parse: "invalid" }),
        ]);
        expect(d.conflicts.length).toBeGreaterThanOrEqual(3);
        expect(d.requiresHumanApproval).toBe(true);
    });

    it("G11: votes object counts correct", () => {
        const d = resolveConvergence("plan", [opinion("claude", "approve"), opinion("gemini", "reject"), opinion("codex", "abstain")]);
        expect(d.votes.approve).toBe(1);
        expect(d.votes.reject).toBe(1);
        expect(d.votes.abstain).toBe(1);
    });

    it("G12: conflicts list populated with reasons", () => {
        const d = resolveConvergence("plan", [opinion("claude", "approve"), opinion("gemini", "reject"), opinion("codex", "abstain")]);
        expect(d.conflicts.length).toBeGreaterThan(0);
        expect(d.conflicts.every((c) => c.length > 0)).toBe(true);
    });

    it("G13: evidenceRefs collected from advisors", () => {
        const d = resolveConvergence("plan", [
            opinion("claude", "approve", { ref: "claude.json" }),
            opinion("gemini", "approve", { ref: "gemini.json" }),
            opinion("codex", "approve"),
        ]);
        expect(d.evidenceRefs).toContain("claude.json");
        expect(d.evidenceRefs).toContain("gemini.json");
    });

    it("G14: stage propagated", () => {
        const plan = resolveConvergence("plan", [opinion("claude", "approve"), opinion("gemini", "approve"), opinion("codex", "approve")]);
        const exec = resolveConvergence("exec", [opinion("claude", "approve"), opinion("gemini", "approve"), opinion("codex", "approve")]);
        expect(plan.stage).toBe("plan");
        expect(exec.stage).toBe("exec");
    });
});
