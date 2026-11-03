# Foody

Persönliches Ernährungs-Dashboard für zwei Personen: Kalorienbudget, Recipe Radar zum Wischen, Screenshot-Import, Einkaufsliste, Historie und Gewicht. Gestaltet nach dem Aktien-Radar.

**Nutzung:** Food Radar läuft als Seite in der Claude-App (wie das Aktien-Radar auf dem iPhone).
Die Seite heißt „Food Radar“ und liegt in deiner Artifact-Galerie. Der Link steht in `CLAUDE.md`.
Es gibt nichts zu installieren und keinen Server. Die Daten liegen privat in deinem Claude-Konto und sind auf jedem Gerät gleich.

---

## 1. Erste Schritte

1. Food Radar in der Claude-App öffnen (iPhone oder PC).
2. **Mehr → Profile und Einstellungen.** Für Profil 1 und Profil 2 Name, Größe und Gewicht eintragen. Alter und Geschlecht sind vorbelegt (Mann 37, Frau 35). Den Wechsel zwischen den Personen machst du oben rechts über die runden Initialen.
3. Unter **Heute** erscheint das Kalorienbudget, sobald Größe und Gewicht da sind. Vorher zeigt die App einen Hinweis und keine erfundene Zahl.
4. Unter **Radar** Gerichte wischen: nach rechts merken, nach links für heute überspringen. ★ macht ein Gericht zum dauerhaften Favoriten.
5. Unter **Rezepte → Screenshot** ein Rezeptbild hochladen und auf **„Mit Claude auslesen“** tippen. Danach die Vorschau prüfen (orange = unsicher), den Bildausschnitt anpassen und speichern.

Beim ersten Auslesen fragt die Claude-App einmal, ob die Seite Claude nutzen und Bilder senden darf.

---

## 2. Architektur und Entscheidungen

| Vorgabe im Master-Prompt | Umsetzung | Grund |
|---|---|---|
| Python + Flask + SQLite, lokal | Seite in der Claude-App mit eingebauter Datenbank (`db`-Capability) | Du wolltest die Handyversion. Ein Flask-Server läuft nur auf dem PC und wäre unterwegs nicht erreichbar (Entscheidung von dir am 17.10.2026). |
| Vanilla JS, HTML, CSS | so umgesetzt | ohne Framework und ohne Abhängigkeiten |
| Lokale Bilder | Bilder im Asset-Speicher der Seite | auf allen Geräten verfügbar |
| Lokales OCR / austauschbare Bild-KI | 1) Claude liest den Screenshot (deine Claude-Nutzung, keine kostenpflichtige API). 2) Text einfügen, z. B. mit iPhone-Livetext (lokale Texterkennung des Geräts). Beide Wege laufen durch denselben Parser. | Claude erkennt Tabellen und Mengen deutlich zuverlässiger als Tesseract. Livetext ist der Weg ohne KI. |
| Python-Tests | Node-Tests (`node:test`) für die Logik, Playwright-Durchlauf im Browser | Die Logik ist JavaScript, weil sie im Browser läuft. Python bleibt für den Build. |

Die Rechenlogik (`src/logic.js`) und die Datenaktionen (`src/store.js`) haben keinerlei Bezug zur Oberfläche. Sie laufen unverändert in Node und werden dort getestet.

### Projektstruktur

```
food-radar/
  README.md            diese Datei
  CLAUDE.md            Arbeitsanweisung für Claude Code + Link zur Seite
  build.py             baut index.html aus src/ (python build.py)
  index.html           gebaute Seite (wird veröffentlicht, nicht von Hand ändern)
  src/
    shell.html         Gerüst der Seite
    style.css          Designsystem (Tokens nach dem Aktien-Radar)
    logic.js           Berechnungen: Energie, Budget, Nährwerte, Einheiten, Einkauf, Rotation, Parser, Historie
    store.js           Datenmodell und Aktionen über die Datenbank
    app.js             Oberfläche, Wischgesten, Import
  seed/
    lebensmittel.csv   Lebensmittel-Referenz je 100 g mit Quelle
    rezepte.json       8 Startrezepte (Nährwerte werden aus den Zutaten berechnet)
  tools/make_seed.js   erzeugt seed/seed-docs.json zum Einspielen in die Datenbank
  tests/
    logic.test.js      Berechnungen gegen Handrechnungen
    store.test.js      Geschäftsregeln über die Datenbankschicht
    fakedb.js          In-Memory-Datenbank mit derselben Semantik
    mock-claude.js     Nachbau von window.claude für den Browsertest
    browser_check.py   Durchlauf der „Definition of Done“ im iPhone-Format
```

