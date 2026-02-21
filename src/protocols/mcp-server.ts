import fs from "node:fs/promises";
import path from "node:path";
import { createContractFromVibe, loadContract, validateContract } from "../core/contract.js";
import { ensureSalaciaDirs } from "../core/paths.js";
import { derivePlan, savePlan } from "../core/plan.js";
import { SnapshotManager } from "../guardian/snapshot.js";
import { McpGateway } from "./mcp.js";

export interface McpServerDescription {
  name: string;
  version: string;
  tools: Array<{ name: string; description: string }>;
}

export async function buildSalaciaMcpServerDescription(): Promise<McpServerDescription> {
  const gateway = new McpGateway({ serverName: "salacia-mcp", serverVersion: "0.1.0" });
  return {
    name: "salacia-mcp",
    version: "0.1.0",
    tools: gateway.getDefaultTools()
  };
}

export async function runSalaciaMcpServer(cwd = process.cwd()): Promise<void> {
  const gateway = new McpGateway({ serverName: "salacia-mcp", serverVersion: "0.1.0" });

  await gateway.startStdioServer({
    contractValidate: async ({ path: filePath }) => {
      const contract = await loadContract(path.resolve(cwd, filePath));
      const validation = validateContract(contract);
      return {
        ok: validation.valid,
        details: validation.valid ? "contract valid" : validation.errors.join("; ")
      };
    },
    snapshotCreate: async ({ label }) => {
      const manager = new SnapshotManager(cwd);
      const snapshot = await manager.createSnapshot(label ?? "mcp");
      return { ok: true, snapshotId: snapshot.id };
    },
    planGenerate: async ({ vibe }) => {
      const paths = await ensureSalaciaDirs(cwd);
      const contract = createContractFromVibe(vibe, "mcp");
      const plan = derivePlan(contract);
      const planPath = path.join(paths.plans, `${Date.now()}-mcp.json`);
      await savePlan(plan, planPath);
      return { ok: true, planPath };
    },
    progressRead: async ({ path: progressPath }) => {
      const full = path.resolve(cwd, progressPath);
      const content = await fs.readFile(full, "utf8");
      return { ok: true, content };
    }
  });
}
