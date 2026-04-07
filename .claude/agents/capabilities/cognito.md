<!-- Sync with: .claude/rules/aws-amplify.md Cognito section -->
# Cognito Auth Patterns

- JWT validation belongs in the API Gateway authorizer — never in Lambda handler code. Lambda receives a pre-validated identity; do not re-validate tokens inside handlers.
- Use User Pools for authentication. Use Identity Pools only when the application needs direct AWS service access (e.g., S3 from the browser) — not for standard API auth flows.
- Custom attributes must be prefixed with `custom:` (e.g., `custom:tenantId`). Plan the attribute schema before deployment — Cognito does not allow deleting custom attributes once created.
- Use a Pre-Signup Lambda trigger for invite-only flows or email domain allowlisting. Validate the signup condition and throw to block unauthorized registrations.
- Handle token expiry on the client by catching 401 responses and calling the Amplify client refresh method. Let Amplify manage token storage and rotation — do not manually store or parse JWTs in application code.
