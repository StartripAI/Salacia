import { createHash } from "node:crypto";
import { z } from "zod";
import type { IntentIR, IntentRisk, RiskLevel } from "../core/types.js";

const IntentRiskSchema = z.object({
  impact: z.number().int().min(0).max(3),
  irreversibility: z.number().int().min(0).max(3),
  uncertainty: z.number().int().min(0).max(3),
  score: z.number().int().min(0).max(9),
  level: z.enum(["low", "medium", "high", "critical"])
});

export const IntentIRSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  compiledAt: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1),
  constraints: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string().min(1)).min(1),
  assumptions: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  affectedAreas: z.array(z.string().min(1)).min(1),
  riskTags: z.array(z.string()),
  risk: IntentRiskSchema,
  evidenceRefs: z.array(z.string())
});

export function normalizeList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}

export function riskLevelFromScore(score: number): RiskLevel {
  if (score >= 8) return "critical";
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

export function buildRisk(impact: number, irreversibility: number, uncertainty: number): IntentRisk {
  const boundedImpact = Math.max(0, Math.min(3, Math.round(impact)));
  const boundedIrreversibility = Math.max(0, Math.min(3, Math.round(irreversibility)));
  const boundedUncertainty = Math.max(0, Math.min(3, Math.round(uncertainty)));
  const score = boundedImpact + boundedIrreversibility + boundedUncertainty;

  return {
    impact: boundedImpact,
    irreversibility: boundedIrreversibility,
    uncertainty: boundedUncertainty,
    score,
    level: riskLevelFromScore(score)
  };
}

export function createIntentId(source: string): string {
  const digest = createHash("sha256")
    .update(source)
    .digest("hex")
    .slice(0, 12);
  return `intent-${Date.now()}-${digest}`;
}

export function validateIntentIR(value: unknown): { valid: boolean; errors: string[]; data?: IntentIR } {
  const result = IntentIRSchema.safeParse(value);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    };
  }

  return {
    valid: true,
    errors: [],
    data: result.data
  };
}
