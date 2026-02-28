export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Stage = "plan" | "exec";

export interface ContractIdentity {
  id: string;
  version: number;
  repo: string;
  createdAt: string;
  createdBy: string;
}

export interface ContractIntent {
  goals: string[];
  constraints: string[];
  nonGoals: string[];
  assumptions: string[];
}

export interface ContractScope {
  inScope: string[];
  outOfScope: string[];
  interfacesTouched: string[];
  dataTouched: string[];
}

export interface PlanStep {
  id: string;
  riskLevel: RiskLevel;
  expectedArtifacts: string[];
  verification: string[];
}

export interface ContractPlan {
  steps: PlanStep[];
}

export interface ContractGuardrails {
  invariants: string[];
  protectedPaths: string[];
  approvalPolicy: string;
}

export interface ContractVerification {
  commands: string[];
}

export interface ContractEvidence {
  runLogs: string[];
  snapshotFingerprint: string | null;
  verificationResults: Array<{
    command: string;
    success: boolean;
    exitCode: number;
    output: string;
  }>;
}

export interface ContractInterop {
  executors: string[];
  protocols: string[];
}

export interface Contract {
  identity: ContractIdentity;
  intent: ContractIntent;
  scope: ContractScope;
  plan: ContractPlan;
  guardrails: ContractGuardrails;
  verification: ContractVerification;
  evidence: ContractEvidence;
  interop: ContractInterop;
}

export interface Plan {
  contractId: string;
  generatedAt: string;
  summary: string;
  steps: PlanStep[];
}

export interface ExecuteOptions {
  cwd: string;
  dryRun?: boolean;
  stage?: Stage;
  model?: string;
  mode?: "auto" | "cli";
  externalAdvisors?: boolean;
}

export interface ExecutionResult {
  adapter: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  summary: string;
  output: string;
  artifacts: string[];
  metadata?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  messages: string[];
}

export type AdapterCapability =
  | "plan"
  | "execute"
  | "approve"
  | "verify"
  | "rollback"
  | "bridge-rules"
  | "bridge-tasks"
  | "bridge-status";

export type SupportLevel = "ga" | "beta" | "bridge" | "na";

export type AdapterKind = "executor" | "ide-bridge";

export interface AdapterCapabilityMatrix {
  target: string;
  kind: AdapterKind;
  available: boolean;
  supportLevel: SupportLevel;
  capabilities: AdapterCapability[];
  notes?: string;
}

export interface BridgeEnvelope {
  id: string;
  createdAt: string;
  adapter: string;
  stage: Stage;
  contractId: string;
  stepId: string;
  dryRun: boolean;
  payload: {
    summary: string;
    verification: string[];
    expectedArtifacts: string[];
  };
}

export interface BridgeDispatchResult {
  success: boolean;
  rawOutput: string;
  artifacts: string[];
  exitCode?: number;
  metadata?: Record<string, unknown>;
}

export interface BridgeHealthReport {
  target: string;
  available: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }>;
}

export type AdvisorVote = "approve" | "reject" | "abstain";

export interface AdvisorOpinion {
  advisor: "codex" | "claude" | "gemini" | "chatgpt";
  vote: AdvisorVote;
  summary: string;
  evidenceRef?: string;
  parseStatus?: "ok" | "fallback" | "invalid";
}

export interface ConvergenceDecision {
  stage: Stage;
  advisors: AdvisorOpinion[];
  votes: {
    approve: number;
    reject: number;
    abstain: number;
  };
  winner: AdvisorVote;
  conflicts: string[];
  requiresHumanApproval: boolean;
  evidenceRefs: string[];
}

export interface ReleaseGateReport {
  generatedAt: string;
  checks: Array<{
    name: string;
    passed: boolean;
    details?: string;
  }>;
  convergence: {
    plan: ConvergenceDecision;
    exec: ConvergenceDecision;
  };
  overallPassed: boolean;
}

export interface MatrixRow {
  target: string;
  available: boolean;
  kind: AdapterKind;
  capabilities: AdapterCapability[];
  notes?: string;
}

export interface IntentRisk {
  impact: number;
  irreversibility: number;
  uncertainty: number;
  score: number;
  level: RiskLevel;
}

