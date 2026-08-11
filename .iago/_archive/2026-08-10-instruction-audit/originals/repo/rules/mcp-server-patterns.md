---
description: >-
  MCP (Model Context Protocol) server patterns using Node.js/TypeScript SDK.
globs:
  - "**/mcp/**"
---

## SDK

Use `@modelcontextprotocol/sdk` — the official TypeScript SDK.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

## Server Structure

```
mcp/
  {server-name}/
    index.ts          # Server entry point
    tools/            # Tool definitions
    resources/        # Resource definitions
    prompts/          # Prompt templates
```

## Tool Definitions

- Use Zod for input validation — schemas are auto-converted to JSON Schema
- One tool per file in `tools/` directory
- Tool names: `snake_case`, descriptive, verb-first (`get_user`, `create_report`)
- Always return structured content with `type: "text"` for text responses

```ts
server.tool("tool_name", { param: z.string() }, async ({ param }) => {
  return { content: [{ type: "text", text: result }] };
});
```

## Error Handling

- Throw `McpError` with appropriate error codes for tool failures
- Never let unhandled exceptions crash the server — wrap tool handlers in try/catch
- Use `ErrorCode.InvalidParams` for bad input, `ErrorCode.InternalError` for unexpected failures
- Return user-readable error messages in the `text` field

## Resources

- Use `resource://` URI scheme
- Resources are read-only data the model can access
- List resources with `server.resource()` — include description and MIME type

## Transport

- Default: `StdioServerTransport` for local tools
- SSE transport for remote/web-based servers
- Never mix transports in a single server instance

## Testing

- Test tools as plain async functions before registering with MCP
- Use `@modelcontextprotocol/sdk/client` for integration tests
- Mock external services — MCP tool tests should not hit real APIs
