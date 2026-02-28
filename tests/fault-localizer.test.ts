import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error local ESM helper without ambient typings
import { extractFaultSignals, localizeFault } from "../scripts/fault-localizer.mjs";

describe("fault localizer", () => {
  it("extracts high-signal queries from issue text", () => {
    const signals = extractFaultSignals(
      "DecimalField.to_python() raises TypeError on dict input in django/forms/fields.py",
      "should raise ValidationError and add tests"
    );
    expect(signals.queries.some((item: string) => item.includes("DecimalField"))).toBe(true);
    expect(signals.explicitPaths).toContain("django/forms/fields.py");
  });

  it("ranks likely source files and produces snippets", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-fault-localizer-"));
    const src = path.join(tmp, "src");
    const docs = path.join(tmp, "docs");
    await fs.mkdir(src, { recursive: true });
    await fs.mkdir(docs, { recursive: true });

    await fs.writeFile(
      path.join(src, "fields.py"),
      [
        "class DecimalField:",
        "    def to_python(self, value):",
        "        return Decimal(value)"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(docs, "fields.md"),
      "DecimalField docs and migration notes",
      "utf8"
    );

    const result = await localizeFault(
      tmp,
      "DecimalField.to_python raises TypeError",
      "fix in src/fields.py and verify tests",
      { maxFiles: 4, maxSnippetChars: 4_000 }
    );

    expect(result.rankedFiles.length).toBeGreaterThan(0);
    expect(result.rankedFiles[0]?.path.endsWith("src/fields.py")).toBe(true);
    const docsEntry = result.rankedFiles.find((item: { path: string }) => item.path.endsWith("docs/fields.md"));
    if (docsEntry) {
      expect(result.rankedFiles[0].score).toBeGreaterThan(docsEntry.score);
    }
    expect(result.snippets).toContain("to_python");
  });
});
