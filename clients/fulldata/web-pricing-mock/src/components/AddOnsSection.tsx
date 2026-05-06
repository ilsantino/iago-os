import { motion } from "framer-motion";
import { ADDONS } from "../data/pricing";

export const AddOnsSection = () => (
  <section
    aria-label="Add-ons modulares"
    className="relative -mx-6 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 px-6 py-12 md:-mx-0 md:px-10 md:py-14"
  >
    <div
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-brand-light/10 blur-2xl"
    />
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 bottom-0 h-48 w-48 rounded-full bg-brand-primary/5 blur-2xl"
    />
    <div className="relative mx-auto flex max-w-6xl flex-col gap-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-brand-light/40 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary">
          Roadmap modular
        </span>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-800">
          Cuando tu operación necesita más
        </h2>
        <p className="max-w-2xl text-sm text-slate-600">
          Add-ons opcionales para casos específicos. Ninguno está en producción
          aún &mdash; se priorizan con producto antes de comercializarse.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ADDONS.map((addon, index) => (
          <motion.article
            key={addon.id}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ delay: index * 0.05, duration: 0.4, ease: "easeOut" }}
            className="relative flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 opacity-90 transition-opacity hover:opacity-100"
          >
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-brand-light/40 bg-brand-light/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-brand-primary">
              Pr&oacute;ximamente
            </span>
            <h3 className="pr-24 text-sm font-semibold text-slate-800 leading-tight">
              {addon.nombre}
            </h3>
            <p className="text-base font-semibold tracking-tight text-brand-primary tabular-nums">
              {addon.precio}
            </p>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {addon.segmento}
            </p>
          </motion.article>
        ))}
      </div>
    </div>
  </section>
);
