import fs from "node:fs/promises";
import path from "node:path";
import type { Plan } from "../core/types.js";
import { getSalaciaPaths } from "../core/paths.js";

export interface ProgressItem {
  id: string;
  title: string;
  status: "todo" | "doing" | "done" | "failed";
  updatedAt: string;
  passes: boolean;
}

export interface ProgressFile {
  generatedAt: string;
  contractId: string;
  items: ProgressItem[];
}

export class ProgressTracker {
  constructor(private readonly root = process.cwd()) {}

  get progressFilePath(): string {
    return path.join(getSalaciaPaths(this.root).progress, "salacia-progress.json");
  }

  async initializeFromPlan(plan: Plan): Promise<ProgressFile> {
    const progress: ProgressFile = {
      generatedAt: new Date().toISOString(),
      contractId: plan.contractId,
      items: plan.steps.map((step) => ({
        id: step.id,
        title: step.id,
        status: "todo",
        updatedAt: new Date().toISOString(),
        passes: false
      }))
    };
    await this.write(progress);
    return progress;
  }

  async read(): Promise<ProgressFile | null> {
    const raw = await fs.readFile(this.progressFilePath, "utf8").catch(() => "");
    if (!raw) return null;
    return JSON.parse(raw) as ProgressFile;
  }

  async write(progress: ProgressFile): Promise<void> {
    await fs.mkdir(path.dirname(this.progressFilePath), { recursive: true });
    await fs.writeFile(this.progressFilePath, JSON.stringify(progress, null, 2), "utf8");
  }

  async updateStep(id: string, status: ProgressItem["status"], passes: boolean): Promise<ProgressFile | null> {
    const progress = await this.read();
    if (!progress) return null;
    const item = progress.items.find((i) => i.id === id);
    if (!item) return progress;

    item.status = status;
    item.passes = passes;
    item.updatedAt = new Date().toISOString();
    await this.write(progress);
    return progress;
  }
}
