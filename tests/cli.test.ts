import { describe, expect, it } from "vitest";
import { buildAdapterRegistry } from "../src/adapters/registry.js";

describe("adapter registry", () => {
  it("contains required adapter targets", () => {
    const names = buildAdapterRegistry().map((a) => a.name);
    expect(names).toContain("claude-code");
    expect(names).toContain("codex");
    expect(names).toContain("opencode");
    expect(names).toContain("cursor");
    expect(names).toContain("cline");
    expect(names).toContain("vscode");
    expect(names).toContain("antigravity");
  });
});
