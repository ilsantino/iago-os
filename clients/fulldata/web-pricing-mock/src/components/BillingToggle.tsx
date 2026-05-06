import { AnimatePresence, motion } from "framer-motion";

export type BillingMode = "monthly" | "annual";

type Props = {
  mode: BillingMode;
  onChange: (mode: BillingMode) => void;
};

export const BillingToggle = ({ mode, onChange }: Props) => {
  const isAnnual = mode === "annual";

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="tablist"
        aria-label="Modalidad de cobro"
        className="relative inline-flex items-center rounded-full border border-slate-200 bg-white p-1 shadow-sm"
      >
        <motion.span
          aria-hidden
          className="absolute top-1 bottom-1 left-1 rounded-full bg-brand-primary shadow-sm"
          initial={false}
          animate={{ x: isAnnual ? "100%" : "0%" }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          style={{ width: "calc(50% - 0.25rem)" }}
        />
        <button
          type="button"
          role="tab"
          aria-selected={!isAnnual}
          onClick={() => onChange("monthly")}
          className={`relative z-10 px-6 py-2 text-sm font-medium rounded-full transition-colors min-w-[8rem] ${
            !isAnnual ? "text-white" : "text-slate-600 hover:text-slate-800"
          }`}
        >
          Mensual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isAnnual}
          onClick={() => onChange("annual")}
          className={`relative z-10 inline-flex items-center gap-2 px-6 py-2 text-sm font-medium rounded-full transition-colors min-w-[8rem] ${
            isAnnual ? "text-white" : "text-slate-600 hover:text-slate-800"
          }`}
        >
          <span>Anual</span>
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              isAnnual
                ? "bg-white/20 text-white"
                : "bg-brand-primary/15 text-brand-primary"
            }`}
          >
            -12%
          </span>
        </button>
      </div>

      <div className="min-h-[1.25rem]">
        <AnimatePresence mode="wait" initial={false}>
          {isAnnual ? (
            <motion.p
              key="annual"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="text-xs text-slate-700"
            >
              Pago anual upfront ·{" "}
              <span className="font-semibold text-brand-primary">
                ahorra hasta $50,393 MXN/año
              </span>
            </motion.p>
          ) : (
            <motion.p
              key="monthly"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="text-xs text-slate-700"
            >
              <span className="font-semibold text-brand-primary">
                1 mes gratis
              </span>{" "}
              · facturación mensual flexible
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
