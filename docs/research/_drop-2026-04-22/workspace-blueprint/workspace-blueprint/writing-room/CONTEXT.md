# Writing Room

<!--
=======================================================================
TEACHING NOTE: This is LAYER 3 — A WORKSPACE CONTEXT.

This is where the real instructions live. Every workspace CONTEXT.md
needs these sections:

  1. What this workspace IS (1-2 sentences)
  2. What to load for each task type (the token budget table)
  3. Folder structure (so the agent knows where files go)
  4. The process (how work happens here)
  5. What NOT to do (anti-patterns and constraints)
  6. Where tools plug in (skills/MCPs for this workspace)

Keep it 25-80 lines of content. If it's past 100, you're probably
duplicating what's in your docs/ files.
=======================================================================
-->

## What This Workspace Is

Where ideas become polished drafts. Someone brings a topic. The agent helps research, outline, write, and refine it in the right voice. Output goes to `final/` and can feed into the production pipeline.

---

## What to Load

<!--
TEACHING NOTE: This is the most important table in any CONTEXT.md.
It's the token budget. It tells the agent exactly what to read
for each task — and implicitly, what to SKIP.

Without this, agents either load everything (wasting tokens) or
guess wrong about what matters (producing off-voice content).
-->

| Task | Load These | Skip These |
|------|-----------|------------|
| Write a blog post | `docs/voice.md`, `docs/style-guide.md` | `docs/audience.md` (unless targeting a specific segment) |
| Write a tutorial | `docs/voice.md`, `docs/audience.md`, `docs/style-guide.md` | — |
| Edit/review a draft | `docs/voice.md`, the draft itself | `docs/audience.md`, `docs/style-guide.md` |
| Research only | Nothing from docs/ | Everything — just use Web Search MCP |

---

## Folder Structure

```
writing-room/
├── CONTEXT.md          ← You are here
├── docs/               ← Reference docs (load per-task)
│   ├── voice.md        ← How the brand sounds. Hard constraints. Personality.
│   ├── style-guide.md  ← Formatting, structure, length guidelines
│   └── audience.md     ← Who reads this, what they care about, what they know
├── drafts/             ← Work in progress (slug-status.md)
└── final/              ← Ready for publishing or production handoff
```

---

## The Process

No rigid steps. The work flows like a conversation:

1. **Understand the topic** — what's the idea and why does it matter?
2. **Find the angle** — what's the specific take, not the generic explainer?
3. **Write it** — in the brand voice, at the right depth for the audience
4. **Catch problems** — voice drift, AI-isms, structural issues, weak opens/closes

A draft becomes `review` when it's structurally complete. It becomes `final` when voice and quality pass.

---

## Skills & Tools for This Workspace

<!--
TEACHING NOTE: This is where skills become CONTEXTUAL, not just listed.

In CLAUDE.md, we listed all available skills. Here, we say WHEN to use them
within this workspace's workflow. This is the difference between
"the humanizer skill exists" and "run /humanizer before moving any
draft to final/ status."

You can have up to 15 skills per workspace. They aren't all markdown
files sitting in a folder — they're capabilities that activate at
specific points in your workflow. Some are:

  - STAGE TRIGGERS: "At review stage, run this skill"
  - ALWAYS-ON: "Every piece of content in this workspace uses this"
  - ON-DEMAND: "Use this when the writer asks for it"

The CONTEXT.md is what makes a skill useful by telling the agent
when and why to invoke it — not just that it's available.
-->

| Skill / Tool | When to Use | How |
|-------------|-------------|-----|
| `/humanizer` | **Before any draft moves to `final/`**. Non-negotiable. Catches AI-isms that voice.md might miss. | Run on the full draft. Apply suggestions. Re-check voice.md compliance after. |
| `/doc-coauthoring` | **Long-form pieces only** (2000+ words). Tutorials, technical guides, whitepapers. | Activates a structured co-writing workflow. Not needed for blog posts or short pieces. |
| Web Search MCP | **Research phase**. When the topic needs current data, competitor analysis, or technical accuracy verification. | Agent will search autonomously. Provide search terms or let it derive them from the topic. |

### Skills That Could Plug In Here (Not Configured)

<!--
TEACHING NOTE: This section shows learners that the skill slots
are EXTENSIBLE. You don't need all 15 filled on day one.
These are suggestions for what you might add as your workflow matures.
-->

- **SEO optimization skill** — could run at review stage to check keyword density, meta descriptions, heading structure
- **Plagiarism/originality check** — could validate before final
- **Translation skill** — if you produce content in multiple languages
- **Tone analysis skill** — quantitative voice consistency checking
- **Citation formatter** — for technical content with references

---

## When a Draft Is Final

A `final` draft is ready for one of two destinations:

1. **Publishing** — goes to CMS, blog platform, docs site
2. **Production pipeline** — copy to `../production/workflows/01-briefs/` to become a video, demo, or other deliverable

---

## What NOT to Do

- **Don't skip voice.md** — it's the difference between on-brand and generic
- **Don't over-research** — a blog post doesn't need 20 sources. Find the angle, write it.
- **Don't load production docs** — you don't need the component library to write a blog post
- **Don't create files outside this workspace** — the handoff to production is a deliberate copy, not a direct write
