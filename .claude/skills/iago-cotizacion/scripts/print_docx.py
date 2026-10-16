# -*- coding: utf-8 -*-
"""Print a built cotización to .docx in the iaGO Señal brand, fonts embedded.

    python scripts/print_docx.py --src fuente/cotizacion.html --out 20261016-rsf-cotizacion-consultoria.docx \
        --footer "iaGO × Red Sun Farms · COT-RSF-002-2026 · consultoría de costos y rentabilidad"

Self-contained: python-docx + beautifulsoup4 + lxml + PyMuPDF + Pillow. Reads the HTML that build.py
assembled (six blocks: header, sections with p / table.done / table.scope / table.amounts / table.kv /
ul.bul / div.accept) and writes Letter pages with the same type and palette as the PDF. Jost 500 is
embedded as the Regular cut of «Jost» and IBM Plex Sans 500 as the Bold cut of «IBM Plex Sans», so
<strong> renders at weight 500, never bold (docs/BRAND.md §3). The mark is the final horizontal logo PNG
that build.py embedded, trimmed to its ink. Verify through Word: scripts/word2pdf.py + rasterize.py.
"""
import argparse
import base64
import io
import os
import re
import shutil
import uuid
import zipfile
from pathlib import Path

import fitz
from bs4 import BeautifulSoup
from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image

HERE = Path(__file__).resolve().parent
FONTDIR = HERE.parent / "assets" / "fonts"

OBS, JADE, PIEDRA = RGBColor(0x0E, 0x12, 0x10), RGBColor(0x1B, 0x5E, 0x4A), RGBColor(0x52, 0x5E, 0x58)
SURFACE, SURFACE2, HAIR, OBS_HEX = "F7F7F7", "F1F1F1", "E3E4E3", "0E1210"
DISPLAY, BODY, MONO = "Jost", "IBM Plex Sans", "IBM Plex Mono"
TEXTW = 6.6

FONTS = [
    ("Jost", [("Regular", "Jost-500.ttf")]),
    ("IBM Plex Sans", [("Regular", "IBMPlexSans-400.ttf"), ("Bold", "IBMPlexSans-500.ttf")]),
    ("IBM Plex Mono", [("Regular", "IBMPlexMono-400.ttf"), ("Bold", "IBMPlexMono-500.ttf")]),
]


# ----------------------------------------------------------------- helpers
def _el(tag, **kw):
    e = OxmlElement(tag)
    for k, v in kw.items():
        e.set(qn("w:" + k.replace("w_", "")), str(v))
    return e


def P(container, space_before=0, space_after=6, indent=None, hanging=None, line=1.3, align=None, first=False):
    par = container.paragraphs[0] if (first and hasattr(container, "paragraphs")) else container.add_paragraph()
    f = par.paragraph_format
    f.space_before, f.space_after, f.line_spacing = Pt(space_before), Pt(space_after), line
    if indent is not None: f.left_indent = Inches(indent)
    if hanging is not None: f.first_line_indent = Inches(-hanging)
    if align is not None: f.alignment = align
    return par


def R(par, text, font=BODY, size=10, color=OBS, bold=False, track=None):
    run = par.add_run(text)
    run.font.name, run.font.size, run.font.color.rgb, run.bold = font, Pt(size), color, bold
    rPr = run._element.get_or_add_rPr()
    rf = rPr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts"); rPr.insert(0, rf)
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rf.set(qn(a), font)
    if track:
        sp = OxmlElement("w:spacing"); sp.set(qn("w:val"), str(track)); rPr.append(sp)
    return run


def keep_next(par):
    par.paragraph_format.keep_with_next = True


def par_border_bottom(par, color=HAIR, sz=4):
    pPr = par._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr"); e = OxmlElement("w:bottom")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), str(sz)); e.set(qn("w:space"), "6"); e.set(qn("w:color"), color)
    b.append(e); pPr.append(b)


def cell_borders(cell, color=HAIR, sz=4, sides=("bottom",)):
    tcPr = cell._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for s in sides:
        e = OxmlElement("w:" + s)
        e.set(qn("w:val"), "single"); e.set(qn("w:sz"), str(sz)); e.set(qn("w:space"), "0"); e.set(qn("w:color"), color)
        b.append(e)
    tcPr.append(b)


def cell_shade(cell, hexcolor):
    cell._tc.get_or_add_tcPr().append(_el("w:shd", val="clear", color="auto", fill=hexcolor))


def text(node):
    return re.sub(r"\s+", " ", node.get_text()).strip()


