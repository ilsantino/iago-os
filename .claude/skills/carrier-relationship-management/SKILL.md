---
name: carrier-relationship-management
description: >-
  Use when building carrier management features for logistics clients (carrier
  onboarding, rate management, performance tracking). Not when building
  general CRM or forward logistics (use /logistics).
---

<!-- Source: ECC carrier-relationship-management -->

## Purpose

Provide DynamoDB data models, API patterns, and integration strategies for
managing carrier relationships — onboarding, rate negotiation, performance
tracking, and compliance.

## Steps

### 1. DynamoDB single-table design

Access patterns for carrier management:

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Get carrier | `CARRIER#{id}` | `PROFILE` | Carrier details |
| List carrier rates | `CARRIER#{id}` | `RATE#{lane}#{effective-date}` | Rate history |
| Get carrier performance | `CARRIER#{id}` | `PERF#{YYYY-MM}` | Monthly KPIs |
| List carriers by lane | GSI1: `LANE#{origin}-{dest}` | `RATE#{carrier-id}` | Rate comparison |
| List carrier documents | `CARRIER#{id}` | `DOC#{type}#{date}` | Insurance, certs |
| Get carrier contacts | `CARRIER#{id}` | `CONTACT#{role}` | Dispatch, billing |

### 2. API Gateway endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/carriers` | Onboard new carrier |
| GET | `/carriers/{id}` | Get carrier profile |
| PUT | `/carriers/{id}/rates` | Update rate for lane |
| GET | `/carriers/{id}/performance` | Get performance metrics |
| GET | `/lanes/{origin}-{dest}/rates` | Compare carrier rates |

Lambda handlers: thin wrappers calling domain logic in `src/features/carriers/`.

### 3. Carrier performance tracking

Track per carrier per month:
- On-time delivery rate
- Damage/claim rate
- Invoice accuracy
- Communication responsiveness
- Compliance document currency

Store as: `pk: CARRIER#{id}`, `sk: PERF#{YYYY-MM}`, attributes for each KPI.

### 4. Integration patterns

- **Carrier APIs:** API Gateway → Lambda → carrier's API (rate quotes, tracking)
- **Webhooks:** API Gateway receives carrier status updates, Lambda processes
- **n8n:** Automated workflows for rate expiration alerts, document renewal reminders

## Output

Advisory — provides data models and API patterns for implementation.

## Boundaries

- Advisory patterns only — does not create tables or endpoints
- DynamoDB single-table design only — no relational modeling
- Does not dispatch agents
- Does not integrate with specific carrier APIs (FedEx, UPS, etc.) — provides the pattern
