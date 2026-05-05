import { useState } from "react";
import { AddOnsSection } from "./AddOnsSection";
import { BandsGrid } from "./BandsGrid";
import type { BillingMode } from "./BillingToggle";
import { BillingToggle } from "./BillingToggle";
import { Footer } from "./Footer";
import { Hero } from "./Hero";

export const PricingPage = () => {
  const [mode, setMode] = useState<BillingMode>("monthly");

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-16 px-6 py-16">
      <Hero />
      <div className="flex justify-center">
        <BillingToggle mode={mode} onChange={setMode} />
      </div>
      <BandsGrid mode={mode} />
      <AddOnsSection />
      <Footer />
    </main>
  );
};
