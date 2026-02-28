import type { AcpDispatchResult, AcpMessage, AcpTransport } from "./acp.js";
import { validateAcpMessage } from "./acp.js";

export class A2AAcpTransport implements AcpTransport {
  readonly transport = "acp-a2a";

  async dispatch(message: AcpMessage): Promise<AcpDispatchResult> {
    const validation = validateAcpMessage(message);
    if (!validation.ok) {
      return {
        ok: false,
        details: `Invalid ACP message: ${validation.errors.join("; ")}`,
        error: {
          code: "acp.invalid_message",
          message: "ACP message failed schema validation",
          details: validation.errors,
          retriable: false
        }
      };
    }

    return {
      ok: true,
      details: `A2A delivered ${message.type} from ${message.source} to ${message.target}`,
      response: {
        ack: true,
        messageId: message.id,
        transport: this.transport
      }
    };
  }
}
