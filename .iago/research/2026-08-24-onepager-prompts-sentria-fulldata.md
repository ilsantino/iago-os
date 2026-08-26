# Prompts para los one-pagers — Sentria y FullData

Fecha: 2026-08-24. Destino: correr cada prompt con Fable 5, en sesión separada, cwd en `C:\Users\sanal\dev\iago-os`.

Los "hechos ancla" de cada prompt salieron de una lectura real de los dos árboles, verificados contra archivo y línea al 2026-08-24. El prompt igual obliga a re-verificarlos porque el código se mueve.

---

## PROMPT 1 — Sentria

```
Escribe un one-pager (1-2 páginas) para presentar Sentria a un director de operaciones o gerente de
planta de una manufacturera mexicana. Español de México. El documento se entrega impreso o en PDF a
alguien que no es técnico y que decide compras.

## Paso 1 — Investiga antes de escribir. No escribas una sola línea hasta terminar esto.

Lee, en este orden, dentro de `clients/sentria/`:

1. `CLAUDE.md` — qué es el sistema, cómo se mueve un incidente de punta a punta.
2. `amplify/data/resource.ts` — el modelo de datos. En particular:
   - `Incident` (~línea 1369): estados, campos de escalación, campos de SLA, marcas de tiempo.
   - `Technician` (~1541): `incidentTypes`, `incidentCategories`, `factoryLines`, `hierarchyLevel`.
   - `FactoryLine` / `Machine` / `IncidentCategory` / `IncidentType` (~1967-2055): el catálogo por
     organización, incluidos `slaResponseMinutes` y `slaResolutionMinutes` por tipo.
   - `Turno`, `TechnicianTurnoAssignment`, `Absence`, `OrgChartLayout`.
3. `amplify/functions/shared/constants.ts` — `ASSIGNMENT_TIMEOUT_MS`, `CREATION_TIMEOUT_MS`,
   `HIERARCHY_LEVELS`, `ASSIGNABLE_LEVELS`, y el comentario que explica por qué el timeout subió de
   5 a 10 minutos (trae datos de producción: úsalos, son argumento de venta).
4. `amplify/functions/shared/incidentCatalogFallback.ts` — `FALLBACK_SLA`: los SLA por defecto de
   cada tipo, y `FALLBACK_TYPE_LABELS` / `FALLBACK_TYPES_BY_CATEGORY`.
5. `amplify/functions/shared/escalation.ts` — la cadena de escalación completa: los tres
   disparadores, `FIVE_MIN_MS`, `MAX_ATTEMPTS_PER_SUPERVISOR`, el anclaje al turno, la pausa entre
   turnos, el agotamiento, y cómo se para sola.
6. `amplify/functions/escalationMonitor/handler.ts` — la cadencia del cron, la auto-cancelación a
   las 5 horas, los recordatorios.
7. `amplify/functions/assignmentTimeoutHandler/handler.ts` — qué pasa cuando un técnico no contesta
   una oferta: auto-rechazo, siguiente candidato, y cuándo cae a escalación.
8. `amplify/functions/shared/assignation.ts`, `availability.ts`, `recipientGate.ts` — cómo se elige
   a quién se le ofrece cada incidente (competencias, turno, ausencias, carga, alcanzabilidad).
9. `src/lib/report-metrics.ts` (lee el bloque de comentarios de arriba completo — declara qué mide
   cada número y qué NO mide), `src/lib/report-salud.ts`, `src/lib/plant-calendar.ts`.
10. `docs/usuarios/modulos-web/01-dashboard.md`, `04-organigrama.md`, `05-reportes.md`,
    `10-lineas-y-maquinas.md` — la descripción de cada módulo en el idioma del usuario final. Es la
    mejor fuente de voz para este documento.
11. `docs/qr-labels/PLAN.md` y `docs/qr-labels/MOCKUP.md` — las etiquetas QR por máquina.
12. `.iago/research/2026-08-19-reportes-salud-planta.md` — §2 (qué es derivable y qué no), §5 (la
    regla de vocabulario) y el cierre (la captura de paro `stoppedAt`/`restartedAt`).
13. `docs/reportes-operacion/README.md` — el reporte de operación que ya se entrega a cliente.
14. `docs/sales/guion-venta-sentria.md` — el tono comercial que ya existe. Hereda ese tono.
15. `.iago/STATE.md` — qué está shippeado.

## Paso 2 — Hechos ancla (verificados 2026-08-24). Confírmalos en el código; si algo cambió, manda el código, no esta lista.

- Niveles: 0 Reportero, 1 Técnico, 2 Líder de Equipo, 3 Gerente de Área, 4 Gerente de Planta.
  Sólo 1 y 2 reciben asignación; 3 y 4 sólo entran como supervisores por escalación.
- Ventana de aceptación de una oferta: 10 minutos. Subió de 5 a 10 tras medir 203 ofertas reales en
  producción: la latencia media de respuesta fue ~6.4 min y el 70.7% de los "Aceptar" llegaba
  después de expirar; con 10 minutos se rescataron 8 ofertas más (+31%).
- Timeout de creación de un reporte a medias: 5 minutos.
- Auto-cancelación de un incidente que sigue sin resolver: 5 horas.
- Escalación — tres disparadores, y sólo tres: oferta ignorada (no queda técnico elegible),
  inactividad (5 minutos de silencio en un incidente en progreso), y ayuda solicitada (el técnico
  asignado la pide desde Telegram).
- Escalación — cadencia: se re-notifica cada 5 minutos, máximo 3 intentos con el mismo supervisor,
  y después sube al siguiente de la cadena del turno anclado. Se pausa sola en el hueco entre
  turnos y se reanuda al abrir el siguiente. Se para sola si vuelve la actividad, si un técnico
  acepta, si un supervisor se suma o toma el incidente, o si el incidente llega a estado terminal.
- SLA por defecto, en minutos de respuesta / minutos de resolución: Breakdown Mecánico 10/60,
  Ajustes y Regulaciones 10/30, Breakdown Eléctrico 10/30, Breakdown Otro 10/120, y los siete tipos
  de Servicios (agua, aire comprimido, calderas, chiller, gas, energía, otro) 10/30.
- Los SLA se sobreescriben POR TIPO desde el catálogo (`IncidentType.slaResponseMinutes` /
  `slaResolutionMinutes`). Vacío = hereda el default de la organización.
- El cumplimiento de SLA se calcula contra las marcas de tiempo reales del incidente y el objetivo
  del tipo — no contra una bandera. Un incidente abierto que ya pasó su objetivo cuenta en contra;
  uno abierto todavía dentro de su ventana no entra al denominador.
- El catálogo (líneas, máquinas, categorías, tipos) es por organización y lo edita un administrador
  desde la web. Un cambio tarda hasta 5 minutos en aparecer en los botones de Telegram. Archivar es
  reversible y conserva el historial; eliminar es irreversible y está bloqueado si hay incidentes
  que referencien el elemento.
- El organigrama se organiza SIEMPRE por turno: el supervisor de cada persona es por turno, no
  global. Con dos o más turnos activos a la vez la vista se parte en columnas, una por turno.
- Competencias por persona: cada técnico trae sus categorías, sus tipos y sus líneas. Un incidente
  sólo se le ofrece a quien cubre esa combinación, está de guardia en el turno activo, no está de
  vacaciones ni ausente, y tiene el bot alcanzable.
- Reportes: siete secciones (tendencia de 6 meses, resumen ejecutivo, operaciones con el reloj de
  planta hora × día, resolución y SLA, máquinas, desempeño de técnicos, detalle por línea), filtros
  en dos niveles con 12 cortes, y tres PDF con marca: Reporte de Operación, Salud de Planta y
  Resumen Ejecutivo, más CSV crudo. Todos los PDF llevan portada con periodo y filtros aplicados y
  una página de metodología.
- El denominador de las tasas son las horas operativas reales, derivadas de los horarios de los
  turnos configurados. Por eso "incidentes por hora operativa" es comparable entre líneas y turnos.

## Paso 3 — Qué tiene que decir el documento

En este orden, y sin encabezados de más:

1. Qué es Sentria, en un párrafo. El reportero abre Telegram, no una app nueva.
2. **Tropicalización.** Que el catálogo es del cliente: sus líneas, sus máquinas, sus categorías de
   incidente, sus tipos. Nada viene cableado. Se edita desde la web y baja a los botones de Telegram.
3. **Organigrama por turno.** Los cinco niveles, el supervisor por turno, ausencias y turnos, la
   vista en vivo del piso.
4. **Cómo se asigna un incidente.** Competencias por persona, quién es elegible, la ventana de
   aceptación, qué pasa con un rechazo o un silencio.
5. **Reglas de escalación**, con detalle. Es una de las dos secciones que el lector se va a llevar.
6. **SLA de aceptación y de resolución**, con detalle, y cómo se modifican por tipo de incidente.
   Deja claro que son dos relojes distintos: la ventana de aceptación de la oferta no es el SLA.
7. **Lo que se ve de la operación real.** Dashboard, reportes, salud de planta, los tres PDF.
8. **Tiempo de paro real.** El paro se captura como tal — cuándo se detuvo y cuándo volvió a
   arrancar — y de ahí sale el paro por línea, por máquina, por turno y por tipo de incidente.
9. **Etiquetas QR en la máquina.** Dos por equipo. La de reporte abre Telegram con la línea y la
   máquina ya resueltas: el reportero sólo elige categoría, tipo y manda foto — se saltan dos pasos
   de selección, y la tarjeta de categoría muestra "Línea 03 · Llenadora ¿Es correcto?" con una
   salida de "No es esta máquina". La de llegada sella la hora en que el técnico llegó al equipo y
   avisa si escaneó la máquina equivocada. Como la etiqueta es de una máquina de una línea concreta,
   el reporte queda amarrado a esa combinación y el menú abre ya acotado a lo que aplica ahí.
10. Un cierre corto: multi-tenant, español, canal Telegram, datos en la nube del cliente.

## Paso 4 — Reglas duras

- **Prosa y viñetas cortas. CERO tablas.** Es un documento de negocio, no una spec.
- Entre 700 y 1,100 palabras. Si te pasas, corta; no reduzcas el cuerpo de escalación ni el de SLA.
- **Presente, voz de producto.** Nunca escribas "próximamente", "en desarrollo", "roadmap", "v2",
  "pronto", "estamos construyendo", ni ninguna variante. Las etiquetas QR y la captura de paro se
  describen como capacidades del producto, en presente, igual que todo lo demás.
- **Pero no inventes despliegue.** Prohibido afirmar que algo "ya está corriendo en tu planta", "hoy
  en Absara", "N clientes lo usan" o cualquier cifra de instalación. Se describe la capacidad del
  producto, no una base instalada. Esa línea no se cruza.
- **La etiqueta de llegada NUNCA es "prueba de presencia".** Ni "comprobante", ni "verificación de
  que el técnico estuvo ahí". Se dice: sella la hora de llegada y detecta la máquina equivocada.
  Esta regla está documentada en el plan por una razón legal y de recursos humanos — respétala.
- **"Paro" sólo para el paro capturado** (se detuvo → arrancó). El tiempo de resolución de un
  incidente NO es paro y jamás se le llama así: no todo incidente para una línea, y la línea casi
  siempre arranca antes de que el ticket se cierre. Nunca escribas "disponibilidad", "OEE" ni
  "MTBF"; si necesitas la idea, es "horas operativas entre incidentes" y "línea menos interrumpida".
- **Cada número sale del código.** Si un dato no está en los archivos que leíste, no va en el
  documento. Nada de porcentajes de mejora inventados, nada de ROI supuesto.
- Sin jerga de infraestructura: nada de AWS, Amplify, Lambda, DynamoDB, GraphQL. Telegram sí — es la
  experiencia del usuario.
- Sin hedging. "Sentria asigna", no "Sentria puede ayudar a asignar".

## Paso 5 — Entrega

Escribe el archivo en `clients/sentria/docs/sales/onepager-sentria.md`.

Al terminar, en el chat (no en el documento) lista cada cifra que usaste con el archivo y la línea
de donde salió. Si alguna no la pudiste anclar, dilo en vez de dejarla pasar.
```

