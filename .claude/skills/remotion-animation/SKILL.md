---
name: remotion-animation
description: Use when producing video deliverables with Remotion (internal marketing, investor decks, client explainer videos). Loads iaGO-specific guardrails on top of Remotion's official `remotion-best-practices` skill — licensing policy, stack boundaries (Framer Motion for UI, Remotion for video), safe zones, and the four-stage script-spec-build-render mental model. Not for Framer Motion UI work or traditional animation tools.
---

# Remotion Animation — iaGO Reference

## Purpose

Knowledge layer for Remotion work at iaGO. This skill does NOT automate a workflow — per the 2026-04-21 council verdict, the `/animation-spec`, `/animation-build`, `/animation-render` skills are deferred until the internal workflow has been run 5+ times. This skill captures the expertise so it's ready when the trigger fires.

## When to use

Invoke when any of these apply:
- Producing video for iaGO marketing (landing hero, investor deck B-roll, demo reels)
- Investigating whether Remotion fits a client deliverable before scoping it
- Answering questions about video-as-code or programmatic video generation

When NOT to use:
- Framer Motion UI animation — use the `framer-motion` conventions in CLAUDE.md instead
- Traditional video editing (CapCut, Premiere, DaVinci) — Remotion is for programmatic, data-driven or repeatable renders
- Simple SVG/Lottie animation — prefer Lottie if the animation is designed in After Effects

## Core mental model

Remotion is a **React-based video rendering framework**. Video = function of time. Every frame, React renders your component tree with a different `frame` value. `@remotion/cli` captures those renders via headless Chromium and stitches them into MP4/WebM/GIF.

```tsx
const Scene = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps], [0, 1], { extrapolateRight: 'clamp' });
  return <div style={{ opacity }}>Hello</div>;
};
```

`useCurrentFrame()` is the heartbeat. `interpolate`, `spring`, `Sequence`, `Series` are math on top of that integer.

## Hard rules (from Remotion's official skill — these WILL break renders if violated)

1. **No CSS transitions. No CSS animations. No Tailwind animation classes.** They don't render reliably. Every animation goes through `interpolate()` or `spring()`.
2. **Express durations as `N * fps`** (e.g., `2 * fps` for 2 seconds), never as raw frame counts.
3. **`spring()` has no end frame** — it approaches asymptotically. Use `springTiming()` from `@remotion/transitions` when precise duration matters.
4. **`media-utils` is deprecated.** New code uses `@remotion/media-parser` for metadata.
5. **`@remotion/cloudrun` is alpha and stagnant.** Lambda is the only production-grade cloud render path.

## iaGO-specific guardrails

### Licensing (CRITICAL)

- iaGO has 3 employees → **free tier** for internal use
- Client licensing is determined by **the client's** employee count, not iaGO's:
  - ≤3 employees or non-profit: free
  - Commercial, 4+ employees: **$75/mo minimum** (Creators plan, 3 seat floor) or $100/mo + $0.01/render (Automators plan)
- **Before any client engagement touches Remotion:** resolve the license in writing with the client. Do not carry the liability implicitly.
- Never scaffold `packages/video/` into a client repo without an explicit license decision captured in the SOW.

### Stack integration

- **Framer Motion stays for UI.** Per CLAUDE.md "Framer Motion on all UI" rule — that's web animation. Remotion is video-only. Do not replace Framer Motion with Remotion in React components.
- **Tailwind 4 inside Remotion is fine** (via `@remotion/tailwind`) for static styling, but animation classes are still forbidden. Write the transforms via `interpolate`.
- **TypeScript strict, no `any`.** Same CLAUDE.md rules as the rest of the codebase.
- **Biome for formatting.** Same as rest of codebase.
- **Lambda deploys are OK despite CLAUDE.md "Amplify Gen 2 only"** — `@remotion/lambda` is a video-rendering-specific infra tool, documented exception. Still never use raw CDK/CF for app backend.

### Safe zones (mobile-first defaults)

Any video that might play on mobile (Instagram, TikTok, YouTube Shorts) must respect:
- Top: 150px (UI overlay zone)
- Bottom: 170px (caption + share button zone)
- Sides: 60px each
- Minimum font sizes: 56px headline, 36px body, 28px labels

Bake these into `defaultProps` for any 1080x1920 composition.

## The four-stage mental model (script → spec → build → render)

Even without automation skills, think in four stages when producing any video:

