export interface AgentRole {
  id: string;
  description: string;
  objective: string;
}

export const salaciaAgentTeam: AgentRole[] = [
  {
    id: "orchestrator",
    description: "Owns contract lifecycle and step dispatching.",
    objective: "Keep execution aligned with contract and plan boundaries."
  },
  {
    id: "reviewer",
    description: "Reviews quality and regression risk.",
    objective: "Detect correctness and maintainability risks before merge."
  },
  {
    id: "verifier",
    description: "Runs verification commands and evidence checks.",
    objective: "Ensure contract verification commands pass with evidence."
  }
];
