export const meta = {
  name: 'munet-hardware-verify',
  description: 'Web-verify 2026 MX prices/specs for MUNET tablet + payment-provider proposal, with adversarial cross-check',
  phases: [
    { title: 'Verify', detail: 'parallel web verification per domain (tablets + MP + Clip + Stripe/STP)' },
    { title: 'Cross-check', detail: 'skeptic re-verifies the decision-critical numbers vs a second source' },
  ],
}

const DOMAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string' },
    summary: { type: 'string', description: 'one-paragraph synthesis in Spanish (MX)' },
    data_points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          iva_note: { type: 'string', description: 'whether the figure includes IVA, or N/A' },
          confidence: { type: 'string', enum: ['alta', 'media', 'baja', 'por_confirmar'] },
          source_url: { type: 'string' },
          source_accessed: { type: 'string', description: 'leave empty; stamped later' },
        },
        required: ['label', 'value', 'confidence', 'source_url'],
      },
    },
    integration_notes: { type: 'string', description: 'API/webhooks/SDK/dev-effort/risks where relevant, else empty' },
    notes: { type: 'string' },
  },
  required: ['domain', 'summary', 'data_points'],
}

const SKEPTIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string' },
    challenged: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          original_value: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmado', 'ajustado', 'refutado', 'por_confirmar'] },
          corrected_value: { type: 'string' },
          source_url: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['label', 'verdict', 'source_url'],
      },
    },
    overall: { type: 'string' },
  },
  required: ['domain', 'challenged'],
}

const DOMAINS = [
  {
    key: 'mp-point',
    label: 'Mercado Pago Point',
    prompt: `Verifica con WebSearch + WebFetch (fuentes oficiales: mercadopago.com.mx, developers.mercadopago.com) los datos VIGENTES en MÉXICO 2026 para:
- Mercado Pago Point Smart 2: precio de lista MXN actual (IVA incluido o no), e indica si hay también un "Point Smart" anterior con otro precio. NOTA: una cotización interna de mayo 2026 lo ubicó en $2,499–$2,999, pero otra fuente lo ubica en ~$4,499 — RESUELVE cuál es el precio de lista oficial vigente y cítalo.
- Mercado Pago Point Air (lector móvil): precio MXN actual.
- Comisión por transacción tarjeta presencial (Point): CONFIRMA si es 3.5% plano SIN cargo fijo (corrige la cifra errónea "3.49% + $4"). Indica si la comisión es + IVA.
- Tiempo de liquidación (dinero disponible): inmediata / al instante / D+0 vs plazos opcionales.
- MP Point Tap / Tap to Pay: ¿la tablet/celular Android del operador funciona como lector contactless sin terminal adicional? Requisitos (Android mínimo, NFC HCE). ¿Comisión igual a Point?
- Split de pagos / dispersión: ¿Mercado Pago ofrece split nativo (marketplace/Connect-equivalente) o se requiere dispersión vía SPEI/STP?
- Integración: Orders API, webhooks, SDK Point Tap, esfuerzo de desarrollo, riesgos (agregador, embebible vs app-switch).
Devuelve data_points con valor + confianza + source_url real para CADA dato. Marca por_confirmar lo que no puedas confirmar en fuente autorizada.`,
  },
  {
    key: 'tablets-ac',
    label: 'Tablets económica + enterprise',
    prompt: `Verifica con WebSearch + WebFetch los datos VIGENTES en MÉXICO 2026 para DOS tablets rugged Android con NFC, usadas para Tap to Pay (MP Point Tap):
1) Oukitel RT3 Plus (opción económica)
2) Samsung Galaxy Tab Active5 (opción enterprise)
Para cada una confirma: precio retail MXN actual en MX (Amazon MX / Mercado Libre / distribuidor; indica IVA incluido), NFC (HCE) sí/no, soporte de bandas LTE de México (B2/B4/B5/B7/B28 etc.), WiFi, RAM/almacenamiento, batería (mAh), resistencia (IP rating + MIL-STD-810H), versión de Android, y si cumple requisito de MP Point Tap (Android >=11 + NFC HCE). Justifica brevemente uso en piso de museo.
Devuelve data_points con valor + confianza + source_url real por cada dato clave (precio y NFC/LTE son críticos).`,
  },
  {
    key: 'tablet-b',
    label: 'Tablet intermedia (recomendada)',
    prompt: `Encuentra y verifica (WebSearch + WebFetch, MÉXICO 2026) la MEJOR tablet rugged Android INTERMEDIA para usarse como Tap to Pay (MP Point Tap) en piso de museo, con precio ENTRE ~$4,200 MXN (Oukitel RT3 Plus) y ~$10,500 MXN (Samsung Galaxy Tab Active5). REQUISITOS DUROS: NFC con HCE, Android >=11, soporte de bandas LTE de México, WiFi, batería robusta, resistencia (IP + idealmente MIL-STD-810H). EXCLUYE la Blackview Active 5 (no recomendada). Candidatas a evaluar: Samsung Galaxy Tab Active3, Ulefone Armor Pad 3 / Armor Pad 3 Pro, Oukitel RT7 / RT5, u otra con disponibilidad real en MX. Elige UNA como recomendada y da: modelo exacto, precio retail MXN vigente (con IVA), NFC/LTE/RAM/almacenamiento/batería/IP-MIL/Android, compatibilidad confirmada con Tap to Pay, y por qué es el punto medio ideal (marca/soporte/durabilidad vs precio) para MUNET. Si ninguna candidata tiene NFC+LTE confirmados en MX, dilo explícitamente y propone la mejor alternativa disponible.
Devuelve data_points con source_url real por dato. El precio y la presencia de NFC son críticos: si no los confirmas en fuente, márcalos por_confirmar.`,
  },
  {
    key: 'clip',
    label: 'Clip',
    prompt: `Verifica con WebSearch + WebFetch (fuente oficial clip.mx + developer.clip.mx) los datos VIGENTES en MÉXICO 2026 para Clip como alternativa de POS:
- Modelos de lector/terminal (Clip Plus, Clip Pro, Clip Total, PinPad) y su precio MXN actual.
- Comisión por transacción tarjeta presencial (confirma % plano y si hay cargo fijo; reporta también comisión por terminal vs por link).
- Tiempo de liquidación (depósito): plazo estándar y opción de depósito inmediato/anticipado (costo).
- Soporte de split de pagos / dispersión: ¿nativo o vía SPEI/STP?
- Hardware requerido y si el flujo presencial usa la app Clip (app-switch) o SDK embebible.
- Integración: API, webhooks, SDK, esfuerzo de desarrollo, riesgos. ¿Es agregador?
- Idoneidad para MUNET (boletos de bajo monto $40-50, museo).
Devuelve data_points con valor + confianza + source_url real por dato. Marca por_confirmar lo no verificable.`,
  },
  {
    key: 'stripe-stp',
    label: 'Stripe + STP',
    prompt: `Verifica con WebSearch + WebFetch (stripe.com/mx + stripe.com/docs + stp.mx) los datos VIGENTES en MÉXICO 2026:
STRIPE:
- Comisión por tarjeta en línea en MX (confirma 3.6% + $3 MXN, o la cifra vigente). Indica si + IVA.
- Métodos: OXXO y SPEI vía Stripe (comisiones de cada uno) — soporte para cobro en línea.
- Stripe Connect para split de pagos (marketplace): ¿disponible en MX? comisión de Connect.
- Stripe Terminal (POS presencial / lectores físicos): CONFIRMA que NO opera en México (no disponible) y cita la fuente.
- Tiempo de liquidación (payout) en MX.
STP (Sistema de Transferencias y Pagos):
- Costo por transferencia SPEI de dispersión (confirma rango $0.50–$2.00 MXN por transferencia, o cifra vigente).
- Caso de uso: dispersión SPEI a cuentas del Fideicomiso/terceros.
Devuelve data_points con valor + confianza + source_url real por dato. Marca por_confirmar lo no verificable.`,
  },
]

