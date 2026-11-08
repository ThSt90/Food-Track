#!/usr/bin/env python3
"""Baut die veröffentlichte Seite: src/* -> index.html (eine Datei, wie es Claude-Artifacts verlangen).

python build.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"


def main() -> None:
    html = (SRC / "shell.html").read_text(encoding="utf-8")
    parts = {
        "/*STYLE*/": SRC / "style.css",
        "/*LOGIC*/": SRC / "logic.js",
        "/*STORE*/": SRC / "store.js",
        "/*APP*/": SRC / "app.js",
    }
    for marker, path in parts.items():
        text = path.read_text(encoding="utf-8")
        if "</script" in text.lower() and path.suffix == ".js":
            raise SystemExit(f"{path.name} enthält '</script' – das würde die Seite zerstören.")
        html = html.replace(marker, text)
    out = ROOT / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"index.html geschrieben ({out.stat().st_size // 1024} KB)")
    # Eigenständige Variante für GitHub Pages (docs/): vollständiges HTML-Dokument + Supabase-Adapter
    docs = ROOT / "docs"
    docs.mkdir(exist_ok=True)
    head = ('<!doctype html><html lang="de"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
            '<meta name="apple-mobile-web-app-title" content="Foody"><link rel="apple-touch-icon" href="icon.png"><link rel="icon" type="image/png" href="favicon.png">'
            '<link rel="manifest" href="manifest.webmanifest"><script src="config.js"></script></head><body>')
    backend = (SRC / "backend.js").read_text(encoding="utf-8")
    import datetime
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=1))).strftime("%d.%m. %H:%M")
    body = html.replace("<main id=\"app\"", "<script>window.FR_BUILD=\"" + stamp + "\";</script>\n<script>\n" + backend + "\n</script>\n<main id=\"app\"", 1)
    (docs / "index.html").write_text(head + body + "</body></html>", encoding="utf-8")
    (docs / "sw.js").write_text((SRC / "sw.js").read_text(encoding="utf-8"), encoding="utf-8")
    print(f"docs/index.html geschrieben ({(docs / 'index.html').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
