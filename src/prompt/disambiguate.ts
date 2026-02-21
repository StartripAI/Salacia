import type { CompileDiagnostic, DisambiguationQuestion, IntentIR } from "../core/types.js";

export function selectDisambiguationQuestion(
  ir: IntentIR,
  diagnostics: CompileDiagnostic[]
): DisambiguationQuestion | null {
  if (ir.risk.score < 6) {
    return null;
  }

  const hasAcceptanceWarning = diagnostics.some((diagnostic) =>
    ["missing.acceptance", "weak.acceptance"].includes(diagnostic.code)
  );

  if (hasAcceptanceWarning) {
    return {
      id: `${ir.id}-acceptance`,
      prompt: "这个高风险任务最重要的验收优先级是什么？",
      reason: "High risk + acceptance criteria ambiguity",
      riskScore: ir.risk.score,
      options: [
        {
          id: "safety-first",
          label: "稳定优先",
          rationale: "先保证回滚与测试完整，再做功能扩展",
          recommended: true
        },
        {
          id: "speed-first",
          label: "速度优先",
          rationale: "快速交付核心路径，容忍后续补充"
        },
        {
          id: "scope-first",
          label: "范围优先",
          rationale: "先锁定 in-scope，再推进实现"
        }
      ]
    };
  }

  return {
    id: `${ir.id}-risk`,
    prompt: "这个高风险任务希望采用哪种变更策略？",
    reason: "High risk requires explicit execution strategy",
    riskScore: ir.risk.score,
    options: [
      {
        id: "incremental",
        label: "渐进变更",
        rationale: "小步快照，逐步验证",
        recommended: true
      },
      {
        id: "big-bang",
        label: "一次性变更",
        rationale: "集中修改后统一验证"
      },
      {
        id: "dry-run",
        label: "先 dry-run",
        rationale: "先生成工件与验证计划，不直接改动"
      }
    ]
  };
}

export function applyDisambiguationAnswer(
  ir: IntentIR,
  question: DisambiguationQuestion,
  optionId: string
): IntentIR {
  const next: IntentIR = {
    ...ir,
    constraints: [...ir.constraints],
    acceptanceCriteria: [...ir.acceptanceCriteria],
    assumptions: [...ir.assumptions],
    riskTags: [...ir.riskTags]
  };

  if (question.id.endsWith("-acceptance")) {
    if (optionId === "safety-first") {
      next.constraints.push("Keep rollback path and verification evidence mandatory");
      next.acceptanceCriteria.push("All verification commands pass before completion");
      next.riskTags.push("safety-priority");
    } else if (optionId === "speed-first") {
      next.constraints.push("Ship minimal slice first, then iterate with evidence");
      next.acceptanceCriteria.push("Core user path works end-to-end");
      next.riskTags.push("speed-priority");
    } else {
      next.constraints.push("Scope must remain locked to declared in-scope areas");
      next.acceptanceCriteria.push("No out-of-scope file changes");
      next.riskTags.push("scope-priority");
    }
  } else {
    if (optionId === "incremental") {
      next.constraints.push("Use incremental execution with step-level verification");
      next.riskTags.push("incremental-execution");
    } else if (optionId === "big-bang") {
      next.constraints.push("Big-bang execution requires full snapshot before run");
      next.riskTags.push("big-bang-approved");
    } else {
      next.constraints.push("Run dry-run first and require explicit approval before mutate");
      next.riskTags.push("dry-run-required");
    }
  }

  return {
    ...next,
    constraints: Array.from(new Set(next.constraints)),
    acceptanceCriteria: Array.from(new Set(next.acceptanceCriteria)),
    assumptions: Array.from(new Set(next.assumptions)),
    riskTags: Array.from(new Set(next.riskTags))
  };
}
