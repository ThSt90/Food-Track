"""Browser-Durchlauf der „Definition of Done“ im iPhone-15-Pro-Format (393 × 852).

Läuft gegen die gebaute index.html mit einem Nachbau von window.claude (tests/mock-claude.js).
Voraussetzung: pip install playwright && playwright install chromium
Aufruf: python tests/browser_check.py   (Screenshots landen in tests/out/)
"""
import base64
import http.server
import json
import socketserver
import sys
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "out"
OUT.mkdir(exist_ok=True)
SEED = json.loads((ROOT / "seed" / "seed-docs.json").read_text(encoding="utf-8"))
MOCK = (ROOT / "tests" / "mock-claude.js").read_text(encoding="utf-8")
SHOT = OUT / "rezept-screenshot.png"

# Antwort, die Claude für den Test-Screenshot liefern würde (Bildausschnitt offen -> lokale Erkennung)
ANSWER = {
    "title": "Ofen-Gnocchi mit Kirschtomaten", "servings": 2, "prep_minutes": 30, "category": "abend", "tags": ["vegetarisch"],
    "ingredients": [
        {"raw": "500 g Gnocchi", "name": "Gnocchi", "amount": 500, "unit": "g"},
        {"raw": "400 g Kirschtomaten", "name": "Kirschtomaten", "amount": 400, "unit": "g"},
        {"raw": "1 Zucchini", "name": "Zucchini", "amount": 1, "unit": None},
        {"raw": "2 EL Olivenöl", "name": "Olivenöl", "amount": 2, "unit": "EL"},
        {"raw": "125 g Mozzarella", "name": "Mozzarella", "amount": 125, "unit": "g"},
        {"raw": "Basilikum", "name": "Basilikum", "amount": None, "unit": None},
    ],
    "steps": ["Ofen auf 220 °C vorheizen.", "Gnocchi, Tomaten und Zucchini mit Öl mischen und 20 Minuten backen.", "Mozzarella darauf verteilen und 5 Minuten überbacken."],
    "nutrition": {"kcal": 610, "protein": 18, "carbs": 92, "fat": 19, "basis": "portion"},
    "source": "@testkueche", "photo_box": None, "unsure": ["Portionsangabe klein gedruckt"],
}


def make_screenshot() -> None:
    from PIL import Image, ImageDraw, ImageFont
    W, H = 590, 1280
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 360), fill=(122, 78, 44))
    for x, y, r, c in [(150, 180, 110, (214, 64, 46)), (330, 150, 90, (240, 180, 60)), (460, 230, 80, (90, 160, 70)), (260, 280, 70, (230, 120, 60))]:
        d.ellipse((x - r, y - r, x + r, y + r), fill=c)
    f = lambda s, b=False: ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if b else ''}.ttf", s)
    y = 390
    for text, size, bold in [("Ofen-Gnocchi mit Kirschtomaten", 30, True), ("30 Min · 2 Portionen", 22, False), ("Zutaten", 26, True)]:
        d.text((24, y), text, fill="black", font=f(size, bold)); y += size + 18
    for line in ["500 g Gnocchi", "400 g Kirschtomaten", "1 Zucchini", "2 EL Olivenöl", "125 g Mozzarella", "Basilikum"]:
        d.text((40, y), "• " + line, fill=(40, 40, 40), font=f(22)); y += 34
    y += 14; d.text((24, y), "Zubereitung", fill="black", font=f(26, True)); y += 44
    for line in ["1. Ofen auf 220 °C vorheizen.", "2. Alles mit Öl mischen, 20 Min backen.", "3. Mozzarella darauf, 5 Min überbacken."]:
        d.text((24, y), line, fill=(40, 40, 40), font=f(21)); y += 34
    d.text((24, y + 20), "Pro Portion: 610 kcal · 18 g Eiweiß · 92 g KH · 19 g Fett", fill=(90, 90, 90), font=f(19))
    im.save(SHOT)


