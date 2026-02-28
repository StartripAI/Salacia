import { describe, expect, it } from "vitest";
import { createContractFromVibe } from "../src/core/contract.js";
import { postToolUseHook, preToolUseHook, stopHook } from "../src/harness/hooks.js";

describe("harness hooks", () => {
  it("preToolUseHook blocks writes to protected paths", () => {
    const contract = createContractFromVibe("hook test");
    contract.guardrails.protectedPaths = ["secrets/", ".env"];

    const decision = preToolUseHook({
      contract,
      action: "edit",
      targetPath: "secrets/token.txt"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason.toLowerCase()).toContain("protected path");
  });

  it("preToolUseHook allows safe paths", () => {
    const contract = createContractFromVibe("hook test");
    contract.guardrails.protectedPaths = ["secrets/"];

    const decision = preToolUseHook({
      contract,
      action: "edit",
      targetPath: "src/main.ts"
    });

    expect(decision.allowed).toBe(true);
  });

  it("preToolUseHook defaults to allow when target is missing", () => {
    const contract = createContractFromVibe("hook test");
    contract.guardrails.protectedPaths = ["secrets/"];
    const decision = preToolUseHook({ contract, action: "scan" });
    expect(decision.allowed).toBe(true);
  });

  it("postToolUseHook always records a note", () => {
    const contract = createContractFromVibe("hook test");
    const result = postToolUseHook({
      contract,
      action: "write",
      targetPath: "src/file.ts"
    });

    expect(result.ok).toBe(true);
    expect(result.note).toContain("write");
  });

  it("stopHook enforces verification before completion", () => {
    const contract = createContractFromVibe("hook test");
    const result = stopHook({ contract, action: "stop" });
    expect(result.shouldVerify).toBe(true);
    expect(result.note).toContain(contract.identity.id);
  });
});
