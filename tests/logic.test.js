/* Reine Berechnungen gegen unabhängige, von Hand gerechnete Referenzwerte.
 * Ausführen: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");

// --------------------------------------------------------------------- 1–3 Energiebedarf
test("1 Grundumsatz Mifflin-St. Jeor gegen Handrechnung", () => {
  // Mann 80 kg, 180 cm, 37 J.: 10·80 + 6,25·180 − 5·37 + 5 = 800 + 1125 − 185 + 5 = 1745
  assert.equal(L.bmrMifflin("m", 80, 180, 37), 1745);
  // Frau 65 kg, 168 cm, 35 J.: 650 + 1050 − 175 − 161 = 1364
  assert.equal(L.bmrMifflin("w", 65, 168, 35), 1364);
  // Mann 92,5 kg, 185 cm, 40 J.: 925 + 1156,25 − 200 + 5 = 1886,25
  assert.equal(L.bmrMifflin("m", 92.5, 185, 40), 1886.25);
});

test("2 Aktivitätsfaktor (PAL) auf den Grundumsatz", () => {
  const p = { sex: "w", heightCm: 168, ageYears: 35, pal: 1.5, goalMode: "halten" };
  const e = L.energy(p, 65, "2026-10-17");
  assert.equal(e.bmr, 1364);
  assert.equal(e.tdee, 2046); // 1364 · 1,5 = 2046
  assert.equal(e.goal, 2046);
  const e2 = L.energy({ ...p, pal: 1.4 }, 65, "2026-10-17");
  assert.equal(e2.tdee, 1910); // 1364 · 1,4 = 1909,6 → 1910
  const e3 = L.energy({ ...p, goalMode: "abnehmen", deficitKcal: 500 }, 65, "2026-10-17");
  assert.equal(e3.goal, 1546);
});

test("3 Tagesziel manuell überschreiben, Energiebedarf bleibt sichtbar", () => {
  const p = { sex: "m", heightCm: 180, ageYears: 37, pal: 1.5, goalMode: "manuell", goalKcalManual: 2100 };
  const e = L.energy(p, 80, "2026-10-17");
  assert.equal(e.goal, 2100);
  assert.equal(e.tdee, 2618); // 1745 · 1,5 = 2617,5 → 2618
  assert.equal(e.goalSource, "manuell festgelegt");
});

test("Fehlende Größe/Gewicht: Hinweis statt erfundenem Wert", () => {
  const e = L.energy({ sex: "m", heightCm: null, ageYears: 37, pal: 1.5 }, null, "2026-10-17");
  assert.deepEqual(e.missing, ["Größe", "Gewicht"]);
  assert.equal(e.bmr, null); assert.equal(e.goal, null);
});

test("Alter aus Geburtsdatum am Stichtag", () => {
  assert.equal(L.ageOn("1989-10-18", null, "2026-10-17"), 36);
  assert.equal(L.ageOn("1989-10-17", null, "2026-10-17"), 37);
});

test("Warnung bei Ziel unter Grundumsatz", () => {
  const e = L.energy({ sex: "w", heightCm: 168, ageYears: 35, pal: 1.4, goalMode: "manuell", goalKcalManual: 1200 }, 65, "2026-10-17");
  assert.ok(e.warnings.some((w) => w.includes("Grundumsatz")));
});

// --------------------------------------------------------------------- Budget (Beispiel aus der Vorgabe)
test("Budget-Beispiel der Vorgabe: 2.000 Ziel, 650 gegessen, 700 geplant", () => {
  const b = L.dayBudget(2000, 0, [650], [700]);
  assert.equal(b.remaining, 1350);
  assert.equal(b.afterPlan, 650);
  const nachVerzehr = L.dayBudget(2000, 0, [650, 700], []);
  assert.equal(nachVerzehr.remaining, 650);
  const ueber = L.dayBudget(2000, 0, [1500, 900], []);
  assert.equal(ueber.remaining, -400); // negativ, nicht auf 0 begrenzt
});

test("8/9 Sportgutschrift nur mit gültigem Verbrauchswert", () => {
  assert.equal(L.sportCredit([{ kcal: null }, { kcal: 0 }], 100), 0);
  assert.equal(L.sportCredit([{ kcal: 300 }, { kcal: null }], 100), 300);
  assert.equal(L.sportCredit([{ kcal: 300 }], 50), 150);
});

test("Passung eines Gerichts ins Budget", () => {
  assert.equal(L.fit(500, 1000).cls, "hi");
  assert.equal(L.fit(900, 1000).cls, "mid");
  assert.equal(L.fit(1100, 1000).cls, "low");
  assert.equal(L.fit(1400, 1000).cls, "bad");
  assert.equal(L.fit(500, 1000).after, 500);
  assert.equal(L.fit(null, 1000).cls, "none");
});

// --------------------------------------------------------------------- Nährwerte
const foods = {
  oats: { name: "Haferflocken", kcal: 379, protein: 13.15, carbs: 67.7, fat: 6.52, density: 0.34 },
  milk: { name: "Milch", kcal: 61, protein: 3.15, carbs: 4.8, fat: 3.25, density: 1.03 },
  oil: { name: "Olivenöl", kcal: 884, protein: 0, carbs: 0, fat: 100, density: 0.9 },
  egg: { name: "Ei", kcal: 143, protein: 12.56, carbs: 0.72, fat: 9.51, pieceG: 50 },
  mystery: { name: "Ohne Makros", kcal: 100, protein: null, carbs: null, fat: null },
};

test("Umrechnung: EL Öl über Dichte, Stück über Stückgewicht, ohne Dichte kein Raten", () => {
  assert.deepEqual(L.toGrams(1, "EL", foods.oil)[0], 13.5); // 15 ml · 0,9 g/ml
  assert.equal(L.toGrams(2, null, foods.egg)[0], 100);
  assert.equal(L.toGrams(1, "EL", { kcal: 1 })[0], null);
  assert.equal(L.toGrams(1, "Dose", foods.egg)[0], null);
  assert.equal(L.toGrams(0.25, "kg", foods.oats)[0], 250);
});

test("6 Portionen: Nährwerte je Portion = Summe / Portionen", () => {
  // 100 g Haferflocken (379) + 200 ml Milch (206 g · 0,61 = 125,66) + 1 EL Öl (13,5 g · 8,84 = 119,34) = 624 kcal gesamt, 2 Port. = 312
  const r = { servings: 2, ingredients: [
    { name: "Haferflocken", amount: 100, unit: "g", foodId: "oats" },
    { name: "Milch", amount: 200, unit: "ml", foodId: "milk" },
    { name: "Olivenöl", amount: 1, unit: "EL", foodId: "oil" }] };
  const n = L.recipeNutrition(r, foods);
  assert.equal(n.quality, "berechnet");
  assert.equal(n.perPortion.kcal, 312);
});

test("Basis „gesamt“ wird durch Portionen geteilt, „je Portion“ nicht", () => {
  const base = { servings: 4, ingredients: [] };
  assert.equal(L.recipeNutrition({ ...base, nutrition: { kcal: 2000, basis: "gesamt" } }, foods).perPortion.kcal, 500);
  assert.equal(L.recipeNutrition({ ...base, nutrition: { kcal: 500, basis: "portion" } }, foods).perPortion.kcal, 500);
  assert.equal(L.recipeNutrition({ ...base, nutrition: { kcal: 500, basis: "portion" } }, foods).quality, "original");
});

test("17/18 Unvollständige Daten werden gekennzeichnet, nie stillschweigend aufgefüllt", () => {
  const r = { servings: 1, ingredients: [
    { name: "Haferflocken", amount: 50, unit: "g", foodId: "oats" },
    { name: "Geheimzutat", amount: 30, unit: "g", foodId: null },
    { name: "Ei", amount: null, unit: null, foodId: "egg" },
    { name: "Salz", amount: null, unit: null, foodId: null }] };
  const n = L.recipeNutrition(r, foods);
  assert.equal(n.quality, "unvollstaendig");
  assert.deepEqual(n.missing, ["Geheimzutat", "Ei"]);
  assert.equal(n.perPortion.kcal, 190); // nur die 50 g Haferflocken: 189,5 → Untergrenze
  const nur = L.recipeNutrition({ servings: 1, ingredients: [{ name: "X", amount: 100, unit: "g", foodId: "mystery" }] }, foods);
  assert.equal(nur.perPortion.kcal, 100);
  assert.equal(nur.perPortion.protein, null); // fehlende Makroangabe bleibt unbekannt
  assert.equal(L.recipeNutrition({ servings: 1, ingredients: [] }, foods).quality, "fehlt");
});

test("Abweichung Originalwert gegen Zutatenberechnung", () => {
  const r = { servings: 1, nutrition: { kcal: 400, basis: "portion" }, ingredients: [{ name: "Haferflocken", amount: 100, unit: "g", foodId: "oats" }] };
  assert.equal(L.recipeNutrition(r, foods).deviationPct, -5); // (379 − 400) / 400 = −5,25 %
});

test("Proteinreich nach EU-Regel (≥ 20 % der Energie)", () => {
  assert.deepEqual(L.derivedTags({ kcal: 400, protein: 20 }), ["proteinreich"]); // 80/400 = 20 %
  assert.deepEqual(L.derivedTags({ kcal: 400, protein: 19 }), []);
});

// --------------------------------------------------------------------- 10/11 Einkauf
test("10 Kompatible Mengen werden addiert, unvereinbare nicht", () => {
  const out = L.shoppingAggregate([
    { name: "Tomaten", amount: 200, unit: "g", factor: 1, source: "A" },
    { name: "Tomaten", amount: 300, unit: "g", factor: 1, source: "B" },
    { name: "Mehl", amount: 0.5, unit: "kg", factor: 1, source: "A" },
    { name: "Mehl", amount: 700, unit: "g", factor: 1, source: "B" },
    { name: "Milch", amount: 1, unit: "EL", factor: 1, source: "A" },
    { name: "Milch", amount: 200, unit: "ml", factor: 1, source: "B" },
    { name: "Tomaten", amount: 2, unit: "Dose", factor: 1, source: "C" },
    { name: "Salz", amount: null, unit: null, factor: 1, source: "A" }]);
  const get = (n, u) => out.find((x) => x.name === n && x.unit === u);
  assert.equal(get("Tomaten", "g").amount, 500);
  assert.equal(get("Tomaten", "g").sources, "A, B");
  assert.equal(get("Mehl", "kg").amount, 1.2);
  assert.equal(get("Milch", "ml").amount, 215);
  assert.equal(get("Tomaten", "Dose").amount, 2); // Dosen nicht zu Gramm addiert
  assert.equal(get("Salz", null).amount, null);
});

test("11 Skalierung nach Portionen", () => {
  // Rezept für 4 Portionen mit 400 g Nudeln; geplant 1 Portion (Faktor 0,25) und 2 Portionen (Faktor 0,5)
  const out = L.shoppingAggregate([
    { name: "Nudeln", amount: 400, unit: "g", factor: 0.25, source: "Pasta" },
    { name: "Nudeln", amount: 400, unit: "g", factor: 0.5, source: "Pasta" }]);
  assert.equal(out[0].amount, 300);
});

// --------------------------------------------------------------------- Gewicht
test("Gewichtstrend und Zusammenfassung", () => {
  assert.deepEqual(L.weightTrend([80, 82, 80]), [80, 80.5, 80.38]); // 80 → 80+0,25·2 → 80,5+0,25·(−0,5)
  const s = L.weightSummary([{ kg: 90 }, { kg: 86 }], 80);
  assert.equal(s.delta, -4); assert.equal(s.deltaPct, -4.4); assert.equal(s.progress, 40); assert.equal(s.toGo, 6);
});

// --------------------------------------------------------------------- Parser
test("Zutatenzeilen in vielen Schreibweisen", () => {
  const p = (l) => { const r = L.parseIngredient(l); return [r.amount, r.unit, r.name]; };
  assert.deepEqual(p("200 g Tomaten"), [200, "g", "Tomaten"]);
  assert.deepEqual(p("200g Tomaten"), [200, "g", "Tomaten"]);
  assert.deepEqual(p("1 EL Olivenöl"), [1, "EL", "Olivenöl"]);
  assert.deepEqual(p("½ TL Salz"), [0.5, "TL", "Salz"]);
  assert.deepEqual(p("1 1/2 Tassen Reis"), [1.5, "Tasse", "Reis"]);
  assert.deepEqual(p("Mehl: 250 g"), [250, "g", "Mehl"]);
  assert.deepEqual(p("• 150 ml Kokosmilch"), [150, "ml", "Kokosmilch"]);
  assert.deepEqual(p("3 Eier"), [3, null, "Eier"]);
  const r = L.parseIngredient("1-2 Zehen Knoblauch");
  assert.equal(r.amount, 1); assert.ok(r.unsure[0].includes("Mengenbereich"));
  assert.ok(L.parseIngredient("Kokosraspeln").unsure.includes("keine Menge erkannt"));
});

test("Rezepttext (z. B. iPhone-Livetext) wird strukturiert, Fehlendes markiert", () => {
  const t = `Cremige Tomaten-Pasta\nZubereitungszeit: 25 Min. | 2 Portionen\nZutaten\n200 g Spaghetti\n1 Dose Tomaten\n2 EL Olivenöl\nSalz\nZubereitung\n1. Spaghetti kochen.\n2. Tomaten in Öl\nerhitzen.\nNährwerte pro Portion: 520 kcal, Eiweiß 16 g, Kohlenhydrate 78 g, Fett 15 g`;
  const r = L.parseRecipeText(t);
  assert.equal(r.title, "Cremige Tomaten-Pasta");
  assert.equal(r.servings, 2); assert.equal(r.prepMinutes, 25);
  assert.equal(r.ingredients.length, 4);
  assert.equal(r.instructions, "Spaghetti kochen.\nTomaten in Öl erhitzen.");
  assert.deepEqual([r.nutrition.kcal, r.nutrition.protein, r.nutrition.carbs, r.nutrition.fat, r.nutrition.basis], [520, 16, 78, 15, "portion"]);
  assert.deepEqual(r.missing, []);
  const leer = L.parseRecipeText("Nur ein Titel");
  assert.ok(leer.missing.includes("Zutaten") && leer.missing.includes("Nährwerte") && leer.missing.includes("Portionszahl"));
});

test("Nährwerte je 100 g werden nicht als Portion übernommen", () => {
  const n = L.parseNutrition("Nährwerte pro 100 g: 180 kcal");
  assert.equal(n.kcal, null);
  assert.ok(n.unsure[0].includes("100 g"));
  assert.equal(L.parseNutrition("Gesamt 1800 kcal").basis, "gesamt");
});

test("JSON eines externen Extraktors (Claude) wird übernommen", () => {
  const r = L.parseRecipeJson({ title: "Bowl", servings: 2, prep_minutes: 20, ingredients: [{ name: "Reis", amount: 150, unit: "g" }, "1 EL Öl", { name: "Lachs" }],
    steps: ["A", "B"], nutrition: { kcal: 600, basis: "portion" }, photo_box: { l: 0, t: 10, r: 100, b: 50 }, unsure: ["Portionen schlecht lesbar"] });
  assert.equal(r.ingredients[1].unit, "EL");
  assert.ok(r.ingredients[2].unsure.includes("keine Menge erkannt"));
  assert.equal(r.instructions, "A\nB");
  assert.deepEqual(r.photoBox, { l: 0, t: 10, r: 100, b: 50 });
  assert.ok(r.missing.includes("Mengen einzelner Zutaten"));
});

test("Fotobereich in einem Screenshot finden", () => {
  // 100×200 px: weißer Hintergrund, Zeilen 20–79 farbiges „Foto“, darunter schwarzer Text
  const w = 100, h = 200, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 20; y < 80; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = 200; data[i + 1] = 120; data[i + 2] = 40; }
  for (let y = 100; y < 180; y += 4) for (let x = 10; x < 90; x += 3) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 20; }
  const box = L.detectPhotoBox({ width: w, height: h, data });
  assert.deepEqual(box, { l: 0, t: 10, r: 100, b: 40 });
  assert.equal(L.detectPhotoBox({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }), null);
});

// --------------------------------------------------------------------- Rotation & Historie
test("Rotation: Favoriten häufiger, kürzlich Gezeigtes seltener, Abneigungen nie", () => {
  const rec = (id, extra = {}) => ({ id, title: id, category: "abend", prepMinutes: 20, ingredients: [{ name: id }], tags: [], autoTags: [], nut: { perPortion: { kcal: 500 } }, ...extra });
  const base = { today: "2026-10-17", remaining: 1500, favorites: new Set(["fav"]), taken: new Set(), lastShown: { gezeigt: "2026-10-16" }, lastEaten: {}, skipped: new Set(), dislikes: ["Pilze"], likes: [] };
  const sc = L.scoreCandidates([rec("fav"), rec("normal"), rec("gezeigt"), rec("Pilze")], base);
  const w = Object.fromEntries(sc.map((c) => [c.recipe.id, c.weight]));
  assert.ok(w.fav > w.normal && w.normal > w.gezeigt);
  assert.equal(w.Pilze, undefined);
  assert.ok(sc.find((c) => c.recipe.id === "fav").why.includes("Favorit"));
  // Häufigkeit über viele Tage: Favorit wird deutlich öfter gezogen
  let favCount = 0, normCount = 0;
  for (let d = 0; d < 400; d++) {
    const pick = L.weightedPick(L.scoreCandidates([rec("fav"), rec("normal"), rec("x"), rec("y")], { ...base, lastShown: {} }), "s" + d, 1)[0].recipe.id;
    if (pick === "fav") favCount++; if (pick === "normal") normCount++;
  }
  assert.ok(favCount > 2 * normCount, `${favCount} vs ${normCount}`);
  // reproduzierbar
  assert.deepEqual(L.weightedPick(sc, "a", 2).map((c) => c.recipe.id), L.weightedPick(sc, "a", 2).map((c) => c.recipe.id));
});

test("Historie wertet nur vollständige Tage, leere Tage nie", () => {
  const s = L.historyStats([
    { hasData: false, complete: false },
    { hasData: true, complete: false, eaten: 1000 },
    { hasData: true, complete: true, unknown: false, eaten: 1900, deviation: -100, hit: true, protein: 100 },
    { hasData: true, complete: true, unknown: false, eaten: 2300, deviation: 300, hit: false, protein: 80 },
    { hasData: true, complete: true, unknown: true, eaten: 500 }]);
  assert.equal(s.completeDays, 2); assert.equal(s.partialDays, 2);
  assert.equal(s.avgKcal, 2100); assert.equal(s.avgDev, 100); assert.equal(s.hitRate, 50);
  assert.equal(s.avgProtein, null); // erst ab 3 Tagen
});

test("Datumsrechnung über Monats- und Zeitumstellungsgrenzen", () => {
  assert.equal(L.addDays("2026-10-24", 2), "2026-10-26"); // Zeitumstellung 25.10.
  assert.equal(L.addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(L.daysBetween("2026-10-20", "2026-10-27"), 7);
});

test("Portionen umrechnen: küchentaugliche Rundung", () => {
  const sc = (a, u, f) => L.scaleAmount(a, u, f);
  assert.deepEqual(sc(150, "g", 2), { amount: 300, unit: "g" });
  assert.deepEqual(sc(60, "g", 4), { amount: 240, unit: "g" });
  assert.deepEqual(sc(60, "g", 1 / 3), { amount: 20, unit: "g" });
  assert.deepEqual(sc(250, "g", 4), { amount: 1, unit: "kg" });
  assert.deepEqual(sc(200, "ml", 7), { amount: 1.4, unit: "l" });
  assert.deepEqual(sc(1, "EL", 2.5), { amount: 2.5, unit: "EL" });
  assert.deepEqual(sc(1, "TL", 0.3), { amount: 0.25, unit: "TL" });
  assert.deepEqual(sc(1, null, 2.5), { amount: 2.5, unit: null });
  assert.deepEqual(sc(2, "Zehe", 3.3), { amount: 7, unit: "Zehe" });
  assert.deepEqual(sc(null, "g", 3), { amount: null, unit: "g" });
});
