---
name: project_fulldata_stage03
description: "FullData Asistente Stage 03 (code) — 4-PR sequence, per-PR git mechanics, CI gate gotchas, which PRs are landed"
metadata: 
  node_type: memory
  type: project
  originSessionId: bba4aa92-e0d6-40f3-9355-fe35947294f3
---

FullData bot asistente **Stage 03** = first code-writing stage on the onetuweb Laravel repos. 4-PR sequence on `feat-ai-assistant-v1` (repos in [[reference_fulldata_bot_asistente]]).

**Status (2026-05-30):**
- **PR 03-1** (knowledge relocation + config + CI gate + hygiene) — **OPEN, CI GREEN**: onetuweb/Fulldata-back **PR #10**, head `feat/assistant-03-1-knowledge-relocation`. Live prod-bug fix (hardcoded macOS knowledge path → `assistant_knowledge` storage disk via `KnowledgeRepository`). 3 independent review rounds (commits `34098e0`, `23989c9`). Awaiting onetuweb merge — iaGO never merges client PRs ([[feedback_no_auto_merge]]).
- **PR 03-2** (ToolRegistry + TenantGuard + ResponseEnvelope) — **OPEN, CI GREEN**: onetuweb/Fulldata-back **PR #11**, head `feat/assistant-03-2-registry-guard-envelope`, base `feat-ai-assistant-v1`. **STACKED ON #10** (branched off the 03-1 tip for `ci.yml` + `config/assistant.php`; merge #10 FIRST — until then PR #11's diff cumulatively shows 03-1's commits). 5 commits (`00a61ff` impl → `b696d96`/`d53e12d`/`8a11588` three review-fix rounds → `0bcdc37` Pint fix). **3 dual-adversarial rounds** (Opus 4.8 ∥ Codex GPT-5.5 + security/tests/completeness lenses) over the 03-2 delta (base = the 03-1 tip, so it reviews only the delta) + local execution of the pure-PHP builders (30/30 assertions; ResponseEnvelope+ToolRegistry have no Laravel deps). Read-only library code: zero write tools (all `can_act:false`), `FORBIDDEN_ACTION_INTENTS` deny-list, `TenantGuard` derives company_id from the user only (+ fused `findForTenant`), `ResponseEnvelope` route guard blocks open-redirect (abs/`//`/backslash/`%2f`/`%5c`/whitespace) + recurses hybrid widgets to any depth.
  - **Residual dual-adversarial Importants are STRUCTURAL, not defects:** the guards have no live consumer yet (the live `AiAssistantController` is still the pre-existing raw-OpenAI path). The dispatcher that consumes them + the end-to-end tenant-isolation/deny-list **integration tests** land in **PR 03-3** by design (the stress-tested 4-PR split). Don't treat "guards unwired" as a 03-2 bug.
- **PR 03-3** (10 tool handlers + ToolDispatcher; the security gate) — next. MUST: dispatcher calls `ToolRegistry::isForbiddenIntent` before dispatch (pass a normalized intent TOKEN, not raw user text — exact-match by design); route every tenant read through `TenantGuard::findForTenant`/`belongsToTenant`; cross-tenant + list-isolation + super-admin-impersonation feature tests.
- **PR 03-4** (controller rewrite to Anthropic transport + AnthropicClient + telemetry). **Finding B folds in here (DECIDED 2026-05-30):** `knowledge.md` violates its own "REGLAS DE FORMATO OBLIGATORIAS" → in the prompt rewrite, hoist format rules into the system prompt and mark the KB `referencia interna; NO copies su formato`.

**Open decisions — BOTH RESOLVED 2026-05-30:**
- Third byte-identical `knowledge.md` at `repos/Fulldata/knowledge.md` (onetuweb FRONTEND, commit 94e9867): confirmed dead (grep: zero frontend refs; retrieval is server-side). **Delete it in the Stage-04 frontend PR** (the first legit onetuweb/Fulldata change) — NOT a standalone chore PR now ([[feedback_no_chore_pr_for_doc_moves]]). Tracked in INTEGRATION-CHECKLIST §F.
- Finding B → PR 03-4 (above).

**Per-PR git mechanics (this client):** branch `feat/assistant-0X-{slug}` OFF the prior PR's branch when it needs the prior's files (03-2 stacked on 03-1 for ci.yml); PR **base = `feat-ai-assistant-v1`** (never main per [[feedback_per_client_deliverable_repo_pattern]]); cumulative diff until the lower PR merges — **merge in order**. One final `feat-ai-assistant-v1 → main` PR after Stage 05.

**Gotchas (verified this session):**
- **PHP gate, NOT the TS execute-pipeline** (PHP/Laravel repo): `php -l` (XAMPP `C:\xampp\php\php.exe`, syntax only — lacks gd/zip/soap) + GitHub CI (`.github/workflows/ci.yml`) running Pint (laravel preset, scoped to `app/Services/Assistant` + `tests/Feature/Assistant` + `config/assistant.php`) + `php artisan test --filter Assistant`. No local composer/vendor → **Pint + PHPUnit only verify on CI** (CI runs on `pull_request` to `feat-ai-assistant-v1`, NOT on feat-branch push). Pint laravel preset: `! $x` WITH space is correct; `no_superfluous_phpdoc_tags` flags `@param mixed` that duplicates a native type (keep @param only when it adds a generic/shape).
- **Pure-PHP service classes can be executed locally** without Laravel (require the file, exercise it) — high-value verification for builders/registries with no DB/framework deps. TenantGuard needs Laravel (Eloquent) → CI only.
- **MIGRATION LANDMINE (flag to onetuweb):** `database/migrations/2026_04_22_*_add_missing_roles_to_users_table.php` uses MySQL-only `ALTER TABLE users MODIFY COLUMN role ENUM(...)` — invalid SQLite. So `RefreshDatabase`/`migrate:fresh` THROWS on the :memory: test DB. DB-backed Assistant tests must self-provision tables via `Schema::create` (see `TenantGuardTest`), NOT `RefreshDatabase`. ci.yml comment updated to say so. Harmless in prod (MySQL).
- Assistant tests MUST live under the `Tests\…\Assistant` namespace or `--filter Assistant` silently selects zero tests (fake-green gate).
- **@claude is COSMETIC on onetuweb** (Claude GitHub App NOT installed; no `claude.yml`). The real review is iaGO's own dual-adversarial workflow, not the GH async loop. PR #11 was NOT tagged (review already done via dual-adversarial; review context lives in the PR body instead).
- **Release blocker** (flag before Stage 05): deploy.yml excludes `storage/**` from FTP sync, so `storage/app/assistant/knowledge.md` won't auto-deploy. INTEGRATION-CHECKLIST §G.

Plan + checklist: `clients/fulldata/bot-asistente/workspace/03_implementation/output/` (00_implementation-plan.md has the stress-tested amendments; INTEGRATION-CHECKLIST.md tracks per-PR landing — check boxes only on merge).
