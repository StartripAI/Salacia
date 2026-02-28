import { describe, expect, it } from "vitest";
import { aiderMirrorHealth } from "../src/vendor_wrappers/aider/index.js";
import { clineMirrorHealth } from "../src/vendor_wrappers/cline/index.js";
import { continueMirrorHealth } from "../src/vendor_wrappers/continue/index.js";

describe("vendor wrapper mirror health", () => {
  it("aider mirror metadata is healthy", async () => {
    const health = await aiderMirrorHealth(process.cwd());
    expect(health.ok).toBe(true);
    expect(health.source?.commit.length).toBe(40);
  });

  it("cline mirror metadata is healthy", async () => {
    const health = await clineMirrorHealth(process.cwd());
    expect(health.ok).toBe(true);
    expect(health.source?.repo).toContain("github.com/cline/cline");
  });

  it("continue mirror metadata is healthy", async () => {
    const health = await continueMirrorHealth(process.cwd());
    expect(health.ok).toBe(true);
    expect(health.source?.license).toBe("Apache-2.0");
  });

  it("wrapper health exposes synced timestamp", async () => {
    const health = await aiderMirrorHealth(process.cwd());
    expect(typeof health.source?.syncedAt).toBe("string");
    expect((health.source?.syncedAt ?? "").length).toBeGreaterThan(10);
  });
});
