# Community

<!--
=======================================================================
TEACHING NOTE: This workspace demonstrates a DIFFERENT pattern than
production. No sequential pipeline — instead, it's a MULTI-FORMAT HUB.

Same input (content from writing-room + deliverables from production)
gets repurposed into multiple output formats: newsletters, social posts,
event materials, templates.

This shows that not every workspace needs a pipeline. Some workspaces
are better modeled as "input → many outputs" rather than "stage → stage."

The skill integration here is also different: skills are FORMAT-SPECIFIC
rather than stage-specific. The newsletter skill activates for newsletters.
The social skill activates for social posts. They don't depend on each other.
=======================================================================
-->

## What This Workspace Is

The distribution hub. Content from writing-room and deliverables from production get repurposed for different platforms and formats. Newsletters, social posts, event materials, templates.

---

## What to Load

| Task | Load These | Also Pull From |
|------|-----------|---------------|
| Write a newsletter | `docs/calendar-rules.md` | `../writing-room/docs/voice.md` (for tone) |
| Create social posts | `docs/platforms.md` | Source content from `../writing-room/final/` |
| Plan an event | `docs/calendar-rules.md` | — |
| Create a template | `docs/platforms.md` | Existing templates in `content/templates/` |

---

## Folder Structure

```
community/
├── CONTEXT.md              ← You are here
├── docs/
│   ├── platforms.md        ← Platform-specific specs (character limits, formats, best practices)
│   └── calendar-rules.md   ← Content cadence, editorial calendar guidelines
└── content/
    ├── newsletters/        ← Email newsletters (YYYY-MM-DD-slug.md)
    ├── social/             ← Social media posts (platform-slug.md)
    ├── events/             ← Event materials (event-name/ folders)
    └── templates/          ← Reusable content templates
```

---

## Skills & Tools for This Workspace

<!--
TEACHING NOTE: Unlike production (where skills are STAGE-SPECIFIC),
community skills are FORMAT-SPECIFIC. Each output format may have
its own skill or tool.

This is the second major pattern for skill integration:
  1. Stage-specific (production): skill activates at pipeline step X
  2. Format-specific (community): skill activates when creating format Y

Both patterns wire into CONTEXT.md the same way — a table that says
"when doing X, use this skill." The difference is what triggers it.
-->

| Skill / Tool | Format | Purpose |
|-------------|--------|---------|
| `/humanizer` | All written content | Run before publishing anything. Non-negotiable for community-facing content. |
| `/pptx` | Event decks | Generate PowerPoint presentations for conferences, workshops, meetups |
| `/frontend-slides` | Event decks (web) | Alternative to pptx — animated HTML slide decks |
| Web Search MCP | Social posts | Check trending topics, verify timeliness of content |

### Format-Specific Skills You Might Add

<!--
TEACHING NOTE: These slots show learners where to plug in
platform-specific tools as they mature. A Slack MCP could
auto-post to internal channels. A social scheduling MCP could
queue posts across platforms. The workspace CONTEXT.md is
where you'd wire those in.
-->

- **Social scheduling MCP** — auto-queue posts to Buffer/Hootsuite/native schedulers
- **Email sending MCP** — deliver newsletters via SendGrid/Mailchimp
- **Image generation skill** — create social media graphics (OG images, quote cards)
- **Analytics MCP** — pull engagement data to inform content calendar
- **Community management MCP** — post to Discord/Slack/Skool from this workspace

---

## Cross-Workspace Inputs

Community doesn't create from scratch. It repurposes:

```
writing-room/final/[slug]-final.md    →  Repurpose into newsletter/social
production/workflows/04-output/[slug] →  Reference as demo link or asset
```

**Always credit the source.** When a social post promotes a blog post, link back. When a newsletter features a demo, reference its production output.

---

## Naming Conventions

| Format | Pattern | Example |
|--------|---------|---------|
| Newsletter | `[YYYY-MM-DD]-[slug].md` | `2026-03-10-launch-week.md` |
| Social post | `[platform]-[slug].md` | `twitter-auth-demo-launch.md` |
| Event folder | `[event-name]/` | `devcon-2026/` |
| Template | `[slug].md` | `weekly-roundup.md` |

---

## What NOT to Do

- **Don't write original long-form here** — that's writing-room's job. Community repurposes and adapts.
- **Don't skip platform specs** — a LinkedIn post and a Twitter thread have completely different constraints. Load `docs/platforms.md`.
- **Don't post without `/humanizer`** — community content is the most public-facing. AI-isms here damage credibility.
