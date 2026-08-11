export const meta = {
  name: 'munet-mp-model-verify',
  description: 'Verificar el modelo de cobro MP para MUNET (jun-2026): Point Air vs Point Smart 2, Orders API nube-a-terminal desde panel WEB, comisión real, impresora — con cross-check escéptico',
  phases: [
    { title: 'Verificar', detail: 'facts MP: Point Air, Point Smart 2, Orders API/terminales, comisión, impresora' },
    { title: 'Cross-check', detail: 'escéptico re-verifica los 2 datos make-or-break en 2a fuente oficial' },
  ],
}

const DOMAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string' },
    summary: { type: 'string', description: 'síntesis en español (MX), 1 párrafo, con el veredicto del punto clave del dominio' },
    data_points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'string', enum: ['alta', 'media', 'baja', 'por_confirmar'] },
          source_url: { type: 'string', description: 'URL real (preferir mercadopago.com.mx / developers.mercadopago.com / starmicronics)' },
        },
        required: ['label', 'value', 'confidence', 'source_url'],
      },
    },
    verdict: { type: 'string', description: 'respuesta directa a la pregunta crítica del dominio' },
    notes: { type: 'string' },
  },
  required: ['domain', 'summary', 'data_points', 'verdict'],
}

const SKEPTIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    claim: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmado', 'ajustado', 'refutado', 'por_confirmar'] },
    corrected: { type: 'string', description: 'el dato correcto si difiere; vacío si confirma' },
    second_source_url: { type: 'string' },
    comment: { type: 'string' },
  },
  required: ['claim', 'verdict', 'second_source_url'],
}

const METHOD =
  'Usa WebSearch + WebFetch sobre fuentes OFICIALES: mercadopago.com.mx (productos), developers.mercadopago.com / mercadopago.com.mx/developers (Point Integration, Orders API, mp-point). Si una página oficial bloquea el fetch, carga scrapling con ToolSearch "select:mcp__scrapling__stealthy_fetch" y reintenta. NO inventes: cada dato con URL real. Lo no confirmable en fuente oficial = confidence por_confirmar.'

const DOMAINS = [
  {
    key: 'point-air',
    label: 'Mercado Pago Point Air — naturaleza real',
    prompt: `Determina con fuente OFICIAL qué ES exactamente el Mercado Pago Point Air en México 2026 y cómo se opera:
- ¿Es un LECTOR Bluetooth que REQUIERE emparejarse a un celular/tablet con la app de MP, o es una TERMINAL AUTÓNOMA con su propia pantalla + su propio internet (WiFi/4G)? (Dato crítico.)
- ¿Tiene pantalla propia? ¿Tiene impresora? ¿Tiene SIM/4G y WiFi propios, o depende del Bluetooth del dispositivo emparejado?
- Precio de lista MXN y promo vigente.
- ¿Cómo se le envía un cobro desde un sistema externo? ¿Por Bluetooth vía Point SDK (app NATIVA Android), o puede recibir el monto "de la nube a la terminal" (Orders API / modo PDV) sin app nativa?
PREGUNTA CRÍTICA (verdict): ¿Una WEB APP (panel del operador corriendo en navegador/WebView de la tablet, SIN app nativa) puede disparar un cobro en el Point Air "al dar click", o el Air OBLIGA a app nativa con Point SDK / o a teclear el monto a mano en la terminal?`,
  },
  {
    key: 'point-smart2',
    label: 'Mercado Pago Point Smart 2 — confirmar modelo',
    prompt: `Confirma con fuente OFICIAL para México 2026 el Mercado Pago Point Smart 2:
- ¿Terminal autónoma con pantalla Android propia + WiFi + 4G + impresora térmica integrada? Confirma cada uno.
- Precio de lista MXN y promo vigente.
- ¿Soporta el flujo Orders API "nube a terminal" (POST /v1/orders, modo PDV/Point Integration) para recibir el monto desde un sistema externo sin teclear? Confirma con doc de developers.
PREGUNTA CRÍTICA (verdict): ¿el Smart 2 sí permite "el panel web manda el monto → la terminal cobra → webhook" sin app nativa? (la research interna dice que sí — confírmalo o refútalo.)`,
  },
  {
    key: 'orders-api',
    label: 'Orders API / Point Integration — terminales compatibles',
    prompt: `Con la documentación OFICIAL de developers de Mercado Pago (Point Integration / Orders API "POST /v1/orders", mp-point), determina para México 2026:
- ¿Qué dispositivos Point soportan el flujo "de la nube a la terminal" (recibir una orden con el monto desde el backend y cobrar sin teclear)? Lista los modelos compatibles (Point Smart, Point Smart 2, Point Pro, Point Air, etc.).
- ¿El Point Air aparece como dispositivo compatible con Orders API / modo PDV integrado, o ese flujo es exclusivo de los Point con pantalla (Smart/Smart 2/Pro)?
- ¿La integración se hace desde backend (server-to-server con access token) — por lo tanto compatible con un panel WEB — o requiere el Point SDK en una app nativa?
PREGUNTA CRÍTICA (verdict): para un panel WEB que quiere "click → cobra la terminal", ¿qué terminales sirven, y el Point Air es una de ellas SÍ o NO?`,
  },
  {
    key: 'comision',
    label: 'Comisión MP Point presencial',
    prompt: `Con fuente OFICIAL (mercadopago.com.mx, sección lectores Point / costos), determina para México 2026 la comisión por cobro con tarjeta presencial en una terminal Point:
- ¿Es 3.50% PLANO SIN cargo fijo por transacción, o hay un cargo fijo (p.ej. +$4) además del porcentaje? Resuélvelo con fuente oficial.
- ¿La comisión es + IVA?
- ¿Varía por plazo de liquidación (al instante vs 14/30 días)? Da las tasas si las publican.
PREGUNTA CRÍTICA (verdict): ¿la comisión Point presencial tiene o NO tiene cargo fijo en pesos? (un análisis interno confundió un "$4 fijo" que en realidad es una cuota propia de iaGO, no de MP — confirma la cifra REAL de MP.)`,
  },
  {
    key: 'impresora',
    label: 'Impresora térmica de red Star',
    prompt: `Determina con fuente real (Star Micronics + retailers MX) para México 2026:
- Star TSP143IV (TSP143IVUE): ¿es impresora de RED (Ethernet/LAN + WiFi) con CloudPRNT, capaz de recibir el boleto directo por la red sin PC puente? Confirma specs (80mm, autocorte, puerto cajón RJ11/RJ12).
- Precio retail MXN real vigente (con IVA) en MX, con URL.
- ¿La TSP143IIIU (USB) sigue disponible/vigente en MX o está descontinuada? ¿La IVUE es la sucesora recomendada?
PREGUNTA CRÍTICA (verdict): ¿cuál es el modelo Star de RED vigente para integración serverless y su precio MXN real?`,
  },
]

