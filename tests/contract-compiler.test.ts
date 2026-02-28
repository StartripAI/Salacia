import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error local ESM helper without ambient typings
import { createMiniContract, validatePatchAgainstContract } from "../scripts/contract-compiler.mjs";

describe("benchmark contract compiler", () => {
  it("creates mini-contract with in-scope and verification commands", () => {
    const repo = "/tmp/repo";
    const contract = createMiniContract(
      repo,
      {
        instance_id: "django__django-14765",
        problem_statement: "ProjectState init should assert set"
      },
      {
        symptom: "ProjectState init issue",
        goals: ["assert set"],
        constraints: ["minimal change"],
        nonGoals: ["refactor"],
        acceptanceCriteria: ["tests pass"],
        affectedAreas: [path.join(repo, "django", "db", "migrations", "state.py")]
      },
      {
        rankedFiles: [{ path: path.join(repo, "django", "db", "migrations", "state.py"), score: 60, hitCount: 5 }]
      },
      {
        skipped: false,
        command: "python3",
        args: ["-m", "pytest", "-q", "tests/migrations/test_state.py"]
      }
    );

    expect(contract.contractId).toMatch(/^swebench-/);
    expect(contract.scope.inScope.some((rule: string) => rule.includes("state.py"))).toBe(true);
    expect(contract.verification.commands[0]).toContain("pytest");
  });

  it("flags protected-path and scope-drift violations", () => {
    const repo = "/tmp/repo";
    const contract = {
      scope: {
        inScope: ["src/**"]
      },
      guardrails: {
        protectedPaths: [".env", "secrets/**"]
      }
    };

    const check = validatePatchAgainstContract(repo, contract, [
      "/tmp/repo/src/main.ts",
      "/tmp/repo/.env",
      "/tmp/repo/docs/readme.md"
    ]);

    expect(check.ok).toBe(false);
    expect(check.violations.some((v: { code: string }) => v.code === "protected-path")).toBe(true);
    expect(check.violations.some((v: { code: string }) => v.code === "scope-drift")).toBe(true);
  });
});

