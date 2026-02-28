export const DEFAULT_CODEX_MODEL_CHAIN = ["gpt-5.2-codex", "gpt-5.1-codex", "gpt-5-codex"];
export const DEFAULT_CLAUDE_MODEL_CHAIN = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5"];
export const DEFAULT_AIDER_MODEL_CHAIN = ["default"];
export const DEFAULT_GEMINI_MODEL_CHAIN = ["gemini-3.1-pro", "gemini-3.1-flash"];


export function parseModelChain(raw, backend, explicitModel) {
  const defaults =
    backend === "claude"
      ? DEFAULT_CLAUDE_MODEL_CHAIN
      : backend === "aider"
        ? DEFAULT_AIDER_MODEL_CHAIN
        : backend === "gemini"
          ? DEFAULT_GEMINI_MODEL_CHAIN
          : DEFAULT_CODEX_MODEL_CHAIN;
  const source = typeof raw === "string" && raw.trim().length > 0 ? raw : defaults.join(",");
  const parsed = source
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (typeof explicitModel === "string" && explicitModel.trim().length > 0) {
    parsed.unshift(explicitModel.trim());
  }

  return [...new Set(parsed)];
}

function formatRepoContext(repoContext) {
  if (!repoContext || typeof repoContext !== "object") {
    return "No precomputed repository context available.";
  }

  const keywords = Array.isArray(repoContext.keywords) ? repoContext.keywords.slice(0, 16) : [];
  const relevantFiles = Array.isArray(repoContext.relevantFiles)
    ? repoContext.relevantFiles.slice(0, 10).map((item) => item.path).filter(Boolean)
    : [];

  const mapText = String(repoContext.repoMap || "").trim();
  const snippetText = String(repoContext.codeSnippets || "").trim();

  return [
    keywords.length > 0 ? `Keywords: ${keywords.join(", ")}` : "Keywords: (none)",
    relevantFiles.length > 0 ? `Relevant files:\n${relevantFiles.map((item) => `- ${item}`).join("\n")}` : "Relevant files: (none)",
    mapText ? `\nRepo map:\n${mapText}` : "\nRepo map: (none)",
    snippetText ? `\nCode snippets:\n${snippetText}` : "\nCode snippets: (none)"
  ].join("\n");
}

function formatLocalization(localization) {
  if (!localization || typeof localization !== "object") {
    return "No fault localization output available.";
  }

  const queries = Array.isArray(localization.queries) ? localization.queries.slice(0, 10) : [];
  const files = Array.isArray(localization.rankedFiles)
    ? localization.rankedFiles.slice(0, 6).map((item) => `${item.path} (score=${item.score}, hits=${item.hitCount})`)
    : [];

  return [
    queries.length > 0 ? `Queries: ${queries.join(", ")}` : "Queries: (none)",
    files.length > 0 ? `Ranked files:\n${files.map((item) => `- ${item}`).join("\n")}` : "Ranked files: (none)"
  ].join("\n");
}

function formatIntent(intent) {
  if (!intent || typeof intent !== "object") {
    return "No intent graph available.";
  }

  const goals = Array.isArray(intent.goals) ? intent.goals : [];
  const constraints = Array.isArray(intent.constraints) ? intent.constraints : [];
  const acceptance = Array.isArray(intent.acceptanceCriteria) ? intent.acceptanceCriteria : [];
  const unknowns = Array.isArray(intent.unknowns) ? intent.unknowns : [];
  const risk = intent.risk && typeof intent.risk === "object" ? intent.risk : null;

  return [
    goals.length > 0 ? `Goals:\n${goals.map((item) => `- ${item}`).join("\n")}` : "Goals: (none)",
    constraints.length > 0 ? `Constraints:\n${constraints.map((item) => `- ${item}`).join("\n")}` : "Constraints: (none)",
    acceptance.length > 0 ? `Acceptance:\n${acceptance.map((item) => `- ${item}`).join("\n")}` : "Acceptance: (none)",
    unknowns.length > 0 ? `Unknowns:\n${unknowns.map((item) => `- ${item}`).join("\n")}` : "Unknowns: (none)",
    risk ? `Risk: score=${risk.score}, level=${risk.level}` : "Risk: (unknown)"
  ].join("\n");
}