---

## PROMPT 2 — FullData

```
Escribe un one-pager (1-2 páginas) para presentar el Asistente FullData. Español de México. Los
lectores son Pedro (comercial) y Rich (lead dev) de onetuweb, y sirve también como material para
que FullData lo enseñe a sus transportistas. Escribe el cuerpo en lenguaje llano y deja UN párrafo
técnico al final para Rich.

## Paso 1 — Investiga antes de escribir. No escribas una sola línea hasta terminar esto.

Dentro de `clients/fulldata/`:

1. `fulldata-bot-asistente/README.md` y `fulldata-bot-asistente/BRIEFING-team.md` — alcance, fases,
   estado de cada stage, disciplina de costo, postura de seguridad.
2. `fulldata-bot-asistente/workspace/00_research/output/findings.md`:
   - §2 — qué hace HOY el asistente del portal y por qué no sirve (el path de conocimiento cableado
     a la Mac de un dev, el fallback de una frase, la ausencia de tool-calling). Ese es el "antes".
   - §3.1 a §3.10 — el inventario real de endpoints por dominio: viajes, cartas porte, facturación
     y cobranza, choferes, clientes, vehículos, remolques, GPS.
   - §4 — el modelo de autenticación y de tenant (`company_id`).
3. `fulldata-bot-asistente/workspace/01_architecture/output/architecture.md`:
   - §1.3 — las 7 etapas por las que pasa toda consulta.
   - §1.4 y §1.4b — el catálogo de 10 herramientas y la tabla de dónde SÍ y dónde NO se usa el LLM,
     con el costo por mensaje.
   - §1.5 — la matriz de tipos de respuesta. Es el corazón del documento.
   - §1.6 — el mapa de los 6 accesos directos.
   - §1.9b — la decisión de proveedor.
   - §2 — el diseño de v2 (bimodal, stage → preview → confirmación humana, `can_act`).
4. `fulldata-bot-asistente/workspace/02_retrieval_layer/output/README.md` y `00_conventions.md` —
   la tabla de las 10 herramientas con su endpoint, su tipo de respuesta y su bandera `can_act`, y
   las convenciones de aislamiento por tenant y de errores accionables.
5. `fulldata-bot-asistente/workspace/03_implementation/output/00_implementation-plan.md` y
   `INTEGRATION-CHECKLIST.md` — qué se está construyendo y cómo se integra sin tocar el resto del
   portal.
6. `reports/guion-fulldata-pedro-rich.md` — el tono con el que Santiago ya le habla a este cliente:
   directo, sin culpar, con analogías del mundo real. Hereda ese registro.
7. `reports/remediacion-fulldata.md` y `.iago/research/2026-06-04-fulldata-security-audit.md` — para
   entender por qué el aislamiento por empresa se explica con tanto cuidado en este cliente.
8. **Verifica el estado real, los checkouts locales están viejos (junio):**
   `gh pr list -R onetuweb/Fulldata-back --state all --limit 20` y lo mismo para `onetuweb/Fulldata`.
   La rama larga es `feat-ai-assistant-v1` en ambos repos. Ajusta cualquier afirmación de estado a
   lo que devuelva `gh`, no a lo que digan los documentos de stage.

## Paso 2 — Hechos ancla (verificados 2026-08-24). Confírmalos; si algo cambió, manda la fuente.

- FullData es un ERP/SaaS para transportistas de carga en México. onetuweb lo desarrolla. Frontend
  Next.js 14 + React 18, backend Laravel 12 + Sanctum. Todo en español.
- El asistente v1 es de consulta: informa, no escribe nada.
- Seis accesos directos visibles en el panel: Carta porte (PDF), Factura (PDF), Rastreo GPS en vivo,
  Mis viajes en curso, Facturas por cobrar, Plantilla de viaje.
- Diez herramientas de lectura detrás: carta porte timbrada en PDF, factura en PDF, estatus SAT de
  una factura (vigente/cancelada), viajes en curso, rastreo en vivo de un viaje, facturas por cobrar
  con filtros de fecha y cliente, tablero de un cliente (saldo y facturación), plantillas de viaje,
  búsqueda global como último recurso, y respuestas de "cómo se hace" desde la base de conocimiento.
- Siete formas de respuesta, y cada pregunta tiene la suya: PDF con botones de descargar y abrir;
  mapa en vivo con la última posición, la ruta trazada, chofer y placas, y un botón a mapa completo;
  lista compacta con máximo 5 filas, cada una clicable, y "Mostrando 5 de N"; tarjeta de navegación
  con un solo botón a la pantalla correcta; prosa; respuesta híbrida (resumen más widgets); y error
  accionable — nunca un "lo siento, tuve un problema", siempre qué pasó y a dónde ir.
- Aislamiento: `company_id` se inyecta del lado del servidor desde la sesión. El LLM nunca ve ni
  decide de qué empresa es el usuario. Antes de consultar, se verifica que el id pedido pertenezca a
  esa empresa, y el filtro se vuelve a aplicar aunque el endpoint ya filtre. Doble filtro es gratis;
  faltar uno es una fuga.
- Facturación queda excluida de forma permanente de cualquier acción — restricción dura del cliente.
  Se garantiza por ausencia de herramienta de escritura y además por una lista de intents prohibidos
  que se rechazan antes de despachar.
- Disciplina de costo: un clic en un acceso directo cuesta CERO llamadas al LLM (el mapeo es
  determinístico del lado del servidor). La base de conocimiento se devuelve textual, sin reescribir.
  Las acciones sugeridas debajo de cada respuesta están fijas por herramienta. El LLM se reserva para
  clasificar la intención, detectar ambigüedad, extraer fechas y filtros del texto, y redactar la
  respuesta final en español. Costo estimado: ~$0.014 por consulta simple, ~$0.025 por una ambigua,
  ~$0.008 por una de conocimiento; ~$1.2K USD/mes a 200 usuarios × 20 mensajes/día. Si se dispara,
  se baja a Haiku con un cambio de variable de entorno.
- El asistente usa la pantalla en la que está el usuario como pista. Si escribe "muéstrame el
  último" estando en viajes, pregunta a qué se refiere en vez de disparar una consulta equivocada.
- Integración: se reescribe el controlador del asistente y se conserva el endpoint que ya existe.
  El widget se embebe en el portal sin tocar el resto.

## Paso 3 — Qué tiene que decir el documento

1. Qué es el asistente, en un párrafo, y qué cambia contra lo que hay hoy en el portal.
2. **Tropicalización a carga mexicana.** Habla el idioma del negocio: carta porte timbrada, CFDI,
   UUID y folio, estatus ante el SAT, complementos de pago, cobranza, rastreo GPS, plantillas de
   viaje, choferes y placas. No es un chatbot genérico traducido.
3. **Los seis accesos directos**, y qué devuelve cada uno.
4. **Cada pregunta con su forma de respuesta.** Un PDF se ve como un PDF; un rastreo se ve como un
   mapa; una consulta de cobranza se ve como una lista clicable. Es la sección que vende.
5. **Qué entiende cuando le escriben libre.** Intención, ambigüedad, fechas y filtros en lenguaje
   natural ("las de mayo", "las del cliente X").
6. **Lo que no hace, a propósito.** Sólo lee. Facturación excluida de forma permanente de cualquier
   acción. Esta sección es un argumento de confianza, no una disculpa: escríbela así.
7. **Aislamiento por empresa.** Explicado en llano, con el criterio de por qué se filtra dos veces.
8. **Costo bajo control.** El principio: no gastar modelo donde alcanza con código.
9. **Cómo se integra** con el portal actual — un párrafo, sin drama.
10. **La segunda fase (v2)**, explícitamente etiquetada como diseño terminado y no construido: cada
    intención se vuelve bimodal (solicitar información / generar acción) y toda escritura pasa por
    preparar → previsualizar → confirmación humana. Facturación nunca entra.

## Paso 4 — Reglas duras

- **Prosa y viñetas cortas. CERO tablas.** Documento de negocio.
- Entre 700 y 1,100 palabras.
- **v2 SÍ se etiqueta como diseño, no como producto.** Es la diferencia con otros materiales: aquí
  se está hablando de un agente que podría escribir contra el SAT, y presentarlo como existente
  sería un problema real con este cliente. Di "diseñada, no construida" con esas palabras.
- Para v1 escribe en presente y sin disculpas. No pongas fechas de entrega ni semanas de timeline;
  si el estado importa, dilo en una línea al final y ánclalo a lo que devolvió `gh`.
- **Cada número sale de los documentos o del código.** Nada de "ahorra X horas" ni de ROI inventado.
- Nada de jerga de proveedor de modelo más allá de una mención. El lector comercial no necesita saber
  qué es tool-calling; el técnico lo lee en el párrafo final.
- Sin hedging.

## Paso 5 — Entrega

Escribe el archivo en `clients/fulldata/reports/onepager-asistente-fulldata.md`.

Al terminar, en el chat (no en el documento) lista cada cifra y cada afirmación de estado con la
fuente de donde salió, y marca las que no pudiste anclar.
```

