#!/usr/bin/env python3
"""Assemble a cotización from its fragments, in the iaGO Señal brand, with the guards accounting asked for.

    python scripts/build.py --src {fuente}/cotizacion --out {fuente}/cotizacion.html --title "Cotización COT-X-001-2026 · tema"

Fragments are `NN-*.html` in --src, concatenated in name order. `<!--LOCKUP-->` in the header is replaced
by the final horizontal logo of `../assets/` (PNG, data URI). Guards (exit 1, every finding printed):
  - a `{{placeholder}}` or `[corchete]` left in the text (brackets are allowed only inside `<mark>`: the
    fields the client fills in, printed highlighted)
  - no folio `COT-{CLIENTE}-{NNN}-{YYYY}` in the header meta
  - no full issue date «D de mes de AAAA» and no «Vigencia: hasta el D de mes de AAAA»
  - the eyebrow does not name a legal entity (S.A., S. de R.L., S.C., S.A.P.I., LLC, Inc.)
  - an internal code (E-nn, NS-nn, PV-nn, Hnn, Pnn, Tnn, Qnn, Onn)
  - amounts that do not add up: each `tr.sub` = the `tr.line` rows above it since the previous group;
    `tr.total` = the sum of the subs (or of the lines when there are no groups); every «$N MXN» in prose
    is the total, a subtotal or a line
  - a savings claim («ahorr»)
Deterministic: no network, no LLM. Then `node scripts/pdf.mjs` and `python scripts/print_docx.py`.
"""
import argparse
import base64
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"

