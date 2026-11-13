# Food Radar – Arbeitsanweisung

Persönliches Ernährungs-Dashboard für Thomas und seine Partnerin. Antworte auf Deutsch. Details stehen in `README.md`.

- **Veröffentlichte Seite (privat):** https://claude.ai/artifact/B6Vc93MZ4tYtT4Ft9YXWMf
  - Immer diese URL aktualisieren, nie eine neue Seite anlegen, sonst sind die Daten weg.
  - Benötigte Capabilities: `db`, `user`, `assets`, `sample` mit `images: true`, `downloads`.
- **Ablauf bei Änderungen:**
  1. `src/` bearbeiten.
  2. `node --test tests/logic.test.js tests/store.test.js` ausführen.
  3. `python build.py` ausführen.
  4. `index.html` unter der URL oben neu veröffentlichen.
- **Regeln, die nicht aufgeweicht werden dürfen:**
  - nie erfundene Nährwerte, Mengen oder Körperdaten
    - einzige Ausnahmen: Foto-Schätzung (`meal-photo`) und Text-/Sprach-Schätzung (`meal-text`) nur als gekennzeichneter Vorschlag in der Eintragsmaske, Thomas hat Näherungswerte hier ausdrücklich erlaubt; gespeichert wird erst nach Bestätigung
  - nur Gegessenes zählt in die Bilanz
  - Verzehre und Tagesziele bleiben eingefroren
  - In „Entdecken“ löscht Wischen nie: links = nicht in die engere Auswahl, rechts = in die engere Auswahl. Löschen und Favorit setzen nur unter „Rezepte“
  - Sport nur mit gültigem Verbrauchswert
- **Datenbank:** Dokumentpfade siehe README, Abschnitt 3. Startdaten aus `seed/`: `node tools/make_seed.js` erzeugt `seed/seed-docs.json`.
- **Design:** dunkel zuerst, Tokens in `src/style.css`, angelehnt an das Aktien-Radar.
  - Kachel: Ring oben rechts, Chips, Kennzahlen-Leiste, hervorgehobene Potenzial-Box, zwei Spalten, Fußzeile mit Punkten und „Details ›“.
- **Link-Import (Ablauf, wenn Thomas einen Rezept-Link schickt oder „Links importieren“ schreibt):**
  1. Offene Links in `imports` lesen (`type: link`, `status: offen`) und die Seite mit WebFetch lesen.
  2. Rezept als Dokument in `recipes` anlegen (Format wie `start-1`); nichts erfinden, Unklares im Chat nennen. **Kategorie immer aus dem Import-Dokument (`category`: `fruehstueck` oder `main`) übernehmen**, nie selbst raten.
  3. **Bild immer mitnehmen:** Seite im eingebauten Browser öffnen, Hauptbild finden (`og:image`, sonst das erste große Rezeptfoto), die Bild-URL im Browser öffnen, Screenshot machen, Schwarzränder abschneiden, als Asset hochladen und die Asset-ID im Feld `image` des Rezepts speichern. Der Shell-Zugriff auf fremde Webseiten ist gesperrt, nur der Browser kommt dran.
  4. Import-Dokument auf `status: uebernommen` setzen.
- **Essen berechnen (Ablauf, wenn Thomas oder Caro „Essen berechnen“ schreibt):**
  1. Offene Aufträge lesen: `select path, data from docs where path like 'imports/%' and data->>'type'='mealtext' and data->>'status'='offen'` (Felder `pid`, `date`, `slot`, `text`).
  2. Text in Posten zerlegen, übliche deutsche Portionsgrößen annehmen, je Posten kcal/Protein/KH/Fett schätzen; die Summe aus den Posten bilden, nichts ohne Annahme erfinden.
  3. Ergebnis in dasselbe Dokument schreiben: `data = data || jsonb_build_object('status','fertig','result', {title, items:[{name,kcal,protein,carbs,fat}], kcal, protein, carbs, fat, note})`. Die App trägt es beim nächsten Öffnen als gegessene, geschätzte Mahlzeit ein (nie doppelt) und setzt `status: uebernommen`.
  4. Im Chat kurz Ergebnis und Annahmen nennen.
- **KI per API (OpenAI, ohne Umweg über Claude):** Edge Functions `meal-text` (Text/Sprache, `gpt-6-luna`), `meal-photo` (Foto, `gpt-6.1-terra`) und `cook-chat` (Kochmodus-Gespräch, `gpt-6-luna`). Dazu `recipe-link` (Rezept aus Link: lädt die Seite serverseitig, liest JSON-LD/Text per OpenAI, liefert Rezept und Hauptbild; Modell `OPENAI_MODEL_LINK`, sonst `gpt-6-luna`) `recipe-suggest` (Rezept aus vorhandenen Zutaten, Schleife „nicht alles da“; Modell `OPENAI_MODEL_SUGGEST`, Standard `gpt-6.1-terra`, ohne Nährwerte, ohne Websuche; nimmt Zutaten oder einen Gerichtswunsch („ich möchte heute eine Kürbissuppe essen“); „Nicht alles da“ erneuert nur das gewählte Gericht; „Alles da – jetzt kochen“ öffnet den Eintrag mit KI-Schätzung (Rezeptliste bleibt unberührt); liefert immer zwei Vorschläge (einfachste Variante und etwas Besonderes), zusammengefasste Zutaten wie „Maultaschen mit Ei“ werden einzeln aufgelistet; Hauptziel Zutaten verkochen, einfach und nicht zu lang (Richtwert, keine harte Grenze), KI-Selbstcheck Geschmack mindestens 8/10 mit bis zu 3 Versuchen, beliebig viele Zusatzzutaten) und `live-session` (GPT-Live-Gespräch, Stimme `OPENAI_LIVE_VOICE`, Standard `cedar`; im Kochmodus startet „Auf Zuruf“ das Gespräch per Sprachbefehl „Foodie, starte das Gespräch“ und beendet es per „Gespräch beenden“, im Leerlauf hört nur die kostenlose Apple-Spracherkennung). Bei `ai: "api"` ersetzt „Rezept aus Link laden“ den Chat-Ablauf „Links importieren“; Kategorie kommt aus der Auswahl, gespeichert wird erst nach Prüfung im Editor. Alle KI-Funktionen erlauben nur die zwei Konten aus der Tabelle `owners` (Prüfung über `my_pid()`, sonst 403); `realtime-session` ist stillgelegt. Secret `OPENAI_API_KEY` in Supabase; Modelle per Secrets `OPENAI_MODEL_TEXT`, `OPENAI_MODEL_PHOTO`, `OPENAI_MODEL_CHAT`, Ausweichmodell `OPENAI_MODEL_FALLBACK` (Standard `gpt-5-mini`). In `docs/config.js` schaltet `ai: "api"` die direkte Berechnung ein; ohne dieses Feld läuft die Warteschlange („Essen berechnen“). Die Schätzung bleibt ein gekennzeichneter Vorschlag, gespeichert wird erst nach Bestätigung.