phase('Verify')
const results = await pipeline(
  DOMAINS,
  (d) =>
    agent(
      `Eres analista de pagos/hardware verificando datos para una propuesta de cliente (museo MUNET, México). NO inventes cifras: cada dato debe venir de una búsqueda web con URL real y fecha. Si un dato no se confirma en fuente autorizada, márcalo confianza=por_confirmar.\n\nDOMINIO: ${d.label}\n\n${d.prompt}`,
      { label: `verify:${d.key}`, phase: 'Verify', agentType: 'research', schema: DOMAIN_SCHEMA },
    ),
  (verified, d) => {
    if (!verified) return { domain: d.key, label: d.label, data: null, skeptic: null }
    return agent(
      `Eres un escéptico de control de calidad. Re-verifica de forma INDEPENDIENTE (WebSearch + WebFetch, fuentes distintas a las ya citadas cuando sea posible) los 3-4 datos MÁS críticos para la decisión del dominio "${d.label}" en MÉXICO 2026. Datos críticos típicos: comisión %, precio de equipo/terminal, tiempo de liquidación, y disponibilidad (p.ej. Stripe Terminal en MX, NFC/LTE en la tablet).\n\nDatos reportados a auditar (JSON):\n${JSON.stringify(verified.data_points || [], null, 2)}\n\nPara cada dato auditado: confirmado / ajustado (da corrected_value) / refutado / por_confirmar, con source_url real y comentario corto. Sé agresivo: si una cifra no se sostiene en fuente autorizada, NO la confirmes.`,
      { label: `skeptic:${d.key}`, phase: 'Cross-check', agentType: 'research', schema: SKEPTIC_SCHEMA },
    ).then((skeptic) => ({ domain: d.key, label: d.label, data: verified, skeptic }))
  },
)

return { results: results.filter(Boolean) }
