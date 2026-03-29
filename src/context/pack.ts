import fs from "node:fs/promises";
import { buildWorkingSet } from "./working-set.js";
import { buildRankedRepoMap } from "./repo-map.js";
import type { Blueprint, ContextPack, RunHistoryEntry, RunSessionSummary } from "../core/types.js";
import { ensureSalaciaDirs, getRunPaths, getSalaciaPaths } from "../core/paths.js";

async function loadRunHistory(root: string, limit: number): Promise<RunHistoryEntry[]> {
  const runsRoot = getSalaciaPaths(root).runs;
  const dirs = await fs.readdir(runsRoot).catch(() => []);
  const ranked = await Promise.all(
    dirs.map(async (runId) => {
      const summaryPath = getRunPaths(root, runId).summary;
      const stat = await fs.stat(summaryPath).catch(() => null);
      return stat ? { runId, summaryPath, mtimeMs: stat.mtimeMs } : null;
    })
  );
  const filtered = ranked.filter((item): item is { runId: string; summaryPath: string; mtimeMs: number } => item !== null);
  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const history: RunHistoryEntry[] = [];
  for (const item of filtered.slice(0, limit)) {
    const raw = await fs.readFile(item.summaryPath, "utf8").catch(() => "");
    if (!raw) continue;
    const summary = JSON.parse(raw) as RunSessionSummary;
    history.push({
      runId: summary.runId,
      finishedAt: summary.finishedAt,
      status: summary.status,
      judgeDecision: summary.judge.judgeDecision,
      promotionDecision: summary.promotionDecision,
      summary: summary.execution.output.slice(0, 240),
      summaryPath: item.summaryPath
    });
  }

  return history;
}

export async function buildContextPack(root: string, blueprint: Blueprint): Promise<ContextPack> {
  const workingSet = await buildWorkingSet(
    root,
    `${blueprint.goal}\n${blueprint.successMetrics.join("\n")}`,
    {
      maxFiles: blueprint.budget.maxFiles,
      maxSnippetChars: blueprint.budget.maxSnippetChars
    }
  );
  const repoMap = await buildRankedRepoMap(workingSet.relevantFiles, {
    maxFiles: blueprint.budget.maxFiles,
    maxSymbols: blueprint.budget.maxSymbols
  });
  const runHistory = await loadRunHistory(root, blueprint.budget.maxHistoryEntries);

  const evidenceRefs = Array.from(
    new Set([
      blueprint.programPath,
      ...workingSet.relevantFiles.map((file) => file.path),
      ...runHistory.map((entry) => entry.summaryPath)
    ])
  );

  return {
    generatedAt: new Date().toISOString(),
    blueprintId: blueprint.id,
    intent: {
      goal: blueprint.goal,
      constraints: blueprint.constraints,
      successMetrics: blueprint.successMetrics
    },
    repoMap,
    workingSet,
    runHistory,
    guardrails: {
      mutableSurface: blueprint.mutableSurface,
      protectedSurface: blueprint.protectedSurface,
      verificationCommands: blueprint.verificationCommands
    },
    evidenceRefs
  };
}

export async function saveContextPack(root: string, runId: string, contextPack: ContextPack): Promise<string> {
  const paths = await ensureSalaciaDirs(root);
  const target = getRunPaths(root, runId).context || `${paths.context}/${runId}.json`;
  await fs.mkdir(paths.context, { recursive: true });
  await fs.writeFile(target, JSON.stringify(contextPack, null, 2), "utf8");
  return target;
}
