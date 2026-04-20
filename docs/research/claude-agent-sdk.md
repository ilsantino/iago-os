# Research: Claude Agent SDK

**Date:** 2026-04-13
**Question:** Python and TypeScript Agent SDK — full API surface, multi-agent patterns

---

## Background

The Claude Agent SDK was renamed from "Claude Code SDK" on 2025-09-29 to signal broader applicability beyond coding tasks. It packages the same tool loop that powers Claude Code as a programmable library for Python and TypeScript. It is NOT the same as the OpenAI Agents SDK (`openai-agents` package) — it has different primitives, no `Agent` class, no `Runner`, and no `@function_tool` decorator.

**Install:**
```bash
pip install claude-agent-sdk
npm install @anthropic-ai/claude-agent-sdk
```
**Requirements:** Python 3.10+, Node.js (bundled Claude Code CLI, no separate install).

---

## Findings

### 1. Core Execution Model

The SDK does not have an `Agent` class or `Runner.run()`. The execution primitives are:

| Primitive | Python | TypeScript |
|---|---|---|
| Simple single-query | `query(prompt, options)` | `query({ prompt, options })` |
| Stateful multi-turn | `ClaudeSDKClient` context manager | `query()` with `resume` |
| Session resume | `options.resume = session_id` | `options: { resume: sessionId }` |

Both `query()` and `ClaudeSDKClient.receive_response()` return async iterators of typed message objects — there is no single return value. The agent runs until it produces a `ResultMessage` (always the last message).

#### Python `query()` signature
```python
async def query(
    *,
    prompt: str | AsyncIterable[dict[str, Any]],
    options: ClaudeAgentOptions | None = None,
    transport: Transport | None = None
) -> AsyncIterator[Message]
```

#### TypeScript `query()` signature
```typescript
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;  // Query extends AsyncGenerator<SDKMessage, void> + control methods
```

The TypeScript `Query` object adds runtime control methods: `.interrupt()`, `.setPermissionMode()`, `.setModel()`, `.rewindFiles()`, `.setMcpServers()`, `.stopTask()`, and more.

---

### 2. Configuration: `ClaudeAgentOptions` / `Options`

This is the equivalent of the OpenAI Agents SDK `Agent()` constructor — all configuration is here, not on a named agent object.

#### Python `ClaudeAgentOptions` (complete field list)
```python
@dataclass
class ClaudeAgentOptions:
    # Core
    model: str | None = None
    fallback_model: str | None = None
    system_prompt: str | SystemPromptPreset | None = None
    max_turns: int | None = None
    max_budget_usd: float | None = None
    cwd: str | Path | None = None

    # Tools
    tools: list[str] | ToolsPreset | None = None       # availability layer (context)
    allowed_tools: list[str] = []                       # permission layer (auto-approve)
    disallowed_tools: list[str] = []                    # permission layer (always deny)
    can_use_tool: CanUseTool | None = None              # dynamic permission callback

    # MCP
    mcp_servers: dict[str, McpServerConfig] | str | Path = {}

    # Permissions
    permission_mode: PermissionMode | None = None
    # 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'

    # Sessions
    continue_conversation: bool = False
    resume: str | None = None                           # disk-backed session ID
    fork_session: bool = False
    enable_file_checkpointing: bool = False

    # Subagents
    agents: dict[str, AgentDefinition] | None = None

    # Hooks
    hooks: dict[HookEvent, list[HookMatcher]] | None = None

    # Output
    output_format: dict[str, Any] | None = None         # structured output via JSON Schema
    include_partial_messages: bool = False

    # Thinking
    effort: Literal["low", "medium", "high", "max"] | None = None
    thinking: ThinkingConfig | None = None

    # Settings loading
    setting_sources: list[SettingSource] | None = None  # 'user' | 'project' | 'local'

    # Misc
    betas: list[SdkBeta] = []
    plugins: list[SdkPluginConfig] = []
    sandbox: SandboxSettings | None = None
    env: dict[str, str] = {}
    extra_args: dict[str, str | None] = {}
    cli_path: str | Path | None = None
    stderr: Callable[[str], None] | None = None
```

TypeScript `Options` has the same semantic fields with camelCase names (`allowedTools`, `mcpServers`, `systemPrompt`, `permissionMode`, `outputFormat`, etc.).

---

### 3. Tool Definitions

There is no `@function_tool`. The pattern is: decorate with `@tool` → wrap in `create_sdk_mcp_server` → pass to `mcp_servers`.

