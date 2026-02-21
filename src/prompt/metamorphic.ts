import type { IntentIR, MetamorphicResult, MetamorphicRule } from "../core/types.js";

export const DEFAULT_METAMORPHIC_RULES: MetamorphicRule[] = [
  {
    id: "non-goal-preservation",
    description: "Non-goals must not be dropped after rewrite"
  },
  {
    id: "constraint-preservation",
    description: "Constraints must not be weakened or removed"
  },
  {
    id: "acceptance-preservation",
    description: "Acceptance criteria count cannot decrease"
  },
  {
    id: "high-risk-tag",
    description: "High risk changes must include explicit risk tag"
  }
];

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function includesAll(source: string[], target: string[]): boolean {
  const targetSet = new Set(target.map(normalize));
  return source.map(normalize).every((item) => targetSet.has(item));
}

export function runMetamorphicTests(source: IntentIR, candidate: IntentIR): MetamorphicResult {
  const checks: MetamorphicResult["checks"] = [];

  const nonGoalsPass = includesAll(source.nonGoals, candidate.nonGoals);
  checks.push({
    ruleId: "non-goal-preservation",
    passed: nonGoalsPass,
    message: nonGoalsPass ? "non-goals preserved" : "rewrite dropped one or more non-goals"
  });

  const constraintsPass = includesAll(source.constraints, candidate.constraints);
  checks.push({
    ruleId: "constraint-preservation",
    passed: constraintsPass,
    message: constraintsPass ? "constraints preserved" : "rewrite weakened/removes constraints"
  });

  const acceptancePass = candidate.acceptanceCriteria.length >= source.acceptanceCriteria.length;
  checks.push({
    ruleId: "acceptance-preservation",
    passed: acceptancePass,
    message: acceptancePass
      ? "acceptance criteria preserved"
      : "rewrite reduced acceptance criteria, potential semantic drift"
  });

  const highRiskPass =
    candidate.risk.score < 6 ||
    candidate.riskTags.some((tag) => normalize(tag).includes("high-risk") || normalize(tag).includes("critical"));
  checks.push({
    ruleId: "high-risk-tag",
    passed: highRiskPass,
    message: highRiskPass
      ? "risk tagging is explicit"
      : "high-risk change missing explicit risk tagging"
  });

  return {
    passed: checks.every((check) => check.passed),
    checks
  };
}
