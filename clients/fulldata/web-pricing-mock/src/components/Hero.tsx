import { motion } from "framer-motion";

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.15, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 260, damping: 24 },
  },
};

export const Hero = () => (
  <motion.div
    initial="hidden"
    animate="show"
    variants={containerVariants}
    className="flex flex-col items-center text-center gap-6"
  >
    <motion.img
      variants={itemVariants}
      src="/logo.png"
      alt="FullData"
      className="h-12 w-auto"
    />
    <motion.h1
      variants={itemVariants}
      className="text-4xl md:text-5xl font-semibold tracking-tight text-slate-800"
    >
      Precios <span className="text-brand-primary">FullData</span>
    </motion.h1>
    <motion.p
      variants={itemVariants}
      className="max-w-2xl text-lg md:text-xl text-slate-600 leading-relaxed"
    >
      All-You-Can-Eat por banda. Un precio mensual, todo incluido. Sin cobro por
      timbre, sin cobro por usuario adicional, sin sorpresas en la factura.
    </motion.p>
    <motion.div
      variants={itemVariants}
      className="inline-flex items-center gap-2 rounded-full border border-brand-light/40 bg-brand-light/10 px-4 py-1.5 text-sm font-medium text-brand-primary"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-primary" />
      Founding members &mdash; precio congelado los primeros 18 meses
    </motion.div>
  </motion.div>
);