---

## Notas de la investigación

1. **La captura de paro no existe todavía.** Diseñada como Plan 03 en
   `.iago/research/2026-08-19-reportes-salud-planta.md` (`stoppedAt` / `restartedAt`); la capa de
   métricas del Plan 01 se escribió para que se enchufe sin reescribirse. Hoy el sistema mide tiempo
   hasta resolver, y el código prohíbe expresamente llamarle "paro" a eso.
2. **Las etiquetas QR tampoco.** `docs/qr-labels/PLAN.md`: "propuesta para revisión, no hay código
   escrito". El plan sí está completo hasta el material de la calcomanía.
3. **El QR no filtra tipos de incidente por máquina.** Pre-siembra línea y máquina y corre tres
   validaciones (línea activa en catálogo, línea permitida al reportero, máquina dentro del set
   activo de esa línea). No hay restricción de tipo por máquina en el modelo: `FactoryLine` y
   `Machine` no tienen campo de tipos permitidos. Lo que sí existe: las **competencias por técnico**
   (`incidentTypes`, `incidentCategories`, `factoryLines`) que deciden a quién se le ofrece.
4. **`slaStatus` en la base es decorativo.** Se estampa `on_track` al crear y nada escribe los
   valores de incumplimiento (`src/lib/report-metrics.ts:16-18`). El cumplimiento real se deriva en
   los reportes contra el objetivo del tipo.
