---
name: project-sentria-roster-sync
description: "Sentria Absara monthly personnel/roster sync — prod org ids, AWS schema conventions, short-name fuzzy-match gotcha, deliverable pattern"
metadata: 
  node_type: memory
  type: project
  originSessionId: 221f2de2-e875-4c33-8c2f-863afaa45984
---

Absara manda un Excel de personal CADA MES (líneas/turnos/líderes cambian); iaGO lo concilia contra AWS y sube el delta. Related: [[project_sentria]], [[reference_sentria_qc_env]].

**Prod (Absara):** org id `24827c64-2ef3-49c7-a102-ab647dbce132`, AppSync API `sezbolkifncg7evkrvzwbdmzd4` (branch `main`), DynamoDB tables `Technician-sezbolkifncg7evkrvzwbdmzd4-NONE` etc., account `851725296610`, us-east-1. **QC:** org `5b6d7ace-5a7d-48f6-8bdf-a4efbd7a60f3` ("Sentria QC"), API `qlyp5ydhyrezrknynpvfzhd2xq`. OJO: hay 2 stacks tagueados prod (`b3fyong6…`=Encuentra7 stale + el real `sezbolki…`), así que `scripts/lib/amplify-env.mjs` `resolveEnv(env=prod)` revienta por ambigüedad — escanear por API id directo.

**Gotcha de match:** AWS guarda el `Technician.name` CORTO (nombre + 1 apellido, p.ej. "Roller Castro", "Antonio Perez", "Temahuai") mientras el Excel trae nombre completo ("Roller Castro Gil"). Requiere match difuso (subset de tokens con tolerancia a acentos/typos). Technician NO tiene número de empleado — el join es por nombre. ~71 técnicos ya en prod, todos con teléfono.

**Esquema AWS a respetar (no inventar):** hierarchyLevel 0=Reportero, 1=Técnico, 2=Líder de Equipo / Gerente de Área, 3=Gerente de Planta/Área, 4=Gerente de Planta (Pablo Haddad top). Los 6 jefes de mantenimiento del Excel = `Líder de Equipo` L2 que reportan a **Raúl Arellano Garibay** (L3). `preferredChannels` usa whatsapp+telegram. `factoryLines` = keys del catálogo (`linea_1`…`linea_34`, `linea_m1-4`, `linea_r1-3`, `linea_8_9`, `linea_11_3`…). Escritura directa a DynamoDB vía patrón `scripts/seed-turnos-lineas.mjs` (SigV4, dry-run, conditional put). Cargar QC primero, luego prod.

**Patrón de entregable (decidido por Santiago):** el Excel que se manda al equipo de Absara NO lleva nada de AWS (ni ids/roles/niveles) — un solo tab, súper simple (# empleado, nombre, puesto, líder, líneas, turno, teléfono, estado, correcciones), teléfonos pre-llenados sólo en matches exactos. iaGO guarda el mapeo AWS de su lado y sube automático al regresar el Excel corregido. Scripts de trabajo en `clients/sentria/.local/` (git-ignored): scan-absara-roster, reconcile2, build-absara, build-conciliado.
