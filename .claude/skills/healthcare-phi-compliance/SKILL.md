---
name: healthcare-phi-compliance
description: >-
  Use when building features that handle protected health information (PHI).
  Not when building non-healthcare applications or when PHI is not involved.
---

<!-- Source: ECC healthcare-phi-compliance -->

## Purpose

Provide HIPAA-compliant patterns for handling PHI in AWS — encryption, access
controls, audit logging, and service configuration — specific to our stack.

## Steps

### 1. Classify data

Identify which fields are PHI:
- **PHI:** Names, DOB, SSN, medical records, insurance IDs, addresses, phone numbers,
  email, biometric data, device identifiers, any health-related data
- **Non-PHI:** Anonymized/de-identified data, aggregate statistics

### 2. Apply AWS HIPAA-eligible patterns

**DynamoDB:**
- Encryption at rest: enabled by default (AWS-managed or customer-managed KMS key)
- No PHI in partition or sort keys — use opaque IDs
- Access patterns: `pk: PATIENT#{id}`, `sk: RECORD#{type}#{date}`
- Enable point-in-time recovery for compliance
- DynamoDB Streams for audit trail

**Cognito:**
- Custom attributes for role-based access: `custom:role` (physician, nurse, admin)
- MFA required for PHI access
- Token expiration: 1 hour access, 30 day refresh
- Pre-authentication trigger for IP allowlisting

**API Gateway:**
- WAF with OWASP rule set
- Request logging to CloudWatch (exclude PHI from logs)
- TLS 1.2 minimum
- API key + Cognito JWT double auth for PHI endpoints

**Lambda:**
- No PHI in environment variables
- No PHI in CloudWatch logs — sanitize before logging
- VPC-bound for database access where required
- Execution role: least-privilege, PHI-specific IAM policy

**SES:**
- No PHI in email subject lines
- Encrypted attachment patterns for PHI documents
- Audit log every PHI-containing email sent

### 3. Audit and compliance

| Requirement | Implementation |
|-------------|---------------|
| Access logging | DynamoDB Streams + CloudWatch |
| Data encryption at rest | KMS (DynamoDB, S3) |
| Data encryption in transit | TLS 1.2+ (API Gateway, all endpoints) |
| Access control | Cognito RBAC + API Gateway authorizer |
| Audit trail | DynamoDB table: `pk: AUDIT#{date}`, `sk: {timestamp}#{user}` |
| Data retention | DynamoDB TTL for time-limited records |
| Breach notification | SES alert + SNS topic for security team |

### 4. BAA requirement

AWS Business Associate Agreement (BAA) must be in place before processing PHI.
Only HIPAA-eligible AWS services may handle PHI. Verify service eligibility at
AWS HIPAA-eligible services page.

## Output

Advisory — no files produced. Provides patterns to apply during implementation.

## Boundaries

- Advisory patterns only — does not create infrastructure or modify code
- Does not replace legal/compliance review — always consult compliance officer
- AWS-only patterns — does not cover on-premises or non-AWS infrastructure
- Does not dispatch agents
