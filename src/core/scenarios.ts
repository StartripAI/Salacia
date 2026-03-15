import type { RiskLevel } from "./types.js";

export interface HarnessScenario {
  id: string;
  name: string;
  icon: string;
  description: string;
  defaults: {
    riskLevel: RiskLevel;
    rollback: boolean;
    verification: "full" | "compile-only" | "custom";
    topology: "single" | "multi";
  };
  promptTemplate: string;
}

export const HARNESS_SCENARIOS: HarnessScenario[] = [
  {
    id: "fix-bug",
    name: "Fix a bug",
    icon: "🐛",
    description: "Describe the bug, Salacia finds and fixes it",
    defaults: {
      riskLevel: "medium",
      rollback: true,
      verification: "full",
      topology: "single"
    },
    promptTemplate: "Fix the following bug: {input}. Ensure all existing tests continue to pass after the fix."
  },
  {
    id: "add-feature",
    name: "Add a feature",
    icon: "✨",
    description: "Describe the feature, Salacia implements it",
    defaults: {
      riskLevel: "medium",
      rollback: true,
      verification: "full",
      topology: "single"
    },
    promptTemplate: "Implement the following feature: {input}. Write tests for the new functionality."
  },
  {
    id: "refactor",
    name: "Refactor code",
    icon: "🔧",
    description: "Point to code, Salacia refactors it safely",
    defaults: {
      riskLevel: "high",
      rollback: true,
      verification: "full",
      topology: "single"
    },
    promptTemplate:
      "Refactor the following: {input}. Preserve all existing behavior and ensure all tests pass. Do not change public APIs."
  },
  {
    id: "add-tests",
    name: "Add tests",
    icon: "🧪",
    description: "Salacia analyzes code and generates test coverage",
    defaults: {
      riskLevel: "low",
      rollback: false,
      verification: "compile-only",
      topology: "single"
    },
    promptTemplate:
      "Analyze the codebase and add comprehensive tests for: {input}. Focus on edge cases and error paths."
  },
  {
    id: "free-form",
    name: "Free-form",
    icon: "📖",
    description: "Describe anything in natural language",
    defaults: {
      riskLevel: "medium",
      rollback: true,
      verification: "full",
      topology: "single"
    },
    promptTemplate: "{input}"
  }
];

export function findScenario(id: string): HarnessScenario | undefined {
  return HARNESS_SCENARIOS.find((s) => s.id === id);
}

export function applyScenarioTemplate(scenario: HarnessScenario, input: string): string {
  return scenario.promptTemplate.replace("{input}", input);
}
