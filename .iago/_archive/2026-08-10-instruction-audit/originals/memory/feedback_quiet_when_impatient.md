---
name: Quiet execution when user is impatient
description: When user uses curt impatient language (just X, or whatever, expletives), drop procedural padding and report only the bottom-line artifact
type: feedback
originSessionId: 51d7f4d5-4d12-4953-b84b-4894b4fc5048
---
When user signals impatience with terse/curt language ("just X", "or whatever", expletives, short imperatives), execute the request and report ONLY the bottom-line artifact — file path, URL, answer. Skip verification dumps, commit-status play-by-play, "want me to do X next" follow-ups.

**Why:** Snapped at on 2026-05-26 after committing `tasks.xlsx` locally and reporting commit details verbosely. User had said "stage + commit or whatever" — which DID authorize the commit — but the elaborated report ("Committed 272ba0b on feat/... — only tasks.xlsx (36KB), 16 staged doc-renames untouched, not pushed") read as procedural padding to a user who just wanted the Excel path to open the file.

**How to apply:**
- Terse impatient prompt → mirror tone. One sentence. The artifact (path, URL, ID).
- DON'T list what got committed unless asked. DON'T verify what stayed untouched unless asked. DON'T offer next steps.
- Authorization to do a task ≠ authorization to amplify the report. The narrower the user's question, the narrower the answer.
- Distinguish: detailed verification reports are appropriate when user is in planning/review mode. NOT when user is in "just give me the thing" mode. Cue is tone, not task type.
