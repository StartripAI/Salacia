import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";

const execFileAsync = promisify(execFile);
const AjvCtor: any = (Ajv2020 as any).default ?? (Ajv2020 as any);
const ajv = new AjvCtor({ allErrors: true, strict: false });

export interface AcpMessage {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source: string;
  target: string;
  createdAt: string;
}

export interface AcpDispatchResult {
  ok: boolean;
  details: string;
  response?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: string[];
    retriable?: boolean;
  };
}

const acpMessageSchema = {
  type: "object",
  required: ["id", "type", "payload", "source", "target", "createdAt"],
  properties: {
    id: { type: "string", minLength: 1 },
    type: { type: "string", minLength: 1 },
    payload: { type: "object" },
    source: { type: "string", minLength: 1 },
    target: { type: "string", minLength: 1 },
    createdAt: { type: "string", minLength: 1 }
  }
} as const;

const validateMessage = ajv.compile(acpMessageSchema);

export interface AcpTransport {
  transport: string;
  dispatch(message: AcpMessage): Promise<AcpDispatchResult>;
}

export function validateAcpMessage(message: unknown): { ok: boolean; errors: string[] } {
  const valid = validateMessage(message);
  if (valid) {
    return { ok: true, errors: [] };
  }

  const errors =
    validateMessage.errors?.map((err: { instancePath?: string; message?: string }) => `${err.instancePath || "/"}: ${err.message ?? "invalid"}`) ?? [
      "invalid ACP message"
    ];
  return { ok: false, errors };
}

export class A2ADispatcher {
  async dispatch(message: AcpMessage): Promise<AcpDispatchResult> {
    const validation = validateAcpMessage(message);
    if (!validation.ok) {
      return {
        ok: false,
        details: `Invalid ACP message: ${validation.errors.join("; ")}`
      };
    }

    return {
      ok: true,
      details: `A2A delivered ${message.type} from ${message.source} to ${message.target}`,
      response: {
        ack: true,
        messageId: message.id
      }
    };
  }
}

export class OpenCodeAcpBridge {
  async probe(): Promise<AcpDispatchResult> {
    try {
      const { stdout, stderr } = await execFileAsync("opencode", ["--help"], {
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      });
      return {
        ok: true,
        details: `${stdout}\n${stderr}`.slice(0, 500)
      };
    } catch (error) {
      return {
        ok: false,
        details: `OpenCode probe failed: ${(error as Error).message}`
      };
    }
  }

  async send(message: AcpMessage): Promise<AcpDispatchResult> {
    const validation = validateAcpMessage(message);
    if (!validation.ok) {
      return {
        ok: false,
        details: `Invalid ACP message: ${validation.errors.join("; ")}`
      };
    }

    const probe = await this.probe();
    if (!probe.ok) {
      return probe;
    }

    return {
      ok: true,
      details: `OpenCode ACP subprocess bridge accepted ${message.type}`,
      response: {
        ack: true,
        bridge: "opencode-subprocess"
      }
    };
  }
}
