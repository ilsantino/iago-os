---
name: project_munet_point_air_standalone
description: "MUNET presencial cobro — Point Air is a standalone terminal, not a BT reader; tablets need no tap-to-pay"
metadata: 
  node_type: memory
  type: project
  originSessionId: af118bc2-3bcc-4360-9342-13db5e9ae6ab
---

MUNET cobro presencial con Mercado Pago (verificado web jun-2026, corrige `clients/munet-web/docs/hardware/kit-operativo.md`):

- **Point Air (D20) es una terminal AUTÓNOMA** — pantalla propia, 4G LTE (chip gratis) + WiFi propios, lector NFC integrado. NO es un lector Bluetooth que se empareja/atea a una tableta. Está ligada a la **cuenta** de MP, no a un dispositivo. (kit-operativo.md la describía erróneamente como lector BT a tablet — ese es el viejo Point Mini/Blue.) Precio: lista $2,999 / promo ~$249.
- **Las tabletas del operador NO necesitan ser tap-to-pay / NFC.** Solo corren el Panel MUNET; el cobro lo hace la terminal MP. Esto lo aclaró Santiago directamente.
- **Cobro auto-disparado desde el panel (Orders API «nube a terminal») solo en Point Smart 1/2, NO en Point Air.** Air = captura manual del monto en la terminal. Recomendación iaGO: Point Smart 2 (lista $4,499 / promo ~$549) por la integración; Air como fallback económico.
- **Comisión Point real ≈ 3.49% + $4 fijo + IVA** (al instante; 3.19%+$4 a 14d; 2.95%+$4 a 30d) — la página dice "3.5% sin fijo" pero la calculadora de socios + análisis reportan el fijo de $4, material en boletos bajos. Marcar "por confirmar" en la cuenta.
- Point Tap (cobrar en la propia tableta) tiene límite $3,000/cobro, requiere la app MP (app-switch) y MP lo documenta para "celulares" — soporte en tableta NO confirmado. Irrelevante con Smart 2/Air.

Deliverable generado: `clients/munet-web/docs/client/MUNET-Propuesta-Hardware-Pagos.docx` (3 tabletas A/B/C + MP/Stripe/Clip + nota interna). Generador: `scripts/build-propuesta-hardware-docx.py`. Tabletas verificadas: A Oukitel RT3 Plus (~$5.2k base, por confirmar), B Ulefone Armor Pad 3 Pro (~$9.8k, recomendada), C Samsung Tab Active5 5G ($13,803 confirmado). Relacionado: [[project_munet_openpay_pivot]] (riel online/fideicomiso, distinto de este POS presencial).
