import fs from "node:fs/promises";
import path from "node:path";
import { loadContract } from "../core/contract.js";
import { ensureSalaciaDirs, latestFileInDir } from "../core/paths.js";

export interface PromptCompileContext {
  cwd: string;
  repoName: string;
  latestContractPath: string | null;
  latestSpecPath: string | null;
  establishedGoals: string[];
  establishedConstraints: string[];
  establishedAreas: string[];
}

function inferRepoName(cwd: string): string {
  return path.basename(cwd);
}

export async function loadPromptContext(cwd = process.cwd()): Promise<PromptCompileContext> {
  const paths = await ensureSalaciaDirs(cwd);
  const [latestContractPath, latestSpecPath] = await Promise.all([
    latestFileInDir(paths.contracts, ".yaml"),
    latestFileInDir(paths.specs, ".md")
  ]);

  const establishedGoals: string[] = [];
  const establishedConstraints: string[] = [];
  const establishedAreas: string[] = [];

  if (latestContractPath) {
    const contract = await loadContract(latestContractPath).catch(() => null);
    if (contract) {
      establishedGoals.push(...contract.intent.goals);
      establishedConstraints.push(...contract.intent.constraints);
      establishedAreas.push(...contract.scope.inScope);
    }
  }

  if (latestSpecPath) {
    const raw = await fs.readFile(latestSpecPath, "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("- ")) continue;
      if (/scope|in scope|out of scope/i.test(trimmed)) {
        establishedAreas.push(trimmed.slice(2));
      }
    }
  }

  return {
    cwd,
    repoName: inferRepoName(cwd),
    latestContractPath,
    latestSpecPath,
    establishedGoals: Array.from(new Set(establishedGoals.map((item) => item.trim()).filter(Boolean))),
    establishedConstraints: Array.from(new Set(establishedConstraints.map((item) => item.trim()).filter(Boolean))),
    establishedAreas: Array.from(new Set(establishedAreas.map((item) => item.trim()).filter(Boolean)))
  };
}
