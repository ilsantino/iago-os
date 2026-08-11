---
name: PR review comment style
description: @claude review tags must be direct — no please, no fluff, summary + watch-for + general pass
type: feedback
---

PR review comments must be direct. No "please", no politeness, no filler.

**Why:** Santiago wants terse communication. Fluff wastes tokens and reads as performative.

**How to apply:**

```
@claude Review this PR thoroughly.

{1-2 sentences: what this PR does. Direct.}

Watch for: {specific concerns in one paragraph}. General pass for anything unexpected.
```

Example:
```
@claude Review this PR thoroughly.

This PR adds a --pipeline flag to SDD for full 5-stage review isolation, and adds Codex CLI fallback logic to both SDD and code-review skills so they degrade gracefully when Codex is unavailable.

Watch for: whether the pipeline mode instructions are clear enough for a fresh-context agent to follow, whether the Codex fallback is consistent between SDD and code-review, and whether the skip instructions correctly reference the right step headings. General pass for anything unexpected.
```
