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
