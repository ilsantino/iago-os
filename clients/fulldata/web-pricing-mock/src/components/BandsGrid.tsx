import { BANDAS } from "../data/pricing";
import { BandCard } from "./BandCard";
import type { BillingMode } from "./BillingToggle";

type Props = {
	mode: BillingMode;
};

export const BandsGrid = ({ mode }: Props) => {
	const bandasRegulares = BANDAS.filter((b) => !b.ctaCustom);

	return (
		<section
			id="bandas"
			aria-label="Bandas de precio"
			className="w-full scroll-mt-12"
		>
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
				{bandasRegulares.map((banda, index) => (
					<BandCard
						key={banda.id}
						banda={banda}
						mode={mode}
						index={index}
					/>
				))}
			</div>
		</section>
	);
};
