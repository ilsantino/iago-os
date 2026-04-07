---
name: prompt-optimizer
description: >-
  Use when building or tuning LLM prompts for client deliverables (chatbots,
  agents, classification, extraction). Not when writing CLAUDE.md rules, agent
  definitions, or skill files (those follow iaGO conventions, not prompt engineering).
---


## Purpose

Optimize Claude SDK prompts for client-facing features — improving quality,
reducing cost, and selecting the right model tier for the task.

## Arguments

`/prompt-optimizer {description or prompt-path}` — the prompt to optimize,
or a description of what the prompt should do.

Optional flags:
- `--model {haiku|sonnet|opus}` — target model (default: auto-select)
- `--cost-ceiling {dollars}` — max cost per 1K invocations
- `--eval` — include before/after evaluation criteria

## Steps

### 1. Analyze the prompt (or draft one)

If a prompt is provided, analyze:
- **Clarity:** Is the instruction unambiguous?
- **Structure:** Does it use system/user/assistant roles effectively?
- **Examples:** Are few-shot examples included where needed?
- **Constraints:** Are output format and length specified?
- **Cost:** Which model tier does this actually need?

If only a description is provided, draft the initial prompt first.

### 2. Model selection

Apply cost-awareness routing:

| Task Complexity | Model | Use When |
|----------------|-------|----------|
| Classification, extraction, formatting | **Haiku** | Structured input → structured output, no reasoning |
| Standard reasoning, tool use, generation | **Sonnet** | Most tasks — default choice |
| Complex planning, multi-step reasoning, nuance | **Opus** | Only when Sonnet demonstrably fails |

Always start with the cheapest viable model. Upgrade only with evidence that
the cheaper model produces unacceptable quality.

### 3. Optimize the prompt

Apply these techniques in order:
1. **Role assignment:** Clear system prompt with persona and constraints
2. **Output specification:** Exact format (JSON schema, markdown template, etc.)
3. **Chain-of-thought:** Add `<thinking>` blocks for reasoning tasks on Sonnet/Opus
4. **Few-shot examples:** 2-3 examples for classification/extraction tasks
5. **Negative examples:** "Do NOT..." for common failure modes
6. **Temperature tuning:** 0 for deterministic, 0.3-0.7 for creative, 1.0 for brainstorming

### 4. Cost estimation

Calculate per-invocation cost:
- Input tokens: system prompt + user message + examples
- Output tokens: expected response length
- Model pricing: Haiku < Sonnet < Opus

Present cost comparison across model tiers.

### 5. Write optimized prompt

Save to `docs/prompts/{slug}.md`:

```markdown
# Prompt: {Name}

## Model
{haiku|sonnet|opus} — {justification}

## System Prompt
```
{The optimized system prompt}
```

## User Message Template
```
{Template with {variables}}
```

## Expected Output
{Format and example}

## Cost
| Model | Input | Output | Per 1K calls |
|-------|-------|--------|-------------|
| Haiku | {tokens} | {tokens} | ${cost} |
| Sonnet | {tokens} | {tokens} | ${cost} |

## Evaluation Criteria
{How to measure if this prompt is working — accuracy, latency, cost}
```

Create `docs/prompts/` if it doesn't exist.

## Output

Display:
1. Recommended model tier with justification
2. Key optimizations applied
3. Cost per 1K invocations
4. Prompt file path
5. If `--eval`: evaluation criteria and suggested test cases

## Examples

**Optimize existing prompt:**
```
/prompt-optimizer src/features/chat/prompts/support-agent.ts
```

**Draft new prompt from description:**
```
/prompt-optimizer Classify incoming support tickets into billing/technical/account categories --model haiku --cost-ceiling 5
```

## Boundaries

- Does not modify application code — produces prompt files only
- Does not deploy prompts or update Claude SDK calls — that's implementation work
- Does not dispatch agents — orchestrator works inline
- Claude SDK only — does not optimize for OpenAI, Gemini, or other providers
  unless client explicitly requires it
- Does not optimize iaGO's own prompts (CLAUDE.md, agent definitions, skill files)
