---
name: iago-n8n
description: >-
  Use when designing n8n automation workflows for a client project (webhook triggers,
  Lambda integrations, DynamoDB events, SES notifications). Not when building the
  n8n workflows directly (this skill produces designs, not executable JSON).
---

## Purpose

Design n8n automation workflows that integrate with the iaGO AWS stack. Produces
workflow specifications with node configurations, trigger definitions, and data
flow diagrams — ready for implementation in n8n's visual editor.

## Arguments

`/iago-n8n {description}` — what the automation should accomplish.

Optional flags:
- `--triggers {webhook|schedule|dynamo|ses|manual}` — comma-separated trigger types
- `--output {path}` — custom output path (default: `.iago/_config/runbooks/automations/`)

## Preconditions

- `.iago/PROJECT.md` should exist for project context. If not, ask the user for
  sufficient context about the target system.

## Steps

### 1. Gather automation requirements

Identify:
1. **Trigger:** What starts the workflow? (webhook, DynamoDB stream, schedule, SES inbound, manual)
2. **Process:** What transformations or actions occur? (data mapping, API calls, conditionals)
3. **Output:** What's the end result? (DynamoDB write, SES email, Lambda invoke, external API call)
4. **Error handling:** What happens on failure? (retry, dead-letter, alert)

### 2. Design workflow

Produce a structured workflow specification:

```markdown
# Workflow: {name}

## Trigger
- **Type:** {webhook|schedule|dynamo-stream|ses-inbound|manual}
- **Configuration:** {trigger-specific config}

## Nodes

### Node 1: {name}
- **Type:** {n8n node type}
- **Input:** {data shape}
- **Action:** {what this node does}
- **Output:** {data shape}

### Node 2: {name}
...

## Data Flow
{trigger} → {node-1} → {conditional?} → {node-2} → {output}

## Error Handling
- **On failure:** {retry count, dead-letter queue, alert channel}
- **Timeout:** {max execution time}

## AWS Integration Points
| Service | Operation | IAM Permission |
|---------|-----------|---------------|
| Lambda | Invoke {function-name} | lambda:InvokeFunction |
| DynamoDB | {GetItem/PutItem/Query} on {table} | dynamodb:{operation} |
| SES | SendEmail | ses:SendEmail |
| API Gateway | {method} {endpoint} | execute-api:Invoke |
```

### 3. Map IAM permissions

For each AWS service interaction, list the minimum IAM permissions required.
n8n's AWS credentials node needs these permissions configured.

### 4. Design webhook endpoints (if applicable)

For webhook triggers, specify:
- API Gateway endpoint path and method
- Request validation schema (API Gateway model)
- Lambda handler that forwards to n8n webhook URL
- Authentication: API key via usage plan or Cognito JWT

### 5. Design DynamoDB event patterns (if applicable)

For DynamoDB stream triggers:
- Which table and stream view type (NEW_IMAGE, OLD_IMAGE, NEW_AND_OLD_IMAGES)
- Lambda function that filters events and forwards to n8n
- Event filter expressions to reduce noise

### 6. Write specification

Save to `.iago/_config/runbooks/automations/{workflow-slug}.md`.
Create `.iago/_config/runbooks/automations/` directory if it doesn't exist.

## Output

Display:
1. Workflow name and trigger type
2. Node count and data flow summary
3. AWS services touched (with required permissions)
4. File path where spec was saved
5. Implementation notes (manual steps needed in n8n UI)

## Examples

**Webhook-triggered order processing:**
```
/iago-n8n Process incoming orders via webhook, validate, store in DynamoDB, send confirmation via SES
```

**Scheduled report generation:**
```
/iago-n8n Generate weekly usage report from DynamoDB, format as PDF, email to stakeholders --triggers schedule
```

## Boundaries

- Produces specifications, not executable n8n workflow JSON
- Does not deploy or configure n8n instances
- Does not create Lambda functions or API Gateway endpoints — references existing ones or flags them as prerequisites
- Does not dispatch any agents — orchestrator designs inline
- AWS-only integrations — does not design for non-AWS services unless the client specifically uses them
- If the automation requires services outside our stack, note them as external dependencies
