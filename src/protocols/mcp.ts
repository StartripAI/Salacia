import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export interface McpGatewayConfig {
  serverName: string;
  serverVersion: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
}

export interface McpToolHandlers {
  contractValidate: (input: { path: string }) => Promise<{ ok: boolean; details: string }>;
  snapshotCreate: (input: { label?: string }) => Promise<{ ok: boolean; snapshotId: string }>;
  planGenerate: (input: { vibe: string }) => Promise<{ ok: boolean; planPath: string }>;
  progressRead: (input: { path: string }) => Promise<{ ok: boolean; content: string }>;
}

export class McpGateway {
  constructor(private readonly config: McpGatewayConfig) {}

  createServer(handlers: McpToolHandlers): McpServer {
    const server = new McpServer({
      name: this.config.serverName,
      version: this.config.serverVersion
    });

    server.registerTool(
      "salacia-contract-validate",
      {
        description: "Validate a Salacia contract by file path",
        inputSchema: z.object({ path: z.string().min(1) })
      },
      async ({ path }) => {
        const out = await handlers.contractValidate({ path });
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out
        };
      }
    );

    server.registerTool(
      "salacia-snapshot",
      {
        description: "Create a Salacia snapshot",
        inputSchema: z.object({ label: z.string().optional() })
      },
      async ({ label }) => {
        const out = await handlers.snapshotCreate(label ? { label } : {});
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out
        };
      }
    );

    server.registerTool(
      "salacia-plan",
      {
        description: "Generate a plan from vibe",
        inputSchema: z.object({ vibe: z.string().min(1) })
      },
      async ({ vibe }) => {
        const out = await handlers.planGenerate({ vibe });
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out
        };
      }
    );

    server.registerTool(
      "salacia-progress",
      {
        description: "Read progress artifact",
        inputSchema: z.object({ path: z.string().min(1) })
      },
      async ({ path }) => {
        const out = await handlers.progressRead({ path });
        return {
          content: [{ type: "text", text: JSON.stringify(out) }],
          structuredContent: out
        };
      }
    );

    return server;
  }

  async startStdioServer(handlers: McpToolHandlers): Promise<void> {
    const server = this.createServer(handlers);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  getDefaultTools(): McpToolDefinition[] {
    return [
      { name: "salacia-contract-validate", description: "Validate contract" },
      { name: "salacia-snapshot", description: "Create snapshot" },
      { name: "salacia-plan", description: "Generate plan" },
      { name: "salacia-progress", description: "Read progress" }
    ];
  }

  describe(): string {
    return `${this.config.serverName}@${this.config.serverVersion}`;
  }
}

export async function callSalaciaMcpTool(options: {
  command: string;
  args: string[];
  toolName: string;
  toolArgs: Record<string, unknown>;
  cwd: string;
}): Promise<{ ok: boolean; output: string }> {
  const transport = new StdioClientTransport({
    command: options.command,
    args: options.args,
    cwd: options.cwd
  });

  const client = new Client({ name: "salacia-mcp-client", version: "0.1.0" });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: options.toolName,
      arguments: options.toolArgs
    });
    return {
      ok: true,
      output: JSON.stringify(result, null, 2)
    };
  } catch (error) {
    return {
      ok: false,
      output: (error as Error).message
    };
  } finally {
    await transport.close();
  }
}