CSS = """
:root{
  --hueso:#FFFFFF; --obsidiana:#0E1210; --jade:#1B5E4A; --senal:#1A9C5E;
  --piedra:#525E58; --surface:#F7F7F7; --surface-2:#F1F1F1;
  --border:rgba(14,18,16,.12); --border-2:rgba(14,18,16,.07);
  --maxw:720px; --wide:1040px;
}
*{box-sizing:border-box}
html{background:var(--hueso)}
body{margin:0; background:var(--hueso); color:var(--obsidiana);
  font-family:"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size:16px; line-height:1.6; font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility}
.wrap{max-width:var(--wide); margin:0 auto; padding:0 26px 100px}
.col{max-width:var(--maxw)}
h1,h2,h3,.claim{font-family:"Jost", "Futura", "Century Gothic", sans-serif; font-weight:500}
strong,b{font-weight:500}
h1{font-size:clamp(30px,5vw,42px); line-height:1.1; letter-spacing:-.01em; margin:.1em 0 .4em; text-wrap:balance}
h2{margin:0 0 .6em}
h2 .claim{display:block; font-size:clamp(21px,3vw,26px); line-height:1.2; text-wrap:balance}
p{margin:0 0 1em; max-width:var(--maxw)}
.eb{display:block; font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:12px; line-height:1.4;
  font-weight:500; letter-spacing:.12em; text-transform:uppercase; color:var(--jade); margin:0 0 .6em}
header.top{padding:56px 0 0}
.brandrow{display:flex; align-items:flex-end; justify-content:space-between; gap:24px; margin:0 0 44px}
.lockup{width:190px; height:auto; display:block}
.brandmeta{font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:12px; color:var(--piedra);
  letter-spacing:.03em; display:flex; flex-direction:column; align-items:flex-end; gap:2px; text-align:right}
.lede{font-size:19px; line-height:1.5; color:var(--piedra); max-width:620px; margin:0 0 1.2em}
hr.rule{border:0; border-top:1.5px solid var(--obsidiana); margin:0 0 48px}
section{padding:0 0 8px; margin:0 0 44px}
section + section{border-top:1px solid var(--border); padding-top:40px}
ul.bul{list-style:none; padding:0; margin:0 0 8px; max-width:var(--maxw)}
ul.bul li{position:relative; padding:0 0 0 22px; margin:0 0 .9em}
ul.bul li::before{content:""; position:absolute; left:0; top:.66em; width:7px; height:7px; background:var(--jade); border-radius:50%}
.tw{overflow:auto; margin:4px 0 14px}
table{border-collapse:collapse; width:100%; font-size:14px; line-height:1.5}
th{text-align:left; font-family:"IBM Plex Mono", ui-monospace, monospace; font-weight:500; font-size:11px;
  letter-spacing:.1em; text-transform:uppercase; color:var(--piedra); padding:0 12px 8px 0;
  border-bottom:1px solid var(--obsidiana); vertical-align:bottom}
td{padding:9px 12px 9px 0; border-bottom:1px solid var(--border); vertical-align:top}
td:last-child, th:last-child{padding-right:0}
td.mono{font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:12.5px; white-space:nowrap; color:var(--piedra)}
td.mono strong{color:var(--obsidiana)}
th.r, td.r{text-align:right}
table.amounts td.mono.r{color:var(--obsidiana); font-size:13px}
table.amounts tr.group td{border-bottom:0; padding-top:16px; padding-bottom:2px}
table.amounts tr.group td strong{font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--piedra)}
table.amounts tr.sub td{background:var(--surface)}
table.amounts tr.total td{border-top:1.5px solid var(--obsidiana); border-bottom:1.5px solid var(--obsidiana); background:var(--surface-2); padding-top:12px; padding-bottom:12px}
table.amounts tr.total td strong{font-size:15px}
table.scope td.mono{white-space:normal}
table.scope th:nth-child(1),table.scope td:nth-child(1){width:22%}
table.scope th:nth-child(2),table.scope td:nth-child(2){width:56%}
table.scope th:nth-child(3),table.scope td:nth-child(3){width:22%}
table.done th:nth-child(1),table.done td:nth-child(1){width:16%}
table.kv th{width:160px; text-transform:none; letter-spacing:0; font-family:"IBM Plex Sans", system-ui, sans-serif; font-size:14px; font-weight:500; color:var(--obsidiana); padding:9px 12px 9px 0; border-bottom:1px solid var(--border); vertical-align:top}
table.kv td.mono{white-space:normal; color:var(--obsidiana); font-size:13.5px}
.accept{display:flex; gap:48px; margin:28px 0 0; max-width:var(--maxw)}
.accept > div{flex:1; border-top:1px solid var(--obsidiana); padding-top:12px}
.accept p{margin:30px 0 0; padding-top:6px; border-top:1px solid var(--border); font-size:13px; color:var(--piedra)}
.accept .eb{margin-bottom:0}
mark{background:#FFF176; color:inherit; padding:0 .15em; -webkit-print-color-adjust:exact; print-color-adjust:exact}
@media print{ body{font-size:10.4pt} }
"""

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500'
         '&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">\n')

FOLIO = re.compile(r"\bCOT-[A-Z0-9]+-\d{3}-\d{4}\b")
MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre"
FULLDATE = re.compile(r"\b\d{1,2} de (?:%s) de \d{4}\b" % MONTHS)
ENTITY = re.compile(r"S\.\s?A\.|S\. de R\.\s?L\.|S\.\s?C\.|S\.A\.P\.I\.|LLC|Inc\.|GmbH|Ltd", re.I)
CODES = re.compile(r"\b(E|NS|PV|O|Q|H|P|T)-?\d{2,3}\b")
LEFTOVER = re.compile(r"\{\{[^}]*\}\}|\[[^\]]*\]")
AMOUNT = re.compile(r"\$([\d,]+)")


