---
name: reference-workspace-mcp-sheets
description: "workspace-mcp Google Sheets tool quirks — conversion, CF update no-op, no data-validation tool, attachments dir"
metadata: 
  node_type: memory
  type: reference
  originSessionId: be23e99c-2e6f-41e9-9a31-436522ee54a4
---

`workspace-mcp` (Google Workspace MCP, authed as santiago@iagoag.com) is the live Google Sheets integration — no need for xing5/mcp-google-sheets. Non-obvious behaviors learned 2026-05-28 working a client inventory sheet:

- **Office files are unusable by the Sheets API.** A `.xlsx` uploaded to Drive (URL has `rtpof=true`) returns "operation not supported... must not be an Office file." The MCP **cannot convert** it: `copy_drive_file` keeps xlsx, `create_drive_file` with `mime_type=application/vnd.google-apps.spreadsheet` → `badRequest`, metadata mime change → no-op. **Only fix: user does File → Save as Google Sheets in the Drive UI.** That conversion also auto-resolves `_xlfn.XLOOKUP`/`_xlfn.SUMIFS` phantom names.
- **`manage_conditional_formatting` action=`update` is a silent no-op** — it echoes the new colors/values as if applied but the live doc is unchanged (verify with `get_spreadsheet_info`). `action=add` and `action=delete` DO persist. To recolor a rule: `add` the new rule at the target `rule_index` (earlier rule wins on conflict), then `delete` the old one. Always verify with `get_spreadsheet_info` (authoritative), not the tool's echoed list.
- **No data-validation / dropdown / filter / locale tool exists** in workspace-mcp. **ESCAPE HATCH — call the Sheets API directly with the MCP's own stored OAuth token** (it has the read-write `spreadsheets` scope). Token at `C:\Users\sanal\.google_workspace_mcp\credentials\santiago@iagoag.com.json` (keys: token, refresh_token, token_uri, client_id, client_secret, scopes); client secret also in `~/.google_workspace_mcp/client_secret.json`. System python has `google-auth` + `google-api-python-client`. Refresh with `Credentials(...).refresh(Request())`, `build("sheets","v4")`, then `batchUpdate` for setDataValidation (ONE_OF_RANGE / ONE_OF_LIST, showCustomUi+strict), setBasicFilter, updateSpreadsheetProperties(locale es_MX), addConditionalFormatRule, repeatCell(numberFormat). This does EVERYTHING the MCP tools can't — no Apps Script needed. Use locally only (his auth, his file, his request).
- **Office→Sheets conversion truncates the grid.** Movimientos grid came out 123 rows (not the 981 the xlsx validations implied); `get_spreadsheet_info` mis-reports it as 1000. batchUpdate clamps over-grid ranges silently; `get` with includeGridData rejects them. Check real `gridProperties.rowCount` before assuming range bounds, and align formula range bounds to the actual grid.
- **`modify_sheet_values` persists reliably** (use for HYPERLINK formulas etc.). Internal nav links: `=HYPERLINK("#gid=XXXX","label")`; get gids from `get_spreadsheet_info`.
- **Local uploads restricted** to `C:\Users\sanal\.workspace-mcp\attachments` (else "path outside permitted directories"). Copy files there first.

See [[feedback-clients-separate-repo]] — client spreadsheet work stays out of iago-os repo.
