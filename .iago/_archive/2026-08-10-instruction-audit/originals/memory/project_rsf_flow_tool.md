---
name: project-rsf-flow-tool
description: "RSF Process Intelligence Platform — all 9 Phase-0 defaults blessed 2026-08-07; Phase 1+2 architecture in progress; Sentria app shell + RSF brand canvas; simplicity mandate"
metadata: 
  node_type: memory
  type: project
  originSessionId: 47be13dc-9979-41e3-845e-32db46dcd8b4
  modified: 2026-08-07T18:55:10.316Z
---

RSF flow tool (process intelligence platform replacing `RSF_MAPA_v2.html`). Phase 0 teardown + decision document at `clients/rsf/.iago/research/2026-08-06-flow-tool-phase0-teardown-decision.md`. Build-spec prompt: `C:\Users\sanal\Downloads\RSF_FLOW_TOOL_PROMPT.md`.

**Santiago blessed ALL 9 §4 defaults 2026-08-07** (iaGO sandbox on synthetic data only / Bedrock inside RSF account only / `flowId` day 1 + seed M2–M4 as drafts / minimal governance / async optimistic-lock, no CRDT / hybrid event-log versioning from MVP / catalog governance split / Excalidraw export-only / single-tenant with tenant-scoped keys).

**Phase 1+2 DELIVERED 2026-08-07:** `clients/rsf/.iago/context/2026-08-07-flow-tool-phase1-architecture.md` (9-agent workflow, 38 findings — 2 Critical [CFN stack cycle, rama-data destruction] — all amended, 0 rejected). Leg docs archived at `clients/rsf/.iago/research/2026-08-07-flow-tool-phase1-legs/`. Build plan = increments I0–I11; I0–I10 sandbox-safe on synthetic; I11 = sole RSF-gated cutover. **AWAITING Santiago's go for I0** + his §9.3 micro-decisions (headline: presence = REST 45s polling, needs re-bless vs Phase-0 AppSync wording). P0 DONE 2026-08-07: repo `ilsantino/rsf-flow-tool` created (private), SebasElDev + glitchyusher invited as admins, inner checkout at `clients/rsf/flow-tool/`. **P1 (RSF AWS account ask) DEFERRED by Santiago** — "nothing to RSF, live on Amplify for now"; build runs entirely in iaGO account on synthetic; real-data hosting decision re-opens at I11 cutover (flag: real data on iaGO Amplify would reverse blessed decision #1 confidentiality boundary). Execution = plan files under `clients/rsf/.iago/plans/feature-flow-tool-mvp/` through the full pipeline in the inner repo.

**Design directive (Santiago, 2026-08-07):** app shell/components/animations follow **Sentria's design + animation style** (ShadCN + Framer Motion patterns; React Flow donor at `clients/sentria/src/components/org-hierarchy/`, @xyflow/react + dagre); the **canvas keeps RSF brand tokens** (rojo #d0181f, verde #66952e, naranja #f79400, Dosis/Open Sans, 7 node shapes) — RSF's brand, semantically load-bearing. **Simplicity mandate:** Santiago is non-technical — boring code, smallest thing that works, no unnecessary features or clever abstractions.

Key locked-in findings: data model lives in `build2/modelo.mjs` (14 campos clave, not README's 13); provenance model (citas/refutados/no_consta) fully drafted in `build2/extracciones/`; `CAT_SISTEMAS` conflates system vs storage-location (split needed); `objetoNetSuite` field does NOT exist; M2–M4 = 65 nodes extracted, inert. Spelling is **Seiso** not Seizo. `clients/rsf/.iago/{PROJECT,ROADMAP,STATE}.md` are STALE (May-2026 AI-pilot framing) — consultoria-1 material is ground truth.

Code repo (when build starts): NEW standalone repo under ilsantino, inner checkout at `clients/rsf/flow-tool/` — never in iago-os history. Planning docs stay in `clients/rsf/.iago/`.

Related: [[project_rsf_poc_structure]], [[project_red_sun_farms]], [[user_technical_level]]
