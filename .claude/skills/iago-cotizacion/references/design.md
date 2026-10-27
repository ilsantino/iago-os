# Design of an iaGO cotización

Reference of the `iago-cotizacion` skill. The quote wears the 2026 iaGO identity (Señal) as
implemented on `bas-labs/iago-web`, branch `feat/rebrand` (`docs/BRAND.md`, `src/styles/tokens.css`).
Never a client's document brand: the quote is iaGO's paper.

## Palette (light theme, the only one for print)

| Role | Hex | Use |
|---|---|---|
| Obsidiana | `#0E1210` | ink: body, headings, table figures, the hairline under the header |
| Hueso | `#FFFFFF` | ground |
| Jade | `#1B5E4A` | eyebrows (section numbers, acceptance labels), bullet dots — the only green text |
| Verde Señal | `#1A9C5E` | **only** the switch stroke inside the lockup; never text, never a fill |
| Piedra deepened | `#525E58` | secondary text: header meta, table headers, mono cells, footer |
| Surface / Surface-2 | `#F7F7F7` / `#F1F1F1` | subtotal rows / total row |
| Hairline | Obsidiana 12 % (`#E3E4E3`) | table row rules, section separators |

## Type

| Role | Face | Size (print) |
|---|---|---|
| Title | Jost 500 | 25 pt, line 1.08 |
| Section claim | Jost 500 | 15.5 pt |
| Body | IBM Plex Sans 400 | 10.2 pt, line 1.55 |
| Emphasis | IBM Plex Sans 500 | same size; never bold 700, never italic |
| Eyebrow / table header | IBM Plex Mono 500, caps, +0.12 em | 7.4 / 6.9 pt |
| Figures, dates, codes | IBM Plex Mono 400 | 7.8–8.6 pt, tabular |

Fonts: the PDF loads them from Google Fonts at print time (Playwright has network); the DOCX embeds the
TTFs in `assets/fonts/` (Jost 500 as the Regular cut of «Jost», Plex Sans 500 as the Bold cut of «IBM Plex
Sans», so `<strong>` is a weight step in Word too). Never Google Fonts `<link>` in anything that ships to
the site; for a PDF it is fine.

## The mark

The final iaGO logo lives in `C:\development\iago-web\workspace\deliverables6-09-logo-final\` (Santiago,
16-oct-2026: the only source for the iaGO logo, in every project). The quote uses the **horizontal** variant,
`png-transparent/iago-logo-horizontal-light.png`: the IAGO wordmark with «ΛGENCY GROUP» letter-spaced across
the full width of the mark. A copy trimmed to its ink is `assets/iago-logo-horizontal-light.png`; `build.py`
embeds it as a data URI, 46 mm wide in the header's left; the DOCX takes the same PNG. The earlier
`iago-lockup-02-light.svg` from `iago-web` `feat/rebrand` (AGENCY GROUP under GO only, off-centre) was wrong
and was removed on 16-oct-2026: never rebuild it from the site's `public/brand/`. Clear space = the ring
radius. No client logo on the quote.

## Layout

- Letter, margins 18 / 17 / 20 / 17 mm (PDF); 0.75 / 0.95 in (DOCX). Three pages.
- Header: lockup left, meta right (three mono lines: folio · place and date · vigencia), then the eyebrow
  with the client entity, the title, the lede, a 1.5 pt Obsidiana rule.
- Sections separated by a hairline; eyebrow number above a Jost claim.
- Tables: mono caps header with an Obsidiana bottom rule; rows with hairlines; first column mono Piedra;
  amounts right-aligned; subtotal rows on Surface; total row on Surface-2 with Obsidiana top and bottom rules.
- Footer, every page: «iaGO × {Cliente} · {folio} · {tema}» left, «n / N» right, mono 7 pt Piedra.
- Acceptance: two columns, Obsidiana top rule, Jade eyebrow, two hairlined lines each.

## Print sheet

`scripts/pdf.mjs` injects the print CSS; `scripts/build.py` writes the screen CSS. Change sizes in one and
mirror in the other. The page cap is enforced (`--max 3`); the fix for an overflow is less text.