### Ändern und neu veröffentlichen

1. Dateien in `src/` ändern.
2. `node --test tests/logic.test.js tests/store.test.js` ausführen.
3. `python build.py` ausführen.
4. `index.html` unter derselben Adresse neu veröffentlichen (in Claude Code mit der URL aus `CLAUDE.md`). Die Daten bleiben erhalten.

---

## 3. Datenmodell

Dokumentdatenbank, ein Dokument je Pfad. Gelöschte Einträge innerhalb eines Dokuments sind `null`.

| Pfad | Inhalt |
|---|---|
| `profiles/{p1,p2}` | Name, Geschlecht, Geburtsdatum/Alter, Größe, PAL, Zielmodus, Defizit, manuelles Ziel, Zielgewicht, Sportanrechnung %, Vorlieben/Abneigungen |
| `foods/{id}` | Lebensmittel: kcal, Protein, KH, Fett je 100 g; Dichte (g/ml); Stückgewicht; Quelle; Aliasnamen |
| `recipes/{id}` | Titel, Kategorie, Zeit, Portionen, Aufwand, Merkmale, Schritte, Bild-ID, Quelle, Import-ID, **Zutaten** (Menge, Einheit, Name, Lebensmittel-ID, Originalzeile), **Originalnährwerte** mit Bezug (je Portion/gesamt) und Art (Original/Schätzung), Version |
| `imports/{id}` | Original-Screenshot (Asset-ID), erkannter Text bzw. JSON, Extraktor, Unsicherheiten |
| `favorites/{pid}` | `{ids: {rezeptId: true}}` – je Person getrennt |
| `days/{pid}__{datum}` | **eingefrorenes Tagesziel** und Sportanrechnung, Sport-Haken, „vollständig erfasst“, **Mahlzeiten** (Status, Portionen, beim Verzehr eingefrorene Nährwerte + Rezeptversion), **Sporteinheiten**, **Radar-Entscheidungen** |
| `weights/{pid}` | `{entries: {datum: {kg, note}}}` |
| `shopping/{datum}__{umfang}` | abgehakt, vorhanden, geänderte Mengen, eigene Posten |
| `settings/sport` | eigene Sportarten, Verbrauchswerte je Person |

Ein Tag ist ein Dokument. So bleibt die Datenbank klein (Limit 25.000 Dokumente, rund 730 Tagesdokumente pro Jahr für zwei Personen), und alles, was eine Buchung betrifft, wird in einem Schreibvorgang geändert.

---

## 4. Berechnungsregeln

**Grundumsatz (Mifflin-St. Jeor):** Männer `10·kg + 6,25·cm − 5·Alter + 5`, Frauen `… − 161`.

**Gesamtbedarf:** Grundumsatz × PAL. Der PAL folgt der DGE und beschreibt den Alltag **ohne** geplanten Sport.
Startwert ist 1,5 (Bürojob, überwiegend sitzend, moderate Alltagsbewegung). Die DGE ordnet Bürotätigkeit bei 1,4–1,5 ein.

**Tagesziel:** „Gewicht halten“ = Bedarf; „Abnehmen“ = Bedarf − Defizit (Standard 500 kcal); „selbst festlegen“ = feste Zahl.
Bedarf und Ziel werden getrennt angezeigt. Liegt das Ziel unter dem Grundumsatz, erscheint eine Warnung.

**Sport:** Der Sport-Haken dokumentiert nur. Angerechnet werden ausschließlich Einheiten mit gültigem Verbrauchswert:
entweder ein eigener Wert (z. B. von der Uhr) oder Minuten × dein hinterlegter Durchschnitt in kcal/h.
Wahlweise wird zu 100 %, 50 % oder 0 % angerechnet.
Weil der PAL keinen Sport enthält, wird Bewegung nicht doppelt gezählt.
Trägst du später einen Durchschnitt ein, bekommen bisher wertlose Einheiten dieser Sportart ihn rückwirkend.

**Budget:**
- Aktuell frei = Ziel + angerechneter Sport − **gegessene** kcal.
- Nach Plan = aktuell frei − vorgemerkte, geplante und gekochte kcal.
- „Gekocht“ zählt nicht als gegessen. Negative Werte werden angezeigt und nicht auf 0 begrenzt.

**Keine Doppelbuchung:** „Gegessen“ setzt einen Zustand und addiert nichts. Neue Einträge haben eine feste ID: zweimal Absenden ergibt einen Eintrag. Ein Knopf ist gesperrt, solange seine Aktion läuft.

