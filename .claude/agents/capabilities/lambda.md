# Lambda Capability

## Handler Pattern

- Thin handler: validate input → call domain function → format response
- Never put business logic in the handler file itself
- Domain logic lives in separate modules that are testable without Lambda context

```ts
// handler.ts — thin wrapper
export const handler = async (event: APIGatewayProxyEvent) => {
  const input = parseAndValidate(event);        // validate
  const result = await processDomainLogic(input); // domain module
  return formatResponse(200, result);            // format
};
```

## Runtime and Module Format

- Runtime: Node.js 20
- ESM required: `"type": "module"` in `package.json`
- Import paths must include `.js` extension in ESM: `import { fn } from "./domain.js"`

## Cold Start Mitigation

- Keep bundle size small — tree-shake unused SDK clients
- Avoid heavy imports at the top level; import inside the handler only what is needed
- Initialize SDK clients outside the handler function so they are reused across invocations

## Configuration

- Environment variables for all config — table names, ARNs, external URLs
- Never hardcode ARNs, table names, or region strings in code
- Access via `process.env.TABLE_NAME` — validate presence at startup, not per-request

## Timeouts

- API handlers: 30 seconds default
- Async processing (queues, streams, scheduled): up to 15 minutes
- Set timeout in infrastructure, not in code — match to actual worst-case duration
