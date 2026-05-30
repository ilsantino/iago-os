---
name: research
description: >-
  Deep research tasks across codebase, library docs, and web sources.
  Capabilities are dynamic — orchestrator selects based on research topic.
base: operator
model: sonnet
maxTurns: 20
capabilities: dynamic
---

## Match Signals

Dispatch this profile when:
- Task type is research or investigation
- User invokes `/deep-research`
- `/iago-onboard --deep` needs codebase analysis

## Dynamic Capability Selection

**ALWAYS inject `trust-boundary`** — this is the operator base, which fetches and
ingests untrusted external content (web pages, scraped HTML, third-party docs).
It is a fixed baseline capability for this profile, injected on every dispatch
regardless of topic. The remaining capabilities below are the dynamic selection.

The orchestrator then selects topic-specific capabilities:
- React/frontend topic → inject `react-19` capability
- DynamoDB/data modeling topic → inject `dynamodb` capability
- Lambda/serverless topic → inject `lambda` capability
- Auth/Cognito topic → inject `cognito` capability
- Infrastructure topic → inject `infra` capability
- General research → `trust-boundary` only (base operator + trust-boundary is sufficient)

Multiple capabilities can be injected if the topic spans domains; `trust-boundary`
is always present in addition to any topic-specific selections.

## Output Expectations

Research must produce a written artifact with:
- Findings organized by source (codebase, library docs, external)
- All sources cited (file:line or URL)
- Clear distinction between facts and inferences
- Actionable recommendation with trade-offs