**Stabile Historie:**
- Beim Verzehr werden die Nährwerte je Portion und die Rezeptversion eingefroren. Ändert sich das Rezept später, zeigt die Mahlzeit „Rezept geändert“. Übernommen werden die neuen Werte nur, wenn du das ausdrücklich bestätigst.
- Das Tagesziel wird beim ersten Eintrag eines Tages eingefroren. Profiländerungen gelten ab heute.
- Für Tage vor der ersten Wägung gilt die erste Wägung.

**Nährwerte eines Rezepts (Datenqualität):**

| Stufe | Bedeutung |
|---|---|
| Originalwert | Angabe aus dem Rezept; „gesamt“ wird durch die Portionen geteilt |
| geschätzt | eigene Schätzung, ausdrücklich als solche gespeichert |
| berechnet | alle Zutaten über die Lebensmitteltabelle umgerechnet |
| unvollständig | nur ein Teil der Zutaten hat Werte; die Zahl ist eine Untergrenze |
| keine Nährwerte | nichts bekannt; ein gegessenes Gericht ohne Wert macht den Tag unvollständig |

Liegen Original und Berechnung vor, zeigt die Detailansicht die Abweichung in Prozent.

**Einheiten:**
- `g/kg` direkt.
- `ml/l/EL (15 ml)/TL (5 ml)` nur über eine bekannte Dichte.
- `Stück/Zehe` nur über ein bekanntes Stückgewicht.
- `Prise/Msp` zählen 0.
- Alles andere wird nicht geraten.
- Salz, Pfeffer, Kräuter, Gewürze, Essig und Zitronensaft ohne Mengenangabe gelten als vernachlässigbar (feste Liste in `logic.js`).
- „Proteinreich“ wird automatisch vergeben ab 20 % der Energie aus Protein (EU-VO 1924/2006).

**Einkaufsliste:**
- Sie wird aus allen Rezept-Mahlzeiten des Tages gebildet, je Person oder für beide.
- Mengen werden mit Portionen ÷ Rezeptportionen skaliert.
- Gleiche Zutat und gleiche Dimension werden addiert (g mit kg, ml mit l/EL/TL). Andere Einheiten bleiben eigene Posten.
- Abgehakt, vorhanden, eigene Mengen und eigene Posten werden gespeichert und bleiben erhalten, wenn sich Gerichte ändern.

**Recipe Radar (Rotation):** Gewichtete Zufallsauswahl ohne Zurücklegen (Efraimidis-Spirakis), reproduzierbar je Person und Tag. Faktoren:

| Regel | Faktor |
|---|---|
| Favorit | ×3 |
| zuletzt gezeigt vor ≤ 1 / 3 / 7 Tagen | ×0,25 / 0,5 / 0,8 |
| zuletzt gegessen vor ≤ 2 / 6 / 13 Tagen | ×0,2 / 0,5 / 0,8 |
| in den letzten 3 Tagen übersprungen | ×0,6 |
| ohne kcal-Wert | ×0,7 |
| Passung ins Budget (gut/passt/knapp/zu viel) | ×1,2 / 1 / 0,6 / 0,3 |
| Vorliebe passt | ×1,3 |
| Abneigung enthalten | nicht vorgeschlagen |

Jede Karte zeigt, warum sie kommt. Wischen löscht nie ein Rezept; jede Entscheidung lässt sich zurücknehmen.

**Historie:**
- Gezählt werden nur Tage, die du als „vollständig erfasst“ markierst und deren gegessene Mahlzeiten alle einen kcal-Wert haben.
- Tage ohne Einträge sind weder Erfolg noch Misserfolg.
- „Budget eingehalten“ heißt: gegessen ≤ Ziel + Sport.
- Ø-Protein erscheint erst ab drei vollständigen Tagen mit Proteinwerten.

**Gewicht:** Einzelmessungen plus exponentiell geglätteter Trend (α = 0,25). Die Fortschrittsanzeige richtet sich nach dem Zielgewicht. Kurzfristige Schwankungen werden ausdrücklich nicht als Fettverlust gedeutet.

---

## 5. Fachliche Analyse (Kurzfassung)

