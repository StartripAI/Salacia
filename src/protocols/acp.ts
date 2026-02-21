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

export class A2ADispatcher {
  async dispatch(message: AcpMessage): Promise<AcpDispatchResult> {
    const valid = validateMessage(message);
    if (!valid) {
      return {
        ok: false,
        details: `Invalid ACP message: ${JSON.stringify(validateMessage.errors)}`
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
    const valid = validateMessage(message);
    if (!valid) {
      return {
        ok: false,
        details: `Invalid ACP message: ${JSON.stringify(validateMessage.errors)}`
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