def inline(par, node, size=10, color=OBS, font=BODY):
    for ch in node.children:
        if isinstance(ch, str):
            t = re.sub(r"\s+", " ", ch)
            if t: R(par, t, font=font, size=size, color=color)
        elif ch.name in ("strong", "b"):
            R(par, re.sub(r"\s+", " ", ch.get_text()), font=font, size=size, color=OBS, bold=True)
        elif ch.name == "br":
            par.add_run().add_break()
        elif ch.name == "mark":  # a field the client fills in: yellow highlight, as in the PDF
            R(par, re.sub(r"\s+", " ", ch.get_text()), font=font, size=size, color=OBS).font.highlight_color = WD_COLOR_INDEX.YELLOW
        else:
            inline(par, ch, size, color, font)


def eyebrow(container, t, before=0, after=2, first=False):
    p = P(container, space_before=before, space_after=after, line=1.1, first=first)
    keep_next(p); R(p, t.upper(), font=MONO, size=7.4, color=JADE, track=18)
    return p


def hairline(doc, before=4, after=4):
    p = P(doc, space_before=before, space_after=after, line=1.0); R(p, " ", size=2); par_border_bottom(p, HAIR, 4)


def spacer(doc, pts=4):
    p = P(doc, space_before=0, space_after=0, line=1.0); R(p, " ", size=pts)


def add_table(doc, rows, cols, widths, top=3, bottom=3, right=6):
    t = doc.add_table(rows=rows, cols=cols); t.alignment = WD_TABLE_ALIGNMENT.LEFT; t.autofit = False
    pr = t._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for s in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement("w:" + s); e.set(qn("w:val"), "nil"); b.append(e)
    pr.append(b)
    lay = OxmlElement("w:tblLayout"); lay.set(qn("w:type"), "fixed"); pr.append(lay)
    m = OxmlElement("w:tblCellMar")
    for s, v in (("top", top), ("left", 0), ("bottom", bottom), ("right", right)):
        e = OxmlElement("w:" + s); e.set(qn("w:w"), str(int(v * 20))); e.set(qn("w:type"), "dxa"); m.append(e)
    pr.append(m)
    for row in t.rows:
        for c, w in zip(row.cells, widths): c.width = Inches(w)
    return t


def cp(cell, **kw):
    return P(cell, first=True, **kw)


def head_cell(c, t, right=False):
    p = cp(c, space_before=0, space_after=0, line=1.1, align=WD_ALIGN_PARAGRAPH.RIGHT if right else None)
    R(p, t.upper(), font=MONO, size=6.8, color=PIEDRA, track=16); cell_borders(c, OBS_HEX, 6)


def body_cell(c, node, mono=False, size=8.8):
    p = cp(c, space_before=0, space_after=0, line=1.3)
    inline(p, node, size=size - 0.8 if mono else size, color=PIEDRA if mono else OBS, font=MONO if mono else BODY)
    cell_borders(c, HAIR, 4)


# ------------------------------------------------------------------ blocks
def header(doc, hdr, logo_path):
    img = hdr.find("img", class_="lockup")
    if img is not None and img.get("src", "").startswith("data:image/png;base64,"):
        im = Image.open(io.BytesIO(base64.b64decode(img["src"].split(",", 1)[1]))).convert("RGBA")
    else:  # fragments older than 16-oct-2026 inline the SVG lockup
        svg = str(hdr.find("svg"))
        pix = fitz.open("svg", svg.encode("utf-8"))[0].get_pixmap(dpi=600, alpha=True)
        im = Image.open(io.BytesIO(pix.tobytes("png")))
    box, pad = im.getchannel("A").getbbox(), 12
    im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
    im.save(str(logo_path), dpi=(600, 600))

    t = add_table(doc, 1, 2, [3.6, 3.0], top=0, bottom=0, right=0)
    c0, c1 = t.rows[0].cells
    cp(c0, space_before=0, space_after=0, line=1.0).add_run().add_picture(str(logo_path), width=Inches(1.75))
    p = cp(c1, space_before=0, space_after=0, line=1.5, align=WD_ALIGN_PARAGRAPH.RIGHT)
    for i, s in enumerate(text(x) for x in hdr.select(".brandmeta span")):
        if i: p.add_run().add_break()
        R(p, s, font=MONO, size=7.6, color=PIEDRA)
    c0.vertical_alignment = c1.vertical_alignment = WD_ALIGN_VERTICAL.BOTTOM

    eyebrow(doc, text(hdr.select_one(".col .eb")), before=12, after=2)
    p = P(doc, space_before=0, space_after=4, line=1.08); R(p, text(hdr.find("h1")), font=DISPLAY, size=22)
    p = P(doc, space_before=0, space_after=8, line=1.3); R(p, text(hdr.select_one(".lede")), size=11, color=PIEDRA)
    p = P(doc, space_before=0, space_after=10, line=1.0); R(p, " ", size=2); par_border_bottom(p, OBS_HEX, 12)


