# Protocols

## MCP

Salacia implements MCP server and client-side gateway via `@modelcontextprotocol/sdk`.

Exposed tools:

- `salacia-contract-validate`
- `salacia-snapshot`
- `salacia-plan`
- `salacia-progress`

Run server:

```bash
salacia mcp-server
```

Describe server metadata:

```bash
salacia mcp-describe --json
```

## ACP

Two ACP paths are implemented:

1. A2A dispatcher (`A2ADispatcher`)
- strict message schema validation (AJV)
- deterministic ack response

2. OpenCode subprocess bridge (`OpenCodeAcpBridge`)
- probe and handshake path
- message validation + bridge ack

## Error Contracts

- schema violations return `{ ok: false, details: ... }`
- bridge unavailability returns explicit diagnostics
- malformed payloads never produce synthetic success