phase('Verificar')
const verified = await parallel(
  DOMAINS.map((d) => () =>
    agent(
      `Eres analista verificando datos para una propuesta de cliente (museo MUNET, México). Rigor de fuente oficial.\n\nDOMINIO: ${d.label}\n\n${d.prompt}\n\n${METHOD}\n\nDevuelve data_points (cada uno con confidence + source_url real) y un verdict que responda DIRECTO la pregunta crítica.`,
      { label: `verify:${d.key}`, phase: 'Verificar', agentType: 'research', schema: DOMAIN_SCHEMA },
    ),
  ),
)

// Cross-check escéptico SOLO de los 2 make-or-break: (a) Point Air desde panel web; (b) comisión sin/ con fijo.
const airV = (verified[0] && verified[0].verdict) || 'sin dato'
const comV = (verified[3] && verified[3].verdict) || 'sin dato'

phase('Cross-check')
const skeptics = await parallel([
  () =>
    agent(
      `Escéptico de QA. De forma INDEPENDIENTE y en fuente OFICIAL de Mercado Pago (developers — Point Integration / Orders API / lista de dispositivos compatibles), verifica o REFUTA esta afirmación:\n\nAFIRMACIÓN: "${airV}"\n\nPregunta concreta: ¿el Mercado Pago Point AIR puede recibir un cobro disparado desde un sistema backend (Orders API "nube a terminal"), de modo que un panel WEB le mande el monto y la terminal cobre sin teclear y sin app nativa? ¿O el Air queda fuera de ese flujo (solo Point con pantalla: Smart/Smart 2/Pro) y por tanto requeriría Point SDK en app nativa o captura manual del monto?\nSé agresivo: si la doc oficial no lista al Air como compatible con Orders API, NO lo confirmes. ${METHOD}`,
      { label: 'skeptic:point-air', phase: 'Cross-check', agentType: 'research', schema: SKEPTIC_SCHEMA },
    ),
  () =>
    agent(
      `Escéptico de QA. De forma INDEPENDIENTE y en fuente OFICIAL (mercadopago.com.mx), verifica o REFUTA:\n\nAFIRMACIÓN: "${comV}"\n\nPregunta concreta: ¿la comisión de Mercado Pago Point por tarjeta presencial es 3.50% PLANO sin cargo fijo en pesos (jun-2026, MX), o existe un cargo fijo por transacción? Confirma si es + IVA. ${METHOD}`,
      { label: 'skeptic:comision', phase: 'Cross-check', agentType: 'research', schema: SKEPTIC_SCHEMA },
    ),
])

return {
  point_air: verified[0],
  point_smart2: verified[1],
  orders_api: verified[2],
  comision: verified[3],
  impresora: verified[4],
  skeptic_point_air: skeptics[0],
  skeptic_comision: skeptics[1],
}
