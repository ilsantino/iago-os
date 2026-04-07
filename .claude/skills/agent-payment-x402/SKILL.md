---
name: agent-payment-x402
description: >-
  Use when implementing agent-to-agent payment flows using the x402 protocol.
  Not when building traditional payment integrations (Stripe, PayPal) or
  human-facing checkout flows.
---


## Purpose

Design agent-to-agent payment flows using the x402 HTTP payment protocol —
where AI agents pay for API access, data, or compute from other agents or
services using HTTP 402 responses.

## Arguments

`/agent-payment-x402 {use-case}` — the payment scenario to design.

Optional flags:
- `--role {payer|payee|both}` — which side to design (default: both)

## Steps

### 1. Understand x402 flow

```
Agent A (payer) → HTTP request → Service B
Service B → 402 Payment Required (with payment details)
Agent A → Processes payment via supported network
Agent A → Retries request with payment proof header
Service B → Validates payment, serves response
```

### 2. Design payer integration

For the paying agent:
- Detect 402 responses and extract payment requirements
- Evaluate cost against budget (hard ceiling per transaction and per session)
- Execute payment via supported network
- Attach payment proof to retry request
- Log all transactions for audit

### 3. Design payee integration

For the receiving service:
- API Gateway returns 402 with payment details for premium endpoints
- Lambda validates payment proof before serving response
- DynamoDB tracks payment records and usage quotas
- Rate limiting per payer identity

### 4. Safety rails

| Rail | Requirement |
|------|-------------|
| Per-transaction limit | Must be set — no open-ended spending |
| Per-session budget | Hard ceiling, abort if exceeded |
| Approval threshold | Transactions above threshold require human approval |
| Audit log | Every transaction logged to DynamoDB with timestamp, amount, counterparty |
| Refund path | Design the dispute/refund flow before launch |

### 5. Write specification

Save to `docs/agents/{use-case-slug}-x402.md`. Include:
- Flow diagram (text)
- API Gateway / Lambda integration points
- DynamoDB schema for payment records
- Safety rail configuration
- Cost modeling

## Output

1. Spec file path
2. Payment flow direction (payer/payee/both)
3. Safety rail summary
4. Estimated cost per 1K transactions

## Boundaries

- Design specification only — does not implement payment logic
- x402 protocol only — not Stripe, PayPal, or traditional payment rails
- Requires x402-compatible endpoints — flag if counterparty doesn't support it
- Must include safety rails — no spec ships without spending limits
- Does not handle real money in development — design for testnet/sandbox first
