import type { Contract } from "../core/types.js";

export interface HookContext {
  contract: Contract;
  action: string;
  targetPath?: string;
}

export function preToolUseHook(context: HookContext): { allowed: boolean; reason: string } {
  const target = context.targetPath ?? "";
  const blocked = context.contract.guardrails.protectedPaths.some((p) => target.startsWith(p));
  if (blocked) {
    return {
      allowed: false,
      reason: `Blocked by protected path guardrail: ${target}`
    };
  }
  return {
    allowed: true,
    reason: "Allowed by guardrail policy"
  };
}

export function postToolUseHook(context: HookContext): { ok: boolean; note: string } {
  return {
    ok: true,
    note: `Post-tool hook recorded for action ${context.action}`
  };
}

export function stopHook(context: HookContext): { shouldVerify: boolean; note: string } {
  return {
    shouldVerify: true,
    note: `Stop hook requires verification for ${context.contract.identity.id}`
  };
}
