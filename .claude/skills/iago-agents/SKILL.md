---
name: iago-agents
description: >-
  Use when designing multi-agent architectures for client deliverables using
  Claude SDK + LangGraph. Not when configuring iaGO's own agents (those are in
  .claude/agents/) or when building simple single-prompt integrations.
---

## Purpose

Design multi-agent systems for client projects — defining agent roles, tool
schemas, orchestration patterns, and LangGraph state graphs. Produces architecture
specifications ready for implementation.

## Arguments

`/iago:agents {description}` — what the multi-agent system should accomplish.

Optional flags:
- `--pattern {router|pipeline|hierarchical|collaborative}` — orchestration pattern
- `--output {path}` — custom output path (default: `docs/agents/`)

## Preconditions

- `.iago/PROJECT.md` should exist for project context. If not, ask the user for
  sufficient context about the target system and its requirements.

## Steps

### 1. Gather requirements

Identify:
1. **Goal:** What should the agent system accomplish end-to-end?
2. **Users:** Who interacts with it? (end users, internal ops, automated triggers)
3. **Scope:** What decisions can agents make autonomously vs. requiring human approval?
4. **Data:** What data sources do agents need access to? (DynamoDB, external APIs, documents)
5. **Constraints:** Latency requirements, cost budget, compliance needs

### 2. Design agent roles

For each agent in the system:

```markdown
### Agent: {name}
- **Role:** {one-sentence purpose}
- **Model:** {haiku|sonnet|opus} — {justification for model choice}
- **Tools:** {list of tools this agent can use}
- **Input:** {what it receives}
- **Output:** {what it produces}
- **Autonomy:** {what it can decide alone vs. what needs escalation}
```

Model routing guidance:
- **Haiku:** Simple classification, extraction, formatting, routing decisions
- **Sonnet:** Implementation, research, standard reasoning, tool use
- **Opus:** Complex planning, multi-step reasoning, architecture decisions

### 3. Design tool schemas

For each tool agents use:

```typescript
// Tool: {name}
// Used by: {agent-name}
{
  name: "{tool-name}",
  description: "{when to use this tool}",
  input_schema: {
    type: "object",
    properties: {
      // typed properties
    },
    required: [/* required fields */]
  }
}
```

Map tools to AWS services:
- DynamoDB read/write → DocumentClient operations
- Lambda invoke → cross-function calls
- SES → email notifications
- API Gateway → external webhook calls
- Cognito → user lookup and validation

### 4. Design orchestration

Choose and specify the orchestration pattern:

**Router:** Single orchestrator dispatches to specialist agents based on input classification.
**Pipeline:** Agents process sequentially, each enriching the context for the next.
**Hierarchical:** Manager agent breaks work into subtasks, delegates to workers, aggregates results.
**Collaborative:** Agents share a state graph and contribute concurrently.

Produce a LangGraph state graph specification:

```markdown
## State Graph

### State Schema
{TypeScript interface for the shared state}

### Nodes
| Node | Agent | Entry Condition | Exit Condition |
|------|-------|----------------|----------------|

### Edges
{node-a} → {node-b} (condition: {when})
{node-a} → {node-c} (condition: {when})

### Terminal Conditions
{When does the graph stop?}
```

### 5. Design error handling and guardrails

Specify:
- **Max iterations:** per agent and total graph execution
- **Cost ceiling:** max tokens per execution (sum across all agents)
- **Timeout:** max wall-clock time
- **Human-in-the-loop:** which decisions require human approval
- **Fallback:** what happens when an agent fails or returns unexpected output

### 6. Write specification

Save to `docs/agents/{system-slug}.md`.
Create `docs/agents/` directory if it doesn't exist.

## Output

Display:
1. System name and orchestration pattern
2. Agent count with model assignments
3. Tool count and AWS service dependencies
4. Cost estimate (tokens per typical execution)
5. File path where spec was saved
6. Implementation notes (what to build first)

## Examples

**Customer support triage system:**
```
/iago:agents Customer support system that classifies tickets, drafts responses, escalates complex issues --pattern router
```

**Document processing pipeline:**
```
/iago:agents Extract data from uploaded PDFs, validate against DynamoDB records, generate summary report --pattern pipeline
```

## Boundaries

- Produces architecture specifications, not runnable code
- Does not create Lambda functions, DynamoDB tables, or deploy infrastructure
- Does not modify iaGO's own agent definitions (`.claude/agents/`)
- Does not dispatch any iaGO agents — orchestrator designs inline
- Claude SDK + LangGraph only — does not design for other agent frameworks
  (CrewAI, AutoGen, etc.) unless client explicitly requires it
- Always include cost estimates — agent systems can be expensive without guardrails
