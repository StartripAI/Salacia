import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compilePromptInput } from "../src/prompt/compile.js";
import { applyDisambiguationAnswer } from "../src/prompt/disambiguate.js";
import { runMetamorphicTests } from "../src/prompt/metamorphic.js";
import { optimizePrompts } from "../src/prompt/optimize.js";

describe("prompt compiler", () => {
  it("compiles vague input into Intent IR with diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-prompt-"));
    const result = await compilePromptInput("build a robust todo app and keep rollback path", { cwd: root });

    expect(result.ir.goals.length).toBeGreaterThan(0);
    expect(result.ir.constraints.length).toBeGreaterThan(0);
    expect(result.metamorphic.passed).toBe(true);
  });

  it("asks a single disambiguation question for high-risk ambiguous input", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-prompt-risk-"));
    const result = await compilePromptInput("delete production auth database records quickly", { cwd: root });

    expect(result.ir.risk.score).toBeGreaterThanOrEqual(6);
    expect(result.question).not.toBeNull();

    const question = result.question!;
    const optionId = question.options[0]?.id ?? "safety-first";
    const answered = applyDisambiguationAnswer(result.ir, question, optionId);
    const test = runMetamorphicTests(result.baseline, answered);
    expect(test.passed).toBe(true);
  });

  it("detects semantic drift when constraints/non-goals are dropped", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-prompt-drift-"));
    const result = await compilePromptInput("implement feature and do not modify billing", { cwd: root });

    const broken = {
      ...result.ir,
      constraints: [],
      nonGoals: []
    };

    const test = runMetamorphicTests(result.baseline, broken);
    expect(test.passed).toBe(false);
    expect(test.checks.some((check) => check.ruleId === "non-goal-preservation" && !check.passed)).toBe(true);
  });
});

describe("prompt optimizer", () => {
  it("generates auditable prompt patches from repeated journal evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-optimize-"));
    const journalDir = path.join(root, ".salacia", "journal");
    await fs.mkdir(journalDir, { recursive: true });

    await fs.writeFile(
      path.join(journalDir, "run-1.json"),
      JSON.stringify({ error: "No 2/3 majority. Human approval required." }),
      "utf8"
    );
    await fs.writeFile(
      path.join(journalDir, "run-2.json"),
      JSON.stringify({ error: "No 2/3 majority. Human approval required." }),
      "utf8"
    );

    const report = await optimizePrompts({ cwd: root, fromJournal: true });
    expect(report.accepted).toBeGreaterThan(0);

    const patchDir = path.join(root, ".salacia", "journal", "prompt-patches");
    const files = await fs.readdir(patchDir);
    expect(files.length).toBeGreaterThan(0);
  });
});
