"""Eigenständige Seite (docs/index.html) mit nachgebautem Supabase: Anmeldung, Laden, Schreiben, Bilder."""
import json, glob, os, re, http.server, threading, functools
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPORT = os.environ.get("FR_EXPORT", "")
rows = {}
sql = open(ROOT + "/supabase/2_daten.sql", encoding="utf-8").read()
for m in re.finditer(r"\('([^']+)', '([^']+)', '((?:[^']|'')*)'::jsonb\)", sql):
    rows[m.group(1)] = {"path": m.group(1), "coll": m.group(2), "data": json.loads(m.group(3).replace("''", "'"))}

CFG = b"window.FR_CONFIG={url:'https://x.supabase.test',key:'anon',profiles:{'t@x.de':'p2'}}"
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0] == "/config.js":
            self.send_response(200); self.send_header("Content-Type", "text/javascript"); self.send_header("Content-Length", str(len(CFG))); self.end_headers(); self.wfile.write(CFG); return
        return super().do_GET()
handler = functools.partial(H, directory=ROOT + "/docs")
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{srv.server_address[1]}"
ok = fails = 0
def check(n, c):
    global ok, fails
    print(("OK   " if c else "FEHL ") + n); ok += c; fails += (not c)

OFFLINE = False
def route(r):
    if OFFLINE: return r.abort()
    u = urlparse(r.request.url); q = parse_qs(u.query); m = r.request.method
    js = lambda o, s=200: r.fulfill(status=s, content_type="application/json", body=json.dumps(o))
    if u.path.endswith("/auth/v1/token"):
        b = json.loads(r.request.post_data); return js({"error_description": "Invalid login credentials"}, 400) if b.get("password") != "geheim" else js({"access_token": "a", "refresh_token": "r", "expires_in": 3600})
    if r.request.headers.get("authorization") != "Bearer a": return js({}, 401)
    if u.path.endswith("/rest/v1/docs"):
        if m == "POST":
            b = json.loads(r.request.post_data); rows[b["path"]] = b; return js({}, 201)
        if m == "DELETE": rows.pop(q["path"][0][3:], None); return js({}, 204)
        out = list(rows.values())
        if "coll" in q: out = [x for x in out if x["coll"] == q["coll"][0][3:]]
        if "path" in q: out = [x for x in out if x["path"] == q["path"][0][3:]]
        return js([{"path": x["path"], "data": x["data"]} for x in out])
    r.fulfill(status=404, body="")

with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_context(viewport={"width": 393, "height": 852}).new_page()
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
    page.route("https://x.supabase.test/**", route)
    page.add_init_script("window.FR_CONFIG={url:'https://x.supabase.test',key:'anon'}")
    page.goto(base + "/index.html"); page.wait_for_selector("input[name=pw]", timeout=5000)
    check("Anmeldemaske erscheint", True)
    page.fill("input[name=email]", "t@x.de"); page.fill("input[name=pw]", "falsch"); page.click("form button"); page.wait_for_timeout(300)
    check("Falsches Passwort zeigt Fehler", "Invalid login" in page.inner_text("body"))
    page.fill("input[name=pw]", "geheim"); page.click("form button"); page.wait_for_selector("nav.bottom", timeout=8000); page.wait_for_timeout(800)
    check("Nach Anmeldung: Navigation mit Neu / Ausgewählt", "Neu" in page.inner_text("nav.bottom") and "Ausgewählt" in page.inner_text("nav.bottom"))
    page.click("nav.bottom button:has-text('Rezepte')"); page.wait_for_timeout(500)
    t = page.inner_text("body")
    check("Rezepte aus der Datenbank sichtbar", "Linsensalat" in t or "Cannelloni" in t)
    bg = page.eval_on_selector(".rcard .thumb", "e=>getComputedStyle(e).backgroundImage")
    check("Bild kommt aus img/", "img/" in bg)
    page.click(".rcard"); page.wait_for_timeout(300)
    page.click("#sheet [data-act=fav]"); page.wait_for_timeout(500)
    check("Schreiben landet in der Datenbank (favorites)", any(k.startswith("favorites/") for k in rows))
    check("Nur das eigene Profil (p2) ist sichtbar", page.locator("header .who button").count() == 0 and "Tommy" not in page.inner_text("header"))
    # Offline-Modus: Änderungen warten in der Schlange und gehen beim Wiederverbinden raus
    page.evaluate("navigator.serviceWorker.ready.then(()=>1)"); page.wait_for_timeout(500)
    before = json.dumps(rows.get([k for k in rows if k.startswith("favorites/")][0]) if any(k.startswith("favorites/") for k in rows) else None)
    OFFLINE = True; page.context.set_offline(True)
    page.click("#sheet [data-act=fav]"); page.wait_for_timeout(600)
    check("Offline: Banner zeigt wartende Änderung", "Offline" in page.inner_text("#fr-net") and "1 Änderung" in page.inner_text("#fr-net"))
    check("Offline: Änderung nicht verloren (lokal gespeichert)", json.loads(page.evaluate("localStorage.getItem('fr:outbox')")) != [])
    page.reload(); page.wait_for_selector("nav.bottom", timeout=8000)
    check("Offline-Start: App lädt aus dem Zwischenspeicher", "Neu" in page.inner_text("nav.bottom"))
    OFFLINE = False; page.context.set_offline(False)
    page.evaluate("window.dispatchEvent(new Event('online'))"); page.wait_for_timeout(4000)
    check("Wieder online: Warteschlange geleert", json.loads(page.evaluate("localStorage.getItem('fr:outbox')")) == [])
    check("Keine JavaScript-Fehler", not errs)
    if errs: print(errs)
    b.close()
print(f"\n{ok}/{ok+fails} Prüfungen bestanden"); raise SystemExit(1 if fails else 0)
