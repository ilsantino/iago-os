---
name: Diagnose before fixing
description: Stop patching symptoms — reproduce, isolate root cause, THEN fix. Never chain config changes without verifying each one.
type: feedback
---

When debugging runtime errors (CORS, 403, wrong URLs), do NOT chain config changes hoping one sticks. Each change must be verified before the next.

**Why:** Session on 2026-04-13 wasted 30+ minutes ping-ponging between config.ts changes (proxy vs direct, DEV override, initApiConfig order) without ever checking the actual HTTP request in the network tab. The 403 root cause was never isolated.

**How to apply:** Follow systematic-debugging.md strictly — REPRODUCE (see the actual request/response), ISOLATE (is it URL? auth header? Lambda?), then FIX one thing. Use curl to test the API directly before touching frontend code.
