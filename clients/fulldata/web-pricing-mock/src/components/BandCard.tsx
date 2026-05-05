import { AnimatePresence, motion } from "framer-motion";
import type { Banda } from "../data/pricing";
import { formatoMXN } from "../data/pricing";
import type { BillingMode } from "./BillingToggle";

type Props = {
  banda: Banda;
  mode: BillingMode;
};

const featuresIncluded = [
  "CFDI 4.0 ilimitado",
  "Carta Porte 3.1 ilimitada",
  "GPS por unidad",
  "Cobranza + DSO real",
  "Usuarios ilimitados",
  "Soporte ilimitado",
];

export const BandCard = ({ banda, mode }: Props) => {
  const isCustom = banda.precioMensual === null;
  const isRecomendado = !!banda.recomendado;

  const baseScale = isRecomendado ? 1.03 : 1;
  const hoverY = isCustom ? -4 : -8;

  const renderPrice = () => {
    if (isCustom) {
      return (
        <div className="flex flex-col gap-1">
          <span className="text-3xl font-semibold text-slate-800">
            Habla con ventas
          </span>
          <span className="text-sm text-slate-600">
            Cotizaci&oacute;n personalizada por flota.
          </span>
        </div>
      );
    }

    const monthly = banda.precioMensual as number;
    const annualTotal = Math.round(monthly * 12 * 0.88);
    const annualEquivMonthly = Math.round(monthly * 0.88);

    if (mode === "monthly") {
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl text-slate-600">$</span>
            <span className="text-5xl font-semibold tracking-tight text-slate-800 tabular-nums">
              {formatoMXN(monthly)}
            </span>
          </div>
          <span className="text-sm text-slate-600">MXN / mes</span>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl text-slate-600">$</span>
          <span className="text-5xl font-semibold tracking-tight text-slate-800 tabular-nums">
            {formatoMXN(annualTotal)}
          </span>
        </div>
        <span className="text-sm text-slate-600">MXN / a&ntilde;o</span>
        <span className="text-xs text-slate-400">
          (${formatoMXN(annualEquivMonthly)} MXN/mes equivalente)
        </span>
      </div>
    );
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, scale: baseScale }}
      whileHover={
        isCustom
          ? { y: hoverY }
          : { y: hoverY, scale: baseScale * 1.02 }
      }
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-lg ${
        isRecomendado
          ? "border-transparent ring-2 ring-brand-primary"
          : "border-slate-200"
      }`}
    >
      {isRecomendado && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-brand-primary px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow">
          <span aria-hidden>&#9733;</span> Recomendado
        </span>
      )}

      <header className="mb-5 flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-lg font-semibold text-slate-800">
            {banda.nombre}
          </h3>
          {banda.subtitle && (
            <span className="text-xs font-medium uppercase tracking-wide text-brand-primary">
              {banda.subtitle}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-600">{banda.rangoUnidades}</p>
      </header>

      <div className="mb-6 min-h-[7rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${mode}-${banda.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
          >
            {renderPrice()}
          </motion.div>
        </AnimatePresence>
      </div>

      <ul className="mb-6 flex flex-col gap-2 text-sm text-slate-600">
        {featuresIncluded.map((feat) => (
          <li key={feat} className="flex items-start gap-2">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary"
            >
              &#10003;
            </span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={`mt-auto rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
          isRecomendado || banda.ctaCustom
            ? "bg-brand-primary text-white hover:bg-brand-light"
            : "border border-slate-200 text-slate-800 hover:border-brand-primary hover:text-brand-primary"
        }`}
      >
        {banda.ctaCustom ? "Agendar llamada" : "Comenzar"}
      </button>
    </motion.article>
  );
};
