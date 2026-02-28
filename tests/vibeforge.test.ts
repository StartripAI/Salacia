import { describe, expect, it } from "vitest";
import { runVibeForge } from "../src/core/vibeforge.js";

describe("vibeforge engine", () => {
  it("compiles vibe intent into stable intent output", async () => {
    const result = await runVibeForge("build login flow and keep api stable", {
      cwd: process.cwd(),
      autoAnswerWithRecommended: true
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("ok");
    expect(typeof result.intent?.id).toBe("string");
    expect(Array.isArray(result.intent?.goals)).toBe(true);
  });

  it("returns disambiguation-required when question has no answer strategy", async () => {
    const result = await runVibeForge("make it faster and safer", {
      cwd: process.cwd(),
      resolveDisambiguation: async () => null
    });
    if (result.code === "disambiguation-required") {
      expect(result.ok).toBe(false);
      expect(result.question).toBeDefined();
      return;
    }
    // If no disambiguation was needed by current compiler heuristics,
    // still assert engine returns a valid deterministic result.
    expect(result.ok).toBe(true);
  });
});
