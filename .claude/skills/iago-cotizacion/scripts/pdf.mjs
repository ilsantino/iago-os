// Print a built cotización to PDF (Letter, Señal print sheet, folio in the footer, page cap).
//
//   cd .claude/skills/iago-cotizacion/scripts && npm i          # once: playwright + chromium
//   node scripts/pdf.mjs --src fuente/cotizacion.html --out 20261016-rsf-cotizacion-consultoria.pdf \
//        --footer "iaGO × Red Sun Farms · COT-RSF-002-2026 · consultoría de costos y rentabilidad" --max 3
//
// Exits 1 over --max pages. The fix for an overflow is less text, not smaller type.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith("--")) a.push([v.slice(2), arr[i + 1]]); return a; }, []));
const src = resolve(args.src), out = resolve(args.out), MAX = Number(args.max || 3);
const footer = args.footer || "iaGO";

const PRINT = `
@page { size: Letter; margin: 18mm 17mm 20mm 17mm; }
:root { --maxw:100% !important; --wide:100% !important; }
html, body { background:#FFFFFF !important; }
body { font-size:10.2pt !important; line-height:1.55 !important; }
.wrap { max-width:none !important; padding:0 !important; margin:0 !important }
.col, p, ul.bul, .lede, .accept { max-width:none !important }
header.top { padding-top:0 !important }
.brandrow { margin-bottom:18px !important }
.lockup { width:46mm !important }
.brandmeta { font-size:7.6pt !important }
h1 { font-size:25pt !important; line-height:1.08 !important }
.lede { font-size:12pt !important; max-width:150mm !important }
h2 .claim { font-size:15.5pt !important }
.eb { font-size:7.4pt !important }
table { font-size:8.6pt !important }
th { font-size:6.9pt !important }
td.mono { font-size:7.8pt !important }
table.kv td.mono, table.kv th { font-size:8.6pt !important }
table.amounts tr.total td strong { font-size:10.5pt !important }
hr.rule { margin-bottom:18px !important }
section { margin-bottom:14px !important; padding-bottom:0 !important }
section + section { padding-top:14px !important }
tr, ul.bul > li, .accept { break-inside:avoid }
.accept { margin-top:18px !important }
.accept p { margin-top:20px !important }
h1, h2 { break-after:avoid; break-inside:avoid }
td, th { padding-top:5px !important; padding-bottom:5px !important }
h2 { margin-bottom:.35em !important }
.tw { overflow:visible !important }
a { color:inherit !important; text-decoration:none !important }
`;
const FOOT = `font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:7pt;color:#525E58;
width:100%;padding:0 17mm;display:flex;justify-content:space-between;-webkit-print-color-adjust:exact;`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;

const b = await chromium.launch();
const c = await b.newContext({ colorScheme: "light", deviceScaleFactor: 2 });
const p = await c.newPage();
await p.goto("file:///" + src.replace(/\\/g, "/"), { waitUntil: "networkidle", timeout: 120000 });
await p.emulateMedia({ media: "print", colorScheme: "light" });
await p.addStyleTag({ content: PRINT });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);
const loaded = await p.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`));
await p.pdf({
  path: out, format: "Letter", printBackground: true, displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: `<div style="${FOOT}"><span>${esc(footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  margin: { top: "18mm", right: "17mm", bottom: "20mm", left: "17mm" },
});
const n = pages(readFileSync(out));
console.log(`fonts: ${[...new Set(loaded)].join(", ") || "NONE (fallbacks used)"}`);
console.log(`${n > MAX ? "FAIL" : "ok "}  ${out}  ${n} pages (max ${MAX})`);
await b.close();
process.exit(n > MAX ? 1 : 0);