def section_head(doc, sec, first):
    if not first: hairline(doc)
    eyebrow(doc, text(sec.select_one("h2 .eb")), before=0, after=1)
    p = P(doc, space_before=0, space_after=5, line=1.15); keep_next(p)
    R(p, text(sec.select_one("h2 .claim")), font=DISPLAY, size=14)


def simple_table(doc, tbl, widths):
    heads = [text(th) for th in tbl.select("thead th")]; rows = tbl.select("tbody tr")
    t = add_table(doc, 1 + len(rows), len(heads), widths)
    for c, h in zip(t.rows[0].cells, heads): head_cell(c, h)
    for r, tr in zip(t.rows[1:], rows):
        for j, (c, td) in enumerate(zip(r.cells, tr.find_all("td"))):
            body_cell(c, td, mono=(j == 0))
    spacer(doc)


def amounts_table(doc, tbl):
    rows = tbl.select("tbody tr"); t = add_table(doc, 1 + len(rows), 3, [0.45, 4.95, 1.2])
    for j, (c, th) in enumerate(zip(t.rows[0].cells, tbl.select("thead th"))): head_cell(c, text(th), right=(j == 2))
    for r, tr in zip(t.rows[1:], rows):
        cls, tds = tr.get("class") or [], tr.find_all("td")
        if "group" in cls:
            p = cp(r.cells[1], space_before=6, space_after=0, line=1.2)
            R(p, text(tds[1]).upper(), font=MONO, size=6.8, color=PIEDRA, track=16); continue
        strong, total = ("sub" in cls or "total" in cls), "total" in cls
        for j, (c, td) in enumerate(zip(r.cells, tds)):
            p = cp(c, space_before=3 if total else 0, space_after=3 if total else 0, line=1.25,
                   align=WD_ALIGN_PARAGRAPH.RIGHT if j == 2 else None)
            if j == 0: R(p, text(td), font=MONO, size=7.6, color=PIEDRA)
            elif j == 1: R(p, text(td), size=10 if total else 8.8, bold=strong)
            else: R(p, text(td), font=MONO, size=9.6 if total else 8.6, bold=strong)
            if total: cell_shade(c, SURFACE2); cell_borders(c, OBS_HEX, 8, ("top", "bottom"))
            elif "sub" in cls: cell_shade(c, SURFACE); cell_borders(c, HAIR, 4)
            else: cell_borders(c, HAIR, 4)
    spacer(doc)


def kv_table(doc, tbl):
    rows = tbl.select("tbody tr"); t = add_table(doc, len(rows), 2, [1.45, 5.15])
    for r, tr in zip(t.rows, rows):
        th, td = tr.find("th"), tr.find("td")
        R(cp(r.cells[0], space_before=0, space_after=0, line=1.3), text(th), size=8.8, bold=True)
        mono = "mono" in (td.get("class") or [])
        R(cp(r.cells[1], space_before=0, space_after=0, line=1.3), text(td), font=MONO if mono else BODY, size=8.6 if mono else 8.8)
        cell_borders(r.cells[0], HAIR, 4); cell_borders(r.cells[1], HAIR, 4)
    spacer(doc)


def bullets(doc, ul):
    for li in ul.find_all("li", recursive=False):
        p = P(doc, space_before=0, space_after=3, line=1.3, indent=0.18, hanging=0.18)
        R(p, "•\t", size=10, color=JADE); p.paragraph_format.tab_stops.add_tab_stop(Inches(0.18))
        inline(p, li)


def accept(doc, div):
    cols = div.find_all("div", recursive=False); t = add_table(doc, 1, 2, [3.1, 3.1], top=5, bottom=0, right=24)
    for c, d in zip(t.rows[0].cells, cols):
        cell_borders(c, OBS_HEX, 6, ("top",)); eyebrow(c, text(d.find("span")), before=0, after=0, first=True)
        for line in d.find_all("p"):
            p = P(c, space_before=12, space_after=0, line=1.2); inline(p, line, size=8.8, color=PIEDRA); par_border_bottom(p, HAIR, 4)


# ------------------------------------------------------------ font embedding
def obfuscate(data, guid_hex):
    key = bytes.fromhex(guid_hex)[::-1]; head = bytearray(data[:32])
    for i in range(32): head[i] ^= key[i % 16]
    return bytes(head) + data[32:]


