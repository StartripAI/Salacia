import type { AdapterCapabilityMatrix } from "../core/types.js";
import type { ExecutorAdapter } from "./base.js";
import { AntigravityAdapter } from "./antigravity.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { ClineAdapter } from "./cline.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";
import { OpenCodeAdapter } from "./opencode.js";
import { VSCodeAdapter } from "./vscode.js";

const registry: ExecutorAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new OpenCodeAdapter(),
  new CursorAdapter(),
  new ClineAdapter(),
  new VSCodeAdapter(),
  new AntigravityAdapter()
];

export function buildAdapterRegistry(): ExecutorAdapter[] {
  return registry;
}

export async function adapterMatrix(cwd = process.cwd()): Promise<AdapterCapabilityMatrix[]> {
  return Promise.all(
    registry.map(async (adapter) => {
      const row = await adapter.matrixRow();
      if (adapter.name === "codex") {
        row.notes = [row.notes, "Windows route uses WSL"].filter(Boolean).join("; ");
      }
      return row;
    })
  );
}

export function findAdapter(name: string): ExecutorAdapter | undefined {
  return registry.find((adapter) => adapter.name === name);
}