#### Python `@tool` decorator
```python
@tool(
    name: str,
    description: str,
    input_schema: type | dict[str, Any],  # {field: type} dict or full JSON Schema
    annotations: ToolAnnotations | None = None
)
async def handler(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": result}]}
    # or: {"content": [...], "is_error": True}  ← keeps loop alive
```

#### TypeScript `tool()` function (uses Zod)
```typescript
tool(
  name: string,
  description: string,
  inputSchema: AnyZodRawShape,            // Zod schema, typed handler args
  handler: (args, extra) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
)
```

#### Tool result shape
```typescript
{
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }   // base64, no data: prefix
    | { type: "resource"; resource: { uri, text?, blob?, mimeType? } }
  >;
  isError?: boolean;  // Python: is_error
}
```

**Critical:** throwing an exception inside a handler kills the entire agent loop. Return `isError: true` for recoverable failures.

#### Tool annotations
```python
ToolAnnotations(
    readOnlyHint=True,    # allows parallel batching
    destructiveHint=True, # informational
    idempotentHint=False, # informational
    openWorldHint=True    # informational
)
```

#### `create_sdk_mcp_server` / `createSdkMcpServer`
```python
# Python
server = create_sdk_mcp_server(
    name="my-server",        # becomes {server_name} in tool IDs
    version="1.0.0",
    tools=[tool_a, tool_b]
)

# TypeScript
const server = createSdkMcpServer({
  name: "my-server",
  version: "1.0.0",
  tools: [toolA, toolB]
});
```

Tool IDs follow pattern: `mcp__{server_name}__{tool_name}`.  
Pass `type: "sdk"` in `mcpServers` for TypeScript SDK servers:
```typescript
mcpServers: {
  "my-tools": { type: "sdk", name: "my-server", instance: server }
}
```
Python just passes the server object directly.

---

### 4. MCP Integration

Three transport types supported:

```python
# stdio (local subprocess)
mcp_servers={
    "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {"GITHUB_TOKEN": os.environ["GITHUB_TOKEN"]}
    }
}

# SSE (remote streaming)
mcp_servers={
    "remote": {
        "type": "sse",
        "url": "https://api.example.com/mcp/sse",
        "headers": {"Authorization": f"Bearer {token}"}
    }
}

# HTTP (remote non-streaming)
mcp_servers={
    "docs": {
        "type": "http",
        "url": "https://code.claude.com/docs/mcp"
    }
}
```

TypeScript `McpServerConfig` union type:
```typescript
type McpServerConfig =
  | { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "sse"; url: string; headers?: Record<string, string> }
  | { type: "http"; url: string; headers?: Record<string, string> }
  | { type: "sdk"; name: string; instance: McpServer }
  | { type: "claudeai-proxy"; url: string; id: string };
```

**No named classes** like `MCPServerStdio` or `MCPServerStreamableHTTP` — these are plain config dicts/objects, not class instances. That design is OpenAI Agents SDK, not Claude.

**Tool search:** enabled by default. When many MCP tools are configured, the SDK withholds tool definitions from context and loads only what's needed per turn. Configurable via `toolConfig`.

---

### 5. Guardrails

No `InputGuardrail`/`OutputGuardrail`/`GuardrailFunctionOutput` classes. Two approaches:

**Option A: Plain functions (explicit in run code)**
```python
def input_check(prompt: str) -> tuple[bool, str | None]:
    if re.search(r"\$\d+", prompt):
        return True, None
    return False, "Please include a dollar amount."

def output_check(result: str) -> tuple[bool, str | None]:
    if re.search(r"\b(approv|reject|escalate)\b", result, re.IGNORECASE):
        return True, None
    return False, "No decision reached."

async def run(prompt: str):
    ok, msg = input_check(prompt)
    if not ok:
        print(msg); return

    async with ClaudeSDKClient(options=opts) as client:
        await client.query(prompt)
        messages = [m async for m in client.receive_response()]

    result = messages[-1].result
    ok, msg = output_check(result or "")
    if not ok:
        print(msg)
```

**Option B: `UserPromptSubmit` hook (structural match to `@input_guardrail`)**
```python
async def guardrail_hook(input_data, tool_use_id, context):
    if re.search(r"\$\d+", input_data["prompt"]):
        return {}
    return {"decision": "block", "reason": "Include a dollar amount."}

options = ClaudeAgentOptions(
    hooks={"UserPromptSubmit": [HookMatcher(hooks=[guardrail_hook])]}
)
```

---

### 6. Hooks (Full Hook Event List)

