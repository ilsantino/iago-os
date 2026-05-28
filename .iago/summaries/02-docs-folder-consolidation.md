---
plan: 02-docs-folder-consolidation
status: done
verified: 2026-05-26
pr: https://github.com/ilsantino/iago-os/pull/79
---

# Summary: 02-docs-folder-consolidation

## Pipeline Result

- **Implement:** exit 0
- **Build gate:** passed
- **Review:** PASS
- **Codex:** exit 0
- **PR:** https://github.com/ilsantino/iago-os/pull/79

## Diff Stats

```
 {docs => .claude/rules}/patterns/carrier.md        |   0
 {docs => .claude/rules}/patterns/customs.md        |   0
 {docs => .claude/rules}/patterns/energy.md         |   0
 {docs => .claude/rules}/patterns/inventory.md      |   0
 {docs => .claude/rules}/patterns/logistics.md      |   0
 {docs => .claude/rules}/patterns/production.md     |   0
 {docs => .claude/rules}/patterns/quality.md        |   0
 {docs => .claude/rules}/patterns/returns.md        |   0
 .claude/skills/deep-research/SKILL.md              |   6 +-
 .claude/skills/iago-n8n/SKILL.md                   |   6 +-
 .claude/skills/iago-schedule/SKILL.md              |   2 +-
 .claude/skills/industry-patterns/SKILL.md          |   2 +-
 .iago/STATE.md                                     |   2 +-
 .iago/_archive/README.md                           |   5 +
 .../adversarial-review-fixes-plan.md               |   0
 .../agent-v2-01-foundation-plan.md                 |   0
 .../agent-v2-01-foundation-summary.md              |   0
 .../agent-v2-02-profiles-plan.md                   |   0
 .../agent-v2-02-profiles-summary.md                |   0
 .../agent-v2-03-enhancements-plan.md               |   0
 .../agent-v2-03-enhancements-summary.md            |   0
 .../agent-v2-04-documentation-plan.md              |   0
 .../agent-v2-04-documentation-summary.md           |   0
 .../research/2026-04-historical}/BUILD-ORDER.md    |   0
 .../2026-04-historical}/CHERRY-PICK-PLAN.md        |   0
 .../2026-04-historical}/DECISION-agents.md         |   0
 .../2026-04-historical}/DECISION-claude-md.md      |   0
 .../2026-04-historical}/DECISION-conventions.md    |   0
 .../research/2026-04-historical}/DECISION-core.md  |   0
 .../2026-04-historical}/DECISION-discipline.md     |   0
 .../2026-04-historical}/DECISION-execution.md      |   0
 .../2026-04-historical}/DECISION-foundation.md     |   0
 .../2026-04-historical}/DECISION-guards.md         |   0
 .../research/2026-04-historical}/DECISION-hooks.md |   0
 .../2026-04-historical}/DECISION-paperclip.md      |   0
 .../2026-04-historical}/DECISION-skills-agents.md  |   0
 .../2026-04-historical}/DECISION-skills.md         |   0
 .../DECISION-workflow-foundation.md                |   0
 .../2026-04-historical}/DECISION-workflow.md       |   0
 .../research/2026-04-historical}/SPRINT-STATUS.md  |   0
 .../research/2026-04-historical}/caveman-skill.md  |   0
 .../research/2026-04-historical}/ecc-analysis.md   |   0
 .../2026-04-historical}/graphify-obsidian-eval.md  |   0
 .../research/2026-04-historical}/gsd-analysis.md   |   0
 .../2026-04-historical}/hooks-synthesis.md         |   0
 .../2026-04-historical}/paperclip-analysis.md      |   0
 .../research/2026-04-historical}/ruflo-analysis.md |   0
 .../2026-04-historical}/skills-agents-synthesis.md |   0
 .../research/2026-04-historical}/superpowers.md    |   0
 .../research/2026-04-historical}/the-architect.md  |   0
 .../2026-04-historical}/workflow-synthesis.md      |   0
 .../agent-sdk-integration-architecture.md          |   0
 .../research/2026-04-research}/claude-agent-sdk.md |   0
 .../claude-platform-agent-deployment.md            |   0
 .../research/2026-04-research}/hermes-agent.md     |   0
 .../2026-04-research}/paperclip-transcript.txt     |   0
 .../2026-04-historical}/agent-architecture-v2.md   |   0
 .../2026-04-historical}/review-pipeline-control.md |   0
 .../_config/architecture.md                        |   2 +-
 .../automations/cross-session-pipeline.md          |   0
 .../runbooks}/automations/trigger-templates.md     |   0
 .../_config/runbooks/dashboard.md                  |   4 +-
 .../_config/runbooks/github-pipeline-setup.md      |   0
 .../02-docs-folder-consolidation.md                |  21 +
 CLAUDE.md                                          |   6 +-
 README.md                                          |  12 +-
 docs/MANUAL.md                                     | 761 ---------------------
 docs/SETUP.md                                      | 238 -------
 docs/WORKFLOW.md                                   | 180 -----
 docs/specs/hermes-agent-adoption.md                |   2 +-
 docs/specs/iago-os-mwp-routing-rule.md             |   6 +-
 docs/specs/iago-os-v2-master-prompt.md             |   2 +-
 scripts/execute-pipeline.sh                        |  22 +
 scripts/lib/env-validation.sh                      |  38 +
 scripts/test-env-validation.sh                     |  88 +++
 75 files changed, 200 insertions(+), 1205 deletions(-)
```
