export type Banda = {
  id: string;
  nombre: string;
  subtitle?: string;
  rangoUnidades: string;
  precioMensual: number | null;
  ctaCustom?: boolean;
  recomendado?: boolean;
};

export const BANDAS: Banda[] = [
  {
    id: "starter",
    nombre: "Starter",
    rangoUnidades: "1 – 5 unidades",
    precioMensual: 1995,
  },
  {
    id: "basic",
    nombre: "Basic",
    rangoUnidades: "6 – 12 unidades",
    precioMensual: 4495,
  },
  {
    id: "pro",
    nombre: "Pro",
    subtitle: "ICP",
    rangoUnidades: "13 – 25 unidades",
    precioMensual: 8995,
    recomendado: true,
  },
  {
    id: "growth",
    nombre: "Growth",
    subtitle: "ICP+",
    rangoUnidades: "26 – 45 unidades",
    precioMensual: 14995,
  },
  {
    id: "scale",
    nombre: "Scale",
    rangoUnidades: "46 – 75 unidades",
    precioMensual: 22995,
  },
  {
    id: "fleet",
    nombre: "Fleet",
    rangoUnidades: "76 – 110 unidades",
    precioMensual: 34995,
  },
  {
    id: "custom",
    nombre: "Custom",
    rangoUnidades: "111+ unidades",
    precioMensual: null,
    ctaCustom: true,
  },
];

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
    nombre: "API / webhooks",
    precio: "+$2,000 MXN/mes",
    segmento: "Integradores / VARs / clientes con ERP existente",
  },
  {
    id: "multi-rfc",
    nombre: "Multi-empresa adicional",
    precio: "+$800 MXN / RFC extra",
    segmento: "Holdings, grupos con varias razones sociales",
  },
  {
    id: "nomina",
    nombre: "Nómina / dispersión a operadores",
    precio: "+$1,200 MXN/mes",
    segmento: "Toda banda con >5 operadores fijos",
  },
  {
    id: "bi",
    nombre: "Inteligencia de datos (BI dashboard)",
    precio: "+$1,500 MXN/mes",
    segmento: "Pro+ / Growth+ / Scale (clientes con CFO o controller)",
  },
];

export const formatoMXN = (n: number): string =>
  new Intl.NumberFormat("es-MX").format(n);
