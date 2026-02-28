import { describe, expect, it } from "vitest";
import {
  dispatchExecutionCoordination,
  isCoordinationProtocol
} from "../src/harness/protocol-dispatch.js";

describe("execution coordination dispatch", () => {
  it("validates supported protocol values", () => {
    expect(isCoordinationProtocol("none")).toBe(true);
    expect(isCoordinationProtocol("mcp")).toBe(true);
    expect(isCoordinationProtocol("acp-a2a")).toBe(true);
    expect(isCoordinationProtocol("acp-opencode")).toBe(true);
    expect(isCoordinationProtocol("acp-mesh")).toBe(true);
    expect(isCoordinationProtocol("invalid")).toBe(false);
  });

  it("returns no-op result when protocol is none", async () => {
    const result = await dispatchExecutionCoordination({
      protocol: "none",
      phase: "pre-exec",
      cwd: process.cwd(),
      adapterName: "codex",
      contractId: "c-1",
      stepCount: 3
    });
    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(false);
  });

  it("dispatches execution envelope through ACP A2A", async () => {
    const result = await dispatchExecutionCoordination({
      protocol: "acp-a2a",
      phase: "post-exec",
      cwd: process.cwd(),
      adapterName: "codex",
      contractId: "c-2",
      stepCount: 2,
      payload: { failed: 0 }
    });
    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(true);
    expect(result.response?.ack).toBe(true);
  });

  it("dispatches execution envelope through ACP mesh", async () => {
    const result = await dispatchExecutionCoordination({
      protocol: "acp-mesh",
      phase: "post-exec",
      cwd: process.cwd(),
      adapterName: "codex",
      contractId: "c-2",
      stepCount: 2
    });
    expect(result.ok).toBe(true);
    expect(result.attempted).toBe(true);
    expect(typeof result.response?.mode).toBe("string");
  });

  it("returns failed result when MCP command cannot start", async () => {
    const result = await dispatchExecutionCoordination({
      protocol: "mcp",
      phase: "pre-exec",
      cwd: process.cwd(),
      adapterName: "codex",
      contractId: "c-3",
      stepCount: 1,
      mcpCommand: {
        command: "node",
        args: ["-e", "process.exit(1)"]
      }
    });
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(false);
  });
});
