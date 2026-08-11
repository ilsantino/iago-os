---
name: runbook-sentria-prod-usage-report
description: How to regenerate the Sentria/Absara production usage report PDF from live prod data
metadata: 
  node_type: memory
  type: reference
  originSessionId: 4b0e0313-c70a-4635-af11-2900bcd07c1e
---

Regenerate the Sentria prod usage report ("Sentria-Reporte-Uso-Prod-YYYY-MM-DD.pdf"). Pipeline lives in gitignored `clients/sentria/.local/prod-report/` (so NOT in repo — won't be found by codebase search; this memory is the pointer). 3 deterministic steps, all read-only against prod.

**AWS access:** default profile = prod account **851725296610** as IAM user `il-santino` (Santiago HAS read access; no profile flag needed). Region us-east-1, AppSync API `sezbolkifncg7evkrvzwbdmzd4`, Cognito pool `us-east-1_95nT7IUYg`.

**Gotcha:** root `clients/sentria/node_modules/@aws-sdk` is broken (missing `@aws/lambda-invoke-store`). Do NOT npm-install at root (lockfile cross-platform risk, see [[feedback_windows_npm_lockfile_xplatform]]). Instead install the SDK INTO the gitignored `.local/prod-report/` and run the scan from there.

Steps (from `clients/sentria/.local/prod-report/`):
1. `npm install @aws-sdk/client-dynamodb @aws-sdk/client-cognito-identity-provider @aws-sdk/util-dynamodb` (one-time; dir is gitignored)
2. `cp ../../scripts/_prod-readonly-scan.mjs ./scan.mjs && node scan.mjs` → dumps `*.json` (Scan + Cognito ListUsers/AdminListGroups, NO writes)
3. `node build-html.mjs` → `report.html` (auto-stamps today's date as "Corte de datos")
4. `node render-via-puppeteer.mjs` → PDF + per-section PNG previews in `preview/` (uses local Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`). Edit `PDF_OUT` date in render-via-puppeteer.mjs + render-pages.mjs first.
5. Copy PDF to `clients/sentria/docs/reports/` (tracked — contains prod PII names/phones, same pattern as prior reports).

Client-facing copy: `build-html.mjs` was de-jargoned 2026-06-05 — it now carries label maps (STATUS_ES/SLA_ES/TYPE_ES/labelLine/labelRole) so the rendered report shows business Spanish, NO Cognito/AWS/DynamoDB/table/field names, account number, API ID, or English enums. Keep it that way; if you add a new section, run a jargon grep on report.html before delivering (Santiago's rule: the Absara report must contain zero internal/infra plumbing).

`.local/` is gitignored (`*.gitignore:*.local`) so prod data dumps never get committed; only the final PDF lands in tracked `docs/reports/`. Verify output by reading the `preview/page-*.png` (Read tool can't pdftoppm the PDF on this box). The `build-report.mjs` (pdfkit) is an OLD/unused variant — the delivered report is the HTML→Puppeteer one. Sentria project context: [[project_sentria]]. Prod-on-Sebas-account: [[reference_munet_prod_aws]] (same account 851725296610).
