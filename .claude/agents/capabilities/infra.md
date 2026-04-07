# AWS Infrastructure Capability

## Amplify Gen 2
- Define all resources with TypeScript: `defineBackend`, `defineAuth`, `defineData`, `defineFunction`
- Single entry point: `amplify/backend.ts` imports and composes all resource definitions
- Auth configuration in `amplify/auth/resource.ts` — Cognito user pool settings here
- Data schema in `amplify/data/resource.ts` — AppSync + DynamoDB configuration
- One directory per Lambda: `amplify/functions/{name}/handler.ts`
- Local development: `npx ampx sandbox` — creates an isolated cloud environment per developer
- Deploy to branch: `npx ampx pipeline-deploy --branch {branch}`

## Custom Resources

If a resource is not covered by Amplify Gen 2 defaults, use `backend.addOutput()` or
custom Amplify constructs within `amplify/backend.ts`. NEVER create standalone CDK apps,
CloudFormation templates, SAM templates, or Serverless Framework configs. All infrastructure
must flow through Amplify Gen 2.

## SES
- Use SES v2 API exclusively: `@aws-sdk/client-sesv2` — the legacy `@aws-sdk/client-ses` is not used
- Define email templates in infrastructure code, not inside Lambda handlers
- Verify sending identities (domain or email) before use — sandbox limits apply until production access is granted
- Include unsubscribe headers on all non-transactional email (CAN-SPAM)

## Safety Protocol
- Always use `--dry-run` or `--no-execute-changeset` before any destructive operation
- Confirm with the orchestrator before: deleting resources, modifying production environments, or changing IAM policies
- Log every command executed and its full output
- Never hardcode AWS credentials or ARNs — use CLI profiles and environment variables
- For Lambda: set ARNs and table names via environment variables, never in source code