Available `HookEvent` values (TypeScript, same in Python):
```
PreToolUse | PostToolUse | PostToolUseFailure |
Notification | UserPromptSubmit | SessionStart | SessionEnd |
Stop | SubagentStart | SubagentStop | PreCompact |
PermissionRequest | Setup | TeammateIdle | TaskCompleted |
ConfigChange | WorktreeCreate | WorktreeRemove
```

`HookMatcher` signature:
```python
@dataclass
class HookMatcher:
    matcher: str | None = None      # e.g. "Bash", "Write|Edit", None = all tools
    hooks: list[HookCallback] = []
    timeout: float | None = None    # default 60s
```

Hook callback signature:
```python
async def hook(input_data: dict, tool_use_id: str | None, context) -> dict:
    # Return {} to allow
    # Return {"decision": "block", "reason": "..."} to deny (UserPromptSubmit)
    # Return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
    #          "permissionDecision": "deny", "permissionDecisionReason": "..."}} for PreToolUse
```

---

### 7. Subagents (Handoffs Pattern)

No `Handoff` class. The pattern is: define `AgentDefinition` objects → orchestrator delegates via `Agent` tool.

**Key distinction from OpenAI handoffs:** the orchestrator remains in control and receives results back. It does not "hand off" and exit. This is the "agent-as-tool" / orchestrator-delegate pattern.

#### `AgentDefinition`
```python
@dataclass
class AgentDefinition:
    description: str                                            # REQUIRED — Claude reads this to decide delegation
    prompt: str                                                 # REQUIRED — subagent system prompt
    tools: list[str] | None = None                             # None = inherit parent's tools
    model: Literal["sonnet", "opus", "haiku", "inherit"] | None = None
    skills: list[str] | None = None
    memory: Literal["user", "project", "local"] | None = None  # Python only
    mcpServers: list[str | dict[str, Any]] | None = None
    # maxTurns: int | None = None  (TypeScript only via AgentDefinition.maxTurns)
```

Usage:
```python
options = ClaudeAgentOptions(
    allowed_tools=["Read", "Grep", "Agent"],   # "Agent" tool REQUIRED
    agents={
        "security-reviewer": AgentDefinition(
            description="Performs security audits. Use for auth, SQL injection, XSS.",
            prompt="You are a security expert. Review for OWASP Top 10...",
            tools=["Read", "Grep"],             # read-only restriction
            model="opus",                        # per-agent model override
        )
    }
)
```

**Invocation:** Claude auto-delegates based on description match, or explicitly with `"Use the security-reviewer agent to..."`.

**Subagent constraints:**
- Subagents cannot spawn their own subagents (no `Agent` in `tools`)
- Subagents do not inherit parent conversation history
- Subagents receive only what the orchestrator includes in the Agent tool prompt
- Windows: long prompts may fail (CLI arg limit 8191 chars)

**Tracking subagent messages:** messages from within a subagent include `parent_tool_use_id`. Check `block.name in ("Agent", "Task")` on `ToolUseBlock` — "Task" was the old name, still appears in some SDK fields.

---

### 8. Sessions

```python
# Capture session ID
session_id = None
async for message in query(prompt="...", options=opts):
    if isinstance(message, SystemMessage) and message.subtype == "init":
        session_id = message.data["session_id"]
    if isinstance(message, ResultMessage):
        session_id = message.session_id  # also available here

# Resume (disk-backed, survives restarts)
async for message in query(prompt="...", options=ClaudeAgentOptions(resume=session_id)):
    ...
```

TypeScript session management functions:
```typescript
listSessions({ dir?, limit?, includeWorktrees? })
getSessionMessages(sessionId, { dir?, limit?, offset? })
getSessionInfo(sessionId, { dir? })
renameSession(sessionId, title, { dir? })
tagSession(sessionId, tag | null, { dir? })
```

---

### 9. Structured Output

No `output_type` with Pydantic models. Use JSON Schema directly:

```python
options = ClaudeAgentOptions(
    output_format={
        "type": "json_schema",
        "schema": {
            "type": "object",
            "properties": {
                "decision": {"type": "string", "enum": ["approve", "reject", "escalate"]},
                "reason": {"type": "string"}
            },
            "required": ["decision", "reason"]
        }
    }
)

# Access via ResultMessage
result_message.structured_output  # dict matching schema
```

---

### 10. Model Routing

Per-agent model override in `AgentDefinition.model`: `"sonnet" | "opus" | "haiku" | "inherit"`.