def embed_fonts(path):
    src = zipfile.ZipFile(path, "r"); tmp = path + ".tmp"; out = zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED)
    parts, rels, table, idx = [], [], [], 0
    for fam, variants in FONTS:
        entries = []
        for kind, f in variants:
            fp = FONTDIR / f
            if not fp.exists(): continue
            idx += 1; g = uuid.uuid4().hex.upper()
            guid = "{%s-%s-%s-%s-%s}" % (g[:8], g[8:12], g[12:16], g[16:20], g[20:])
            parts.append(("word/fonts/font%d.odttf" % idx, obfuscate(fp.read_bytes(), g)))
            rels.append(("rIdFont%d" % idx, "font%d.odttf" % idx)); entries.append((kind, "rIdFont%d" % idx, guid))
        if entries: table.append((fam, entries))
    x = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
         '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">']
    for fam, entries in table:
        x.append('<w:font w:name="%s"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/>' % fam)
        x += ['<w:embed%s r:id="%s" w:fontKey="%s"/>' % e for e in entries]; x.append("</w:font>")
    x.append("</w:fonts>")
    y = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    y += ['<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/%s"/>' % r for r in rels]
    y.append("</Relationships>")
    for item in src.infolist():
        if item.filename in ("word/fontTable.xml", "word/_rels/fontTable.xml.rels"): continue
        data = src.read(item.filename)
        if item.filename == "word/settings.xml":
            t = data.decode("utf8")
            if "embedTrueTypeFonts" not in t:
                i = t.index(">", t.index("<w:settings")) + 1; t = t[:i] + "<w:embedTrueTypeFonts/><w:saveSubsetFonts/>" + t[i:]
            data = t.encode("utf8")
        elif item.filename == "[Content_Types].xml":
            t = data.decode("utf8")
            if 'Extension="odttf"' not in t:
                i = t.index(">", t.index("<Types")) + 1
                t = t[:i] + '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' + t[i:]
            data = t.encode("utf8")
        elif item.filename == "word/_rels/document.xml.rels":
            t = data.decode("utf8")
            if "fontTable.xml" not in t:
                t = t.replace("</Relationships>", '<Relationship Id="rIdFontTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>')
            data = t.encode("utf8")
        out.writestr(item, data)
    out.writestr("word/fontTable.xml", "".join(x)); out.writestr("word/_rels/fontTable.xml.rels", "".join(y))
    for part, blob in parts: out.writestr(part, blob)
    out.close(); src.close(); shutil.move(tmp, path)
    return len(parts)


# ------------------------------------------------------------------ document
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True); ap.add_argument("--out", required=True); ap.add_argument("--footer", required=True)
    a = ap.parse_args()
    soup = BeautifulSoup(Path(a.src).read_text(encoding="utf-8"), "lxml")
    doc = Document(); sec = doc.sections[0]
    sec.page_width, sec.page_height = Inches(8.5), Inches(11)
    sec.left_margin = sec.right_margin = Inches(0.95); sec.top_margin = sec.bottom_margin = Inches(0.75)
    st = doc.styles["Normal"]; st.font.name, st.font.size, st.font.color.rgb = BODY, Pt(10), OBS
    st.element.rPr.rFonts.set(qn("w:eastAsia"), BODY); st.paragraph_format.space_after = Pt(6)

    fp = sec.footer.paragraphs[0]; fp.paragraph_format.tab_stops.add_tab_stop(Inches(TEXTW), WD_TAB_ALIGNMENT.RIGHT)
    R(fp, a.footer + "\t", font=MONO, size=7, color=PIEDRA)
    run = R(fp, "", font=MONO, size=7, color=PIEDRA)
    fld = OxmlElement("w:fldSimple"); fld.set(qn("w:instr"), "PAGE")
    r = OxmlElement("w:r"); tt = OxmlElement("w:t"); tt.text = "1"; r.append(tt); fld.append(r); run._element.addnext(fld)

    out = Path(a.out)
    header(doc, soup.select_one("header.top"), out.with_name("lockup.png"))
    for i, s in enumerate(soup.select("section")):
        section_head(doc, s, first=(i == 0))
        for p_ in s.select(".col > p"):
            inline(P(doc, space_before=0, space_after=5, line=1.3), p_)
        for tbl in s.select("table"):
            cls = tbl.get("class") or []
            if "amounts" in cls: amounts_table(doc, tbl)
            elif "kv" in cls: kv_table(doc, tbl)
            elif "scope" in cls: simple_table(doc, tbl, [1.45, 3.65, 1.5])
            else: simple_table(doc, tbl, [1.05, 5.55])
        for ul in s.select("ul.bul"): bullets(doc, ul)
        if s.select_one(".accept"): accept(doc, s.select_one(".accept"))
    doc.save(str(out)); n = embed_fonts(str(out))
    print("ok  %s  %d fonts embedded  %.2f MB" % (out.name, n, out.stat().st_size / 1048576))


if __name__ == "__main__":
    main()
