---
name: Node 20 Lambda fire-and-forget abandons promise chain
description: In Amplify Gen 2 Node 20 Lambdas, fire-and-forget promises with .catch() after the handler returns can have their promise chain abandoned, even with callbackWaitsForEmptyEventLoop=true default
type: feedback
originSessionId: e46c5202-1fdb-4faa-99e7-1193b3938739
---
Pattern to avoid in Lambda handlers:

```ts
// BAD — promise gets abandoned on some invocations
sendSlowThing(...).catch(err => console.error(err));
return response;
```

```ts
// GOOD — await guarantees Lambda waits for completion + errors surface
try {
  await sendSlowThing(...);
} catch (err) {
  console.error(err);
}
return response;
```

**Why:** On munet-web PR #51 (ticket-email unification, 2026-04-17), `sendTicketEmail` was fired-and-forgotten after DDB `transactWriteItems`. S3 PDF upload initiated but `ses.send()` never fired — zero SES Send metric, zero error logs, zero Lambda Errors metric. The `.catch` never executed because the promise chain was abandoned before the rejection propagated. Lambda Duration reported as 1.3s for a pipeline that needs 3-5s. Root cause: Node 20 Lambda runtime's event-loop drain doesn't reliably honor orphan promise chains that aren't referenced from the handler's returned Promise.

**How to apply:** For any Lambda that does important post-DB work (email, webhook callbacks, external API sync), ALWAYS await the call inside the handler. Use try/catch to swallow errors if the handler needs to return success regardless. Do NOT rely on `callbackWaitsForEmptyEventLoop=true` default to keep the container alive for `.catch()` chains. This applies across all iaGO client Amplify Gen 2 Lambdas.

**Debug signature of this bug:** Lambda invocation shows Duration too short for expected I/O + zero application logs + zero error metrics + downstream I/O initiated but not completed (e.g., S3 object exists but subsequent DDB update flags are unset).
