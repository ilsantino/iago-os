# Rasteriza un PDF a JPEG, una imagen por pagina, para la revision visual.
#
# PyMuPDF y no pdftoppm: poppler no esta en esta maquina y el resultado es el
# mismo. El PDF de entrada lo produce Word/PowerPoint, no LibreOffice, asi que
# lo que se revisa es exactamente lo que va a ver el cliente.
#
#   python rasterizar.py <archivo.pdf> <carpeta-salida> [dpi]

import shutil
import sys
from pathlib import Path

import fitz

pdf = Path(sys.argv[1])
destino = Path(sys.argv[2])
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 100

if destino.exists():
    shutil.rmtree(destino)
destino.mkdir(parents=True)

doc = fitz.open(pdf)
for i, pagina in enumerate(doc, start=1):
    pix = pagina.get_pixmap(dpi=dpi)
    pix.save(destino / f"pagina-{i:02d}.jpg", jpg_quality=82)

print(f"{doc.page_count} paginas a {dpi} ppp en {destino}")
