# Team 3 — agentskills.io standard

_Research date: 2026-04-28_

## TL;DR (3-line verdict)

- Standard health: **ACTIVE** — 17.4k stars on spec repo, 115 commits since Dec 2025, PRs merged as recently as Apr 22 2026; daily commit cadence in April
- Adoption: **35+ runtimes** supporting the standard (Claude Code, Cursor, VS Code/Copilot, OpenAI Codex, Gemini CLI, GitHub Copilot, OpenHands, Roo Code, Amp, Letta, Goose, Spring AI, Databricks, Snowflake, and 20+ more); anthropics/skills reference repo at 125k stars, 14.7k forks; 50k+ community skills across public registries
- Wedge I verdict: **DROP** — iago-os skills are already 97% compliant by coincidence; the 3 non-standard fields (`experimental`, `audit_scope`, `audit_disclaimer`) move cleanly into `metadata`; zero migration ceremony warranted, and portability to other runtimes is not a real iaGO need in the next 6 weeks

---

## What is agentskills.io

Agent Skills is a lightweight open format for extending AI agent capabilities with specialized knowledge and workflows. Originally developed by Anthropic, it was published as an open standard on **December 18, 2025** (initial Anthropic internal launch: October 2025) and placed under community governance at `github.com/agentskills/agentskills`.

The core primitive is a folder containing a `SKILL.md` file. Agents load skills through **progressive disclosure**: only the `name` + `description` (~100 tokens) are loaded at startup for all skills; the full body loads only when a skill activates.

### Schema definition (as of 2026-04-28)

Source: https://agentskills.io/specification

| Field | Required | Constraints |
|---|---|---|
| `name` | Yes | 1-64 chars; `[a-z0-9-]` only; no leading/trailing/consecutive hyphens; must match directory name |
| `description` | Yes | 1-1024 chars; describes what the skill does and when to use it |
| `license` | No | License name or bundled file reference |
| `compatibility` | No | 1-500 chars; env requirements (target product, packages, network) |
| `metadata` | No | Arbitrary `string → string` map; catch-all for non-spec fields |
| `allowed-tools` | No | Space-separated pre-approved tools (Experimental) |

No explicit version number in spec as of research date. No CHANGELOG.md in the repo. The spec is presented as a living document without semver tags — `gh api repos/agentskills/agentskills/tags` returns empty. This is intentional: the format is deliberately minimal (only 2 required fields) to avoid versioning surface area.