1. **Script** — narration/copy + scene outline. Lives in `animation-studio/script/{slug}.md`. Human-written.
2. **Spec** — typed data instance describing the video: dimensions, fps, scenes, brand, safe zones, license context. Lives in `animation-studio/spec/{slug}.json`. Machine-readable.
3. **Build** — Remotion `<Composition>` that consumes the spec as `defaultProps`. Lives in `animation-studio/src/compositions/{slug}/`. Claude-written.
4. **Render** — `npx remotion render {id}` → MP4. Output in `animation-studio/out/{slug}.mp4`. Git-ignored.

`VideoSpec` TypeScript shape (use when relevant, adapt per video):

```ts
type VideoSpec = {
  id: string;
  title: string;
  fps: 30 | 60;
  dimensions: { width: number; height: number };
  scenes: Scene[];
  voiceover?: { src: string; derivesDuration: true };
  brand?: { primary: string; secondary: string; font: string };
  safeZones?: { top: number; bottom: number; sides: number };
  licenseContext: { iagoInternal: boolean; clientEmployees?: number };
};
type Scene = {
  id: string;
  durationSeconds: number;
  kind: "title" | "bullets" | "chart" | "voiceover-sync" | "callout" | "outro";
  props: Record<string, unknown>;
};
```

`calculateMetadata` on the `<Composition>` derives `durationInFrames` from the scenes array (or from voiceover audio length if present).

## Package landscape (pick the right tool)

Most common:
- `remotion` — core (`useCurrentFrame`, `interpolate`, `spring`, `Sequence`, `Series`, `AbsoluteFill`)
- `@remotion/cli` — `npx remotion studio` / `render` / `still`
- `@remotion/player` — embed video in React app
- `@remotion/transitions` — `<TransitionSeries>` with fade/slide/wipe + `linearTiming`/`springTiming`
- `@remotion/animation-utils` — CSS transform helpers
- `@remotion/shapes` — SVG primitives
- `@remotion/google-fonts` — tree-shakeable Google Font imports
- `@remotion/tailwind` — Tailwind integration (static styling only)

For specific needs:
- Voiceover-synced captions: `@remotion/captions` + `@remotion/install-whisper-cpp` (local) or `@remotion/openai-whisper` (cloud)
- Charts: plain SVG + `interpolate` works; or use `@remotion/shapes`
- 3D: `@remotion/three` (React-Three-Fiber inside compositions)
- Lottie import: `@remotion/lottie`
- Preload heavy media: `@remotion/preload`

## Render paths

- **Local (default):** `npx remotion render {id}`. Headless Chromium on dev box. 1080p 30fps ≈ 5-10× real-time on a decent laptop. No cloud cost. **Use this until a real bottleneck appears.**
- **Lambda:** `@remotion/lambda`. AWS Lambda + S3, parallel frame workers. Use for >60s videos, batch jobs, or when a client needs render-on-demand. Deployment: `npx remotion lambda sites create` + `npx remotion lambda functions deploy`.
- **Cloud Run:** never. Alpha and stagnant.

## Bridging to CapCut / manual finishing

Practitioner workflow: render the Remotion MP4, drop into CapCut/Premiere for finishing (music, transitions between Remotion-rendered scenes, color grading). This is the documented pattern from the community workflow this skill is based on. Don't try to do everything in Remotion — it's the "programmatic core" that feeds a human editor.

## Trigger conditions for upgrading this skill

Per council verdict (2026-04-21), upgrade to workflow-automation skills when:
- `/animation-spec` + `/animation-build` + `/animation-render` trio: after manually running the Remotion-to-output loop 5+ times and being able to name the exact friction
- `iago-video-scaffold` (for client projects): after a signed SOW includes video deliverables AND iaGO has run internal workflow 3+ times
- Lambda wrapping: after render latency or local-machine bottleneck becomes a real blocker on real work

Until then: this reference skill is the full surface area. No automation.

## Gotchas (first-timer list)

1. CSS transitions break renders — #1 mistake new users make.
2. `spring()` has no end frame — use `springTiming()` when you need precise duration.
3. Lambda 5GB S3 output cap = ~2 hours of Full HD per render.
4. Client licensing threshold is on the **client's** headcount, not iaGO's. Always document.
5. Remotion's `remotion-best-practices` skill ships via `npx skills add remotion-dev/skills` — treat its rule files as canonical.
6. Video previews in Remotion Studio cache aggressively — restart the server after large dependency bumps.
7. Windows-specific: headless Chromium needs Chrome or Chromium installed; Remotion will prompt on first run. Don't install in `C:\Program Files\` path with spaces if you hit issues.
