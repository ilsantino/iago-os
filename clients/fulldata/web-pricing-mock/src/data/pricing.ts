export type Banda = {
	id: string;
	nombre: string;
	subtitle?: string;
	rangoUnidades: string;
	precioMensual: number | null;
	/** Midpoint $/unidad/mes for context — not displayed as primary price. */
	precioPorUnidad: number | null;
	/** Plain-language ROI hint per band (psychology: specificity beats vagueness). */
	roiHint?: string;
	ctaCustom?: boolean;
	recomendado?: boolean;
};

export const BANDAS: Banda[] = [
	{
		id: "starter",
		nombre: "Starter",
		rangoUnidades: "1 – 5 unidades",
		precioMensual: 1995,
		precioPorUnidad: 665,
	},
	{
		id: "basic",
		nombre: "Basic",
		rangoUnidades: "6 – 12 unidades",
		precioMensual: 4495,
		precioPorUnidad: 499,
	},
	{
		id: "pro",
		nombre: "Pro",
		rangoUnidades: "13 – 25 unidades",
		precioMensual: 8995,
		precioPorUnidad: 474,
	},
	{
		id: "growth",
		nombre: "Growth",
		rangoUnidades: "26 – 45 unidades",
		precioMensual: 14995,
		precioPorUnidad: 422,
	},
	{
		id: "scale",
		nombre: "Scale",
		rangoUnidades: "46 – 75 unidades",
		precioMensual: 22995,
		precioPorUnidad: 380,
	},
	{
		id: "fleet",
		nombre: "Fleet",
		rangoUnidades: "76 – 110 unidades",
		precioMensual: 34995,
		precioPorUnidad: 376,
	},
	{
		id: "custom",
		nombre: "Custom",
		rangoUnidades: "111+ unidades",
		precioMensual: null,
		precioPorUnidad: null,
		ctaCustom: true,
	},
];

/** Annual = monthly * 12 * 0.88 (12% off). Savings = monthly * 12 * 0.12. */
export const calcSavings = (monthly: number): number =>
	Math.round(monthly * 12 * 0.12);
export const calcAnnual = (monthly: number): number =>
	Math.round(monthly * 12 * 0.88);
export const calcAnnualMonthlyEquiv = (monthly: number): number =>
	Math.round(monthly * 0.88);

export type AyceGroup = {
	id: string;
	title: string;
	items: readonly string[];
};

export const AYCE_GROUPS: readonly AyceGroup[] = [
	{
		id: "facturacion",
		title: "Facturación SAT",
		items: [
			"CFDI 4.0 ilimitado",
			"Carta Porte 3.1 ilimitada",
			"Complementos de pago PPD",
			"Notas de crédito y cancelaciones",
			"Plantillas de documentos",
		],
	},
	{
		id: "operacion",
		title: "Operación diaria",
		items: [
			"Mapa GPS en tiempo real",
			"App móvil para operadores",
			"Botón SOS para choferes",
			"Cotizador de viaje por ruta",
			"Sábana de control consolidada",
		],
	},
	{
		id: "activos",
		title: "Activos y compliance",
		items: [
			"Catálogo de unidades, remolques y choferes",
			"Alertas de pólizas y permisos por vencer",
			"Multi-empresa (varios RFC emisores)",
			"Evidencia de entrega digital",
		],
	},
	{
		id: "cobranza",
		title: "Cobranza inteligente",
		items: [
			"Días de cobro por cada pagador",
			"Saldos vivos y antigüedad automática",
			"Concentración de cartera por cliente",
			"Reconciliación viaje + factura + pago",
		],
	},
] as const;

export type AddOn = {
	id: string;
	nombre: string;
	precio: string;
	segmento: string;
};

export const ADDONS: AddOn[] = [
	{
		id: "anexo30",
		nombre: "Anexo 30 (Controles Volumétricos)",
		precio: "+$1,500 MXN/mes",
		segmento: "Hidrocarburos / hazmat — compliance obligatorio",
	},
	{
		id: "api",
		nombre: "API / Webhooks",
		precio: "+$2,000 MXN/mes",
		segmento: "Integradores, VARs, ERP existente",
	},
	{
		id: "multi-rfc",
		nombre: "Multi-empresa adicional",
		precio: "+$800 MXN / RFC extra",
		segmento: "Holdings y grupos con varias razones sociales",
	},
	{
		id: "nomina",
		nombre: "Nómina y dispersión a operadores",
		precio: "+$1,200 MXN/mes",
		segmento: "Flotas con >5 operadores fijos",
	},
	{
		id: "bi",
		nombre: "Inteligencia de datos (BI)",
		precio: "+$1,500 MXN/mes",
		segmento: "Pro+ con CFO o controller",
	},
	{
		id: "gastos",
		nombre: "Gastos por viaje",
		precio: "+$900 MXN/mes",
		segmento: "Combustible, casetas, peajes, viáticos — margen real por ruta",
	},
	{
		id: "mantenimiento",
		nombre: "Mantenimiento preventivo",
		precio: "+$1,100 MXN/mes",
		segmento: "Kilometraje, servicios, refacciones, llantas",
	},
	{
		id: "open-banking",
		nombre: "Conciliación bancaria automática",
		precio: "+$1,800 MXN/mes",
		segmento: "Open Banking / STP — flujo real vs facturado",
	},
];

export const formatoMXN = (n: number): string =>
	new Intl.NumberFormat("es-MX").format(n);
