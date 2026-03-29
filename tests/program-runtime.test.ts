import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildContextPack } from "../src/context/pack.js";
import { compileProgramMarkdown, validateProgramMarkdown } from "../src/runtime/program.js";
import { runBlueprint } from "../src/runtime/run.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

describe("v0.2 runtime model", () => {
  it("validates required program.md sections and surface overlap", () => {
    const invalid = [
      "# Program",
      "",
      "## Goal",
      "- ship",
      "",
      "## Mutable Surface",
      "- src/**",
      "",
      "## Protected Surface",
      "- src/**"
    ].join("\n");

    const result = validateProgramMarkdown(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.some((item) => item.includes("constraints"))).toBe(true);
    expect(result.errors.some((item) => item.includes("overlap"))).toBe(true);
  });

  it("compiles program markdown into a blueprint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-program-"));
    const programPath = path.join(root, "program.md");
    await fs.writeFile(
      programPath,
      [
        "# Program",
        "",
        "## Goal",
        "- Deliver a bounded harness run.",
        "",
        "## Constraints",
        "- Keep it auditable.",
        "",
        "## Mutable Surface",
        "- src/**",
        "",
        "## Protected Surface",
        "- .salacia/**",
        "",
        "## Success Metrics",
        "- Verification passes.",
        "",
        "## Budget",
        "- maxFiles: 4",
        "- maxSymbols: 10",
        "",
        "## Verification",
        "- node -e \"process.exit(0)\"",
        "",
        "## Promotion Policy",
        "- Accept verified patches."
      ].join("\n"),
      "utf8"
    );

    const blueprint = await compileProgramMarkdown(programPath);
    expect(blueprint.goal).toContain("bounded harness run");
    expect(blueprint.budget.maxFiles).toBe(4);
    expect(blueprint.verificationCommands[0]).toContain("process.exit(0)");
  });

  it("builds a context pack and runs a judged harness flow", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-run-v2-"));
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "salacia@example.com"]);
    await git(root, ["config", "user.name", "Salacia"]);

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
    await fs.writeFile(
      path.join(root, "program.md"),
      [
        "# Program",
        "",
        "## Goal",
        "- Sync a VS Code verification task.",
        "",
        "## Constraints",
        "- Keep the run reviewable.",
        "",
        "## Mutable Surface",
        "- .vscode/**",
        "",
        "## Protected Surface",
        "- .salacia/**",
        "- src/**",
        "",
        "## Success Metrics",
        "- Verification passes.",
        "",
        "## Budget",
        "- maxFiles: 4",
        "- maxSymbols: 8",
        "",
        "## Verification",
        "- node -e \"process.exit(0)\"",
        "",
        "## Promotion Policy",
        "- Accept verified patches."
      ].join("\n"),
      "utf8"
    );
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "seed"]);

    const blueprint = await compileProgramMarkdown(path.join(root, "program.md"));
    const context = await buildContextPack(root, blueprint);
    expect(context.workingSet.relevantFiles.length).toBeGreaterThan(0);

    const result = await runBlueprint({
      root,
      blueprint,
      adapterName: "vscode",
      dryRun: false,
      mode: "auto"
    });

    expect(result.summary.status).toBe("accepted");
    expect(result.judge.judgeDecision).toBe("accept");
    expect(result.summary.changedFiles).toContain(".vscode/tasks.json");
  }, 120_000);
});
