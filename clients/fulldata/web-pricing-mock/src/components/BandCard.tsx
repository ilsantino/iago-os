import { AnimatePresence, motion } from "framer-motion";
import type { Banda } from "../data/pricing";
import {
	calcAnnual,
	calcAnnualMonthlyEquiv,
	calcSavings,
	formatoMXN,
} from "../data/pricing";
import type { BillingMode } from "./BillingToggle";

type Props = {
	banda: Banda;
	mode: BillingMode;
	index: number;
};

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

const cardVariants = {
	hidden: { opacity: 0, y: 24 },
	visible: (i: number) => ({
		opacity: 1,
		y: 0,
		transition: {
			delay: i * 0.06,
			duration: 0.55,
			ease: EASE_OUT_EXPO,
		},
	}),
};

const bandNumber = (i: number) =>
	`0${i + 1}`.slice(-2);

export const BandCard = ({ banda, mode, index }: Props) => {
	const renderPrice = () => {
		const monthly = banda.precioMensual as number;
		const annualTotal = calcAnnual(monthly);
		const annualEquivMonthly = calcAnnualMonthlyEquiv(monthly);
		const annualLista = monthly * 12;
		const savings = calcSavings(monthly);

		if (mode === "monthly") {
			return (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-baseline gap-1">
						<span className="text-xl text-slate-400 transition-colors duration-500 group-hover:text-brand-primary">
							$
						</span>
						<span className="text-5xl font-semibold tracking-tight leading-none text-slate-900 tabular-nums transition-colors duration-500 group-hover:text-brand-primary">
							{formatoMXN(monthly)}
						</span>
					</div>
					<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
						MXN / mes
					</span>
				</div>
			);
		}

		return (
			<div className="flex flex-col gap-1.5">
				<span className="text-[10px] text-slate-400 line-through tabular-nums">
					${formatoMXN(annualLista)} MXN lista
				</span>
				<div className="flex items-baseline gap-1">
					<span className="text-xl text-slate-400 transition-colors duration-500 group-hover:text-brand-primary">
						$
					</span>
					<span className="text-5xl font-semibold tracking-tight leading-none text-slate-900 tabular-nums transition-colors duration-500 group-hover:text-brand-primary">
						{formatoMXN(annualTotal)}
					</span>
				</div>
				<span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
					MXN / a&ntilde;o · ${formatoMXN(annualEquivMonthly)}/mes equiv
				</span>
				<span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-brand-primary/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-brand-primary">
					<span aria-hidden>&#9889;</span>
					Ahorras ${formatoMXN(savings)} MXN/a&ntilde;o
				</span>
			</div>
		);
	};

	return (
		<motion.article
			custom={index}
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true, margin: "-10%" }}
			variants={cardVariants}
			whileHover={{ y: -8, scale: 1.02 }}
			transition={{ type: "spring", stiffness: 380, damping: 24 }}
			className="group relative flex flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-white via-white to-brand-primary/[0.04] p-5 md:p-6 ring-1 ring-slate-200/80 shadow-[0_4px_12px_-2px_rgba(15,23,42,0.06),0_2px_4px_-2px_rgba(216,96,48,0.04)] transition-shadow duration-500 hover:ring-2 hover:ring-brand-primary hover:shadow-[0_20px_45px_-12px_rgba(216,96,48,0.35),0_8px_18px_-8px_rgba(216,96,48,0.2)]"
		>
			{/* Always-visible top accent bar — fades from 50% baseline to 100% on hover */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand-primary via-brand-light to-brand-primary opacity-50 transition-opacity duration-500 group-hover:opacity-100"
			/>

			{/* Number badge in top-right corner */}
			<span
				aria-hidden
				className="pointer-events-none absolute right-4 top-3 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-primary/30 transition-colors duration-500 group-hover:text-brand-primary"
			>
				{bandNumber(index)}
			</span>

			{/* Glow blob — subtle baseline, intensifies on hover */}
			<div
				aria-hidden
				className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand-primary/[0.06] blur-3xl transition-all duration-700 group-hover:bg-brand-primary/30 group-hover:scale-110"
			/>

			{/* Subtle gradient overlay — fades in extra warmth on hover */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-primary/0 via-transparent to-brand-light/0 opacity-0 transition-opacity duration-700 group-hover:from-brand-primary/[0.05] group-hover:to-brand-light/[0.04] group-hover:opacity-100"
			/>

			<header className="relative mb-4 flex flex-col gap-0.5">
				<h3 className="text-lg font-semibold tracking-tight text-slate-900 transition-colors duration-500 group-hover:text-brand-primary">
					{banda.nombre}
				</h3>
				<p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
					{banda.rangoUnidades}
				</p>
			</header>

			<div className="relative mb-4 min-h-[6.5rem]">
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={`${mode}-${banda.id}`}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -8 }}
						transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
					>
						{renderPrice()}
					</motion.div>
				</AnimatePresence>
			</div>

			{banda.precioPorUnidad !== null && (
				<p className="relative mb-5 text-[10px] text-slate-400 tabular-nums">
					~${formatoMXN(banda.precioPorUnidad)} MXN / unidad / mes
				</p>
			)}

			<motion.button
				type="button"
				whileTap={{ scale: 0.97 }}
				transition={{ type: "spring", stiffness: 400, damping: 28 }}
				className="relative mt-auto overflow-hidden rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-xs md:text-sm font-semibold text-slate-800 transition-all duration-500 group-hover:border-brand-primary group-hover:bg-brand-primary group-hover:text-white group-hover:shadow-[0_6px_16px_-4px_rgba(216,96,48,0.5)]"
			>
				<span className="relative z-10">Comenzar 1 mes gratis</span>
			</motion.button>
		</motion.article>
	);
};
