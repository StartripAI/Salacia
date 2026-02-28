import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error local ESM helper without ambient typings
import { buildTreeSitterRepoMap } from "../scripts/tree-sitter-repo-map.mjs";

describe("tree-sitter repo map", () => {
  it("builds symbol graph artifacts with ranked files and symbols", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-repo-map-"));
    const srcDir = path.join(tmp, "src");
    await fs.mkdir(srcDir, { recursive: true });

    const authPath = path.join(srcDir, "auth.js");
    const repoPath = path.join(srcDir, "repo.js");

    await fs.writeFile(
      authPath,
      [
        "import { saveUser } from './repo.js';",
        "export class AuthService {",
        "  validateLogin(user, pass) {",
        "    return Boolean(user) && pass.length > 7;",
        "  }",
        "  register(user) {",
        "    return saveUser(user);",
        "  }",
        "}",
        "export function normalizeUser(value) {",
        "  return String(value).trim();",
        "}"
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      repoPath,
      [
        "export function saveUser(user) {",
        "  return { id: 1, ...user };",
        "}"
      ].join("\n"),
      "utf8"
    );

    const map = await buildTreeSitterRepoMap(
      [
        {
          path: authPath,
          score: 120,
          hitCount: 5,
          sampleLines: [{ query: "validateLogin", line: 3, preview: "validateLogin bug" }]
        },
        {
          path: repoPath,
          score: 40,
          hitCount: 1,
          sampleLines: [{ query: "saveUser", line: 1, preview: "saveUser persistence" }]
        }
      ],
      { maxFiles: 2, maxSymbolsPerFile: 8, maxPromptFiles: 2, maxPromptSymbols: 8 }
    );

    expect(["tree-sitter", "fallback-regex"]).toContain(map.engine);
    expect(map.rankingMethod).toBe("v1");
    expect(map.nodes).toBeGreaterThan(0);
    expect(map.edges).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(map.graph?.nodes)).toBe(true);
    expect(Array.isArray(map.graph?.edges)).toBe(true);
    expect(map.topFiles.length).toBeGreaterThan(0);
    expect(map.topSymbols.length).toBeGreaterThan(0);
    expect(map.text).toContain("Top files");
    expect(map.text).toContain("Top symbols");
    expect(map.topSymbols[0]).toHaveProperty("line");
    expect(map.topSymbols[0]).toHaveProperty("rank");
  });

  it("keeps target source file ranked above docs in known fixture", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-repo-map-rank-"));
    const srcDir = path.join(tmp, "src");
    const docsDir = path.join(tmp, "docs");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(docsDir, { recursive: true });

    const targetPath = path.join(srcDir, "fields.py");
    const docsPath = path.join(docsDir, "fields.md");

    await fs.writeFile(
      targetPath,
      [
        "class DecimalField:",
        "    def to_python(self, value):",
        "        return Decimal(value)"
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      docsPath,
      "DecimalField docs and migration notes. to_python behavior summary.",
      "utf8"
    );

    const map = await buildTreeSitterRepoMap(
      [
        {
          path: targetPath,
          score: 110,
          hitCount: 4,
          sampleLines: [{ query: "to_python", line: 2, preview: "to_python raises error" }]
        },
        {
          path: docsPath,
          score: 10,
          hitCount: 1,
          sampleLines: [{ query: "docs", line: 1, preview: "documentation" }]
        }
      ],
      { maxFiles: 2, maxSymbolsPerFile: 6, maxPromptFiles: 2, maxPromptSymbols: 6 }
    );

    const target = map.files.find((file: { path: string }) => file.path === targetPath);
    const docs = map.files.find((file: { path: string }) => file.path === docsPath);
    expect(target).toBeDefined();
    expect(docs).toBeDefined();
    expect(Number(target!.rank)).toBeGreaterThan(Number(docs!.rank));
  });
});
