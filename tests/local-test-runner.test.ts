import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error importing local ESM script helper without ambient typings
import { buildLocalTestPlan, runLocalTestPlan, runMinimalVerification } from "../scripts/local-test-runner.mjs";

describe("local test runner", () => {
  it("selects python pytest command when python markers exist", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-local-test-python-"));
    await fs.writeFile(path.join(tmp, "pyproject.toml"), "[project]\nname='demo'\n", "utf8");
    await fs.mkdir(path.join(tmp, "tests"), { recursive: true });
    await fs.writeFile(path.join(tmp, "tests", "test_demo.py"), "def test_ok():\n    assert True\n", "utf8");

    const plan = await buildLocalTestPlan(
      tmp,
      { repo: "demo/repo" },
      { relevantFiles: [{ path: path.join(tmp, "tests", "test_demo.py") }] }
    );

    expect(plan.skipped).toBe(false);
    expect(plan.command).toBe("python3");
    expect(Array.isArray(plan.args)).toBe(true);
    expect(plan.args.join(" ")).toContain("pytest");
    expect(plan.args.join(" ")).toContain("tests/test_demo.py");
  });

  it("runs selected node tests for javascript projects", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-local-test-js-"));
    await fs.mkdir(path.join(tmp, "test"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, "package.json"),
      JSON.stringify({ name: "demo", private: true, type: "module" }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(tmp, "test", "demo.test.js"),
      [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "test('ok', () => {",
        "  assert.equal(1 + 1, 2);",
        "});"
      ].join("\n"),
      "utf8"
    );

    const plan = await buildLocalTestPlan(
      tmp,
      { repo: "demo/repo" },
      { relevantFiles: [{ path: path.join(tmp, "test", "demo.test.js") }] }
    );
    const result = await runLocalTestPlan(tmp, plan, 30_000);

    expect(result.skipped).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.command).toContain("node --test");
  });

  it("runs minimal verification and reports workspace conflicts status", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-local-minimal-"));
    await fs.writeFile(path.join(tmp, "app.txt"), "hello\n", "utf8");

    const result = await runMinimalVerification(tmp);
    expect(result.ok).toBe(false);
    expect(result.command).toContain("git status");
    expect(result.reason).toContain("failed");
  });
});
