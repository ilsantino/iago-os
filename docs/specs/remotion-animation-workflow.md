# Spec: Remotion Animation Workflow for iaGO

> **COUNCIL VERDICT (2026-04-21): Downgraded.** 4-of-5 advisors rejected the 4-week two-tier build. Current execution scope: bare `animation-studio/` workspace only. No custom skills, no client scaffold, no Lambda until trigger conditions (below) fire. Full council record: Obsidian `decisions/2026-04-21-remotion-animation-workflow.md`.
>
> **Trigger conditions for expansion:**
> - **Build client scaffold when:** signed SOW includes video deliverables AND iaGO has run internal workflow 3+ times.
> - **Build custom skills when:** manually run Remotion-to-output workflow 5+ times and can name the exact friction.
> - **Go Lambda when:** render latency or machine bottleneck becomes a real blocker on real work.

## Problem

iaGO needs an animation delivery capability — for client explainer videos (Munet customs flows, product demos), internal marketing (landing hero, investor decks), and data-viz outputs — without adding a human animator or a proprietary tool (After Effects, CapCut-only workflows). Existing stack has Framer Motion for UI animation but no video rendering path. Claude Code + Remotion is the obvious unlock since Remotion is React and Remotion publishes its own Claude Code agent skills.

## Solution

**Two-tier hybrid:** iaGO's own `animation-studio/` workspace for marketing and prototyping, plus a lightweight `packages/video/` scaffold for client projects that need to ship video with the deliverable. Both tiers share the same iaGO skills on top of Remotion's official `remotion-best-practices` skill.

Rejected alternatives:
- **Dedicated studio only:** clean but client handoff is awkward — client wants the video code with their code
- **Per-project only:** no internal lab for iaGO marketing, every experiment pollutes a client repo

## Scope

### In Scope

- `animation-studio/` workspace at `iago-os/animation-studio/` with Remotion + `remotion-best-practices` skill installed
- iaGO skills (`.claude/skills/`):
  - `/animation-spec` — turn a script into a typed `VideoSpec` (TS interface + JSON instance); the "spec" stage of the four-stage workflow
  - `/animation-build` — scaffold a Remotion `<Composition>` from a spec
  - `/animation-render` — run local render, or dispatch to Lambda if configured
- Two reference compositions: one explainer (voiceover + scenes), one data-viz (bar chart from JSON)
- `scripts/` folder with the four-stage workflow: `script/` (narration MD) → `spec/` (typed JSON) → `build/` (compositions) → `render/` (MP4 output)
- Client-side scaffold: `iago-os/.claude/skills/iago-video-scaffold/` that copies a minimal Remotion setup into `{client-project}/packages/video/`
- License flagging: `/animation-spec` prompts for client employee count and flags commercial license requirement in spec output
- Obsidian integration: session digests written to `sessions/` after each video build (so reusable animations are discoverable)

### Out of Scope

- ElevenLabs TTS pipeline integration (defer to v2 — practitioners currently drop audio in `public/`)
- Automatic caption generation via Whisper (v2)
- MCP server for Remotion (experimental, not worth wiring until stable)
- Framer Motion replacement — Framer Motion stays for UI; Remotion is video-only
- Client-facing video CMS or dashboard (out of scope for this delivery capability)
- Enterprise Lambda-rendering licensing negotiation (cross that bridge when a client needs it)
- Migrating existing client-side Framer Motion to Remotion (different use cases)

## Technical Approach

**Stack alignment:**
- Remotion is React 19 compatible, TypeScript strict — fits CLAUDE.md code standards
- Tailwind 4 supported inside Remotion compositions (via `@remotion/tailwind`)
- Lambda rendering via `@remotion/lambda` — fits the Amplify Gen 2 "no raw CDK/CF" rule because `@remotion/lambda` manages its own infra outside Amplify (documented as an acceptable exception for video-only renders, never for app backend)
- Biome for formatting/linting (already our default)
- No testing-runtime for frame output (too expensive); use `npx remotion still --frame=N` for visual regression spot-checks

**Workspace layout:**

```
iago-os/
├── animation-studio/              # iaGO's own animation shop
│   ├── script/                    # narration + scene outlines (MD)
│   ├── spec/                      # typed VideoSpec JSON instances
│   ├── src/
│   │   ├── Root.tsx               # registerRoot + <Composition> declarations
│   │   ├── compositions/          # one folder per animation
│   │   └── types/video-spec.ts    # shared VideoSpec interface
│   ├── public/                    # audio, images, fonts
│   ├── out/                       # rendered MP4s (gitignored)
│   ├── remotion.config.ts
│   └── package.json
├── .claude/skills/
│   ├── animation-spec/
│   ├── animation-build/
│   ├── animation-render/
│   └── iago-video-scaffold/
└── clients/
    └── {client}/packages/video/   # mirror of animation-studio/src, scoped
```

**VideoSpec interface (the "spec" that matters more than the code):**

