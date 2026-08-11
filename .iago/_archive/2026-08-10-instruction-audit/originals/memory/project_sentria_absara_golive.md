---
name: project_sentria_absara_golive
description: Absara (Sentria cliente 1) go-live corte done 2026-06-29 06:00; pilot incidents cleared; real-time dashboard gap pending
metadata: 
  node_type: memory
  type: project
  originSessionId: c37b90eb-b6c5-444a-9370-275fc6a81f61
---

Ana (Absara) pidió un "corte" para que el lunes 2026-06-29 06:00 (America/Mexico_City) Absara empezara a registrar incidencias **de manera oficial** en Sentria, dejando un ambiente limpio.

**Ejecutado la noche del 2026-06-28** (prod, cuenta de Sebas `851725296610`, region us-east-1, prod AppSync API `sezbolkifncg7evkrvzwbdmzd4`, Absara `organizationId = 24827c64-2ef3-49c7-a102-ab647dbce132`, única org en prod):
- Borrados **solo los incidentes de prueba**: 128 `Incident` + 1040 `StatusChange` + 20 `Comment`. Verificado 0 restantes.
- **Intactos** (confirmado por conteo): User 71, Technician 83, Organization 1, IncidentCategory 2, IncidentType 11, FactoryLine 42, Machine 22, Turno 11. Fotos en S3 también se dejaron.
- Script reusable, auto-respaldo + dry-run + guard de org: `clients/sentria/.local/corte-absara.mjs` (allowlist dura de 3 tablas, solo borra `organizationId === Absara`). Re-correr: `node .local/corte-absara.mjs --execute`. Backups en `clients/sentria/.local/corte-absara-backup-*/` + dump completo en `.local/prod-report/`.
- `IncidentCategory`/`IncidentType` son CATÁLOGO (config), NO instancias — no borrar nunca por error de prefijo "Incident*".

**Pendiente / gap a resolver (flag a Santiago):** Ana pidió "se reflejen en tiempo real". El **registro** sí es real-time (Telegram guarda al instante), pero el **dashboard web NO se auto-refresca**: sin subscription en `Incident` (bloqueada por deny-guard owner auth), `staleTime` 60s, `refetchOnWindowFocus:false`, sin `refetchInterval`. Fix más barato = `refetchInterval: 30_000` en `useIncidentsList`/`useIncidentDetails` (≤30s, sin cambio de schema/auth). Es deploy a prod → pasar por pipeline (`/iago-fast` o `/iago-quick`) antes del arranque. Esperando go de Santiago.

**Nota menor:** numeración de incidentes sigue desde ~`INC-0138` (no reinicia en `INC-0001`); resetear solo si Ana lo pide.

Relacionado: [[project_sentria]], [[project_sentria_roster_sync]], [[runbook_sentria_prod_usage_report]], [[reference_sentria_qc_env]].
