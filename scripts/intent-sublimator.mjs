#!/usr/bin/env node
import { createHash } from "node:crypto";

const CONSTRAINT_RE = /(must|should|cannot|can't|do not|without|only|never|preserve|avoid)/i;
const ACCEPTANCE_RE = /(acceptance|done when|success|verify|test|pass|should raise|should return)/i;
const NON_GOAL_RE = /(out of scope|non-?goal|do not refactor|don't refactor|avoid unrelated)/i;
const RISK_RE = /(security|auth|token|secret|database|migration|destructive|delete|drop)/i;

function normalizeList(values) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function splitSegments(text) {
  return normalizeList(
    String(text || "")
      .split(/\r?\n|[;；!?！？。]/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 2)
  );
}

function deriveRisk(problem, hints) {
  const source = `${problem}\n${hints}`.toLowerCase();
  let impact = 1;
  let irreversibility = 1;
  let uncertainty = 1;

  if (/security|auth|database|migration|production|data loss/.test(source)) impact = 3;
  if (/delete|drop|remove|overwrite|irreversible/.test(source)) irreversibility = 3;
  if (/maybe|probably|unclear|unknown|etc|somehow/.test(source)) uncertainty = 3;

  const score = impact + irreversibility + uncertainty;
  const level = score >= 8 ? "critical" : score >= 6 ? "high" : score >= 4 ? "medium" : "low";
  return { impact, irreversibility, uncertainty, score, level };
}

function stableId(seed) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

export function sublimateIntent(instancePayload, localization, repoContext = null) {
  const problem = String(instancePayload?.problem_statement || "").trim();
  const hints = String(instancePayload?.hints_text || "").trim();
  const segments = splitSegments(`${problem}\n${hints}`);

  const goals = normalizeList(
    segments.filter((segment) => !CONSTRAINT_RE.test(segment) && !NON_GOAL_RE.test(segment)).slice(0, 6)
  );
  const constraints = normalizeList(segments.filter((segment) => CONSTRAINT_RE.test(segment)).slice(0, 8));
  const acceptance = normalizeList(segments.filter((segment) => ACCEPTANCE_RE.test(segment)).slice(0, 8));
  const nonGoals = normalizeList(segments.filter((segment) => NON_GOAL_RE.test(segment)).slice(0, 6));

  const topFiles = (localization?.rankedFiles || []).slice(0, 5).map((item) => item.path);
  const affectedAreas = topFiles.length > 0 ? topFiles : (repoContext?.relevantFiles || []).slice(0, 5).map((item) => item.path);

  const risks = deriveRisk(problem, hints);
  const riskTags = normalizeList(
    [
      ...segments.filter((segment) => RISK_RE.test(segment)).map(() => "domain-risk"),
      risks.score >= 6 ? "high-risk" : "",
      topFiles.some((file) => /test/i.test(file)) ? "test-sensitive" : ""
    ].filter(Boolean)
  );

  const unknowns = normalizeList(
    [
      acceptance.length === 0 ? "acceptance-criteria-missing" : "",
      affectedAreas.length === 0 ? "fault-localization-weak" : "",
      goals.length === 0 ? "goal-extraction-weak" : ""
    ].filter(Boolean)
  );

  const idSeed = `${instancePayload?.instance_id || "unknown"}:${problem}:${hints}`;
  const id = `intent-${stableId(idSeed)}`;

  return {
    id,
    instanceId: instancePayload?.instance_id || "unknown",
    symptom: goals[0] || problem,
    goals: goals.length > 0 ? goals : [problem || "fix issue"],
    constraints,
    nonGoals,
    acceptanceCriteria: acceptance,
    affectedAreas,
    risk: risks,
    riskTags,
    unknowns,
    graph: {
      goal: goals,
      constraint: constraints,
      outOfScope: nonGoals,
      artifact: affectedAreas,
      acceptanceCriteria: acceptance,
      risk: riskTags,
      unknown: unknowns
    }
  };
}

