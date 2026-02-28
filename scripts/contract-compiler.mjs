#!/usr/bin/env node
import path from "node:path";
import { createHash } from "node:crypto";

function normalizePosix(value) {
  return String(value || "").replaceAll("\\", "/");
}

function stableId(seed) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

function toRepoRelative(repoPath, inputPath) {
  if (!inputPath) return null;
  const normalized = path.isAbsolute(inputPath) ? inputPath : path.join(repoPath, inputPath);
  const relative = normalizePosix(path.relative(repoPath, normalized));
  if (!relative || relative.startsWith("../")) return null;
  return relative;
}

function toScopeRule(repoPath, inputPath) {
  const rel = toRepoRelative(repoPath, inputPath);
  if (!rel) return null;
  if (rel.includes("*")) return rel;
  if (/\.(py|ts|tsx|js|jsx|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs|json|yml|yaml)$/.test(rel)) {
    return rel;
  }
  return `${rel}/**`;
}

function pathMatchesRule(relPath, rule) {
  const rel = normalizePosix(relPath);
  const scope = normalizePosix(rule);

  if (scope.endsWith("/**")) {
    const prefix = scope.slice(0, -3);
    return rel === prefix || rel.startsWith(`${prefix}/`);
  }
  if (scope.includes("*")) {
    const pattern = `^${scope
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("\\*\\*", ".*")
      .replaceAll("\\*", "[^/]*")}$`;
    return new RegExp(pattern).test(rel);
  }
  return rel === scope;
}

function normalizeList(values) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function createMiniContract(repoPath, instancePayload, intent, localization, localTestPlan) {
  const inScope = normalizeList(
    [
      ...(intent?.affectedAreas || []).map((item) => toScopeRule(repoPath, item)),
      ...((localization?.rankedFiles || []).slice(0, 5).map((item) => toScopeRule(repoPath, item.path)))
    ].filter(Boolean)
  );

  const protectedPaths = normalizeList([
    ".env",
    ".env.local",
    ".env.production",
    "secrets/**",
    ".git/**"
  ]);

  const verificationCommands = [];
  if (!localTestPlan?.skipped && localTestPlan?.command) {
    verificationCommands.push(`${localTestPlan.command} ${(localTestPlan.args || []).join(" ")}`.trim());
  }
  if (verificationCommands.length === 0) {
    verificationCommands.push("python3 -m pytest -q");
  }

  const seed = `${instancePayload?.instance_id || "unknown"}:${JSON.stringify(inScope)}:${JSON.stringify(verificationCommands)}`;
  return {
    contractId: `swebench-${stableId(seed)}`,
    generatedAt: new Date().toISOString(),
    instanceId: instancePayload?.instance_id || "unknown",
    intent: {
      symptom: intent?.symptom || String(instancePayload?.problem_statement || "").slice(0, 180),
      goals: intent?.goals || [],
      constraints: intent?.constraints || [],
      nonGoals: intent?.nonGoals || [],
      acceptanceCriteria: intent?.acceptanceCriteria || []
    },
    scope: {
      inScope,
      outOfScope: ["docs/**", "benchmarks/**"]
    },
    guardrails: {
      protectedPaths,
      invariants: [
        "Do not modify protected paths",
        "Keep modifications within in-scope files unless explicitly justified"
      ]
    },
    verification: {
      commands: verificationCommands
    }
  };
}

export function validatePatchAgainstContract(repoPath, contract, changedFiles) {
  const violations = [];
  const relChanged = normalizeList(
    (changedFiles || [])
      .map((item) => toRepoRelative(repoPath, item) || normalizePosix(item))
      .filter(Boolean)
  );

  for (const file of relChanged) {
    const protectedHit = (contract?.guardrails?.protectedPaths || []).find((rule) => pathMatchesRule(file, rule));
    if (protectedHit) {
      violations.push({
        code: "protected-path",
        file,
        rule: protectedHit,
        message: `Changed protected path: ${file} matches ${protectedHit}`
      });
    }

    const inScopeRules = contract?.scope?.inScope || [];
    if (inScopeRules.length > 0) {
      const inScope = inScopeRules.some((rule) => pathMatchesRule(file, rule));
      if (!inScope) {
        violations.push({
          code: "scope-drift",
          file,
          message: `Changed file is outside contract scope: ${file}`
        });
      }
    }
  }

  return {
    ok: violations.length === 0,
    changedFiles: relChanged,
    violations
  };
}

