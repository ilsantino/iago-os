import { useState } from "react";
import { AddOnsSection } from "./AddOnsSection";
import { AYCEBanner } from "./AYCEBanner";
import { BandsGrid } from "./BandsGrid";
import type { BillingMode } from "./BillingToggle";
import { BillingToggle } from "./BillingToggle";
import { CustomCard } from "./CustomCard";
import { FAQSection } from "./FAQSection";
import { FinalCTA } from "./FinalCTA";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { LeversBanner } from "./LeversBanner";
import { PainAnchoring } from "./PainAnchoring";
import { RiskReversalBanner } from "./RiskReversalBanner";

export const PricingPage = () => {
	const [mode, setMode] = useState<BillingMode>("monthly");

	return (
		<main className="mx-auto flex max-w-7xl flex-col gap-12 px-6 py-12 md:gap-14 md:py-16">
			<Hero />
			<AYCEBanner />
			<PainAnchoring />
			<RiskReversalBanner />
			<div className="flex justify-center">
				<BillingToggle mode={mode} onChange={setMode} />
			</div>
			<BandsGrid mode={mode} />
			<LeversBanner />
			<CustomCard />
			<AddOnsSection />
			<FAQSection />
			<FinalCTA />
			<Footer />
		</main>
	);
};
