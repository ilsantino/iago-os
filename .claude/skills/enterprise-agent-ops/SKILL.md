---
name: enterprise-agent-ops
description: >-
  Use when designing multi-agent systems for client deployments (3-5 agents,
  orchestration patterns, operational concerns). Not when building single-agent
  features or configuring iaGO's own agents.
---

<!-- Source: ECC enterprise-agent-ops, scaled for consultancy -->

## Purpose

Design production-grade multi-agent architectures for client projects — agent
roles, orchestration patterns, observability, failure handling, and deployment
strategies using Claude SDK + LangGraph + n8n.

## Arguments

`/enterprise-agent-ops {system-description}` — what the agent system should do.

Optional flags:
- `--agents {count}` — target agent count (default: 3, max: 5)
- `--pattern {router|pipeline|hierarchical}` — orchestration pattern

## Steps

### 1. Requirements gathering

Identify:
- What decisions must agents make?
- What tools do agents need? (DynamoDB, SES, external APIs)
- What's the latency budget? (sync vs async)
- What's the cost budget per execution?
- What requires human approval?

### 2. Design agent topology

Keep it small — 3-5 agents max for a consultancy-scale system:

```markdown
## Agent Topology

### Agent 1: {Role} (Orchestrator)
- **Model:** Sonnet
- **Responsibility:** Route requests, aggregate results
- **Tools:** {list}

### Agent 2: {Role} (Specialist)
- **Model:** Haiku
- **Responsibility:** {focused task}
- **Tools:** {list}
```

### 3. Design orchestration

**LangGraph state graph:**
- Define TypeScript state interface
- Map nodes to agents
- Define edges with routing conditions
- Set terminal conditions

**n8n integration points:**
- Webhook triggers for external events
- Lambda invocations for agent execution
- DynamoDB for state persistence
- SES for notification on completion/failure

### 4. Operational concerns

| Concern | Solution |
|---------|----------|
| Observability | Structured logging per agent, trace ID propagation |
| Failure handling | Per-agent retry (3x), circuit breaker, dead-letter queue |
| Cost control | Token budgets per agent, model tier enforcement |
| Latency | Async processing via SQS/Lambda, timeout per agent |
| Security | Least-privilege IAM roles per agent, no shared credentials |
| Testing | Mock tools for unit tests, integration tests against sandbox |

### 5. Write specification

Save to `docs/agents/{system-slug}-ops.md`. Include:
- Agent topology diagram (text)
- State graph specification
- n8n workflow integration points
- Operational runbook (deploy, monitor, troubleshoot)
- Cost estimate per 1K executions

## Output

1. Spec file path
2. Agent count and model assignments
3. Orchestration pattern chosen
4. Cost estimate per 1K executions
5. Key operational risks

## Examples

**Support ticket triage:**
```
/enterprise-agent-ops Triage support tickets: classify, draft response, escalate complex --agents 3
```

**Document processing:**
```
/enterprise-agent-ops Extract, validate, and summarize uploaded contracts --pattern pipeline
```

## Boundaries

- Design only — does not implement agents or deploy infrastructure
- 3-5 agents max — more is not better for a 3-person team
- Claude SDK + LangGraph + n8n only — no other orchestration frameworks
- Does not modify iaGO's own agents (`.claude/agents/`)
- Must include cost estimates — agent systems without budgets are liabilities