export interface IntentIR {
  id: string;
  source: string;
  compiledAt: string;
  goals: string[];
  constraints: string[];
  nonGoals: string[];
  assumptions: string[];
  acceptanceCriteria: string[];
  affectedAreas: string[];
  riskTags: string[];
  risk: IntentRisk;
  evidenceRefs: string[];
}

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface CompileDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  field?: string;
  suggestion?: string;
  evidenceRef?: string;
}

export interface DisambiguationOption {
  id: string;
  label: string;
  rationale: string;
  recommended?: boolean;
}

export interface DisambiguationQuestion {
  id: string;
  prompt: string;
  reason: string;
  riskScore: number;
  options: DisambiguationOption[];
}

export interface MetamorphicRule {
  id: string;
  description: string;
}

export interface MetamorphicCheck {
  ruleId: string;
  passed: boolean;
  message: string;
}

export interface MetamorphicResult {
  passed: boolean;
  checks: MetamorphicCheck[];
}

export interface PromptPatch {
  id: string;
  createdAt: string;
  appliesTo: string;
  rationale: string;
  operations: string[];
  score: number;
  evidenceRefs: string[];
  rollbackRef: string;
}

export interface PromptOptimizationReport {
  generatedAt: string;
  considered: number;
  accepted: number;
  patches: PromptPatch[];
  skipped: string[];
}

export type ConsistencyViolationCode =
  | "missing-artifact"
  | "unexpected-revert"
  | "ghost-revival"
  | "contract-drift";

export interface ConsistencyViolation {
  code: ConsistencyViolationCode;
  severity: "low" | "medium" | "high";
  message: string;
  artifact?: string;
  stepId?: string;
}

export interface ConsistencyReport {
  ok: boolean;
  score: number;
  violations: ConsistencyViolation[];
  baselinePath: string;
  snapshotId?: string;
  suggestion?: string;
}

export type SuperiorityProbeId =
  | "prompt_compiler_pipeline"
  | "active_disambiguation"
  | "metamorphic_guard"
  | "prompt_optimizer_auditability"
  | "consistency_safety_net"
  | "dual_convergence_gates"
  | "trellis_mapping_doc"
  | "clean_room_policy_doc"
  | "snapshot_restore_test_coverage"
  | "json_cli_contract";

export interface SuperiorityAuditCheckSpec {
  id: string;
  probe: SuperiorityProbeId;
  weight: number;
  required: boolean;
  strengthSignal: boolean;
  description?: string;
}

export interface SuperiorityAuditProfile {
  id: string;
  name: string;
  version: string;
  baselineScore: number;
  requiredScore: number;
  requiredMargin: number;
  minimumStrengthSignals: number;
  checks: SuperiorityAuditCheckSpec[];
}

export interface SuperiorityAuditCheckResult {
  id: string;
  probe: SuperiorityProbeId;
  passed: boolean;
  weight: number;
  awarded: number;
  required: boolean;
  strengthSignal: boolean;
  summary: string;
  evidenceRefs: string[];
  metrics?: Record<string, number | string | boolean>;
}

export interface SuperiorityAuditReport {
  generatedAt: string;
  profileId: string;
  profileName: string;
  profileVersion: string;
  profilePath: string;
  baselineScore: number;
  requiredScore: number;
  baselineTargetScore: number;
  score: number;
  maxScore: number;
  passRate: number;
  strengthSignals: number;
  minimumStrengthSignals: number;
  strongerThanBaseline: boolean;
  requiredFailures: string[];
  failedChecks: string[];
  checks: SuperiorityAuditCheckResult[];
  reportPath: string;
}

export type BenchmarkSuite = "core" | "scale" | "full";

export type BenchmarkDimension =
  | "prompt_quality"
  | "contract_integrity"
  | "convergence_robustness"
  | "execution_governance"
  | "ide_native_depth"
  | "protocol_behavior"
  | "scale_stability"
  | "compliance_audit"
  | "anti_gaming";

export type BenchmarkDimensionProvenance = "measured" | "profiled" | "unavailable";

export type BenchmarkMethodPair =
  | "internal-vs-measured"
  | "internal-vs-profiled"
  | "internal-vs-unavailable"
  | "external-vs-measured"
  | "external-vs-profiled"
  | "external-vs-unavailable";

export interface BenchmarkCase {
  id: string;
  dimension: BenchmarkDimension;
  description: string;
  critical: boolean;
  hidden: boolean;
  competitorComparable: boolean;
}