**Was ein Experte zusätzlich beachtet** (alles eingebaut):
- Bedarf und Ziel trennen.
- Sport nicht doppelt zählen.
- Verzehre einfrieren.
- Tagesziele einfrieren.
- Datenqualität sichtbar machen.
- Unvollständige Tage nicht werten.
- Mengenbereiche („1–2 Zehen“) markieren statt still auflösen.
- Nährwerte „pro 100 g“ nicht als Portion übernehmen.
- Gewichtstrend statt Tageswert.
- Mindestens eine Warnung bei Zielen unter dem Grundumsatz.
- Duplikate vor dem Speichern erkennen.

**Datenquellen:**

| Bereich | Status |
|---|---|
| Rezepte | Originalangaben aus deinen Screenshots |
| Lebensmittel | Starttabelle mit 48 Grundzutaten aus USDA FoodData Central (SR Legacy), Quelle je Zeile. In dieser Arbeitsumgebung war die Datenbank nicht online erreichbar. Die Werte wurden deshalb aus der bekannten Referenz übernommen und nicht live gegengeprüft. Sie sind in der App korrigierbar. |
| Körperdaten | deine Eingaben |
| Sportverbrauch | deine Durchschnittswerte oder Gerätewerte; es gibt keine eingebauten MET-Schätzungen, weil keine erfundenen Werte vorgegeben werden sollten |

**Verifiziert / geschätzt / fehlend:**
- Verifiziert durch Tests: die Formeln und Regeln.
- Geschätzt: der Energiebedarf (jede Formel ist eine Schätzung mit typischerweise ±10 % Streuung) und als „geschätzt“ markierte Rezeptwerte.
- Fehlend: alles, was nicht im Rezept steht – es bleibt leer.

**Später ergänzbar, ohne die Architektur zu ändern:**
- vollständiger BLS- oder FDC-Import in `foods`
- Claude schätzt fehlende Lebensmittel (Feld `source` kennzeichnet das)
- Wochenplanung
- Makroziele
- Barcode-Scan per Foto
- Apple-Health-Gewicht über einen Connector

---

## 6. Verifikation

- `node --test tests/logic.test.js tests/store.test.js` → 42 Tests.
  - Die Referenzwerte sind von Hand gerechnet und stehen als Rechnung im Testcode, z. B. Mifflin 80 kg/180 cm/37 J. = 1.745 kcal und das Budget-Beispiel 2.000/650/700 → 1.350 bzw. 650.
  - Abgedeckt sind alle 20 Pflichtpunkte der Vorgabe: Grundumsatz, PAL, manuelles Ziel, keine Anrechnung von Geplantem, Verzehr, Portionen, Doppeltipp, Sport mit und ohne Wert, Einkauf summieren und skalieren, Wischlogik, Favoriten, Neustart, Profiltrennung, Rezeptänderung, unvollständige Daten, fehlende Mengen, Gewicht korrigieren und Bilanz nach jeder Änderung.
- `python tests/browser_check.py` → 28 Prüfungen der Definition of Done im iPhone-Format: Profile, Screenshot-Import mit Bildzuschnitt, Wischen, Favorit, Plan, Verzehr, halbe Portion, Sport, Einkauf, Historie, Gewicht, Neustart, Profiltrennung, keine JavaScript-Fehler.

---

## 7. Bekannte Einschränkungen

- **Nur in der Claude-App bzw. auf claude.ai nutzbar** und nur angemeldet. Außerhalb (z. B. `index.html` per Doppelklick) zeigt die Seite „Speicher nicht verfügbar“.
- **Zwei Geräte gleichzeitig:** Schreibvorgänge gelten nach „letzter gewinnt“ je Dokument. Gleichzeitiges Bearbeiten desselben Tages derselben Person auf zwei Geräten kann eine Eingabe überschreiben. Normalerweise bucht jede Person ihren eigenen Tag.
- **Teilen:** Teilst du die Seite mit deiner Partnerin, sieht sie alle Daten beider Profile. Die Profile sind fachlich getrennt, aber nicht gegeneinander abgeschirmt.
- **Screenshot mit Claude** verbraucht deine normale Claude-Nutzung. Ohne Freigabe bleibt „Text einfügen“.
- **Lebensmitteltabelle** ist klein (48 Einträge). Zutaten ohne Treffer machen berechnete Werte „unvollständig“, bis du ein Lebensmittel ergänzt oder die Originalwerte des Rezepts nutzt.
- **Daten liegen bei Claude**, nicht in OneDrive. Unter Profile → Daten gibt es eine JSON-Sicherung zum Herunterladen.
- iPhone-Fotos im HEIC-Format: Der Zuschnitt wird als JPEG gespeichert. Das unveränderte Original wird nur aufbewahrt, wenn das Format unterstützt wird (PNG, JPEG, WebP, GIF).