Claude Code extends the base spec with additional frontmatter fields (`disable-model-invocation`, `user-invocable`, `when_to_use`, `argument-hint`, `arguments`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`). These are additive Claude Code-specific extensions; other runtimes ignore them. Source: https://code.claude.com/docs/en/skills

---

## Health metrics

Source: `gh api repos/agentskills/agentskills` + direct inspection

| Metric | Value |
|---|---|
| Repository created | 2026-12-16 (4.5 months ago) |
| Stars | 17,446 |
| Forks | 1,033 |
| Open issues | 49 |
| Total commits | 115 |
| Contributors | 30 |
| Last push | 2026-04-22 |
| PRs open/merged last 7 days | 7 PRs created (2026-04-20 through 2026-04-26) |
| April 2026 commit days | Apr 1, 2, 3, 9, 10, 13, 14, 19, 20, 22 — consistent daily/multi-day cadence |
| License | Apache-2.0 (code), CC-BY-4.0 (docs) |
| Releases/tags | None — spec versioned by commit, not semver |

The Anthropic-owned reference skills repo (`anthropics/skills`) is the primary community artifact:
- Stars: 125,411
- Forks: 14,682
- Created: 2025-09-22
- Last push: 2026-04-23

GitHub `agent-skills` topic: **3,706 public repositories** as of April 2026. Top community collections have 35k-57k stars. Active Discord at `discord.gg/MKPE9g8aUy`.

GitHub CLI shipped `gh skill` command on **2026-04-16** (https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli), enabling `gh skill publish`, `gh skill install`, `gh skill list` against GitHub registries. This is a strong ecosystem signal — GitHub toolchain integration means skills are treated as first-class artifacts alongside packages.

**Verdict on health: demonstrably active.** Not a speculative or stagnant project.

---

## Adoption

### Runtimes supporting the standard

As of 2026-04-28, the following agent systems explicitly support the Agent Skills format (from agentskills.io/clients):

**Tier 1 (major platforms):** Claude Code (Anthropic), Claude.ai, GitHub Copilot, VS Code, Cursor, OpenAI Codex, Gemini CLI

**Tier 2 (notable tools):** OpenHands, Amp, Letta, Goose (Block), Roo Code, Spring AI, Databricks Cortex Code, Snowflake Cortex Code, Kiro (AWS), Junie (JetBrains), Firebender, TRAE (ByteDance), Qodo, Laravel Boost, Ona, Emdash, Factory, Agentman, Mistral Vibe, Workshop, Google AI Edge Gallery, nanobot, fast-agent, Autohand Code CLI, pi, Mux, Command Code

Total: **35+ runtimes** from 7 major vendors (Anthropic, Google, Microsoft/GitHub, OpenAI, Amazon, ByteDance, Mistral).

### Skills in public registries

- SkillRepo (https://www.skillrepo.dev): public registry, exact count not disclosed, but site references "grading and install counts"
- `anthropics/skills` reference repo: 125k stars, 14.7k forks
- Community collections: 50k+ skills indexed across just two collections by early 2026 (https://medium.com/@frulouis/25-top-claude-agent-skills-registries)
- `agent-skills` GitHub topic: 3,706 repos

### Community signals

- Discord active (community link on official site)
- Simon Willison wrote about launch Dec 19 2025 (https://simonwillison.net/2025/Dec/19/agent-skills/)
- VentureBeat, The New Stack, the-decoder, TechRadar covered the standard launch
- Spring AI blog (Jan 2026), Strapi blog, LlamaIndex blog all published integration guides
- GitHub CLI `gh skill` landed Apr 16 2026 — platform integration, not just ecosystem tooling

---

## Versioning + stability

The spec has **no semver versioning**. The format is intentionally minimal — 2 required fields (`name`, `description`), 4 optional fields. The minimalism is load-bearing: a schema this small has almost no breaking-change surface.

No CHANGELOG.md exists in the repo. No releases or tags. Changes are tracked via commits. The most recent 20 commits (all in April 2026) show no indication of field renames or removals — activity is documentation additions, client logo additions, and tooling improvements.

**Stability assessment: HIGH.** The spec is unlikely to break existing skills because it only specifies what the parser must accept, not what it must reject. Extra frontmatter fields (like iago-os's `experimental`) are passed through as unknowns by most runtimes. This is by design — the `metadata` escape hatch exists precisely for this.

---

## Alternatives

### MCP (Model Context Protocol)

MCP is the other Anthropic-originated open standard. It is complementary, not competing. MCP gives agents access to external tools and data (APIs, databases, code execution). Skills give agents procedural knowledge and workflow instructions. The consensus across the ecosystem (LlamaIndex, dev.to, Milvus, cosmicjs, duet.so) is: MCP = tool connectivity layer; Skills = knowledge layer. Use both.

Source: https://dev.to/phil-whittaker/mcp-vs-agent-skills-why-theyre-different-not-competing-2bc1

### Competing approaches (losing)

| Approach | Status |
|---|---|
| OpenAI GPT Store / ChatGPT extensions | Different abstraction (UI/chat plugins), not portable to coding agents |
| Google Gems | Gemini-only; Google ships Gemini CLI using agentskills.io instead |
| Microsoft Declarative Agents (Copilot) | VS Code team adopted agentskills.io; Copilot shows logos on agentskills.io |
| LangChain Hub | Prompt repository, not a skills format; no runtime dispatch mechanism |

The pattern mirrors MCP's trajectory: Anthropic publishes an open spec, OpenAI and Google adopt it within months. OpenAI Codex is on the agentskills.io client showcase. Gemini CLI is on the showcase. The MCP playbook is repeating.

---

## Cost-benefit for iago-os

### Current iago-os frontmatter audit

37 skill directories, 37 SKILL.md files. All use:
- `name`: present in all 37, lowercase-kebab, compliant
- `description`: present in all 37, well-formed, compliant

Non-standard fields in use:
- `experimental: true` — 5 skills (`agent-payment-x402`, `autonomous-loops`, `continuous-agent-loop`, `liquid-glass-design`, `santa-method`)
- `audit_scope: standalone` — 2 skills (`amplify-bug-bounty`, `frontend-bug-bounty`)
- `audit_disclaimer: >-` — 2 skills (same 2 above)

All 37 skills already use the correct filename (`SKILL.md`), correct directory structure, and the two required fields. **The skills are already 97% spec-compliant today without any intentional effort.**

### Migration cost

The 3 non-standard field types affect 7 skills. Under the spec, non-standard fields are tolerated by all runtimes (unknown fields are ignored). However, strict compliance would require moving them into `metadata:`:

```yaml
# Before (non-standard):
experimental: true

# After (spec-compliant):
metadata:
  experimental: "true"
```

Effort: ~20 minutes, 7 files, purely cosmetic. No runtime behavior change in Claude Code. No test changes. No CI changes.

**However: this migration has zero value for iago-os right now** (see below).

### Value analysis

| Value driver | Assessment |
|---|---|
| External publishing | Not applicable. iago-os skills are internal agency tools, never published to SkillRepo or any registry |
| Consuming third-party skills | Possible — but 97% of registry skills are generic coding patterns, not iaGO-specific workflows. No third-party skill maps to `/iago-execute`, `/council`, `/deep-research`. Value is near zero in next 6 weeks |
| Portability to other runtimes | Both operators (Santiago on Windows, Sebas on Mac) use Claude Code exclusively. No migration to Cursor, Amp, or other runtimes is planned. Portability has no current value |
| CI validation via `skills-ref` | `skills-ref validate` exists (https://github.com/agentskills/agentskills/tree/main/skills-ref). Could add to CI. But with 0 external consumers, enforcement is overhead with no payoff |
| Future-proofing | Claude Code already natively consumes the skills as-is. The Claude Code-specific extensions (`disable-model-invocation`, `context: fork`, etc.) that iago-os would want are spec extensions, not base spec fields. Wedge I would not unlock them |

### Risk if we don't adopt

Near-zero in 6-week horizon. The `experimental` and `audit_*` fields are unknown to other runtimes but harmless — they do not break loading. Claude Code reads them and ignores them. If a future Claude Code version starts enforcing strict frontmatter validation (no evidence this is planned), the fix is still the 20-minute migration above.

The one real risk: if iago-os skills were ever submitted to the public registry or distributed externally, non-compliant metadata would cause `skills-ref validate` to fail. That use case is not in the roadmap.

---

## Verdict

**DROP Wedge I as a formal wedge. No 6-week sprint warranted.**

Reasoning:

1. **The compliance gap is trivial.** 37/37 skills are already compliant on the fields that matter (`name`, `description`, directory structure). The 3 non-standard field types are in `metadata` territory and cause no runtime errors today or in any foreseeable future.

2. **No external publishing path.** iago-os skills are internal. There is no SkillRepo submission, no public distribution, no partner runtime adoption on the roadmap. The network effects of the registry are irrelevant.

3. **Portability is not a real iaGO need.** Both operators are on Claude Code. Neither is moving to Cursor or Amp in the next 6 weeks. Future-proofing for a migration that may never happen is speculative cost.

4. **The 20-minute fix can be applied opportunistically.** When touching a skill file for other reasons, move `experimental:` into `metadata.experimental`. No dedicated sprint needed.

5. **The standard IS worth monitoring.** If iago-os ever onboards a client whose team uses Cursor, Gemini CLI, or another runtime — or if the team distributes skills externally — compliance becomes immediately valuable. The work is 20 minutes. Revisit at that trigger, not on a calendar.

**One concrete action:** Add `compatibility: Claude Code (or any Agent Skills-compatible agent)` to the 5-10 skills that are genuinely Claude Code-specific (`iago-execute`, `iago-plan`, etc.). This is a documentation improvement, not compliance work, and takes 10 minutes. It signals intent and costs nothing.

---

## Sources

- https://agentskills.io — Official standard site
- https://agentskills.io/specification — Full schema spec
- https://agentskills.io/llms.txt — Documentation index
- https://github.com/agentskills/agentskills — Spec repo (17.4k stars, 115 commits, Apache-2.0)
- https://github.com/anthropics/skills — Reference skills repo (125k stars, 14.7k forks)
- https://code.claude.com/docs/en/skills — Claude Code skills documentation (Claude Code-specific extensions)
- https://github.com/topics/agent-skills — GitHub topic (3,706 repos)
- https://www.skillrepo.dev/home — SkillRepo public registry
- https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/ — gh skill CLI launch Apr 16 2026
- https://thenewstack.io/agent-skills-anthropics-next-bid-to-define-ai-standards/ — Launch coverage, Dec 2025
- https://the-decoder.com/anthropic-publishes-agent-skills-as-an-open-standard-for-ai-platforms/ — Open standard announcement
- https://simonwillison.net/2025/Dec/19/agent-skills/ — Simon Willison analysis
- https://dev.to/phil-whittaker/mcp-vs-agent-skills-why-theyre-different-not-competing-2bc1 — MCP vs Skills comparison
- https://spring.io/blog/2026/01/13/spring-ai-generic-agent-skills/ — Spring AI adoption, Jan 2026
- https://medium.com/@frulouis/25-top-claude-agent-skills-registries — Community registry overview (50k+ skills cited)
- https://agentskill.work/en/skills/agentskills/agentskills — Spec documentation mirror
