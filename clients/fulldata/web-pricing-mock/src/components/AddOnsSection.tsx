import { motion } from "framer-motion";
import { ADDONS } from "../data/pricing";

export const AddOnsSection = () => (
  <section aria-label="Add-ons modulares" className="w-full">
    <div className="mb-8 flex flex-col items-center text-center gap-3">
      <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-800">
        Add-ons modulares
      </h2>
      <p className="max-w-2xl text-base text-slate-600">
        Roadmap modular &mdash; desarrollo pendiente. Estos m&oacute;dulos no
        est&aacute;n en producci&oacute;n a&uacute;n; se priorizan con el
        equipo de producto antes de comercializarse.
      </p>
    </div>

    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {ADDONS.map((addon, index) => (
        <motion.article
          key={addon.id}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 0.7, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ delay: index * 0.08, duration: 0.45, ease: "easeOut" }}
          className="relative flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6"
        >
          <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border border-brand-light/40 bg-brand-light/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-primary">
            Pr&oacute;ximamente &mdash; en desarrollo
          </span>
          <h3 className="pr-32 text-lg font-semibold text-slate-800">
            {addon.nombre}
          </h3>
          <p className="text-2xl font-semibold tracking-tight text-slate-800 tabular-nums">
            {addon.precio}
          </p>
          <p className="text-sm leading-relaxed text-slate-600">
            <span className="font-medium text-slate-800">Segmento:</span>{" "}
            {addon.segmento}
          </p>
        </motion.article>
      ))}
    </div>
  </section>
);
