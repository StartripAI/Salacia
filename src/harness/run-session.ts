import fs from "node:fs/promises";
import type { JudgeReport, RunEvent, RunSessionSummary } from "../core/types.js";
import { ensureRunDirs, getRunPaths } from "../core/paths.js";

export async function appendRunEvent(root: string, runId: string, event: RunEvent): Promise<string> {
  const run = await ensureRunDirs(root, runId);
  await fs.appendFile(run.events, `${JSON.stringify(event)}\n`, "utf8");
  return run.events;
}

export async function loadRunEvents(root: string, runId: string): Promise<RunEvent[]> {
  const raw = await fs.readFile(getRunPaths(root, runId).events, "utf8").catch(() => "");
  if (!raw) return [];
  return raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunEvent);
}

export async function saveRunSummary(root: string, runId: string, summary: RunSessionSummary): Promise<string> {
  const run = await ensureRunDirs(root, runId);
  await fs.writeFile(run.summary, JSON.stringify(summary, null, 2), "utf8");
  return run.summary;
}

export async function loadRunSummary(root: string, runId: string): Promise<RunSessionSummary | null> {
  const raw = await fs.readFile(getRunPaths(root, runId).summary, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw) as RunSessionSummary;
}

export async function saveJudgeReport(root: string, runId: string, report: JudgeReport): Promise<string> {
  const run = await ensureRunDirs(root, runId);
  await fs.writeFile(run.judge, JSON.stringify(report, null, 2), "utf8");
  return run.judge;
}

export async function loadJudgeReport(root: string, runId: string): Promise<JudgeReport | null> {
  const raw = await fs.readFile(getRunPaths(root, runId).judge, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw) as JudgeReport;
}
