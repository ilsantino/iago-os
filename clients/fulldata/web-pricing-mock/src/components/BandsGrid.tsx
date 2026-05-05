import { BANDAS } from "../data/pricing";
import { BandCard } from "./BandCard";
import type { BillingMode } from "./BillingToggle";

type Props = {
  mode: BillingMode;
};

export const BandsGrid = ({ mode }: Props) => (
  <section aria-label="Bandas de precio" className="w-full">
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
      {BANDAS.map((banda) => (
        <BandCard key={banda.id} banda={banda} mode={mode} />
      ))}
    </div>
  </section>
);