function formatContract(contract) {
  if (!contract || typeof contract !== "object") {
    return "No contract boundary available.";
  }
  const inScope = Array.isArray(contract.scope?.inScope) ? contract.scope.inScope.slice(0, 10) : [];
  const protectedPaths = Array.isArray(contract.guardrails?.protectedPaths)
    ? contract.guardrails.protectedPaths.slice(0, 10)
    : [];
  const commands = Array.isArray(contract.verification?.commands) ? contract.verification.commands.slice(0, 6) : [];

  return [
    `Contract ID: ${contract.contractId || "unknown"}`,
    inScope.length > 0 ? `In scope:\n${inScope.map((item) => `- ${item}`).join("\n")}` : "In scope: (none)",
    protectedPaths.length > 0
      ? `Protected paths:\n${protectedPaths.map((item) => `- ${item}`).join("\n")}`
      : "Protected paths: (none)",
    commands.length > 0
      ? `Verification commands:\n${commands.map((item) => `- ${item}`).join("\n")}`
      : "Verification commands: (none)"
  ].join("\n");
}

export function buildRealTaskPrompt(instance, repoPath, scaffoldEnabled, contextInput = null, standardLabel = "SWE-bench Verified") {
  const issue = String(instance.problem_statement ?? "").trim();
  const hints = String(instance.hints_text ?? "").trim();
  const normalizedStandard = String(standardLabel || "SWE-bench Verified").trim() || "SWE-bench Verified";

  if (!scaffoldEnabled) {
    return [
      issue,
      "",
      "Minimal execution rules:",
      "- Apply the fix directly in repository:",
      `  ${repoPath}`,
      "- Keep edits focused on this issue only.",
      "- Keep modifications unstaged in git working tree.",
      "- Return after patch is complete."
    ].join("\n");
  }

  const context =
    contextInput && typeof contextInput === "object" && contextInput.repoContext
      ? contextInput
      : { repoContext: contextInput };

  const repoContext = context.repoContext || null;
  const localization = context.localization || null;
  const intent = context.intent || null;
  const contract = context.contract || null;

  const contextBlock = formatRepoContext(repoContext);
  const localizationBlock = formatLocalization(localization);
  const intentBlock = formatIntent(intent);
  const contractBlock = formatContract(contract);

  return [
    `You are solving one ${normalizedStandard} task in repository ${repoPath}.`,
    `Task instance: ${instance.instance_id}.`,
    "Issue statement:",
    issue,
    ...(hints ? ["", "Hints:", hints] : []),
    "",
    "Repository context precomputed by Salacia:",
    contextBlock,
    "",
    "Fault localization pre-pass:",
    localizationBlock,
    "",
    "Intent IR (sublimated from issue):",
    intentBlock,
    "",
    "Execution contract boundary:",
    contractBlock,
    "",
    "Salacia scaffold guidance:",
    "PHASE 1 — LOCATE (mandatory before any edit)",
    "- Confirm target files from fault localization ranked list.",
    "- Read related source and tests before editing.",
    "- If ranked files look wrong, re-search with grep and adjust target set.",
    "PHASE 2 — DIAGNOSE",
    "- State root cause and intended minimal fix.",
    "- Keep modifications inside contract in-scope files.",
    "PHASE 3 — IMPLEMENT",
    "- Apply the smallest patch that fixes the stated root cause.",
    "- Add/update tests only when needed for this issue.",
    "PHASE 4 — VERIFY",
    "- Run relevant tests and inspect failures.",
    "- Iterate fix based on failure output until stable.",
    "HARD GUARDRAILS",
    "- Do not touch protected paths.",
    "- Do not perform unrelated refactors.",
    "- Keep modifications unstaged in git working tree.",
    "- Return after patch and verification are complete."
  ].join("\n");
}
