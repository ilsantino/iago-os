import { motion } from "framer-motion";

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
          className={`relative z-10 px-6 py-2 text-sm font-medium rounded-full transition-colors min-w-[8rem] ${
            isAnnual ? "text-white" : "text-slate-600 hover:text-slate-800"
          }`}
        >
          Anual
        </button>
      </div>
      <p className="text-xs text-slate-600">
        {isAnnual ? (
          <>
            <span className="font-semibold text-brand-primary">12% off</span>{" "}
            sobre precio lista &middot; pago anual upfront
          </>
        ) : (
          <>1 mes gratis al activarse &middot; revenue desde el segundo mes</>
        )}
      </p>
    </div>
  );
};