def strip(html: str) -> str:
    html = re.sub(r"<svg.*?</svg>", " ", html, flags=re.S)
    html = re.sub(r"<mark>.*?</mark>", " ", html, flags=re.S)  # fill-in fields: [brackets] allowed only inside a highlight
    return re.sub(r"<[^>]+>", " ", html)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--title", required=True)
    a = ap.parse_args()
    src = Path(a.src)
    frags = sorted(p for p in src.glob("*.html"))
    if not frags:
        print(f"no fragments in {src}", file=sys.stderr); return 1
    # The mark is the final horizontal logo (iago-web/workspace/deliverables/2026-09-logo-final,
    # «ΛGENCY GROUP» spanning the full width of IAGO), trimmed to its ink, embedded as a data URI.
    png = base64.b64encode((ASSETS / "iago-logo-horizontal-light.png").read_bytes()).decode("ascii")
    lockup = f'<img class="lockup" alt="iaGO Agency Group" src="data:image/png;base64,{png}">'
    body = "".join(p.read_text(encoding="utf-8").rstrip() + "\n" for p in frags)
    body = body.replace("<!--LOCKUP-->", lockup)
    doc = ('<!doctype html>\n<html lang="es" data-theme="light">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
           f"<title>{a.title}</title>\n{FONTS}<style>{CSS}</style>\n</head>\n<body>\n{body}</div>\n</body>\n</html>\n")

    bad = []
    text = strip(doc.split("</head>", 1)[1])
    opens, closes = doc.count("<section>"), doc.count("</section>")
    if opens != closes:
        bad.append(f"unbalanced <section>: {opens}/{closes}")
    for m in LEFTOVER.finditer(text):
        bad.append(f"placeholder or bracket left: «{m.group(0)}»")
    for m in CODES.finditer(text):
        bad.append(f"internal code: «{m.group(0)}» …{text[max(0, m.start()-30):m.end()+30].strip()}…")
    if re.search(r"ahorr", text, re.I):
        bad.append("a savings claim («ahorr…»)")
    meta = re.search(r'<div class="brandmeta">(.*?)</div>', body, flags=re.S)
    meta_t = strip(meta.group(1)) if meta else ""
    if not FOLIO.search(meta_t):
        bad.append("no folio COT-{CLIENTE}-{NNN}-{YYYY} in the header meta")
    if not FULLDATE.search(meta_t):
        bad.append("no full issue date «D de mes de AAAA» in the header meta")
    if not re.search(r"Vigencia:\s*hasta el \d{1,2} de", meta_t):
        bad.append("no «Vigencia: hasta el D de mes de AAAA» in the header meta")
    eb = re.search(r'<header.*?<span class="eb">(.*?)</span>', body, flags=re.S)
    if not eb or not ENTITY.search(eb.group(1)):
        bad.append("the header eyebrow does not name the client's legal entity (S.A. de C.V., S. de R.L. …)")

    # amounts: lines → subs → total → prose
    rows = re.findall(r'<tr class="(group|line|sub|total)">(.*?)</tr>', body, flags=re.S)
    run, subs, lines, total = 0, [], [], None
    for cls, inner in rows:
        amt = AMOUNT.findall(inner)
        val = int(amt[-1].replace(",", "")) if amt else None
        if cls == "group":
            run = 0
        elif cls == "line":
            if val is None: bad.append(f"amounts: a line row without a $ figure: {strip(inner).strip()[:60]}")
            else: run += val; lines.append(val)
        elif cls == "sub":
            if val != run: bad.append(f"amounts: subtotal ${val:,} but its lines add to ${run:,}")
            subs.append(val); run = 0
        elif cls == "total":
            total = val
    if rows:
        if total is None:
            bad.append("amounts: no tr.total row")
        elif total != (sum(s for s in subs if s is not None) if subs else sum(lines)):
            bad.append(f"amounts: total ${total:,} but the rows add to ${(sum(subs) if subs else sum(lines)):,}")
        prose = {int(v.replace(",", "")) for v in re.findall(r"\$([\d,]+)\s*MXN", text)}
        allowed = {total, *subs, *lines}  # a payment schedule may quote a line
        if total not in prose:
            bad.append("amounts: the total never appears in prose as «$N MXN más IVA»")
        for v in prose - allowed:
            bad.append(f"amounts: ${v:,} MXN in prose is neither the total, a subtotal nor a line")

    Path(a.out).write_text(doc, encoding="utf-8")
    print(f"{a.out}  {len(doc):,} bytes  {len(frags)} fragments  sections {opens}  "
          + (f"total ${total:,} = " + " + ".join(f"{s:,}" for s in (subs or lines)) if total else "no amounts table"))
    for b in bad:
        print("  FAIL " + b, file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