export interface BenchmarkProbeResult extends BenchmarkCase {
  functionalPass: 0 | 1;
  qualityScore: number;
  reliabilityScore: number;
  dimensionScore: number;
  evidenceRefs: string[];
  notes?: string;
  metrics?: Record<string, number | string | boolean>;
}

export interface BenchmarkDimensionScore {
  dimension: BenchmarkDimension;
  cases: number;
  functionalPassRate: number;
  qualityScore: number;
  reliabilityScore: number;
  dimensionScore: number;
}

export interface BenchmarkRunConfig {
  suite: BenchmarkSuite;
  repeats: number;
  seed: number;
  includeHidden: boolean;
  scale: {
    targetFiles: number;
    concurrency: number;
    soakHours: number;
  };
}

export interface BenchmarkRunReport {
  metadata: {
    runId: string;
    generatedAt: string;
    suite: BenchmarkSuite;
    repeats: number;
    seed: number;
    gitCommit: string;
    nodeVersion: string;
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCount: number;
    memoryBytes: number;
    datasetHash: string;
  };
  config: BenchmarkRunConfig;
  probeCount: number;
  probes: BenchmarkProbeResult[];
  dimensions: BenchmarkDimensionScore[];
  overall: {
    functionalPassRate: number;
    qualityScore: number;
    reliabilityScore: number;
    score: number;
  };
  reportPath: string;
  rawDir: string;
  normalizedDir: string;
}

export interface BenchmarkAttestation {
  method: "minisign" | "ed25519";
  manifestPath: string;
  signaturePath: string;
  publicKeyPath: string;
}

export type CompetitorId =
  | "salacia"
  | "codex"
  | "claude"
  | "aider"
  | "cline"
  | "continue"
  | "opencode"
  | "cursor"
  | "trellis";

export interface CompetitorTaskSpec {
  id: string;
  title: string;
  prompt: string;
  verifyCommand: string[];
}

export interface CompetitorRunResult {
  competitor: CompetitorId;
  available: boolean;
  measured: boolean;
  success: boolean;
  exitCode: number;
  durationMs: number;
  testsPassed: boolean;
  changedFiles: string[];
  repoPath: string;
  stdoutPath: string;
  stderrPath: string;
  reason?: string;
}

export interface CompetitorRunReport {
  runId: string;
  generatedAt: string;
  task: CompetitorTaskSpec;
  results: CompetitorRunResult[];
  reportPath: string;
}

export interface BenchmarkCompetitorRecord {
  id: string;
  name: string;
  kind: "open-source" | "closed-source";
  license: string;
  source: string;
  sampledAt: string;
  provenance: "measured" | "profiled";
  evidenceRefs: string[];
  dimensions: Record<BenchmarkDimension, number | null>;
  dimensionProvenance?: Partial<Record<BenchmarkDimension, BenchmarkDimensionProvenance>>;
  strictMode?: {
    status: "required" | "exempt";
    reason?: string;
  };
}

export interface BenchmarkComparisonDimensionResult {
  dimension: BenchmarkDimension;
  salacia: number | null;
  competitor: number | null;
  outcome: "win" | "loss" | "parity" | "excluded";
  salaciaScoreSource: "internal-benchmark" | "external-competitor-run";
  competitorDimensionProvenance: BenchmarkDimensionProvenance;
  methodPair: BenchmarkMethodPair;
  excludedReason?: "unavailable" | "method-mismatch" | "not-supported";
  methodMismatch: boolean;
  comparable: boolean;
}

export interface BenchmarkComparisonResult {
  competitorId: string;
  competitorName: string;
  provenance: "measured" | "profiled";
  evidenceRefs: string[];
  strictMode: {
    status: "required" | "exempt";
    reason?: string;
  };
  comparablePairs: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  dimensions: BenchmarkComparisonDimensionResult[];
}

export interface SotaDecision {
  runId: string;
  passed: boolean;
  winRate: number;
  decisivePairs: number;
  minimumDecisivePairs: number;
  qualityFloor: number;
  qualityFloorFailures: BenchmarkDimension[];
  comparablePairs: number;
  excludedCompetitors: string[];
  competitors: BenchmarkComparisonResult[];
  methodMismatchPairs: number;
  excludedPairs: number;
  externalComparablePairs: number;
  internalOnlyPairs: number;
  strictMode: boolean;
  ci95: {
    low: number;
    high: number;
  };
  unmeasuredCompetitors: string[];
  reasons: string[];
}