```ts
type VideoSpec = {
  id: string;                      // composition id
  title: string;
  fps: 30 | 60;
  dimensions: { width: number; height: number };  // 1920x1080, 1080x1920 (vertical), 1080x1080
  scenes: Scene[];
  voiceover?: { src: string; derivesDuration: true };  // path in public/
  brand?: { primary: string; secondary: string; font: string };
  safeZones?: { top: number; bottom: number; sides: number };  // mobile floors
  licenseContext: { iagoInternal: boolean; clientEmployees?: number };  // licensing flag
};

type Scene = {
  id: string;
  durationSeconds: number;
  kind: "title" | "bullets" | "chart" | "voiceover-sync" | "callout" | "outro";
  props: Record<string, unknown>;  // scene-specific
};
```

`calculateMetadata` derives total `durationInFrames` from `scenes.reduce((acc, s) => acc + s.durationSeconds, 0) * fps`, or overrides from voiceover audio length.

**Skill contracts:**

- `/animation-spec {brief}` → reads a script brief, asks clarifying questions (tone, format, duration target), writes `animation-studio/spec/{slug}.json` + updates `VideoSpec` type if new scene kind needed. Flags license implications.
- `/animation-build {spec-slug}` → reads `spec/{slug}.json`, scaffolds `src/compositions/{slug}/` with a `<Composition>` that maps each scene to animated React. Follows Remotion skills' hard rules: `interpolate`/`spring` only, no CSS transitions, `N * fps` for durations, safe zones enforced.
- `/animation-render {spec-slug} [--lambda]` → local render via `npx remotion render` or Lambda if flag set. Writes to `out/{slug}.mp4`. Reports duration, file size, render time.
- `/iago-video-scaffold {client}` → copies minimal Remotion scaffold into `clients/{client}/packages/video/` with client-specific brand defaults pre-populated.

**Licensing gate:**

- `animation-studio/` uses Remotion free (iaGO = 3 employees)
- `/animation-spec` requires `licenseContext` on every spec. If `iagoInternal: false` and `clientEmployees > 3`, spec writes a `**LICENSE REQUIRED**` banner and halts `/animation-render` unless the client has confirmed a Creators plan.
- Document lives at `animation-studio/LICENSE_POLICY.md`

**Rendering:**

- Local (Windows): default. `npx remotion render` hits headless Chromium on the dev box. 1080p 30fps runs at ~5-10x real-time on a decent laptop.
- Lambda: `@remotion/lambda` deployed to iaGO's AWS account (582071018864). Parallel frame workers. Used for anything >60 seconds or batch jobs. Explicit opt-in via `--lambda` flag.
- Never Cloud Run (alpha, stagnant per research)

**Observability:**

- Each render writes metadata to `animation-studio/out/.manifest.json`: spec slug, duration, file size, render time, git SHA. Useful for tracking which spec produced which MP4.
- Obsidian session digest written after each `/animation-render` success — path `sessions/YYYY-MM-DD-animation-{slug}.md`

## Delivery Path

### Phase 1 (Week 1): Workspace + reference composition
- `animation-studio/` workspace scaffolded (`npx create-video@latest`)
- `remotion-best-practices` skill installed via `npx skills add remotion-dev/skills`
- `VideoSpec` type locked
- One reference composition: "iaGO brand intro" (5-second title card with spring-in logo) — proves local Windows render end-to-end
- Deliverable: `animation-studio/out/iago-intro.mp4`

### Phase 2 (Week 2): iaGO skills + two more references
- `/animation-spec`, `/animation-build`, `/animation-render` skills written
- Second reference: explainer (3 scenes, voiceover from `public/`, ~20 seconds) — proves `calculateMetadata` audio-derived duration
- Third reference: data-viz (animated bar chart from JSON `defaultProps`) — proves data-driven composition
- License policy doc written
- Deliverable: 3 rendered MP4s + 3 skill files working end-to-end

### Phase 3 (Week 3): Lambda render + client scaffold
- `@remotion/lambda` deployed to iaGO AWS account
- `/animation-render --lambda` working for at least one composition
- `iago-os/.claude/skills/iago-video-scaffold/` skill written
- First use: scaffold `clients/munet-web/packages/video/` with Munet brand
- Deliverable: Lambda render of the brand intro + Munet video scaffold

### Phase 4 (Week 4): Integration + documentation
- Obsidian session digest automation (stop-hook fires `sessions/YYYY-MM-DD-animation-*.md`)
- `.iago/` integration: `/iago-plan --feature` recognizes `docs/specs/animation-*.md` and scaffolds animation delivery plan
- CLAUDE.md update: document the `animation-studio/` and the four-stage workflow
- Deliverable: full docs + Munet explainer video built end-to-end through the workflow (dogfood)

## Open Questions

1. **Pre-emptive Creators plan?** iaGO is at the 3-employee free-tier threshold. One hire and we hit $75/mo. Decide now vs reactively? → Recommend reactive. Free tier stays free, and first paid client covers it.
2. **Script Lab location:** `animation-studio/script/` (in-repo) or Obsidian `_context/animations/`? → Recommend in-repo. Scripts version with the spec. Obsidian links to them.
3. **Lambda cost guardrail:** Do we set a monthly spend alarm on Remotion Lambda separately from the main iaGO AWS usage? → Yes. $20/mo soft alarm, $50/mo hard.

## Handoff

Run `/writing-plans docs/specs/remotion-animation-workflow.md` to break this into implementation tasks, or skip ahead with `/iago-plan --feature docs/specs/remotion-animation-workflow.md` if ready to go through the pipeline.
