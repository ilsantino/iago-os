const TRUST = [
  "PAC autorizado SAT",
  "CFDI 4.0 + Carta Porte 3.1",
  "Anexo 30 hidrocarburos",
  "App iOS + Android para operadores",
] as const;

export const Footer = () => (
  <footer className="border-t border-slate-200 pt-10">
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-wider text-slate-500">
        {TRUST.map((t, i) => (
          <span key={t} className="inline-flex items-center gap-2">
            <span aria-hidden className="text-brand-primary">
              &#9679;
            </span>
            <span className="font-semibold">{t}</span>
            {i < TRUST.length - 1 && (
              <span aria-hidden className="hidden sm:inline text-slate-300">
                |
              </span>
            )}
          </span>
        ))}
      </div>

      <p className="max-w-2xl text-sm text-slate-700">
        <span className="font-semibold text-brand-primary">1 mes gratis</span>{" "}
        al activarse. La revenue empieza desde el segundo mes natural — sin
        cargo retroactivo.
      </p>

      <p className="text-xs text-slate-400">
        &copy; FullData &middot; Demo de pricing &middot; Modelo Phase 4 (v1.1)
      </p>
    </div>
  </footer>
);
