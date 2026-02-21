declare module "@anthropic-ai/claude-agent-sdk/sdk.mjs" {
  export function unstable_v2_prompt(
    prompt: string,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}
