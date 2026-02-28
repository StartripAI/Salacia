import type { DisambiguationQuestion, IntentIR } from "./types.js";
import { compilePromptInput } from "../prompt/compile.js";
import { applyDisambiguationAnswer } from "../prompt/disambiguate.js";
import { runMetamorphicTests } from "../prompt/metamorphic.js";

type CompileOutput = Awaited<ReturnType<typeof compilePromptInput>>;

export interface VibeForgeResult {
  ok: boolean;
  code: "ok" | "disambiguation-required" | "metamorphic-failed";
  intent?: IntentIR;
  question?: DisambiguationQuestion;
  diagnostics: CompileOutput["diagnostics"];
  metamorphic: ReturnType<typeof runMetamorphicTests>;
  corrected: CompileOutput["corrected"];
  context: CompileOutput["context"];
  answerUsed?: string;
}

export interface VibeForgeOptions {
  cwd: string;
  resolveDisambiguation?: (question: DisambiguationQuestion) => Promise<string | null>;
  autoAnswerWithRecommended?: boolean;
}

function resolveRecommendedAnswer(question: DisambiguationQuestion): string | null {
  const preferred = question.options.find((option) => option.recommended)?.id;
  if (preferred) return preferred;
  return question.options[0]?.id ?? null;
}

export async function runVibeForge(vibe: string, options: VibeForgeOptions): Promise<VibeForgeResult> {
  const compiled = await compilePromptInput(vibe, { cwd: options.cwd });
  let intent = compiled.ir;
  let answerUsed: string | undefined;

  if (compiled.question) {
    let answer: string | null = null;
    if (typeof options.resolveDisambiguation === "function") {
      answer = await options.resolveDisambiguation(compiled.question);
    } else if (options.autoAnswerWithRecommended) {
      answer = resolveRecommendedAnswer(compiled.question);
    }

    if (!answer) {
      return {
        ok: false,
        code: "disambiguation-required",
        question: compiled.question,
        diagnostics: compiled.diagnostics,
        metamorphic: compiled.metamorphic,
        corrected: compiled.corrected,
        context: compiled.context
      };
    }

    answerUsed = answer;
    intent = applyDisambiguationAnswer(intent, compiled.question, answer);
  }

  const metamorphic = runMetamorphicTests(compiled.baseline, intent);
  if (!metamorphic.passed) {
    return {
      ok: false,
      code: "metamorphic-failed",
      intent,
      diagnostics: compiled.diagnostics,
      metamorphic,
      corrected: compiled.corrected,
      context: compiled.context,
      ...(answerUsed ? { answerUsed } : {})
    };
  }

  return {
    ok: true,
    code: "ok",
    intent,
    diagnostics: compiled.diagnostics,
    metamorphic,
    corrected: compiled.corrected,
    context: compiled.context,
    ...(answerUsed ? { answerUsed } : {})
  };
}
