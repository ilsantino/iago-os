---
name: iago-workspaces project
description: Scaffolded MWP repo at ~/dev/iago-workspaces/ — 4 workspaces, content-pipeline ACTIVE Phase 1 shorts-first, others stubbed
type: project
originSessionId: 9bd2e8a4-71ea-42dc-af0f-7b78439c0fc3
---
iago-workspaces — supersedes iago-os-v2 framing. Scaffolded 2026-04-27.

**Status (2026-04-27)**: SCAFFOLDED. Initial commit `62b0569`. 39 files. 4 workspaces:
- `content-pipeline/` — ACTIVE Phase 1 (shorts-first exploration)
- `consulting-practice/` — STUB Phase 2
- `research-lab/` — STUB Phase 2
- `investor-relations/` — STUB Phase 2 (NEW — added during scaffold session)

**Why this exists separately from iago-os**: Council (2026-04-21) verdict downgraded "v2 with phased absorption" to "parallel non-code workspaces only" because MWP solves context-window problem, iago-os solves delivery-quality problem (orthogonal). Code-delivery stays on iago-os permanently. See [[decisions/2026-04-21-iago-os-v2-council]] in Obsidian.

**How to apply**:
- All Santiago non-code work (content, consulting non-code deliverables, research, investor) belongs in iago-workspaces
- Code work stays in iago-os (never migrate)
- Open Claude Code in `~/dev/iago-workspaces/` for content/consulting/research/investor sessions
- Open Claude Code in `~/dev/iago-os/` for code-delivery sessions (Munet, iaGO-OS itself)
- Don't try to merge them. Different workspaces serve different cognitive modes.

**Phase 1 doctrine (active)**: shorts-first exploration. 3 shorts/week + 1 LinkedIn longform/week. YouTube long = OFF until Phase 2 (~week 8 or after 5+ short hooks validate). See `content-pipeline/_config/current-phase.md`.

**Production stack pending Santiago setup** (~3-5 hr one-time):
- HeyGen account + custom avatar
- ElevenLabs Spanish voice clone
- fal.ai API key
- Minimal Remotion template (captions + lower-thirds + sting)
- Metricool or Publer subscription for cross-platform scheduling

**Spanish content output, English routing metadata** — workspace navigation files in English; voice/format/constraints + all output in Spanish (rioplatense).

**No new tooling without proven friction**:
- Instagram-cli (supreme-gg-gg): rejected (feed reader, not posting/scraping; TOS risk)
- Perplexity API: deferred (try free WebSearch first)
- Custom IG/X scrapers: rejected (TOS + ban risk; Metricool $15-30/mo replaces)
- 6th memory layer: rejected (existing 5 cover it; integrate via Obsidian publish digest)

**Latest session digest**: [[sessions/2026-04-27-iago-workspaces-scaffold]]
**Next session**: Santiago wires production stack, then re-runs the test short ("5 capas de memoria > 1 RAG") through actual HeyGen+fal.ai+Remotion pipeline to validate.
