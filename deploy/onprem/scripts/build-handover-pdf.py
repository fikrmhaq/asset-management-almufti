#!/usr/bin/env python3
"""Renders a handover sheet from Markdown to a print-ready PDF.

    py scripts/build-handover-pdf.py                     # HANDOVER.id.md -> HANDOVER.id.pdf
    py scripts/build-handover-pdf.py HANDOVER.md         # the English one

The Markdown file stays the editable source; the PDF is generated from it, so
correcting a hostname or a contact means editing one file and re-running this.

Rendering goes through a headless Chromium (Edge or Chrome, whichever is
installed) rather than a PDF drawing library: it gives real table layout and
page-break control for a few lines of CSS, which is most of what this document
needs. Requires `markdown-it-py` (pip install markdown-it-py).
"""

import re
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

from markdown_it import MarkdownIt

# Chromium builds vary in which spelling of the flag they accept; unknown flags
# are ignored, so passing both is the reliable way to suppress the browser's
# default header and footer.
BROWSERS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]

CSS = """
@page { size: A4; margin: 18mm 16mm 16mm 16mm; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.55;
  color: #16191d;
  margin: 0;
}

h1 {
  font-size: 20pt;
  line-height: 1.25;
  margin: 0 0 4pt;
  letter-spacing: -0.2pt;
}

/* The paragraph straight after the title reads as a standfirst. */
h1 + p {
  color: #565e69;
  font-size: 10pt;
  margin: 0 0 6pt;
  padding-bottom: 12pt;
  border-bottom: 2px solid #16191d;
}

h2 {
  font-size: 12.5pt;
  margin: 20pt 0 7pt;
  padding-top: 9pt;
  border-top: 1px solid #d6dae0;
  break-after: avoid;
}

/* The first section follows the title rule and needs no second one. */
h2:first-of-type { border-top: none; padding-top: 0; }

h3 { font-size: 11pt; margin: 14pt 0 5pt; break-after: avoid; }

p, ul, ol { margin: 0 0 8pt; }
li { margin-bottom: 3pt; }
ul, ol { padding-left: 18pt; }

/* Section separators in the source; the headings already carry a rule. */
hr { display: none; }

strong { font-weight: 600; }

code {
  font-family: "Cascadia Mono", Consolas, "Courier New", monospace;
  font-size: 9pt;
  background: #f2f4f6;
  border: 1px solid #e3e7ec;
  border-radius: 3px;
  padding: 0.5pt 3pt;
  white-space: nowrap;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 10pt;
  font-size: 9.5pt;
  break-inside: auto;
}

/* A row split across a page boundary loses its meaning, so rows stay whole
   while the table itself is free to break between them. */
tr { break-inside: avoid; }
thead { display: table-header-group; }

th, td {
  border: 1px solid #d6dae0;
  padding: 5pt 7pt;
  text-align: left;
  vertical-align: top;
}

th { background: #eef1f4; font-weight: 600; }
tbody tr:nth-child(even) td { background: #fafbfc; }

/* Cells left blank in the source are there to be written in by hand. */
td:empty { min-width: 60mm; }
td:empty::after { content: "\\00a0"; display: block; min-height: 15pt; }

.doc-footer {
  margin-top: 22pt;
  padding-top: 8pt;
  border-top: 1px solid #d6dae0;
  color: #6b7280;
  font-size: 8.5pt;
}
"""

MONTHS_ID = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]


def find_browser() -> str:
    for path in BROWSERS:
        if Path(path).exists():
            return path
    sys.exit(
        "No Chromium-based browser found for rendering.\n"
        "Install Microsoft Edge or Google Chrome, or add its path to BROWSERS."
    )


def drop_empty_headers(html: str) -> str:
    """Removes header rows that exist only to satisfy Markdown's table syntax.

    A two-column table with no column names still needs a `| | |` header row and
    a delimiter row, which renders as an empty grey band above the table.
    """

    def replace(match: re.Match) -> str:
        text = re.sub(r"<[^>]+>", "", match.group(0))
        return "" if not text.strip() else match.group(0)

    return re.sub(r"<thead>.*?</thead>", replace, html, flags=re.DOTALL)


def main() -> None:
    package_dir = Path(__file__).resolve().parent.parent
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else package_dir / "HANDOVER.id.md"
    if not source.is_absolute():
        source = package_dir / source

    if not source.exists():
        sys.exit(f"no such file: {source}")

    output = source.with_suffix(".pdf")

    md = MarkdownIt("commonmark").enable("table")
    body = drop_empty_headers(md.render(source.read_text(encoding="utf-8")))

    today = date.today()
    stamp = f"{today.day} {MONTHS_ID[today.month - 1]} {today.year}"
    footer = (
        f'<p class="doc-footer">Dokumen ini dihasilkan dari <code>{source.name}</code> '
        f"— {stamp}. Perbarui berkas sumbernya, lalu hasilkan ulang PDF ini.</p>"
    )

    html = (
        '<!doctype html><html lang="id"><head><meta charset="utf-8">'
        f"<title>{source.stem}</title><style>{CSS}</style></head>"
        f"<body>{body}{footer}</body></html>"
    )

    browser = find_browser()

    # A real file rather than stdin: Chromium's --print-to-pdf takes a URL, and a
    # file:// URL is the only input it accepts without a running server.
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "handover.html"
        page.write_text(html, encoding="utf-8")

        subprocess.run(
            [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--no-pdf-header-footer",
                "--print-to-pdf-no-header",
                f"--print-to-pdf={output}",
                page.as_uri(),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )

    if not output.exists():
        sys.exit("the browser exited without writing a PDF")

    print(f"{output}  ({output.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
