import { createHash } from "node:crypto";
import type {
  CompileDiagnostic,
  DisambiguationQuestion,
  IntentIR,
  MetamorphicResult
} from "../core/types.js";
import { selectDisambiguationQuestion } from "./disambiguate.js";
import { loadPromptContext, type PromptCompileContext } from "./context.js";
import { buildRisk, createIntentId, normalizeList, validateIntentIR } from "./ir.js";
import { runMetamorphicTests } from "./metamorphic.js";

export interface CompilePromptOptions {
  cwd?: string;
  sourceId?: string;
}

export interface CompilePromptResult {
  baseline: IntentIR;
  ir: IntentIR;
  diagnostics: CompileDiagnostic[];
  metamorphic: MetamorphicResult;
  question: DisambiguationQuestion | null;
  context: PromptCompileContext;
  corrected: boolean;
}

interface ParsedIntent {
  goals: string[];
  constraints: string[];
  nonGoals: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  affectedAreas: string[];
  riskTags: string[];
}

const CONSTRAINT_RE = /(must|should|cannot|can't|do not|without|only|never)/i;
const NON_GOAL_RE = /(non-?goal|don't|do not|without|avoid|exclude|out of scope)/i;
const ASSUMPTION_RE = /(assume|assuming|if )/i;
const ACCEPTANCE_RE = /(acceptance|done when|success|verify|test|pass)/i;

function splitCandidateSentences(input: string): string[] {
  return input
    .split(/\n|\.|;|。|；/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);
}

function inferAreas(input: string, context: PromptCompileContext): string[] {
  const lower = input.toLowerCase();
  const inferred: string[] = [];

  if (/adapter|executor|cursor|cline|vscode|opencode|antigravity|claude|codex/.test(lower)) {
    inferred.push("src/adapters/**");
  }
  if (/protocol|mcp|acp|a2a/.test(lower)) {
    inferred.push("src/protocols/**");
  }
  if (/snapshot|rollback|drift|guardian|verify|progress/.test(lower)) {
    inferred.push("src/guardian/**");
  }
  if (/plan|contract|spec|prompt|compiler/.test(lower)) {
    inferred.push("src/core/**", "src/prompt/**");
  }
  if (/cli|command/.test(lower)) {
    inferred.push("src/cli/**");
  }

  if (inferred.length === 0 && context.establishedAreas.length > 0) {
    inferred.push(...context.establishedAreas.slice(0, 3));
  }

  if (inferred.length === 0) {
    inferred.push("src/**", ".salacia/**");
  }

  return normalizeList(inferred);
}

function parseIntent(input: string, context: PromptCompileContext): ParsedIntent {
  const segments = splitCandidateSentences(input);
  const goals = normalizeList(
    segments.filter((segment) => !NON_GOAL_RE.test(segment)).slice(0, 5)
  );

  const constraints = normalizeList(segments.filter((segment) => CONSTRAINT_RE.test(segment)));
  const nonGoals = normalizeList(segments.filter((segment) => NON_GOAL_RE.test(segment)));
  const assumptions = normalizeList(segments.filter((segment) => ASSUMPTION_RE.test(segment)));
  const acceptanceCriteria = normalizeList(segments.filter((segment) => ACCEPTANCE_RE.test(segment)));

  const riskTags = normalizeList(
    [
      /delete|drop|remove|overwrite|destructive/.test(input.toLowerCase()) ? "destructive-change" : "",
      /security|auth|token|secret|permission/.test(input.toLowerCase()) ? "security-sensitive" : "",
      /migration|schema|database|prod|production/.test(input.toLowerCase()) ? "production-change" : "",
      /refactor|rewrite|large/.test(input.toLowerCase()) ? "broad-refactor" : ""
    ].filter(Boolean)
  );

  return {
    goals,
    constraints,
    nonGoals,
    assumptions,
    acceptanceCriteria,
    affectedAreas: inferAreas(input, context),
    riskTags
  };
}

function scoreRisk(input: string, parsed: ParsedIntent) {
  const lower = input.toLowerCase();

  let impact = 1;
  if (/security|auth|payment|database|prod|production/.test(lower)) {
    impact = 3;
  } else if (/refactor|rewrite|migration/.test(lower)) {
    impact = 2;
  }

  let irreversibility = 1;
  if (/delete|drop|remove|overwrite|irreversible/.test(lower)) {
    irreversibility = 3;
  } else if (/rename|migrate|replace/.test(lower)) {
    irreversibility = 2;
  }

  let uncertainty = 0;
  if (/maybe|probably|something|etc|whatever|later|as needed/.test(lower)) {
    uncertainty = 2;
  }
  if (parsed.acceptanceCriteria.length === 0) {
    uncertainty = Math.max(uncertainty, 2);
  }
  if (parsed.goals.length <= 1 && splitCandidateSentences(input).length <= 1) {
    uncertainty = Math.max(uncertainty, 2);
  }
  if (lower.includes(" and ") && lower.split(" and ").length > 4) {
    uncertainty = Math.max(uncertainty, 3);
  }

  return buildRisk(impact, irreversibility, uncertainty);
}

function buildBaselineIR(input: string, parsed: ParsedIntent): IntentIR {
  const risk = scoreRisk(input, parsed);
  return {
    id: createIntentId(input),
    source: input,
    compiledAt: new Date().toISOString(),
    goals: parsed.goals.length > 0 ? parsed.goals : [input.trim()],
    constraints: parsed.constraints,
    nonGoals: parsed.nonGoals,
    assumptions: parsed.assumptions,
    acceptanceCriteria: parsed.acceptanceCriteria,
    affectedAreas: parsed.affectedAreas,
    riskTags: parsed.riskTags,
    risk,
    evidenceRefs: []
  };
}

function addDiagnostic(
  diagnostics: CompileDiagnostic[],
  code: string,
  severity: CompileDiagnostic["severity"],
  message: string,
  suggestion: string,
  field?: string
): void {
  diagnostics.push({
    code,
    severity,
    message,
    suggestion,
    ...(field ? { field } : {})
  });
}

function autoCorrectIR(baseline: IntentIR, context: PromptCompileContext, diagnostics: CompileDiagnostic[]): IntentIR {
  const corrected: IntentIR = {
    ...baseline,
    goals: [...baseline.goals],
    constraints: [...baseline.constraints],
    nonGoals: [...baseline.nonGoals],
    assumptions: [...baseline.assumptions],
    acceptanceCriteria: [...baseline.acceptanceCriteria],
    affectedAreas: [...baseline.affectedAreas],
    riskTags: [...baseline.riskTags],
    evidenceRefs: [...baseline.evidenceRefs]
  };

  if (corrected.goals.length === 0) {
    corrected.goals.push(...(context.establishedGoals.slice(0, 2) || ["Deliver requested behavior"]));
    addDiagnostic(
      diagnostics,
      "missing.goals",
      "warning",
      "Prompt goals were incomplete; fallback goals injected",
      "Provide at least one explicit business goal",
      "goals"
    );
  }

  if (corrected.constraints.length === 0) {
    corrected.constraints.push(
      "Keep implementation auditable and reversible",
      "Do not introduce unrelated refactors"
    );
    addDiagnostic(
      diagnostics,
      "missing.constraints",
      "warning",
      "No explicit constraints found; default guardrail constraints injected",
      "Add explicit quality/scope constraints",
      "constraints"
    );
  }

  if (corrected.nonGoals.length === 0) {
    corrected.nonGoals.push("Do not modify unrelated modules");
    addDiagnostic(
      diagnostics,
      "missing.non-goals",
      "info",
      "No non-goals found; default non-goal added",
      "Specify what should explicitly remain untouched",
      "nonGoals"
    );
  }

  if (corrected.acceptanceCriteria.length === 0) {
    corrected.acceptanceCriteria = corrected.goals.map((goal) => `Goal achieved: ${goal}`);
    addDiagnostic(
      diagnostics,
      "missing.acceptance",
      "warning",
      "Acceptance criteria missing; generated from goals",
      "Declare explicit acceptance criteria and validation commands",
      "acceptanceCriteria"
    );
  }

  if (corrected.assumptions.length === 0) {
    corrected.assumptions.push("Required toolchain and repository access are available");
  }

  if (corrected.affectedAreas.length === 0) {
    corrected.affectedAreas = context.establishedAreas.length > 0 ? context.establishedAreas.slice(0, 3) : ["src/**"];
  }

  if (corrected.risk.score >= 6 && !corrected.riskTags.some((tag) => tag.includes("high-risk"))) {
    corrected.riskTags.push("high-risk-domain");
  }

  corrected.goals = normalizeList(corrected.goals);
  corrected.constraints = normalizeList(corrected.constraints);
  corrected.nonGoals = normalizeList(corrected.nonGoals);
  corrected.assumptions = normalizeList(corrected.assumptions);
  corrected.acceptanceCriteria = normalizeList(corrected.acceptanceCriteria);
  corrected.affectedAreas = normalizeList(corrected.affectedAreas);
  corrected.riskTags = normalizeList(corrected.riskTags);

  const driftDigest = createHash("sha256")
    .update(JSON.stringify({
      goals: corrected.goals,
      constraints: corrected.constraints,
      nonGoals: corrected.nonGoals,
      acceptanceCriteria: corrected.acceptanceCriteria
    }))
    .digest("hex")
    .slice(0, 12);

  corrected.evidenceRefs.push(`intent-digest:${driftDigest}`);
  return corrected;
}

export async function compilePromptInput(
  input: string,
  options: CompilePromptOptions = {}
): Promise<CompilePromptResult> {
  const normalizedInput = input.trim();
  const context = await loadPromptContext(options.cwd ?? process.cwd());
  const diagnostics: CompileDiagnostic[] = [];

  const parsed = parseIntent(normalizedInput, context);
  const baseline = buildBaselineIR(normalizedInput, parsed);
  const corrected = autoCorrectIR(baseline, context, diagnostics);

  const validation = validateIntentIR(corrected);
  if (!validation.valid) {
    for (const error of validation.errors) {
      addDiagnostic(
        diagnostics,
        "type.invalid",
        "error",
        `Intent IR validation failed: ${error}`,
        "Fix compile inputs and rerun prompt compile"
      );
    }
  }

  const metamorphic = runMetamorphicTests(baseline, corrected);
  if (!metamorphic.passed) {
    addDiagnostic(
      diagnostics,
      "metamorphic.failed",
      "error",
      "Metamorphic prompt testing failed",
      "Review rewritten intent fields before plan generation"
    );
  }

  const question = selectDisambiguationQuestion(corrected, diagnostics);
  const correctedFlag = JSON.stringify(baseline) !== JSON.stringify(corrected);

  return {
    baseline,
    ir: corrected,
    diagnostics,
    metamorphic,
    question,
    context,
    corrected: correctedFlag
  };
}