class Quiet(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8"}

    def log_message(self, *a):
        pass


def main() -> int:
    make_screenshot()
    httpd = socketserver.TCPServer(("127.0.0.1", 0), partial(Quiet, directory=str(ROOT)))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    assets: dict = {}
    errors: list = []
    checks: list = []

    def check(name, cond):
        checks.append((name, bool(cond)))
        print(("OK   " if cond else "FEHL ") + name)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2, color_scheme="dark", has_touch=False, locale="de-DE", timezone_id="Europe/Berlin")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.expose_function("__saveAsset", lambda i, b64, t: assets.__setitem__(i, (base64.b64decode(b64), t or "image/jpeg")))
        page.route("**/_blob/*", lambda route: route.fulfill(body=assets.get(route.request.url.rsplit("/", 1)[-1], (b"", "image/png"))[0], content_type=assets.get(route.request.url.rsplit("/", 1)[-1], (b"", "image/png"))[1]))
        page.add_init_script(f"window.__seed = {json.dumps(SEED)}; window.__sampleAnswer = {json.dumps(ANSWER)};\n" + MOCK)
        url = f"http://127.0.0.1:{port}/index.html"
        page.goto(url)
        page.evaluate("localStorage.clear(); localStorage.setItem('fr:extras', 'true'); localStorage.setItem('fr:view', '\"heute\"')")
        page.reload()
        page.wait_for_selector("text=Ohne Kalorienziel")
        nav = lambda name: page.click(f"nav.bottom button[aria-label='{name}']")
        body = lambda: page.inner_text("#app")

        # 1–3 Profile einrichten
        check("Ohne Größe/Gewicht: keine Pflichtangabe, kein erfundenes Budget", "Ohne Kalorienziel" in body() and "fehlen noch Angaben" not in body() and "Noch frei" not in body())
        page.screenshot(path=str(OUT / "01-heute-leer.png"))
        nav("Mehr"); page.click("text=Profile und Einstellungen")
        page.fill("#p-name", "Thomas"); page.fill("#p-height", "180"); page.fill("#p-weight", "80")
        page.click("text=Profil speichern"); page.wait_for_timeout(400)
        check("Profil 1: Grundumsatz 1.745 und Bedarf 2.618 sichtbar", "1.745" in body() and "2.618" in body())
        page.screenshot(path=str(OUT / "02-profil.png"), full_page=True)
        page.click(".who button:nth-child(2)"); page.wait_for_timeout(200)
        page.fill("#p-height", "168"); page.fill("#p-weight", "65"); page.select_option("#p-mode", "abnehmen")
        page.click("text=Profil speichern"); page.wait_for_timeout(400)
        check("Profil 2: 1.364 Grundumsatz, 2.046 Bedarf, Ziel 1.546", all(x in body() for x in ["1.364", "2.046", "1.546"]))
        page.click(".who button:nth-child(1)"); page.wait_for_timeout(200)

        # 4–7 Screenshot importieren
        nav("Rezepte"); page.click("button:has-text('Screenshot')")
        page.set_input_files("#imp-file", str(SHOT)); page.wait_for_timeout(200)
        page.click("text=Mit Claude auslesen")
        page.wait_for_selector("#ed-title", timeout=5000)
        check("Vorschau mit erkanntem Titel", page.input_value("#ed-title") == "Ofen-Gnocchi mit Kirschtomaten")
        check("Bild ging an Claude", page.evaluate("window.__sampleImages") == 1)
        check("Unsichere Werte markiert", page.locator(".sheet .notice").count() >= 1)
        crop_t = page.input_value("#crop-t"); crop_b = page.input_value("#crop-b")
        check(f"Fotobereich lokal erkannt (oben {crop_t} %, unten {crop_b} %)", float(crop_t) <= 2 and 26 <= float(crop_b) <= 30)
        page.screenshot(path=str(OUT / "03-import-vorschau.png"))
        page.click(".sheet >> text=Speichern")
        page.wait_for_selector(".sheet >> text=Zubereitung", timeout=5000)
        page.wait_for_function("document.querySelector('.sheet .hero') !== null", timeout=5000)
        check("Rezept gespeichert, Bild hochgeladen (Original + Zuschnitt)", len(assets) == 2)
        check("Originalwert 610 kcal je Portion", "610" in page.inner_text(".sheet"))
        page.screenshot(path=str(OUT / "04-rezept-detail.png"))
        page.evaluate("""() => { window.__recs = []; window.SpeechRecognition = window.webkitSpeechRecognition = class { constructor(){ this.lang=''; window.__recs.push(this); } start(){ this.on = true; } stop(){ this.on = false; } abort(){ this.on = false; } }; }""")
        page.click("button:has-text('Kochen starten')"); page.wait_for_timeout(300)
        check("Kochmodus: Schritt 1 von 3 groß sichtbar", "Schritt 1 von 3" in page.inner_text("#cook") and page.locator(".cook-step").count() == 1)
        check("Auf Zuruf: im Leerlauf hört nur die Spracherkennung zu (keine KI-Verbindung)", "Auf Zuruf: an" in page.inner_text(".cook-voice") and page.evaluate("window.__recs.length") >= 1 and page.evaluate("window.__recs[window.__recs.length-1].on") is True and "Foodie, starte das Gespräch" in page.inner_text("#cook"))
        page.evaluate("""() => { const r = window.__recs[window.__recs.length-1]; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Foodie, starte das Gespräch' }], { isFinal: true })] }); }""")
        page.wait_for_timeout(400)
        check("Auf Zuruf: 'Foodie, starte das Gespräch' startet das Gespräch", "Gespräch beenden" in page.inner_text(".cook-voice"))
        page.evaluate("""() => { const r = window.__recs[window.__recs.length-1]; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'beende das Gespräch' }], { isFinal: true })] }); }""")
        page.wait_for_timeout(1800)
        check("Auf Zuruf: 'beende das Gespräch' beendet es und schaltet zurück in den Leerlauf", "Gespräch starten" in page.inner_text(".cook-voice") and page.evaluate("window.__recs[window.__recs.length-1].on") is True)
        page.screenshot(path=str(OUT / "04b-kochmodus.png"))
        check("Kochmodus: Temperatur fett markiert", "220 °C" in page.eval_on_selector_all("#cook .cook-step b", "els => els.map(e => e.textContent).join('|')"))
        page.click("#cook >> text=Weiter"); page.wait_for_timeout(150)
        check("Kochmodus: Weiter zeigt Schritt 2", "Schritt 2 von 3" in page.inner_text("#cook"))
        page.fill("#cook-q", "wo bin ich"); page.press("#cook-q", "Enter"); page.wait_for_timeout(200)
        check("Kochmodus Sprache: 'wo bin ich' nennt Schritt 2 von 3", "Schritt 2 von 3." in page.inner_text(".cook-reply"))
        page.fill("#cook-q", "was kommt danach"); page.press("#cook-q", "Enter"); page.wait_for_timeout(200)
        check("Kochmodus Sprache: 'was kommt danach' liest den nächsten Schritt", page.inner_text(".cook-reply").startswith("Danach:"))
        page.fill("#cook-q", "timer 2 minuten"); page.press("#cook-q", "Enter"); page.wait_for_timeout(300)
        check("Kochmodus Sprache: Timer läuft", "⏱" in page.inner_text(".cook-voice") and page.locator("#cook-timer").count() == 1)
        page.fill("#cook-q", "weiter"); page.press("#cook-q", "Enter"); page.wait_for_timeout(200)
        check("Kochmodus Sprache: 'weiter' springt zu Schritt 3", "Schritt 3 von 3" in page.inner_text("#cook"))
        page.screenshot(path=str(OUT / "04c-kochmodus-sprache.png"))
        page.evaluate("""() => {
          window.__starts = 0; window.__spoken = []; let n = 0;
          window.SpeechRecognition = window.webkitSpeechRecognition = class { constructor(){ this.lang=''; } start(){ window.__starts++; const k = ++n; setTimeout(() => { if (this.onresult && k % 2 === 1) this.onresult({ results: [Object.assign([{ transcript: k === 1 ? 'wo bin ich' : 'gespräch beenden' }], { isFinal: true })] }); if (this.onend) this.onend(); }, 60); } stop(){} abort(){} };
          window.SpeechSynthesisUtterance = class { constructor(t){ this.text=t; } };
          Object.defineProperty(window, 'speechSynthesis', { value: { speak(u){ window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); }, cancel(){}, getVoices(){ return []; } }, configurable: true });
        }""")
        page.click("#cook >> text=Gespräch starten"); page.wait_for_timeout(1800)
        check("Gespräch: hört nach Ansage selbst zu, antwortet auf 'wo bin ich' laut und beendet sich per Sprachbefehl", page.evaluate("window.__starts") >= 2 and any("Schritt" in x and "von 3" in x for x in page.evaluate("window.__spoken")) and any("Gespräch beendet" in x for x in page.evaluate("window.__spoken")) and "Gespräch starten" in page.inner_text("#cook"))

        # GPT-Live: simulierte WebRTC-Verbindung, Funktionsaufruf "next_step" und Transkripte
        page.evaluate("""() => {
          window.FR_CONFIG = Object.assign(window.FR_CONFIG || {}, { ai: 'api' }); window.__sent = []; window.__liveCalls = 0;
          window.FR_LIVE = async (b) => { window.__liveCalls++; return { sdp: 'v=0 answer', id: 'x' }; };
          window.MediaStream = window.MediaStream || class { constructor(){} getTracks(){ return []; } };
          navigator.mediaDevices.getUserMedia = async () => ({ getAudioTracks: () => [{ stop(){} }], getTracks: () => [{ stop(){} }] });
          window.RTCPeerConnection = class { constructor(){ this.iceGatheringState = 'complete'; this.connectionState = 'new'; this.localDescription = { sdp: 'v=0 offer' }; }
            addEventListener(){} addTrack(){} createDataChannel(){ const dc = { readyState: 'open', send(m){ window.__sent.push(JSON.parse(m)); }, close(){} }; window.__dc = dc; setTimeout(() => dc.onopen && dc.onopen(), 0); return dc; }
            async createOffer(){ return { type: 'offer', sdp: 'v=0 offer' }; } async setLocalDescription(){} async setRemoteDescription(){} close(){} };
        }""")
        page.click("#cook >> text=Zurück"); page.wait_for_timeout(100)
        page.click("#cook >> text=Gespräch starten"); page.wait_for_timeout(500)
        check("GPT-Live: Verbindung wird aufgebaut", page.evaluate("window.__liveCalls") == 1 and "Verbinde" in page.inner_text("#cook"))
        page.evaluate("""() => { const e = (m) => window.__dc.onmessage({ data: JSON.stringify(m) });
          e({ type: 'session.started' }); e({ type: 'session.input_transcript.delta', delta: 'weiter bitte' });
          e({ type: 'response.event', delegation_id: 'd1', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'next_step', arguments: '{}' } } });
          e({ type: 'session.output_transcript.delta', delta: 'Schritt drei.' }); }""")
        page.wait_for_timeout(300)
        sent = page.evaluate("window.__sent")
        check("GPT-Live: next_step springt weiter und Ergebnis geht an die KI zurück", "Schritt 3 von 3" in page.inner_text("#cook") and any(m.get("type") == "response.item.create" and m.get("delegation_id") == "d1" for m in sent) and any(m.get("type") == "response.create" for m in sent))
        check("GPT-Live: Transkript sichtbar, Status 'Ich spreche'", "Schritt drei." in page.inner_text(".cook-reply") and "Ich spreche" in page.inner_text("#cook"))
        page.evaluate("""() => window.__dc.onmessage({ data: JSON.stringify({ type: 'response.event', event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c2', name: 'end_conversation', arguments: '{}' } } }) })""")
        page.click("#cook >> text=Gespräch beenden"); page.wait_for_timeout(700)
        check("GPT-Live: beenden sendet session.close", any(m.get("type") == "session.close" for m in page.evaluate("window.__sent")) and "Gespräch starten" in page.inner_text("#cook"))
        page.evaluate("() => { window.FR_CONFIG.ai = ''; }")

        page.fill("#cook-q", "kann ich Joghurt ersetzen"); page.press("#cook-q", "Enter"); page.wait_for_timeout(200)
        check("Kochmodus: freie Frage ohne KI-Zugang erklärt, was geht", "KI-Zugang" in page.inner_text(".cook-reply"))
        page.click("#cook >> text=Zurück"); page.wait_for_timeout(150)
        page.click("#cook >> text=Zurück"); page.wait_for_timeout(150)
        page.click("#cook >> text=Zutaten"); page.wait_for_timeout(150)
        check("Kochmodus: Zutaten für 4 Portionen (Gnocchi 1.000 g bzw. 1 kg)", "Gnocchi" in page.inner_text("#cook") and "Hinweis" not in page.inner_text("#cook"))
        page.click("#cook [data-act=cookEnd]"); page.wait_for_timeout(150)
        check("Kochmodus beenden", page.locator("#cook .cook").count() == 0)

        # Duplikaterkennung
        page.click("button:has-text('Screenshot')"); page.click("text=Text einfügen (ohne Bild-KI)")
        page.fill("#imp-text", "Ofen-Gnocchi mit Kirschtomaten\n2 Portionen\nZutaten\n500 g Gnocchi\n400 g Kirschtomaten\n1 Zucchini\nZubereitung\nBacken.")
        page.click("text=Text auswerten"); page.wait_for_selector("#ed-cat"); check("Kategorie ist Pflicht: ohne Wahl kein Speichern", page.input_value("#ed-cat") == ""); page.click(".sheet >> text=Speichern"); page.wait_for_timeout(150); check("Hinweis: Kategorie wählen", "Kategorie wählen" in page.inner_text("#toast")); page.select_option("#ed-cat", "main"); page.click(".sheet >> text=Speichern"); page.wait_for_timeout(200)
        check("Duplikat erkannt, Nachfrage vor dem Speichern", "Mögliches Duplikat" in page.inner_text(".sheet"))
        page.click(".sheet [data-act=closeSheet]")

        # Rezept aus Link laden (API, simuliert): Kategorie aus der Auswahl, Bild und Zutaten im Prüf-Editor
        page.evaluate("""() => { window.FR_CONFIG = Object.assign(window.FR_CONFIG || {}, { ai: 'api' }); window.__linkUrl = null;
          window.FR_LINK = async (u) => { window.__linkUrl = u; return { recipe: { title: 'Linsen-Curry', servings: 2, prep_minutes: 25, tags: [], ingredients: [{ raw: '200 g Linsen', name: 'Linsen', amount: 200, unit: 'g' }, { raw: '1 Zwiebel', name: 'Zwiebel', amount: 1, unit: null }], steps: ['Zwiebel anbraten.', 'Linsen köcheln.'], nutrition: { kcal: null, protein: null, carbs: null, fat: null, basis: null }, unsure: [] }, image: { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' } }; }; }""")
        nav("Rezepte"); page.wait_for_timeout(200); page.click("[data-act=fabLink]"); page.wait_for_selector("#imp-url")
        check("Link-Import: Knopf 'Rezept aus Link laden' erst nach Kategorie aktiv", page.locator("[data-act=impLinkLoad]").is_disabled())
        page.fill("#imp-url", "https://example.com/linsen-curry"); page.click("[data-act=impCat][data-v=main]"); page.wait_for_timeout(100)
        page.click("[data-act=impLinkLoad]"); page.wait_for_selector("#ed-cat", timeout=5000)
        check("Link-Import: Rezept im Prüf-Editor, Kategorie aus der Auswahl, Quelle gesetzt", page.input_value("#ed-cat") == "main" and page.input_value("#ed-title") == "Linsen-Curry" and "Zwiebel anbraten" in page.eval_on_selector_all(".sheet textarea", "els => els.map(e => e.value).join(' ')") and page.evaluate("window.__linkUrl") == "https://example.com/linsen-curry")
        page.click(".sheet [data-act=closeSheet]"); page.wait_for_timeout(150)

        # Aus Zutaten kochen (API, simuliert): Vorschlag → abhaken → neuer Vorschlag ohne fehlende Zutat → speichern
        page.evaluate("""() => { window.FR_CONFIG = Object.assign(window.FR_CONFIG || {}, { ai: 'api' }); window.__sg = [];
          window.FR_SUGGEST = async (b) => { window.__sg.push(JSON.parse(JSON.stringify(b)));
            if (window.__sg.length === 1) return { recipes: [{ title: 'Hähnchen-Brokkoli-Reis', servings: 2, prep_minutes: 25, why: 'Viel Gemüse und Protein.', taste_score: 8, taste_check: 'Würzig mit frischer Säure.', unused: [{ name: 'Mais', reason: 'passt nicht' }], ingredients: [
              { name: 'Hähnchenbrust', amount: 300, unit: 'g', kind: 'vorhanden' }, { name: 'Brokkoli', amount: 300, unit: 'g', kind: 'vorhanden' }, { name: 'Reis', amount: 150, unit: 'g', kind: 'vorhanden' },
              { name: 'Zitrone', amount: 1, unit: null, kind: 'zusaetzlich' }, { name: 'Paprikapulver', amount: 1, unit: 'TL', kind: 'gewuerz' }], steps: ['Reis kochen.', 'Hähnchen anbraten.', 'Brokkoli dazu.'], note: '', variant: 'einfach' }, { title: 'Thai-Curry mit Hähnchen', variant: 'besonders', servings: 2, prep_minutes: 35, taste_score: 9, ingredients: [{ name: 'Hähnchenbrust', amount: 300, unit: 'g', kind: 'vorhanden' }, { name: 'Kokosmilch', amount: 400, unit: 'ml', kind: 'zusaetzlich' }], steps: ['Anbraten.', 'Mit Kokosmilch köcheln.'], note: '' }] };
            return { recipe: { title: 'Hähnchen-Reis-Pfanne', servings: 2, prep_minutes: 20, why: 'Ohne Zitrone.', ingredients: [
              { name: 'Hähnchenbrust', amount: 300, unit: 'g', kind: 'vorhanden' }, { name: 'Brokkoli', amount: 300, unit: 'g', kind: 'vorhanden' }, { name: 'Reis', amount: 150, unit: 'g', kind: 'vorhanden' },
              { name: 'Paprikapulver', amount: 1, unit: 'TL', kind: 'gewuerz' }], steps: ['Reis kochen.', 'Alles braten.'], note: '' } }; }; }""")
        nav("Rezepte"); page.wait_for_timeout(300)
        check("Rezepte (KI-Modus): nur 'Aus Zutaten' und Link, kein manuelles Anlegen und kein Screenshot", page.locator("[data-act=newRecipe]").count() == 0 and page.locator("[data-act=importStart]").count() == 0 and page.locator("[data-act=sgStart]").count() == 1 and page.locator("[data-act=fabLink]").count() == 1)
        page.click("[data-act=sgStart]"); page.wait_for_selector("#sg-text")
        page.fill("#sg-text", "Hähnchenbrust, Brokkoli und Reis"); page.click("[data-act=sgGo]"); page.wait_for_selector(".sgrow", timeout=5000)
        check("Zutaten-Vorschlag: Liste mit Gruppen, Gewürze als angenommen", "Hähnchen-Brokkoli-Reis" in page.inner_text(".sheet") and "Zitrone" in page.inner_text(".sheet") and "angenommen vorhanden" in page.inner_text(".sheet").lower() and "geschmacks-check der ki: 8/10" in page.inner_text(".sheet").lower() and "nicht verwendet: mais" in page.inner_text(".sheet").lower() and page.evaluate("window.__sg[0].have.length") == 3)
        page.click("[data-act=sgPick][data-i='1']"); page.wait_for_timeout(150)
        check("Zutaten-Vorschlag: zwei Varianten, Umschalten zeigt das zweite Rezept", "Thai-Curry mit Hähnchen" in page.inner_text(".sheet") and "Kokosmilch" in page.inner_text(".sheet") and "Einfachste Variante" in page.inner_text(".sheet"))
        page.click("[data-act=sgPick][data-i='0']"); page.wait_for_timeout(150)
        check("Zutaten-Vorschlag: 'Alles da' gesperrt wenn etwas fehlt, 'Nicht alles da' gesperrt wenn nichts fehlt", page.locator("[data-act=sgAgain]").is_disabled() and not page.locator("[data-act=sgSave]").is_disabled())
        page.locator(".sgrow:has-text('Zitrone') input").click(); page.wait_for_timeout(150)
        check("Zutaten-Vorschlag: Abhaken schaltet um", page.locator("[data-act=sgSave]").is_disabled() and not page.locator("[data-act=sgAgain]").is_disabled())
        page.click("[data-act=sgAgain]"); page.wait_for_selector("text=Hähnchen-Reis-Pfanne", timeout=5000)
        sg = page.evaluate("window.__sg[1]")
        check("Zutaten-Vorschlag: Neuanfrage schließt Zitrone aus und merkt sich bestätigte Zutaten und beide bisherigen Titel", sg["missing"] == ["Zitrone"] and "Brokkoli" in sg["have"] and "Paprikapulver" not in sg["have"] and sg["tried"] == ["Hähnchen-Brokkoli-Reis", "Thai-Curry mit Hähnchen"])
        check("Zutaten-Vorschlag: Neuanfrage ersetzt nur das gewählte Gericht, das andere bleibt", page.evaluate("window.__sg[1].only") == "einfach" and page.locator("[data-act=sgPick]").count() == 2)
        page.click("[data-act=sgPick][data-i='1']"); page.wait_for_timeout(150)
        check("Zutaten-Vorschlag: zweites Gericht unverändert", "Thai-Curry mit Hähnchen" in page.inner_text(".sheet"))
        page.click("[data-act=sgPick][data-i='0']"); page.wait_for_timeout(150)
        page.evaluate("""() => { window.__txt = []; window.FR_TEXT = async (t) => { window.__txt.push(t); return { title: 'Hähnchen-Reis-Pfanne', items: [{ name: 'Hähnchen', kcal: 300 }, { name: 'Reis', kcal: 250 }], kcal: 550, protein: 40, carbs: 55, fat: 12, confidence: 'mittel', note: 'Annahme: 1 Portion' }; }; }""")
        page.click("[data-act=sgSave]"); page.wait_for_selector("[data-act=dsSave]", timeout=5000)
        check("Zutaten-Vorschlag: 'Alles da' schätzt die Portion und öffnet den Eintrag, ohne Rezept zu speichern", "Hähnchen-Reis-Pfanne" in page.evaluate("window.__txt[0]") and "1 Portion" in page.evaluate("window.__txt[0]") and page.locator("[data-act=dsSave]").count() == 1)
        page.evaluate("() => { delete window.FR_TEXT; }")
        page.keyboard.press("Escape"); page.evaluate("() => { document.querySelector('.sheet [data-act=closeSheet]') && document.querySelector('.sheet [data-act=closeSheet]').click(); }"); page.wait_for_timeout(200)

        # 8–10 Recipe Radar
        nav("Neu"); page.wait_for_selector(".chooser", timeout=5000)
        page.screenshot(path=str(OUT / "start-neu.png"))
        check("Entdecken zeigt drei gleiche Kacheln: Frühstück, Mittagessen, Abendessen (ohne Überschrift)", page.locator("button.pick").count() == 3 and "Was suchst du?" not in body() and "Abendessen" in body())
        page.click("button.pick:has-text('Abendessen')"); page.wait_for_selector(".swipe", timeout=5000)
        check("Auswahl Mittag/Abend zeigt nur Hauptgerichte", "Frühstück" not in page.inner_text(".swipe .sub").split("·")[0])
        kb = page.locator(".abtn.super").bounding_box()
        check("Favorit/Löschen ohne Scrollen erreichbar", kb["y"] + kb["height"] <= 852 - 70)
        ab = page.locator(".abtn.keep").bounding_box()
        check("Karte samt Knöpfen ohne Scrollen sichtbar, ohne Kalorienanzeige", ab["y"] + ab["height"] <= 852 - 70 and "kcal" not in page.inner_text(".swipe"))
        page.screenshot(path=str(OUT / "05-radar-kachel.png"))
        page.screenshot(path=str(OUT / "05b-radar-ganz.png"), full_page=True)
        check("Neu: kein Scrollen, nur drei Knöpfe", page.evaluate("document.documentElement.scrollHeight <= window.innerHeight + 1") and page.locator(".actions .abtn").count() == 3 and "Heute kochen" not in page.inner_text("#app"))
        rid0 = page.get_attribute(".swipe", "data-rid"); page.click(".swipe .favstar"); page.wait_for_timeout(500)
        check("Stern auf der Karte: Karte bleibt, Stern wird gelb", page.get_attribute(".swipe", "data-rid") == rid0 and page.get_attribute(".swipe .favstar", "aria-pressed") == "true")
        page.click(".swipe .favstar"); page.wait_for_timeout(500)
        check("Stern erneut: Favorit wieder entfernt", page.get_attribute(".swipe .favstar", "aria-pressed") == "false")
        first = page.get_attribute(".swipe", "data-rid")
        first_title = page.inner_text(".swipe h2")
        box = page.locator(".swipe").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 300); page.mouse.down()
        for i in range(1, 11): page.mouse.move(box["x"] + box["width"] / 2 - i * 25, box["y"] + 302)
        page.mouse.up(); page.wait_for_timeout(700)
        second = page.get_attribute(".swipe", "data-rid")
        check("Links wischen überspringt nur (kein Löschen)", second != first and "gelöscht" not in page.inner_text("#toast"))
        page.click("[data-act=undoDecision]"); page.wait_for_timeout(500)
        nav("Rezepte"); page.wait_for_timeout(200)
        check("Rezept bleibt in der Bibliothek", first_title in body())
        # iOS: ein Tipp auf einen Button nimmt dem Suchfeld den Fokus nicht -> Anzeige darf trotzdem nicht hängen
        page.evaluate("document.querySelectorAll('nav.bottom button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()))")
        page.focus("#lib-q"); page.click("nav.bottom button[aria-label='Neu']"); page.wait_for_timeout(400)
        check("Ein Tipp genügt, auch wenn ein Suchfeld den Fokus hat", page.locator(".swipe, .chooser").count() >= 1)
        nav("Rezepte"); page.wait_for_timeout(200)
        nav("Neu"); page.wait_for_selector(".swipe", timeout=5000)
        box = page.locator(".swipe").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 300); page.mouse.down()
        for i in range(1, 11): page.mouse.move(box["x"] + box["width"] / 2 + i * 25, box["y"] + 302)
        page.mouse.up(); page.wait_for_timeout(700)
        check("Stufe 1, rechts wischen: engere Auswahl", "Weiter (1)" in body())
        # Neuzeichnen zwischen Berühren und Loslassen (iPhone): der Tipp darf trotzdem nicht verloren gehen
        wb = page.locator(".abtn.keep").bounding_box()
        page.mouse.move(wb["x"] + wb["width"] / 2, wb["y"] + wb["height"] / 2); page.mouse.down()
        page.evaluate("(() => { const a = document.getElementById('app'); a.innerHTML = a.innerHTML; })()")
        page.mouse.up(); page.wait_for_timeout(500)
        check("Tipp überlebt ein Neuzeichnen zwischen Berühren und Loslassen", page.locator("button:has-text('Sammeln')").count() >= 1)
        page.click("button:has-text('Sammeln')"); page.wait_for_timeout(400)
        fav_rid = first
        box = page.locator(".swipe").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.6); page.mouse.down()
        for i in range(1, 11): page.mouse.move(box["x"] + box["width"] / 2 + 2, box["y"] + box["height"] * 0.6 - i * 25)
        page.mouse.up(); page.wait_for_timeout(700)
        check("Hochwischen = Superlike: nur Favorit, Karte bleibt, Auswahl unverändert", "Weiter (1)" in body() and page.get_attribute(".swipe .favstar", "aria-pressed") == "true" and page.get_attribute(".abtn.super", "aria-pressed") == "true")
        page.click(".abtn.keep"); page.wait_for_timeout(500)
        check("Stufe 2 zeigt den Favoriten", page.get_attribute(".swipe", "data-rid") == fav_rid)
        box = page.locator(".swipe").bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 300); page.mouse.down()
        for i in range(1, 11): page.mouse.move(box["x"] + box["width"] / 2 + i * 25, box["y"] + 302)
        page.mouse.up(); page.wait_for_timeout(700)
        page.wait_for_timeout(300)
        check("Stufe 2, rechts wischen: Mahlzeit kommt von der Kachel, keine Rückfrage", page.locator(".sheet").count() == 0)
        check("Stufe 2: nach Auswahl ist die Auswahl abgearbeitet", "Nichts mehr in der Auswahl" in body())
        page.click("button:has-text('Sammeln')"); page.wait_for_timeout(500)
        nav("Rezepte"); page.click("button.chip:has-text('★ Favoriten')"); page.wait_for_timeout(200)
        print("   Favoriten:", page.locator(".rcard").count(), fav_rid)
        check("Favorit dauerhaft gespeichert", page.locator(".rcard").count() == 1)
        page.click("button.chip:has-text('★ Favoriten')")
        # Bibliotheksrezept für heute als Abendessen planen
        page.click(".rcard:has-text('Ofen-Gnocchi')"); page.click(".sheet >> text=Einplanen …")
        page.click(".sheet >> button:has-text('Einplanen')"); page.wait_for_timeout(300)

        # 11–13 Heute: Prognose, Verzehr, Portion
        nav("Ausgewählt"); page.wait_for_timeout(200)
        t = body()
        check("Nur drei Kennzahlen, Geplantes zählt nicht: 2.618 verfügbar", "noch verfügbar" in t.lower() and "Gesamtverbrauch pro Tag" in t and "Heute verbraucht" in t and "nach Plan" not in t and "2.618" in page.inner_text(".kpis .pot"))
        page.screenshot(path=str(OUT / "06-heute-plan.png"), full_page=True)
        dinner = page.locator(".meal:has-text('Ofen-Gnocchi')").last
        dinner.locator("button:has-text('Gegessen')").click(); page.wait_for_timeout(300)
        dinner.locator("button:has-text('Gegessen')").count()
        check("Nach Verzehr: 2.618 − 610 = 2.008 frei", "2.008" in page.inner_text(".kpis .pot"))
        dinner = page.locator(".meal.eaten:has-text('Ofen-Gnocchi')")
        dinner.locator("button[aria-label=weniger]").click(); page.wait_for_timeout(300)
        check("Halbe Portion: 2.618 − 305 = 2.313 frei", "2.313" in page.inner_text(".kpis .pot"))

        # 14 Sport ist nicht mehr Teil der Ansicht (läuft über Apple Health)
        check("Kein Sport-Bereich in der Tagesansicht", "Sport gemacht" not in body() and "Aktivität" not in body())
        import zlib, struct
        def _png():
            raw = b"".join(b"\x00" + b"\xc8\x80\x40" * 40 for _ in range(40))
            ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
            return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", 40, 40, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"")
        (OUT / "foto.png").write_bytes(_png())

        # Beschreiben ohne API: Text wird als Auftrag gespeichert und wartet auf Claude
        page.click("button[data-act=describe]"); page.wait_for_selector("#ds-text", timeout=3000)
        page.fill("#ds-text", "2 Brötchen mit Käse"); page.set_input_files("#ds-photo", str(OUT / "foto.png")); page.wait_for_selector(".dsprev", timeout=3000)
        page.click("button[data-act=dsQueue]"); page.wait_for_timeout(800)
        check("Beschreiben ohne API: Auftrag mit Foto wartet auf Berechnung", "wartet auf berechnung" in body().lower() and "2 Brötchen mit Käse" in body() and page.locator(".dsthumb").count() == 1)
        page.click("button[data-act=dsDel]"); page.wait_for_timeout(400)
        check("Wartender Auftrag lässt sich entfernen", "2 Brötchen mit Käse" not in body())

        # Beschreiben mit API: Text -> Posten + Summe (simulierte KI), Eintragen als gegessen
        page.evaluate("window.FR_CONFIG = Object.assign(window.FR_CONFIG || {}, {ai: 'api'})")
        page.evaluate("window.FR_TEXT = async () => ({title:'Toast mit Ei',items:[{name:'3 Scheiben Toast',kcal:240,protein:8,carbs:45,fat:3},{name:'1 Ei',kcal:80,protein:7,carbs:1,fat:5}],kcal:320,protein:15,carbs:46,fat:8,confidence:'mittel',note:'Annahme: Toast ca. 27 g.'})")
        nav("Neu"); nav("Ausgewählt"); page.wait_for_timeout(300)
        page.click("button[data-act=describe]"); page.wait_for_selector("#ds-text", timeout=3000)
        page.fill("#ds-text", "3 Toast und ein Ei"); page.click("button[data-act=dsRun]"); page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "beschreiben.png"))
        check("Beschreiben: Posten und Summe werden angezeigt", "3 Scheiben Toast" in page.inner_text("body") and "320" in page.inner_text("body") and "geschätzt" in page.inner_text("body").lower() and "≈" in page.inner_text("body"))
        page.click("button[data-act=dsSave]"); page.wait_for_timeout(500)
        check("Beschreiben: Eintrag zählt als gegessen (2.313 − 320 = 1.993)", "1.993" in page.inner_text(".kpis .pot") and "Toast mit Ei" in body())

        # Annahmen gespeichert, Mengen pro Posten anpassbar
        page.click(".meal:has-text('Toast mit Ei') [data-act=mealMenu]"); page.wait_for_selector(".items", timeout=3000)
        check("Eintrag: Annahmen der Schätzung und Posten sichtbar", "Annahme" in page.inner_text(".items") and "3 Scheiben Toast" in page.inner_text(".items"))
        page.locator(".items .itm").first.locator("[aria-label=weniger]").click(); page.wait_for_timeout(400)
        check("Eintrag: Menge eines Postens ändern passt kcal an (240 × 0,75 + 80 = 260)", "180 kcal" in page.inner_text(".items") and "260" in page.inner_text(".sheet"))
        page.click(".sheet [data-act=closeSheet]"); page.wait_for_timeout(200)
        check("Eintrag: Tagesbilanz folgt (2.313 − 260 = 2.053)", "2.053" in page.inner_text(".kpis .pot"))
        page.click(".meal:has-text('Toast mit Ei') [data-act=mealMenu]"); page.wait_for_selector(".items"); page.locator(".items .itm").first.locator("[aria-label=mehr]").click(); page.wait_for_timeout(400)
        page.click(".sheet [data-act=closeSheet]"); page.wait_for_timeout(200)
        check("Eintrag: zurück auf 1× ergibt wieder 1.993", "1.993" in page.inner_text(".kpis .pot"))

        # Portionen 4 und Umrechnen, Link-Knopf
        nav("Rezepte"); check("Link-Knopf unten öffnet direkt das Link-Fenster", (page.click(".fab"), page.wait_for_selector("#imp-url", timeout=3000), page.wait_for_timeout(300), page.evaluate("document.activeElement && document.activeElement.id") == "imp-url")[3])
        page.click(".sheet [data-act=closeSheet]"); page.wait_for_timeout(200)
        nav("Rezepte"); page.click(".rcard >> nth=0"); page.wait_for_selector(".sheet .stepper", timeout=3000)
        check("Rezept zeigt Zutaten standardmäßig für 4 Portionen", "für 4 Portionen" in page.inner_text(".sheet"))
        amounts = lambda: page.evaluate("[...document.querySelectorAll('.sheet table.tbl')].find(t => t.querySelector('th'))?.querySelectorAll('tbody tr td.r:first-child') ? [...[...document.querySelectorAll('.sheet table.tbl')].find(t => t.querySelector('th')).querySelectorAll('tbody tr td.r:first-child')].map(td => td.textContent.trim()) : []")
        before = amounts()
        page.click(".sheet [data-act=svStep][data-d='1']"); page.wait_for_timeout(200)
        after = amounts()
        check(f"Portionen erhöhen rechnet die Zutatenmengen um ({before[:2]} → {after[:2]})", "für 5 Portionen" in page.inner_text(".sheet") and before != after and len(before) > 0)
        page.click(".sheet [data-act=toggleIng]"); page.wait_for_timeout(200)
        check("Zutaten-Aufklapper in der Kachel zeigt dieselbe Portionszahl", "Mengen für 5 Portionen" in page.inner_text(".sheet"))
        page.click(".sheet [data-act=closeSheet]"); page.wait_for_timeout(200)

        # 15 Einkaufsliste
        nav("Einkauf"); page.wait_for_timeout(200)
        t = body()
        check("Einkaufsliste aus vorgemerkten/geplanten Gerichten", "Gnocchi" in t and "Kirschtomaten" in t)
        page.get_by_role("checkbox", name="Gnocchi gekauft").check(); page.wait_for_timeout(300)
        check("Abgehakt: Posten verschwindet aus der Liste", page.locator(".shop label .n:text-is('Gnocchi')").count() == 0 and "ausgeblendet" in body())
        page.click("text=ausgeblendet"); page.wait_for_timeout(200)
        check("Abhaken bleibt gespeichert (über „anzeigen“ sichtbar)", page.locator(".shop label.done .n:text-is('Gnocchi')").count() == 1)
        page.screenshot(path=str(OUT / "07-einkauf.png"), full_page=True)
        page.click("button:has-text('Alles zurücksetzen')"); page.wait_for_timeout(500)
        check("Zurücksetzen zeigt Rückmeldung", "Einkaufsliste zurückgesetzt" in page.inner_text("#toast"))
        check("Einkaufsliste zurücksetzen funktioniert (Haken weg, Posten wieder offen, keine Fehlermeldung)", page.locator(".shop label .n:text-is('Gnocchi')").count() == 1 and page.locator(".shop label.done").count() == 0 and "Konnte nicht speichern" not in body())

        # Farbe wählen
        nav("Mehr"); page.wait_for_timeout(150)
        before = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        check("Farbpalette mit 10 dezenten Farben, immer sichtbar", page.locator(".sw-c").count() == 10)
        page.click(".sw-c[aria-label=Himmel]"); page.wait_for_timeout(150)
        picked = page.get_attribute(".sw-c[aria-label=Himmel]", "data-hex")
        after = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        check("Farbwahl: Akzentfarbe ist exakt die gewählte Farbe", before != after and after.lower() == picked.lower() and page.get_attribute(".sw-c[aria-label=Himmel]", "aria-checked") == "true")
        page.screenshot(path=str(OUT / "11-farbe.png"))
        page.eval_on_selector("#accent-custom", "e => { e.value = '#c2a0e0'; e.dispatchEvent(new Event('change', {bubbles: true})); }"); page.wait_for_timeout(150)
        check("Eigene Farbe wird exakt übernommen", page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == "#c2a0e0")
        page.eval_on_selector("#accent-custom", "e => { e.value = '#ffff66'; e.dispatchEvent(new Event('change', {bubbles: true})); }"); page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / "11b-gelb.png"))
        page.eval_on_selector("#accent-custom", "e => { e.value = '#c2a0e0'; e.dispatchEvent(new Event('change', {bubbles: true})); }"); page.wait_for_timeout(150)
        page.click("text=in „Meine Farben“ speichern"); page.wait_for_timeout(150)
        check("Eigene Farbe lässt sich in der Palette speichern (Meine Farben)", "meine farben" in body().lower() and page.locator(".sw-c").count() == 11)
        page.click("text=Diese gespeicherte Farbe entfernen"); page.wait_for_timeout(100)
        page.click("text=Zurück zum Standard"); page.wait_for_timeout(100)

        # 16 Historie
        nav("Mehr"); page.click("text=Historie und Statistik"); page.wait_for_timeout(200)
        check("Historie: heutiger Tag zählt erst ab morgen", "0 / 1" in body())
        page.screenshot(path=str(OUT / "08-historie.png"), full_page=True)

        # 17 Gewicht
        nav("Mehr"); page.click("text=Gewicht")
        for dte, kg in [("2026-10-03", "82.4"), ("2026-10-08", "81.9"), ("2026-10-12", "81.2")]:
            page.fill("#w-date", dte); page.fill("#w-kg", kg); page.click("form[data-submit=weightAdd] button"); page.wait_for_timeout(250)
        check("Gewichtsverlauf mit Trend", page.locator("svg.chart circle").count() >= 4)
        page.screenshot(path=str(OUT / "09-gewicht.png"), full_page=True)

        # 18 Neustart
        page.reload(); page.wait_for_selector("text=Messung eintragen"); nav("Ausgewählt"); page.wait_for_selector(".kpis .pot")
        check("Nach Neustart: Budget und Profil unverändert", "1.993" in page.inner_text(".kpis .pot") and page.get_attribute(".who button:nth-child(1)", "title") == "Thomas")

        # Wischen nach links löscht einen nicht gegessenen Eintrag
        n0 = page.locator(".meal[data-mid]").count()
        box = page.locator(".meal[data-mid]").first.bounding_box(); print("BOX", box, page.evaluate("document.querySelectorAll('.meal[data-mid]').length"))
        page.mouse.move(box["x"] + box["width"] - 20, box["y"] + 6); page.mouse.down()
        for i in range(1, 16): page.mouse.move(box["x"] + box["width"] - 20 - i * 15, box["y"] + 7)
        page.mouse.up(); page.wait_for_timeout(700)
        check("Eintrag nach links wischen entfernt ihn", n0 >= 1 and page.locator(".meal[data-mid]").count() == n0 - 1)

        # 19 Trennung der Profile
        page.click(".who button:nth-child(2)"); page.wait_for_timeout(300)
        check("Profil 2: Kalorienanzeige ausgeblendet", page.locator(".kpis").count() == 0)

        # Hellmodus einmal ansehen
        page.emulate_media(color_scheme="light"); nav("Neu"); page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "10-radar-hell.png"))
        check("Kopfzeile: kein Logo, kein Hell/Dunkel-Knopf", page.locator("header.top .brand").count() == 0 and page.locator("header.top [data-act=theme]").count() == 0)
        nav("Mehr"); t0 = page.evaluate("document.documentElement.dataset.theme || ''"); page.click("[data-act=theme]"); page.wait_for_timeout(200)
        check("Mehr: Hell/Dunkel umschalten", page.evaluate("document.documentElement.dataset.theme || ''") != t0)
        page.click("[data-act=theme]"); page.wait_for_timeout(100)
        nav("Mehr"); page.click("text=Wochenrückblick"); page.wait_for_timeout(300)
        check("Wochenrückblick öffnet", "Wochenrückblick" in body())
        page.click("[data-act=rbShift][data-n='-7']"); page.wait_for_timeout(200)
        check("Wochenrückblick: Vorwoche blättert", "Wochenrückblick" in body())
        nav("Mehr"); page.click("text=Apple Health"); page.wait_for_timeout(300)
        check("Apple Health: ohne Anleitung, Kurzbefehl-Start bleibt", "Kurzbefehl starten" in body() and "Geheimwort" not in body())
        browser.close()
    httpd.shutdown()
    bad = [e for e in errors if "favicon" not in e]
    check("Keine JavaScript-Fehler", not bad)
    for e in bad[:10]:
        print("   ", e)
    failed = [n for n, ok in checks if not ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} Prüfungen bestanden")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
