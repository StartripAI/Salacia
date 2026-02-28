import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  AdvisorOpinion,
  AdvisorVote,
  ConvergenceDecision,
  Stage
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface ConvergeOptions {
  stage: Stage;
  inputPath: string;
  cwd?: string;
  external?: boolean;
  strictExternal?: boolean;
  timeoutMs?: number;
  retries?: number;
}

interface AdvisorResponseShape {
  vote: AdvisorVote;
  summary: string;
  evidenceRef?: string;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeVote(value: string): AdvisorVote | null {
  const lower = value.toLowerCase().trim();
  if (lower === "approve") return "approve";
  if (lower === "reject") return "reject";
  if (lower === "abstain") return "abstain";
  return null;
}

function inferVoteFromText(text: string): AdvisorVote {
  const normalized = text.toLowerCase();
  if (normalized.includes("reject") || normalized.includes("fail") || normalized.includes("error")) {
    return "reject";
  }
  if (normalized.includes("abstain") || normalized.includes("unknown") || normalized.includes("uncertain")) {
    return "abstain";
  }
  return "approve";
}

function parseAdvisorResponse(raw: string): { response: AdvisorResponseShape; parseStatus: "ok" | "fallback" | "invalid" } {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch && jsonObjectMatch[0] !== trimmed) {
    candidates.push(jsonObjectMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<AdvisorResponseShape>;
      const vote = parsed.vote ? normalizeVote(parsed.vote) : null;
      if (!vote) {
        continue;
      }
      return {
        response: {
          vote,
          summary: (parsed.summary ?? "No summary provided").slice(0, 500),
          ...(parsed.evidenceRef ? { evidenceRef: parsed.evidenceRef } : {})
        },
        parseStatus: "ok"
      };
    } catch {
      // Try next candidate.
    }
  }

  if (trimmed.length > 0) {
    return {
      response: {
        vote: inferVoteFromText(trimmed),
        summary: trimmed.slice(0, 500)
      },
      parseStatus: "fallback"
    };
  }

  return {
    response: {
      vote: "abstain",
      summary: "Empty advisor response"
    },
    parseStatus: "invalid"
  };
}

function buildLocalCodexOpinion(stage: Stage, inputRaw: string, inputPath: string): AdvisorOpinion {
  const looksStructured =
    inputRaw.trim().startsWith("{") || inputRaw.includes("identity:") || inputRaw.includes("steps");

  let vote: AdvisorVote;
  if (stage === "plan") {
    vote = looksStructured && inputRaw.includes("steps") ? "approve" : "reject";
  } else {
    vote = inputRaw.includes("success") || inputRaw.includes("verification") ? "approve" : "abstain";
  }

  return {
    advisor: "codex",
    vote,
    summary: `Codex local policy vote=${vote}`,
    parseStatus: "ok",
    evidenceRef: inputPath
  };
}

async function runExternalAdvisor(
  advisor: "claude" | "gemini" | "chatgpt",
  scriptName: string,
  inputPath: string,
  cwd: string,
  timeoutMs: number,
  retries: number
): Promise<AdvisorOpinion> {
  const scriptPath = path.join(cwd, "scripts", scriptName);

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await fs.access(scriptPath);
      const { stdout, stderr } = await execFileAsync("node", [scriptPath, inputPath], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 5 * 1024 * 1024
      });

      const combined = `${stdout}\n${stderr}`.trim();
      const parsed = parseAdvisorResponse(combined);
      return {
        advisor,
        vote: parsed.response.vote,
        summary: parsed.response.summary,
        parseStatus: parsed.parseStatus,
        evidenceRef: parsed.response.evidenceRef ?? scriptPath
      };
    } catch (error) {
      if (attempt <= retries) {
        continue;
      }

      const err = error as Error & { stderr?: string; stdout?: string };
      const detail = [err.message, err.stderr ?? "", err.stdout ?? ""]
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .join(" | ")
        .slice(0, 500);

      return {
        advisor,
        vote: "abstain",
        summary: `${advisor} unavailable after ${attempt} attempt(s): ${detail}`,
        parseStatus: "invalid",
        evidenceRef: scriptPath
      };
    }
  }

  return {
    advisor,
    vote: "abstain",
    summary: `${advisor} unavailable`,
    parseStatus: "invalid",
    evidenceRef: scriptPath
  };
}

