export const meta = {
  name: 'munet-tablet-prices',
  description: 'Cazar el precio NUEVO real (MX, jun-2026) de la tableta más barata viable para MUNET — NFC NO requerido — vía scrapling, con cross-check escéptico',
  phases: [
    { title: 'Precio', detail: 'precio real MX por modelo conocido vía scrapling stealthy_fetch (NFC NO requerido)' },
    { title: 'Descubrir', detail: 'caza abierta de la tableta Android+LTE más barata (rugerizada o consumo+funda)' },
    { title: 'Cross-check', detail: 'escéptico re-verifica los 4 precios más baratos en una 2a fuente (descarta reacond./grey-market)' },
  ],
}

// NFC NO es requisito: con Mercado Pago el cobro lo hace la terminal Point; la tableta solo corre el Panel MUNET.
// Requisito real: Android + LTE de México + batería de turno + durabilidad (rugerizada o consumo + funda). PRIORIDAD = precio NUEVO real más bajo.

const PRICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string' },
    available_mx: { type: 'string', enum: ['sí', 'no', 'limitada'] },
    best_price_mxn: { type: 'number', description: 'precio NUEVO más bajo creíble confirmado, MXN, IVA incl si aplica. 0 si no se confirmó.' },
    case_price_mxn: { type: 'number', description: 'costo de funda rugerizada compatible si la tableta NO es rugerizada; 0 si rugerizada o N/A' },
    price_confidence: { type: 'string', enum: ['alta', 'media', 'baja', 'por_confirmar'] },
    condition: { type: 'string', enum: ['nuevo', 'reacondicionado', 'mixto', 'desconocido'], description: 'el best_price debe ser de unidad NUEVA' },
    prices: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          retailer: { type: 'string' },
          price_mxn: { type: 'string' },
          condition: { type: 'string' },
          in_stock: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['retailer', 'price_mxn', 'url'],
      },
    },
    specs: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lte_mx: { type: 'string', description: 'bandas LTE MX (B2/4/5/7/28) sí/cuáles, o WiFi-only' },
        battery: { type: 'string' },
        rugged: { type: 'string', description: 'IP/MIL o "no rugerizada (requiere funda)"' },
        ram_storage: { type: 'string' },
        screen: { type: 'string' },
        android: { type: 'string' },
        nfc: { type: 'string', description: 'informativo — NO es requisito para MUNET' },
      },
      required: ['lte_mx', 'battery', 'rugged', 'ram_storage', 'screen', 'android'],
    },
    meets_requirements: { type: 'string', description: 'corre Panel MUNET (Android) + LTE MX + batería de turno + durabilidad (rugerizada o con funda) — sí/parcial/no + por qué. NFC NO cuenta.' },
    landed_total_mxn: { type: 'number', description: 'best_price + case_price (costo real para piso de museo). 0 si no se pudo calcular.' },
    notes: { type: 'string' },
  },
  required: ['model', 'available_mx', 'best_price_mxn', 'price_confidence', 'condition', 'prices', 'specs', 'meets_requirements'],
}

const DISCOVERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    angle: { type: 'string' },
    candidates: {
      type: 'array',
      description: 'top 3 más baratas que cumplen, de menor a mayor costo total (tableta + funda si aplica)',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string' },
          best_price_mxn: { type: 'number' },
          case_price_mxn: { type: 'number' },
          landed_total_mxn: { type: 'number' },
          retailer: { type: 'string' },
          url: { type: 'string' },
          condition: { type: 'string', enum: ['nuevo', 'reacondicionado', 'desconocido'] },
          lte_mx: { type: 'string' },
          battery: { type: 'string' },
          rugged: { type: 'string' },
          android: { type: 'string' },
          meets: { type: 'string' },
        },
        required: ['model', 'best_price_mxn', 'landed_total_mxn', 'url', 'condition'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['angle', 'candidates'],
}

const SKEPTIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string' },
    claimed_price_mxn: { type: 'number' },
    verdict: { type: 'string', enum: ['confirmado', 'ajustado', 'refutado', 'por_confirmar'] },
    corrected_price_mxn: { type: 'number', description: 'precio NUEVO real si difiere; 0 si confirma el reportado' },
    second_source_url: { type: 'string' },
    is_new: { type: 'string', description: 'la 2a fuente vende NUEVO sí/no' },
    in_stock: { type: 'string' },
    comment: { type: 'string' },
  },
  required: ['model', 'verdict', 'second_source_url'],
}

const MP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    point_commission_pct: { type: 'string', description: '% plano de comisión Point tarjeta presencial, vigente jun-2026, + si es + IVA' },
    fixed_fee_4: { type: 'string', enum: ['confirmado', 'refutado', 'por_confirmar'], description: '¿existe el cargo fijo de ~$4 por transacción además del %?' },
    fixed_fee_detail: { type: 'string' },
    smart2_price_mxn: { type: 'string', description: 'precio lista y promo Point Smart 2' },
    air_price_mxn: { type: 'string', description: 'precio lista y promo Point Air' },
    sources: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
  required: ['point_commission_pct', 'fixed_fee_4', 'sources'],
}

const FRAME =
  'CONTEXTO MUNET (museo, México): la tableta NO cobra — el cobro lo hace la terminal Mercado Pago Point. Por eso NFC / tap-to-pay NO es requisito. La tableta SOLO necesita: correr el Panel MUNET (web app Android), LTE de México (Telcel/AT&T/Movistar — preferible) + WiFi, batería para un turno completo, y aguante de piso de museo (rugerizada O tableta de consumo + funda rugerizada). PRIORIDAD ABSOLUTA: el precio NUEVO real más bajo en MX. "No podemos perder lana." Si encuentras una tableta MÁS BARATA que cumpla, repórtala — no te cases con la lista.'

const METHOD =
  'MÉTODO OBLIGATORIO: Mercado Libre MX y Amazon MX bloquean el fetch normal (403/500). Carga el schema de scrapling con ToolSearch query "select:mcp__scrapling__stealthy_fetch,mcp__scrapling__bulk_stealthy_fetch" y usa stealthy_fetch sobre listado.mercadolibre.com.mx/<modelo-con-guiones>, la página de producto de Amazon MX, y distribuidores (Cyberpuerta, PCDigital, CompuSales, Coppel, Liverpool, Mercado Libre, Amazon). Si scrapling falla, usa WebFetch/WebSearch de respaldo. El best_price debe ser de unidad NUEVA con AL MENOS 2 fuentes (retailer + URL + ¿en stock?). Ignora reacondicionados/Grado B para el best_price (anótalos aparte). Pon price_confidence=por_confirmar y best_price_mxn=0 si no confirmas precio NUEVO en retailer mexicano.'

