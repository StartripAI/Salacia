import fs from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import yaml from "js-yaml";
import { z } from "zod";
import type { Contract } from "./types.js";

const StepSchema = z.object({
  id: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  expectedArtifacts: z.array(z.string()),
  verification: z.array(z.string())
});

export const ContractZodSchema = z.object({
  identity: z.object({
    id: z.string().min(1),
    version: z.number().int().min(1),
    repo: z.string().min(1),
    createdAt: z.string().min(1),
    createdBy: z.string().min(1)
  }),
  intent: z.object({
    goals: z.array(z.string()),
    constraints: z.array(z.string()),
    nonGoals: z.array(z.string()),
    assumptions: z.array(z.string())
  }),
  scope: z.object({
    inScope: z.array(z.string()),
    outOfScope: z.array(z.string()),
    interfacesTouched: z.array(z.string()),
    dataTouched: z.array(z.string())
  }),
  plan: z.object({
    steps: z.array(StepSchema).min(1)
  }),
  guardrails: z.object({
    invariants: z.array(z.string()),
    protectedPaths: z.array(z.string()),
    approvalPolicy: z.string().min(1)
  }),
  verification: z.object({
    commands: z.array(z.string())
  }),
  evidence: z.object({
    runLogs: z.array(z.string()),
    snapshotFingerprint: z.string().nullable(),
    verificationResults: z.array(
      z.object({
        command: z.string(),
        success: z.boolean(),
        exitCode: z.number(),
        output: z.string()
      })
    )
  }),
  interop: z.object({
    executors: z.array(z.string()),
    protocols: z.array(z.string())
  })
});

export const contractJsonSchema = {
  type: "object",
  required: ["identity", "intent", "scope", "plan", "guardrails", "verification", "evidence", "interop"],
  properties: {
    identity: {
      type: "object",
      required: ["id", "version", "repo", "createdAt", "createdBy"],
      properties: {
        id: { type: "string", minLength: 1 },
        version: { type: "integer", minimum: 1 },
        repo: { type: "string", minLength: 1 },
        createdAt: { type: "string", minLength: 1 },
        createdBy: { type: "string", minLength: 1 }
      }
    },
    intent: { type: "object" },
    scope: { type: "object" },
    plan: {
      type: "object",
      required: ["steps"],
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["id", "riskLevel", "expectedArtifacts", "verification"],
            properties: {
              id: { type: "string", minLength: 1 },
              riskLevel: { enum: ["low", "medium", "high", "critical"] },
              expectedArtifacts: { type: "array", items: { type: "string" } },
              verification: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    },
    guardrails: { type: "object" },
    verification: { type: "object" },
    evidence: { type: "object" },
    interop: { type: "object" }
  }
} as const;

const AjvCtor: any = (Ajv2020 as any).default ?? (Ajv2020 as any);
const ajv = new AjvCtor({ allErrors: true, strict: false });
const validateSchema = ajv.compile(contractJsonSchema);

export function createContractFromVibe(vibe: string, repo = "current"): Contract {
  const now = new Date().toISOString();
  return {
    identity: {
      id: `salacia-${Date.now()}`,
      version: 1,
      repo,
      createdAt: now,
      createdBy: "salacia"
    },
    intent: {
      goals: [vibe.trim()],
      constraints: ["Keep implementation auditable and reversible"],
      nonGoals: ["Unrelated refactors"],
      assumptions: ["Required tools are available in PATH"]
    },
    scope: {
      inScope: ["src/**", ".salacia/**"],
      outOfScope: ["secrets/**", "**/.env*"],
      interfacesTouched: ["CLI", "Contracts", "Adapters"],
      dataTouched: [".salacia/contracts", ".salacia/specs", ".salacia/plans"]
    },
    plan: {
      steps: [
        {
          id: "analyze",
          riskLevel: "low",
          expectedArtifacts: [".salacia/plans/latest.json"],
          verification: ["npm run lint"]
        },
        {
          id: "implement",
          riskLevel: "medium",
          expectedArtifacts: ["source changes"],
          verification: ["npm test"]
        },
        {
          id: "verify",
          riskLevel: "low",
          expectedArtifacts: ["verification logs"],
          verification: ["npm test"]
        }
      ]
    },
    guardrails: {
      invariants: ["No plaintext secrets in repository", "Preserve rollback path"],
      protectedPaths: [".env", "secrets/"],
      approvalPolicy: "require-approval-on-high-risk"
    },
    verification: {
      commands: ["npm run lint", "npm test"]
    },
    evidence: {
      runLogs: [],
      snapshotFingerprint: null,
      verificationResults: []
    },
    interop: {
      executors: ["claude-code", "codex", "opencode", "cursor", "cline", "vscode", "antigravity"],
      protocols: ["mcp", "acp"]
    }
  };
}

export function validateContract(contract: unknown): { valid: boolean; errors: string[] } {
  const zodResult = ContractZodSchema.safeParse(contract);
  const schemaValid = validateSchema(contract);

  const errors: string[] = [];
  if (!zodResult.success) {
    for (const issue of zodResult.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (!schemaValid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      errors.push(`schema ${err.instancePath || "/"}: ${err.message ?? "invalid"}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function saveContract(contract: Contract, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, yaml.dump(contract, { noRefs: true }), "utf8");
}

export async function loadContract(filePath: string): Promise<Contract> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = yaml.load(raw);
  const checked = ContractZodSchema.parse(parsed);
  return checked;
}
