import { describe, expect, it } from "vitest";
// @ts-expect-error importing local ESM script helper without ambient typings
import { buildRealTaskPrompt, parseModelChain } from "../scripts/public-benchmark-utils.mjs";

describe("public benchmark utilities", () => {
  it("parses default and explicit model chain deterministically", () => {
    const codexDefault = parseModelChain(undefined, "codex", undefined);
    expect(codexDefault).toEqual(["gpt-5.2-codex", "gpt-5.1-codex", "gpt-5-codex"]);
    const aiderDefault = parseModelChain(undefined, "aider", undefined);
    expect(aiderDefault).toEqual(["default"]);

    const explicit = parseModelChain("gpt-5.1-codex,gpt-5-codex", "codex", "gpt-5.2-codex");
    expect(explicit).toEqual(["gpt-5.2-codex", "gpt-5.1-codex", "gpt-5-codex"]);
  });

  it("builds scaffold prompt and bare prompt on separate branches", () => {
    const instance = {
      instance_id: "pallets__flask-5014",
      problem_statement: "Fix login bug without breaking API",
      hints_text: "login validator lives near auth handlers"
    };

    const scaffold = buildRealTaskPrompt(instance, "/tmp/repo", true, {
      keywords: ["validateLogin", "auth", "tests/auth.test.js"],
      relevantFiles: [
        { path: "/tmp/repo/src/auth.js", hitCount: 4, sampleLines: [] },
        { path: "/tmp/repo/tests/auth.test.js", hitCount: 2, sampleLines: [] }
      ],
      repoMap: "- /tmp/repo/src/auth.js (hits=4)\n- /tmp/repo/tests/auth.test.js (hits=2)",
      codeSnippets: "# /tmp/repo/src/auth.js\nL10: export function validateLogin() {}"
    });
    const bare = buildRealTaskPrompt(instance, "/tmp/repo", false);

    expect(scaffold).toContain("Salacia scaffold guidance");
    expect(scaffold).toContain("Task instance: pallets__flask-5014");
    expect(scaffold).toContain("Repository context precomputed by Salacia");
    expect(scaffold).toContain("Fault localization pre-pass");
    expect(scaffold).toContain("Intent IR (sublimated from issue)");
    expect(scaffold).toContain("Execution contract boundary");
    expect(scaffold).toContain("validateLogin");
    expect(scaffold).toContain("PHASE 1 — LOCATE");
    expect(scaffold).toContain("Hints:");

    expect(bare).toContain("Minimal execution rules");
    expect(bare).toContain("Fix login bug without breaking API");
    expect(bare).not.toContain("Salacia scaffold guidance");
  });

  it("injects benchmark standard label into scaffold prompt", () => {
    const instance = {
      instance_id: "pallets__flask-5014",
      problem_statement: "Fix login bug without breaking API",
      hints_text: ""
    };
    const prompt = buildRealTaskPrompt(instance, "/tmp/repo", true, null, "SWE-bench Pro");
    expect(prompt).toContain("You are solving one SWE-bench Pro task in repository /tmp/repo.");
  });
});
