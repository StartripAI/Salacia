import { describe, expect, it } from "vitest";
import { A2ADispatcher } from "../src/protocols/acp.js";
import { McpGateway } from "../src/protocols/mcp.js";

describe("protocol gateways", () => {
  it("returns default MCP tool definitions", () => {
    const gateway = new McpGateway({ serverName: "salacia-mcp", serverVersion: "0.1.0" });
    const tools = gateway.getDefaultTools();
    expect(tools.map((t) => t.name)).toEqual([
      "salacia-contract-validate",
      "salacia-snapshot",
      "salacia-plan",
      "salacia-progress"
    ]);
  });

  it("validates ACP schema", async () => {
    const dispatcher = new A2ADispatcher();

    const invalid = await dispatcher.dispatch({
      id: "",
      type: "",
      payload: {},
      source: "",
      target: "",
      createdAt: ""
    });
    expect(invalid.ok).toBe(false);

    const valid = await dispatcher.dispatch({
      id: "m-1",
      type: "task",
      payload: { task: "x" },
      source: "salacia",
      target: "adapter",
      createdAt: new Date().toISOString()
    });
    expect(valid.ok).toBe(true);
  });
});