export function resolveConvergence(
  stage: Stage,
  opinions: AdvisorOpinion[],
  options: { external?: boolean; strictExternal?: boolean } = {}
): ConvergenceDecision {
  const votes = { approve: 0, reject: 0, abstain: 0 };
  const evidenceRefs: string[] = [];
  const conflicts: string[] = [];

  for (const opinion of opinions) {
    votes[opinion.vote] += 1;
    if (opinion.evidenceRef) {
      evidenceRefs.push(opinion.evidenceRef);
    }

    if (opinion.parseStatus === "invalid") {
      conflicts.push(`${opinion.advisor}: invalid advisor response`);
    }
  }

  let winner: AdvisorVote = "abstain";
  if (votes.approve >= 2 && votes.reject >= 2) {
    conflicts.push("Conflicting majority: approve and reject both reached threshold.");
    winner = "abstain";
  } else if (votes.approve >= 2) {
    winner = "approve";
  } else if (votes.reject >= 2) {
    winner = "reject";
  }

  if (winner === "abstain") {
    conflicts.push("No 2/3 majority. Human approval required.");
  }

  const strictExternalBlocked = (() => {
    if (!(options.external && options.strictExternal)) {
      return false;
    }

    const externalOpinions = opinions.filter((opinion) => opinion.advisor !== "codex");
    const strictCompliant = externalOpinions.filter(
      (opinion) =>
        opinion.parseStatus === "ok" &&
        opinion.vote !== "abstain" &&
        Boolean(opinion.evidenceRef && opinion.evidenceRef.trim().length > 0)
    );

    if (externalOpinions.length === 0) {
      conflicts.push("strict external requires at least one external advisor");
      return true;
    }

    if (strictCompliant.length === 0) {
      conflicts.push(
        "strict external requires at least one successful external advisor (parseStatus=ok, non-abstain, evidenceRef)"
      );
      return true;
    }

    for (const opinion of externalOpinions) {
      if (!strictCompliant.includes(opinion)) {
        conflicts.push(
          `${opinion.advisor}: external advisor did not satisfy strict contract (non-blocking with other successful advisors)`
        );
      }
    }

    return false;
  })();

  if (strictExternalBlocked) {
    winner = "abstain";
  }

  return {
    stage,
    advisors: opinions,
    votes,
    winner,
    conflicts,
    requiresHumanApproval: winner === "abstain" || strictExternalBlocked,
    evidenceRefs
  };
}

export async function runConvergence(options: ConvergeOptions): Promise<ConvergenceDecision> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? parseEnvInt("SALACIA_CONVERGE_TIMEOUT_MS", 90_000);
  const retries = options.retries ?? parseEnvInt("SALACIA_CONVERGE_RETRIES", 0);

  const inputRaw = await fs.readFile(options.inputPath, "utf8").catch(() => "");
  const opinions: AdvisorOpinion[] = [buildLocalCodexOpinion(options.stage, inputRaw, options.inputPath)];

  if (options.external) {
    const externalOpinions = await Promise.all([
      runExternalAdvisor("claude", "validate-claude.mjs", options.inputPath, cwd, timeoutMs, retries),
      runExternalAdvisor("gemini", "validate-gemini.mjs", options.inputPath, cwd, timeoutMs, retries),
      runExternalAdvisor("chatgpt", "validate-chatgpt.mjs", options.inputPath, cwd, timeoutMs, retries)
    ]);
    opinions.push(...externalOpinions);
  } else {
    opinions.push({
      advisor: "claude",
      vote: "abstain",
      summary: "External advisor skipped (external=false)",
      parseStatus: "fallback"
    });
    opinions.push({
      advisor: "gemini",
      vote: "abstain",
      summary: "External advisor skipped (external=false)",
      parseStatus: "fallback"
    });
    opinions.push({
      advisor: "chatgpt",
      vote: "abstain",
      summary: "External advisor skipped (external=false)",
      parseStatus: "fallback"
    });
  }

  return resolveConvergence(options.stage, opinions, {
    external: Boolean(options.external),
    strictExternal: Boolean(options.strictExternal)
  });
}