const MODELS = [
  { key: 'samsung-a9plus', model: 'Samsung Galaxy Tab A9+ 5G/LTE (SM-X216)', hint: 'consumo BARATA y muy disponible (Coppel/Liverpool/Amazon/ML). NO rugerizada → reporta también el precio de una FUNDA rugerizada compatible (case_price_mxn) y el landed_total.' },
  { key: 'samsung-a9', model: 'Samsung Galaxy Tab A9 LTE (SM-X115, 8.7")', hint: 'aún más barata que la A9+, LTE, consumo. NO rugerizada → funda aparte. Candidata a la más barata del lote.' },
  { key: 'lenovo-tabm', model: 'Lenovo Tab M11 LTE (o Tab M9 LTE si sale más barata)', hint: 'consumo barato, LTE, muy disponible en MX. NO rugerizada → funda aparte. Busca la variante LTE, no WiFi-only.' },
  { key: 'oukitel-rt3plus', model: 'Oukitel RT3 Plus', hint: 'rugerizada 8", LTE, 11000mAh, Android 15. NUEVA en MX. (Opción A actual, base estimado $5,200 SIN confirmar — confírmalo.)' },
  { key: 'ulefone-pad2', model: 'Ulefone Armor Pad 2', hint: 'rugerizada ~11", LTE, batería enorme. Más barata que la 3 Pro. NUEVA en MX.' },
  { key: 'ulefone-pad3pro', model: 'Ulefone Armor Pad 3 Pro', hint: 'rugerizada 10.36", LTE B28, 33280mAh, 8/256, Android 13. (Opción B recomendada actual, base estimado $9,800 SIN confirmar — confírmalo.)' },
  { key: 'oukitel-rtcheap', model: 'Oukitel rugerizada con LTE más barata disponible NUEVA en MX (RT5 / RT6 / RT7 — la que salga más barata)', hint: 'busca el modelo Oukitel rugerizado con LTE y batería grande más barato y disponible NUEVO en MX.' },
  { key: 'samsung-active5', model: 'Samsung Galaxy Tab Active5 5G (SM-X306)', hint: 'enterprise rugerizada 8" (Opción C). Reconfirmar ~$13,803 IVA incl. (CompuSales).' },
]

const DISCOVERY = [
  {
    key: 'rugged-cheapest',
    angle: 'Tableta RUGERIZADA más barata',
    prompt: 'Encuentra la tableta RUGERIZADA Android con LTE de México más BARATA, NUEVA y disponible en MX hoy (jun-2026). Barre marcas chinas de nicho además de las obvias: Blackview (Active/Tab), Oukitel (RT/OT), Ulefone (Armor Pad), Doogee (T/R), Cubot (Tab Kingkong), FOSSiBOT, Hotwav, además de cualquier rugerizada con LTE en Mercado Libre/Amazon/Cyberpuerta. Devuelve las 3 más baratas que cumplan (Android, LTE MX, batería de turno). NFC NO requerido.',
  },
  {
    key: 'consumer-plus-case',
    angle: 'Consumo + funda (costo total más bajo)',
    prompt: 'Encuentra la combinación más BARATA de tableta de CONSUMO Android con LTE de México + FUNDA rugerizada compatible (minimiza el COSTO TOTAL tableta+funda, landed_total). Barre: Samsung Galaxy Tab A9 / A9+, Lenovo Tab M9 / M11 (variantes LTE), Xiaomi Redmi Pad / Pad SE (variante LTE si existe), Honor Pad X, TCL Tab, Nokia T. Para cada una incluye el precio de una funda rugerizada real (con URL). Devuelve las 3 combinaciones de menor costo total que cumplan. NFC NO requerido.',
  },
]

phase('Precio')
const priced = await parallel([
  ...MODELS.map((t) => () =>
    agent(
      `Eres analista de compras verificando el PRECIO NUEVO REAL en MÉXICO (jun-2026) de una tableta para una propuesta de cliente.\n\n${FRAME}\n\nTABLETA: ${t.model}\nNota: ${t.hint}\n\n${METHOD}\n\nDevuelve el schema completo. Calcula landed_total_mxn = best_price + funda (si NO es rugerizada). Evalúa meets_requirements SIN contar NFC.`,
      { label: `precio:${t.key}`, phase: 'Precio', agentType: 'research', schema: PRICE_SCHEMA },
    ),
  ),
  ...DISCOVERY.map((d) => () =>
    agent(
      `Eres analista de compras cazando la opción MÁS BARATA para una propuesta de cliente.\n\n${FRAME}\n\nMISIÓN (${d.angle}): ${d.prompt}\n\n${METHOD}\n\nDevuelve DISCOVERY_SCHEMA: top 3 candidatas de menor costo total (landed_total), cada una con precio NUEVO real, URL real, condición y specs clave (LTE MX, batería, rugged/funda, Android). Ordénalas de más barata a más cara.`,
      { label: `descubrir:${d.key}`, phase: 'Descubrir', agentType: 'research', schema: DISCOVERY_SCHEMA },
    ),
  ),
])

