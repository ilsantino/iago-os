import { motion } from "framer-motion";

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 280, damping: 24 },
  },
};

export const Hero = () => (
  <motion.div
    initial="hidden"
    animate="show"
    variants={containerVariants}
    className="flex flex-col items-center text-center gap-5"
  >
    <motion.img
      variants={itemVariants}
      src="/logo.png"
      alt="FullData"
      className="h-10 w-auto md:h-12"
    />
    <motion.h1
      variants={itemVariants}
      className="text-4xl md:text-6xl font-semibold tracking-tight text-slate-800"
    >
      Precios <span className="text-brand-primary">FullData</span>
    </motion.h1>
    <motion.p
      variants={itemVariants}
      className="max-w-xl text-base md:text-lg text-slate-600"
    >
      Un plan por flota. Un precio fijo. Cero sorpresas en la factura.
    </motion.p>

    <motion.div
      variants={itemVariants}
      className="mt-2 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center"
    >
      <a
        href="#bandas"
        className="inline-flex items-center justify-center rounded-xl bg-brand-primary px-6 py-3 text-sm md:text-base font-semibold text-white shadow-md transition-colors hover:bg-brand-light"
      >
        Comenzar 1 mes gratis
      </a>
      <a
        href="#demo"
        className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-6 py-3 text-sm md:text-base font-semibold text-slate-800 transition-colors hover:border-brand-primary hover:text-brand-primary"
      >
        <span aria-hidden>&#9654;</span>
        Agendar demo de 30 min
      </a>
    </motion.div>
  </motion.div>
);
