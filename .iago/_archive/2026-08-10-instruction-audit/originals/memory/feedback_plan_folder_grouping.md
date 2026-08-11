---
name: Group related plans in one folder
description: For multi-plan work (audit fixes, bug bounty follow-ups, etc.), put all plans under a single feature-{slug}/ folder — don't create one folder per cluster
type: feedback
originSessionId: 0ddd9b57-ee1e-44f0-8168-6125c8938cf1
---
When producing multiple related plans at once (e.g., 5 clusters of fixes from
a bug-bounty audit), put them all under ONE `feature-{slug}/` folder as
`01-name.md`, `02-name.md`, etc. — do NOT create a separate `feature-{cluster}/`
folder for each cluster.

**Why:** Santiago views the plans as a coherent body of work (all AWS-related,
same audit origin, same target branch). Multiple sibling `feature-*/` folders
scatter them across `.iago/plans/` and make the scope hard to see at a glance.

**How to apply:** when breaking a single audit / spec / review output into N
plans, pick one feature slug for the whole batch (e.g., `feature-amplify-audit-fixes`)
and number the plans inside it. Use `depends_on` + `wave` to express ordering
between plans within the folder. Reserve distinct `feature-*/` folders for
genuinely independent features.
