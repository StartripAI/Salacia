import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error importing local ESM script helper without ambient typings
import { buildRepoContext, extractIssueKeywords } from "../scripts/repo-context-builder.mjs";

describe("repo context builder", () => {
  it("extracts stable keywords from issue text", () => {
    const keywords = extractIssueKeywords(
      "translate_url() creates incorrect URL when optional named groups are missing in URL pattern"
    );
    expect(keywords).toContain("translate_url");
    expect(keywords.some((item: string) => item.toLowerCase().includes("optional"))).toBe(true);
  });

  it("builds relevant files, repo map, and snippets", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-repo-context-"));
    const srcDir = path.join(tmp, "src");
    const testsDir = path.join(tmp, "tests");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(testsDir, { recursive: true });

    await fs.writeFile(
      path.join(srcDir, "router.py"),
      [
        "class Router:",
        "    def translate_url(self, value, optional=None):",
        "        if optional is None:",
        "            return value",
        "        return f\"{value}/{optional}\""
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(testsDir, "test_router.py"),
      [
        "from src.router import Router",
        "",
        "def test_translate_url_optional():",
        "    assert Router().translate_url('a') == 'a'"
      ].join("\n"),
      "utf8"
    );

    const context = await buildRepoContext(
      tmp,
      "translate_url optional groups missing; add test coverage and keep behavior stable",
      { maxFiles: 4, maxSnippetChars: 4_000 }
    );

    expect(Array.isArray(context.keywords)).toBe(true);
    expect(context.relevantFiles.length).toBeGreaterThan(0);
    expect(context.repoMap).toContain("router.py");
    expect(context.codeSnippets).toContain("translate_url");
  });
});

