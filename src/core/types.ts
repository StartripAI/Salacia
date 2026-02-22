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
  mode?: "auto" | "cli" | "sdk";
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
  advisor: "codex" | "claude" | "gemini";
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