Global model in `ClaudeAgentOptions.model` (full model ID string, e.g. `"claude-opus-4-1"`).

No `ModelSettings` class. Thinking configuration:
```python
thinking: ThinkingConfig | None  # {"type": "adaptive"} | {"type": "enabled", "budgetTokens": N} | {"type": "disabled"}
effort: "low" | "medium" | "high" | "max"  # shorthand for thinking/token budget
```

Third-party providers via env vars:
```bash
CLAUDE_CODE_USE_BEDROCK=1      # AWS Bedrock
CLAUDE_CODE_USE_VERTEX=1       # Google Vertex AI
CLAUDE_CODE_USE_FOUNDRY=1      # Microsoft Azure AI Foundry
```

---

### 11. Tracing

No custom spans API exposed. OpenTelemetry-native:
```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4317
```

Plugs into Grafana, Datadog, Honeycomb without SDK changes. Per-run cost and usage always available on `ResultMessage`:
```python
result.total_cost_usd
result.usage           # {input_tokens, output_tokens, cache_creation_input_tokens, ...}
result.model_usage     # {model_name: ModelUsage}
```

---

### 12. Exposing Agents as MCP Servers

`create_sdk_mcp_server`/`createSdkMcpServer` creates **in-process MCP servers** so your custom tools are accessible to Claude without running a separate subprocess. The server itself runs inside your process.

There is no `expose_as_mcp_server()` function that wraps a full agent as an MCP endpoint for external consumption. The `create_sdk_mcp_server` only bundles tool *functions*, not an entire agent. If you want to expose an agent as an MCP server to external consumers, you would build an HTTP server that wraps the SDK (documented in `platform.claude.com/docs/en/agent-sdk/hosting`).

---

### 13. Message Type Reference

```python
Message = UserMessage | AssistantMessage | SystemMessage | ResultMessage | StreamEvent | RateLimitEvent

class AssistantMessage:
    content: list[TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock]
    model: str
    parent_tool_use_id: str | None  # set if inside subagent
    usage: dict | None
    message_id: str | None

class ResultMessage:
    subtype: str            # "success" | "error_during_execution"
    duration_ms: int
    is_error: bool
    num_turns: int
    session_id: str
    total_cost_usd: float | None
    result: str | None
    structured_output: Any = None
    model_usage: dict | None
```

---

### 14. Multi-Agent Patterns

#### Orchestrator pattern
Main agent with `agents` dict + `"Agent"` in `allowed_tools`. Claude selects subagent by matching task to `description`. Orchestrator stays in loop and processes results.

#### Parallel agent execution
Not directly supported via SDK primitives. Achieved with `asyncio.gather` on multiple independent `query()` calls, each potentially pointed at different `cwd` or `system_prompt`. No shared state between parallel queries unless you use sessions.

```python
results = await asyncio.gather(
    run_agent("security-scan"),
    run_agent("performance-analysis"),
    run_agent("test-coverage"),
)
```

#### Agent-as-tool pattern
`AgentDefinition` is exactly this. Subagents are invoked as tools by the orchestrator and return their result as the tool's output. The orchestrator composes multiple subagent results.

#### Deterministic vs. LLM-routed workflows
- **LLM-routed:** put subagent descriptions in `AgentDefinition.description` and let Claude decide. Works well for high-level delegation.
- **Deterministic:** explicitly name the subagent in your prompt (`"Use the X agent to..."`) or call `query()` directly with a tailored `system_prompt` and no subagent layer.
- **Hybrid:** orchestrator LLM decides routing, but subagents follow deterministic tool restriction policies via `tools: [...]` and `can_use_tool`.

---

### 15. Python vs. TypeScript API Differences

| Feature | Python | TypeScript |
|---|---|---|
| Package | `claude-agent-sdk` | `@anthropic-ai/claude-agent-sdk` |
| Tool schema | `{field: type}` dict or JSON Schema | Zod schema (typed handler args) |
| Tool annotations param | `annotations=` kwarg on `@tool` | 5th arg to `tool()` |
| MCP server SDK type | implicit (just pass object) | `{ type: "sdk", name, instance }` |
| `AgentDefinition.memory` | supported | not present |
| `AgentDefinition.maxTurns` | not present | supported |
| Query control methods | `ClaudeSDKClient` class | `.interrupt()` etc. on `Query` object |
| Session functions | no standalone helpers | `listSessions()`, `getSessionMessages()`, etc. |
| Error response | `"is_error": True` | `isError: true` |
| Streaming input | `AsyncIterable[dict]` | `AsyncIterable<SDKUserMessage>` |

