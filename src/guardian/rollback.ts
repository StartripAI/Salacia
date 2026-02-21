import { exec } from "node:child_process";
import { promisify } from "node:util";
import { SnapshotManager } from "./snapshot.js";

const execAsync = promisify(exec);

export interface RollbackOptions {
  verificationCommands?: string[];
  retries?: number;
  cwd?: string;
}

export class RollbackEngine {
  constructor(private readonly snapshotManager: SnapshotManager) {}

  async rollback(snapshotId: string, options: RollbackOptions = {}): Promise<void> {
    const retries = options.retries ?? 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        await this.snapshotManager.restoreSnapshot(snapshotId);
        await this.runPostRollbackVerification(options.verificationCommands ?? ["git rev-parse --is-inside-work-tree"], options.cwd);
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt <= retries) {
          continue;
        }
      }
    }

    throw new Error(`Rollback failed after retries: ${lastError?.message ?? "unknown"}`);
  }

  private async runPostRollbackVerification(commands: string[], cwd = process.cwd()): Promise<void> {
    for (const command of commands) {
      await execAsync(command, { cwd, maxBuffer: 5 * 1024 * 1024 });
    }
  }
}