// Barrera justificada: necesito TODOS los precios para rankear cuáles 4 modelos merecen el cross-check escéptico.
const knownPrices = MODELS.map((t, i) => {
  const r = priced[i]
  if (!r) return null
  return { model: r.model || t.model, price: r.best_price_mxn || 0, landed: r.landed_total_mxn || r.best_price_mxn || 0, url: (r.prices && r.prices[0] && r.prices[0].url) || '', conf: r.price_confidence }
}).filter(Boolean)

const discovered = []
for (let i = 0; i < DISCOVERY.length; i++) {
  const r = priced[MODELS.length + i]
  if (r && Array.isArray(r.candidates)) {
    for (const c of r.candidates) {
      discovered.push({ model: c.model, price: c.best_price_mxn || 0, landed: c.landed_total_mxn || c.best_price_mxn || 0, url: c.url || '', conf: 'media' })
    }
  }
}

// Pool combinado, dedup por modelo normalizado, ordenar por costo total (landed) ascendente, descartar 0/sin-precio.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const pool = [...knownPrices, ...discovered].filter((x) => x.landed > 0)
const seen = new Set()
const ranked = []
for (const x of pool.sort((a, b) => a.landed - b.landed)) {
  const k = norm(x.model)
  if (seen.has(k)) continue
  seen.add(k)
  ranked.push(x)
}
const cheapest = ranked.slice(0, 4)

phase('Cross-check')
const skeptics = await parallel([
  ...cheapest.map((c) => () =>
    agent(
      `Eres un escéptico de control de calidad de precios. Re-verifica de forma INDEPENDIENTE, en una SEGUNDA fuente distinta (otro retailer mexicano), el precio NUEVO real en MÉXICO (jun-2026) de:\n\nMODELO: ${c.model}\nPrecio reportado (costo total tableta+funda si aplica): ~$${c.landed} MXN\nFuente original: ${c.url || 's/d'}\n\n${METHOD}\n\nSé agresivo: ¿el precio se sostiene NUEVO y en stock en una 2a fuente? ¿Era reacondicionado/grey-market/sin stock disfrazado? Si difiere, da corrected_price_mxn real. Devuelve SKEPTIC_SCHEMA (claimed_price_mxn = ${c.landed}).`,
      { label: `skeptic:${norm(c.model).slice(0, 16)}`, phase: 'Cross-check', agentType: 'research', schema: SKEPTIC_SCHEMA },
    ),
  ),
  () =>
    agent(
      `Eres analista de pagos verificando datos para la propuesta MUNET (México, jun-2026). Confirma con WebSearch + WebFetch (fuentes: mercadopago.com.mx, vendedores.mercadopago.com.mx/calculadora-comisiones-partners, blogs de socios/contadores):\n- Comisión Mercado Pago Point por tarjeta presencial: ¿es 3.5% plano + IVA, o 3.49% + cargo FIJO de ~$4 por transacción + IVA? RESUELVE cuál es la vigente y por qué (la página de producto vs la calculadora de socios discrepan). Este cargo fijo es decisivo en boletos de $40-50.\n- Precio Point Smart 2 (lista y promo) y Point Air (lista y promo) en MXN, jun-2026.\nDevuelve MP_SCHEMA con fuentes reales (URLs).`,
      { label: 'mp-comision', phase: 'Cross-check', agentType: 'research', schema: MP_SCHEMA },
    ),
])

const mp = skeptics[skeptics.length - 1]
const tabletSkeptics = skeptics.slice(0, cheapest.length).filter(Boolean)

return {
  priced_known: priced.slice(0, MODELS.length).filter(Boolean),
  discovery: priced.slice(MODELS.length).filter(Boolean),
  ranked_by_landed: ranked,
  cheapest_verified: tabletSkeptics,
  mp_commission: mp,
}