---

## OpenAI Agents SDK Mapping (for migration context)

| OpenAI Agents SDK | Claude Agent SDK |
|---|---|
| `Agent(name, instructions, tools, handoffs, output_type)` | `ClaudeAgentOptions` + `AgentDefinition` |
| `@function_tool` | `@tool` + `create_sdk_mcp_server` |
| `Runner.run(agent, msg)` | `query(prompt, options)` |
| `Runner.run_streamed()` | `query()` — always async iterator, always streaming |
| `@input_guardrail` + `GuardrailFunctionOutput` | Plain function OR `UserPromptSubmit` hook |
| `@output_guardrail` | Plain function on `ResultMessage.result` |
| `Handoff` / `handoffs=[...]` | `AgentDefinition` + `"Agent"` in `allowed_tools` |
| `output_type: BaseModel` | `output_format: {"type": "json_schema", "schema": {...}}` |
| `MCPServerStdio` | `{"command": ..., "args": [...]}` config dict |
| `MCPServerStreamableHTTP` | `{"type": "http", "url": ...}` config dict |
| `MCPServerSse` | `{"type": "sse", "url": ...}` config dict |
| Built-in tracing | OpenTelemetry via env vars |
| Custom spans | Not exposed |
| `ModelSettings` | `effort: str` + `thinking: ThinkingConfig` |

---

## Sources

| Source | Contribution |
|---|---|
| [code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview) | Core API, `query()` signatures, all capability tabs |
| [code.claude.com/docs/en/agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript) | Full TypeScript `Options` type, `Query` methods, hook events, session API |
| [code.claude.com/docs/en/agent-sdk/python](https://code.claude.com/docs/en/agent-sdk/python) | Complete `ClaudeAgentOptions` dataclass, all message types, `ClaudeSDKClient` |
| [code.claude.com/docs/en/agent-sdk/custom-tools](https://code.claude.com/docs/en/agent-sdk/custom-tools) | `@tool` decorator, `create_sdk_mcp_server`, tool annotations, error handling |
| [code.claude.com/docs/en/agent-sdk/mcp](https://code.claude.com/docs/en/agent-sdk/mcp) | MCP transport types, `McpServerConfig` union, auth, tool search |
| [code.claude.com/docs/en/agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents) | `AgentDefinition`, orchestrator pattern, parallel, agent-as-tool, resuming |
| [platform.claude.com/cookbook/claude-agent-sdk-04-migrating-from-openai-agents-sdk](https://platform.claude.com/cookbook/claude-agent-sdk-04-migrating-from-openai-agents-sdk) | Full OpenAI→Claude mapping, guardrails pattern, session comparison |
| [github.com/anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python) | Python package README, `@tool`, `create_sdk_mcp_server`, hooks examples |
| WebSearch results | SDK rename history, MCP ecosystem context, multi-agent framework comparisons |

---

## Recommendation

**Decision:** Use the Claude Agent SDK Python package (`claude-agent-sdk`) as the primary agent runtime for iaGO client projects, not the OpenAI Agents SDK or LangGraph.

**Confidence:** High

**Reasoning:** The Claude Agent SDK gives the deepest integration with Claude models (prompt caching automatic, per-turn cost tracking, extended thinking, Bedrock/Vertex passthrough), has the richest MCP ecosystem (200+ servers, in-process tool server, HTTP/SSE/stdio), and its subagent + hooks model maps cleanly onto the iaGO hub-and-spoke architecture already in CLAUDE.md. The OpenAI Agents SDK (`Runner`, `@function_tool`, `handoffs`, `output_type`) is a completely different set of primitives — nothing transfers directly. If you're starting from OpenAI Agents SDK, budget a rewrite, not a port.

**Next step:** Update `/.claude/rules/available-skills.md` and `/.claude/agents/` capability modules to reference the correct Claude Agent SDK primitives (`ClaudeAgentOptions`, `AgentDefinition`, `@tool`, `create_sdk_mcp_server`, `HookMatcher`). Retire any references to `Runner`, `@function_tool`, `MCPServerStdio` as class names, or `output_type`.

**Risk if wrong:** If Claude Agent SDK adds breaking changes before v1.0 (it's still pre-1.0), tool schemas and message types could shift. Mitigate by pinning the package version and monitoring the [CHANGELOG](https://github.com/anthropics/claude-agent-sdk-python/blob/main/CHANGELOG.md).
