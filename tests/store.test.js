/* Geschäftsregeln über die Datenbankschicht (mit In-Memory-Datenbank, gleiche Semantik wie die App).
 * Ausführen: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore, slotForCategory } = require("../src/store.js");
const { FakeDB } = require("./fakedb.js");
const { docs } = require("../tools/make_seed.js");

const DAY = "2026-10-17";
const now = () => new Date(2026, 9, 17, 12, 0, 0);

async function setup(db = new FakeDB(), seed = true) {
  if (seed) for (const d of docs) await db.doc(d.path).set(d.data);
  const st = createStore(db, { now });
  st.subscribe();
  return { db, st };
}

/** Profil 1 mit festen Werten: Mann, 80 kg, 180 cm, 37 J., PAL 1,5, manuelles Ziel 2.000 kcal. */
async function ready() {
  const ctx = await setup();
  await ctx.st.saveProfile("p1", { heightCm: 180, goalMode: "manuell", goalKcalManual: 2000 }, 80);
  await ctx.st.saveProfile("p2", { heightCm: 168, goalMode: "halten" }, 65);
  // Testrezept mit Originalwert 700 kcal je Portion (2 Portionen) und Zutaten
  const rid = await ctx.st.saveRecipe({ title: "Testcurry", category: "abend", servings: 2, prepMinutes: 30,
    ingredients: [{ name: "Reis", amount: 150, unit: "g" }, { name: "Tomaten", amount: 400, unit: "g" }],
    nutrition: { kcal: 700, protein: 30, carbs: 90, fat: 20, basis: "portion" } });
  return { ...ctx, rid };
}

test("Energie aus Profil: Grundumsatz, PAL, Bedarf, manuelles Ziel", async () => {
  const { st } = await ready();
  const e = st.energyFor("p1", DAY);
  assert.equal(e.bmr, 1745); assert.equal(e.tdee, 2618); assert.equal(e.goal, 2000);
  assert.equal(st.energyFor("p2", DAY).goal, 2046); // 1364 · 1,5
});

test("4/5/20 Geplant zählt nicht, gegessen schon – Beispiel 2.000 / 650 / 700", async () => {
  const { st, rid } = await ready();
  await st.addMeal("p1", DAY, "mittag", { title: "Mittag manuell", manual: { kcal: 650 }, status: "gegessen", id: "m-mittag" });
  const din = await st.addMeal("p1", DAY, "abend", { recipeId: rid, status: "geplant" });
  let b = st.day("p1", DAY).budget;
  assert.equal(b.remaining, 1350); assert.equal(b.afterPlan, 650);
  await st.setMealStatus("p1", DAY, din, "gekocht");
  assert.equal(st.day("p1", DAY).budget.remaining, 1350); // „gekocht“ ändert die Bilanz nicht
  await st.setMealStatus("p1", DAY, din, "gegessen");
  b = st.day("p1", DAY).budget;
  assert.equal(b.remaining, 650); assert.equal(b.afterPlan, 650);
});

test("6 Halbe Portion rechnet die Hälfte an; Korrektur aktualisiert die Bilanz", async () => {
  const { st, rid } = await ready();
  const id = await st.addMeal("p1", DAY, "abend", { recipeId: rid });
  await st.setMealStatus("p1", DAY, id, "gegessen", 0.5);
  assert.equal(st.day("p1", DAY).budget.eaten, 350);
  await st.updateMeal("p1", DAY, id, { portions: 1.5 });
  assert.equal(st.day("p1", DAY).budget.eaten, 1050);
  assert.equal(st.day("p1", DAY).budget.remaining, 950);
  await st.deleteMeal("p1", DAY, id);
  assert.equal(st.day("p1", DAY).budget.remaining, 2000);
});

test("7 Wiederholtes Antippen bucht nicht doppelt", async () => {
  const { st, rid } = await ready();
  const id = await st.addMeal("p1", DAY, "abend", { recipeId: rid });
  await Promise.all([st.setMealStatus("p1", DAY, id, "gegessen"), st.setMealStatus("p1", DAY, id, "gegessen"), st.setMealStatus("p1", DAY, id, "gegessen")]);
  assert.equal(st.day("p1", DAY).budget.eaten, 700);
  // gleiche Anlage-ID (z. B. Formular doppelt abgeschickt) = ein Eintrag
  await Promise.all([st.addMeal("p1", DAY, "snack", { id: "tok1", title: "Apfel", manual: { kcal: 52 }, status: "gegessen" }),
    st.addMeal("p1", DAY, "snack", { id: "tok1", title: "Apfel", manual: { kcal: 52 }, status: "gegessen" })]);
  assert.equal(st.meals("p1", DAY).filter((m) => m.title === "Apfel").length, 1);
  assert.equal(st.day("p1", DAY).budget.eaten, 752);
  // zweimal „Merken“ im Radar = eine Vormerkung
  await st.radarDecide("p1", DAY, rid, "keep"); await st.radarDecide("p1", DAY, rid, "keep");
  assert.equal(st.meals("p1", DAY).filter((m) => m.status === "vorgemerkt").length, 1);
});

test("8/9 Sport: Haken allein bringt nichts, gültiger Wert wird angerechnet", async () => {
  const { st } = await ready();
  await st.setDayFlag("p1", DAY, "sportDone", true);
  assert.equal(st.day("p1", DAY).sport, 0);
  const a = await st.addActivity("p1", DAY, { kind: "laufen", minutes: 30 });
  assert.equal(st.day("p1", DAY).sport, 0); // noch kein Verbrauchswert hinterlegt
  assert.equal(st.activities("p1", DAY)[0].kcal, null);
  await st.setSportRate("p1", "laufen", 600, "eigener Durchschnitt");
  assert.equal(st.activities("p1", DAY).find((x) => x.id === a).kcal, 300); // 30 min · 600 kcal/h
  assert.equal(st.day("p1", DAY).budget.remaining, 2300);
  await st.addActivity("p1", DAY, { kind: "golf", minutes: 120, kcal: 450 });
  assert.equal(st.day("p1", DAY).sport, 750);
  await st.saveProfile("p1", { sportCreditPct: 50 });
  assert.equal(st.day("p1", DAY).sport, 375); // heute: neue Anrechnungsquote gilt
});

test("10/11 Einkaufsliste: Zusammenfassen, Skalieren auf Kochportionen, Nutzerzustand bleibt", async () => {
  const { st, rid } = await ready();
  const rid2 = await st.saveRecipe({ title: "Salat", category: "mittag", servings: 1, ingredients: [{ name: "Tomaten", amount: 300, unit: "g" }, { name: "Tomaten", amount: 1, unit: "Dose" }] });
  // Testcurry: 2 Portionen, 400 g Tomaten, 150 g Reis. Kochen für 2 → Faktor 1
  await st.addMeal("p1", DAY, "abend", { recipeId: rid, servings: 2 });
  await st.addMeal("p2", DAY, "abend", { recipeId: rid, servings: 2 });
  await st.addMeal("p1", DAY, "mittag", { recipeId: rid2, servings: 1 }); // 300 g + 1 Dose
  let s = st.shopping(DAY, "alle");
  const tg = s.items.find((i) => i.name === "Tomaten" && (i.unit === "g" || i.unit === "kg"));
  assert.equal(tg.unit, "kg"); assert.equal(tg.amount, 1.1);
  assert.equal(s.items.find((i) => i.unit === "Dose").amount, 1);
  assert.equal(s.items.find((i) => i.name === "Reis").amount, 300);
  assert.equal(st.shopping(DAY, "p1").items.find((i) => i.name === "Reis").amount, 150);
  await st.shoppingSet(DAY, "alle", tg.key, { checked: true });
  await st.shoppingAdd(DAY, "alle", "Kaffee", 500, "g");
  // Kochportionen ändern → Menge aktualisiert sich, Haken bleibt
  const m = st.meals("p2", DAY)[0];
  await st.updateMeal("p2", DAY, m.id, { servings: 4 });
  s = st.shopping(DAY, "alle");
  const tg2 = s.items.find((i) => i.name === "Tomaten" && (i.unit === "g" || i.unit === "kg"));
  assert.equal(tg2.amount, 1.5); assert.equal(tg2.checked, true);
  assert.ok(s.items.some((i) => i.name === "Kaffee" && !i.auto));
});

test("Standard 4 Portionen: Vormerken und Planen kochen für 4, Essensportion bleibt 1", async () => {
  const { st, rid } = await ready();
  await st.radarDecide("p1", DAY, rid, "keep");
  let m = st.meals("p1", DAY)[0];
  assert.equal(m.servings, 4); assert.equal(m.portions, 1);
  assert.equal(st.shopping(DAY, "p1").items.find((i) => i.name === "Reis").amount, 300); // 150 g für 2 → 300 g für 4
  await st.updateMeal("p1", DAY, m.id, { servings: 6 });
  assert.equal(st.shopping(DAY, "p1").items.find((i) => i.name === "Reis").amount, 450);
});

test("12 Wischlogik: links überspringt, rechts merkt vor, Rückgängig, nie gelöscht", async () => {
  const { st, rid } = await ready();
  const n = await st.radarDraw("p1", DAY, {}, 5);
  assert.equal(n, 5);
  const stack = st.radarStack("p1", DAY);
  assert.equal(stack.length, 5);
  const [a, b] = stack;
  await st.radarDecide("p1", DAY, a.id, "skip");
  assert.ok(!st.radarStack("p1", DAY).some((r) => r.id === a.id));
  assert.ok(st.recipe(a.id)); // nicht gelöscht
  assert.equal(st.radarLists("p1", DAY).uebersprungen[0].id, a.id);
  await st.radarDecide("p1", DAY, b.id, "keep");
  const vm = st.meals("p1", DAY).find((m) => m.recipeId === b.id);
  assert.equal(vm.status, "vorgemerkt");
  const d = st.day("p1", DAY);
  assert.equal(d.budget.eaten, 0); // nicht als gegessen verbucht
  assert.equal(d.budget.planned, vm.total.kcal); // aber in der Prognose
  await st.radarDecide("p1", DAY, b.id, "undo");
  assert.ok(!st.meals("p1", DAY).some((m) => m.recipeId === b.id));
  assert.ok(st.radarStack("p1", DAY).some((r) => r.id === b.id));
  // Weitere laden zieht keine bereits gezeigten Gerichte erneut
  await st.radarDraw("p1", DAY, {}, 5);
  const ids = Object.keys(st.dayDoc("p1", DAY).radar);
  assert.equal(new Set(ids).size, ids.length);
  // an einem späteren Tag darf ein übersprungenes Gericht wieder kommen
  await st.radarDraw("p1", "2026-10-25", {}, 20);
  assert.ok(Object.keys(st.dayDoc("p1", "2026-10-25").radar).includes(a.id));
  assert.equal(Object.keys(st.S.recipes).length, 9);
});

test("12b Zwei Stufen: rechts = Favorit, Stufe 2 = heute kochen, Mittag/Abend gemeinsame Kategorie", async () => {
  const { st } = await ready();
  await st.radarDraw("p1", DAY, {}, 5);
  const [a, b] = st.radarStack("p1", DAY);
  await st.radarDecide("p1", DAY, a.id, "fav");
  assert.ok(!st.recipe(a.id, "p1").favorite); // rechts = nur engere Auswahl, kein dauerhafter Favorit
  assert.equal(st.shopping(DAY, "p1").items.length, 0); // Auswahl allein erzeugt noch keine Einkaufsliste
  assert.ok(!st.radarStack("p1", DAY).some((r) => r.id === a.id)); // Stufe 1 ohne Favoriten
  assert.deepEqual(st.radarStack("p1", DAY, { stage: "fav" }).map((r) => r.id), [a.id]);
  await st.radarDecide("p1", DAY, a.id, "keep");
  assert.equal(st.radarStack("p1", DAY, { stage: "fav" }).length, 0);
  assert.ok(st.shopping(DAY, "p1").items.length > 0); // erst die Entscheidung in Stufe 2 erzeugt die Liste
  const m = st.meals("p1", DAY).find((x) => x.recipeId === a.id);
  assert.ok(["mittag", "abend", "fruehstueck"].includes(m.slot));
  assert.equal(m.servings, 4);
  await st.radarDecide("p1", DAY, b.id, "super"); // Superlike: engere Auswahl + dauerhafter Favorit
  assert.ok(st.recipe(b.id, "p1").favorite);
  assert.ok(st.radarStack("p1", DAY, { stage: "fav" }).some((r) => r.id === b.id));
  await st.radarDecide("p1", DAY, b.id, "undo"); // nimmt den Favoriten wieder zurück
  assert.ok(!st.recipe(b.id, "p1").favorite);
  assert.equal(slotForCategory("mittag", 9), "mittag");
  assert.equal(slotForCategory("abend", 9), "mittag");
  assert.equal(slotForCategory("main", 18), "abend");
  assert.equal(slotForCategory("fruehstueck", 18), "fruehstueck");
  assert.equal(slotForCategory("snack", 18), "fruehstueck");
  await st.radarDecide("p1", DAY, b.id, "keep", 4, "mittag");
  assert.equal(st.meals("p1", DAY).find((x) => x.recipeId === b.id).slot, "mittag");
  assert.ok(st.recipes("p1").every((r) => ["fruehstueck", "main"].includes(r.category)));
  // Einkaufsliste kennt die Mahlzeit samt Portionen
  assert.equal(st.shopping(DAY, "p1").meals.find((x) => x.id === m.id).servings, 4);
});

test("12c Zurücksetzen startet Entdecken komplett neu", async () => {
  const { st } = await ready();
  await st.radarDraw("p1", DAY, {}, 5);
  const [a, b, c] = st.radarStack("p1", DAY);
  await st.radarDecide("p1", DAY, a.id, "skip"); await st.radarDecide("p1", DAY, b.id, "fav"); await st.radarDecide("p1", DAY, b.id, "keep");
  await st.radarDecide("p1", DAY, c.id, "fav");
  await st.shoppingAdd(DAY, "p1", "Brot", 1, "Stk");
  await st.radarReset("p1", DAY, { slot: "main" });
  assert.equal(st.shopping(DAY, "p1").items.length, 0); // Einkaufsliste ebenfalls leer
  assert.equal(st.radarFavCount("p1", DAY), 0);
  assert.ok(!st.meals("p1", DAY).some((m) => m.recipeId === b.id)); // Vorgemerktes verschwindet von „Heute“
  assert.ok(st.recipe(b.id, "p1") && st.recipe(c.id, "p1") && !st.recipe(c.id, "p1").favorite); // Rezepte bleiben, Favorit weg
  assert.ok(st.radarStack("p1", DAY).length >= 5); // wieder alles in Stufe 1
});

test("12e Links wischen löscht (Rückgängig stellt wieder her)", async () => {
  const { st, rid } = await ready();
  const before = JSON.parse(JSON.stringify(st.S.recipes[rid]));
  await st.radarDecide("p1", DAY, rid, "del");
  assert.ok(!st.S.recipes[rid]);
  await st.restoreRecipe(rid, before);
  assert.equal(st.S.recipes[rid].title, before.title);
});

test("12d Einkaufsliste zurücksetzen nimmt Haken und Mengen zurück", async () => {
  const { st, rid } = await ready();
  await st.radarDecide("p1", DAY, rid, "keep");
  const it = st.shopping(DAY, "p1").items[0];
  await st.shoppingSet(DAY, "p1", it.key, { checked: true });
  assert.ok(st.shopping(DAY, "p1").items.find((x) => x.key === it.key).checked);
  await st.shoppingReset(DAY, "p1");
  assert.ok(!st.shopping(DAY, "p1").items.find((x) => x.key === it.key).checked);
});

test("13/14 Favoriten und alle Daten überstehen einen Neustart", async () => {
  const { db, st, rid } = await ready();
  await st.toggleFavorite("p1", rid);
  await st.addMeal("p1", DAY, "abend", { recipeId: rid, status: "gegessen" });
  await st.upsertWeight("p1", DAY, 79.4);
  const st2 = createStore(db, { now }); // „App neu gestartet“: neuer Speicher, gleiche Datenbank
  st2.subscribe();
  assert.ok(st2.favSet("p1").has(rid));
  assert.ok(!st2.favSet("p2").has(rid));
  assert.equal(st2.day("p1", DAY).budget.eaten, 700);
  assert.equal(st2.currentWeight("p1", DAY), 79.4);
  assert.equal(st2.profile("p1").heightCm, 180);
  await st2.toggleFavorite("p1", rid);
  assert.ok(!st2.favSet("p1").has(rid));
});

test("15 Profile bleiben vollständig getrennt", async () => {
  const { st, rid } = await ready();
  const id = await st.addMeal("p1", DAY, "abend", { recipeId: rid, status: "gegessen" });
  await st.addActivity("p1", DAY, { kind: "golf", minutes: 60, kcal: 300 });
  await st.upsertWeight("p1", DAY, 81);
  assert.equal(st.day("p2", DAY).budget.eaten, 0);
  assert.equal(st.day("p2", DAY).sport, 0);
  assert.equal(st.currentWeight("p2", DAY), 65);
  await assert.rejects(() => st.setMealStatus("p2", DAY, id, "geplant")); // fremde Mahlzeit nicht erreichbar
});

test("16 Rezeptänderung verändert frühere Verzehre nicht unbemerkt", async () => {
  const { st, rid } = await ready();
  const id = await st.addMeal("p1", "2026-10-15", "abend", { recipeId: rid, status: "gegessen" });
  await st.saveRecipe({ ...st.S.recipes[rid], nutrition: { kcal: 900, basis: "portion" } }, rid);
  const m = st.meals("p1", "2026-10-15")[0];
  assert.equal(m.total.kcal, 700);
  assert.equal(m.recipeChanged, true);
  await st.resnapshotMeal("p1", "2026-10-15", id); // bewusste Übernahme
  assert.equal(st.meals("p1", "2026-10-15")[0].total.kcal, 900);
  // geplante (nicht gegessene) Mahlzeiten folgen dagegen dem aktuellen Rezept
  await st.addMeal("p1", DAY, "abend", { recipeId: rid });
  assert.equal(st.day("p1", DAY).budget.planned, 900);
  // gelöschtes Rezept: gegessene Mahlzeit bleibt mit Titel und Wert erhalten
  await st.deleteRecipe(rid);
  assert.equal(st.meals("p1", "2026-10-15")[0].total.kcal, 900);
  assert.equal(st.meals("p1", "2026-10-15")[0].title, "Testcurry");
  assert.equal(st.meals("p1", DAY).length, 0);
});

test("Tagesziel bleibt für vergangene Tage eingefroren", async () => {
  const { st } = await ready();
  await st.addMeal("p2", "2026-10-10", "abend", { title: "Alt", manual: { kcal: 500 }, status: "gegessen" });
  assert.equal(st.dayDoc("p2", "2026-10-10").goalKcal, 2046);
  await st.addMeal("p2", DAY, "abend", { title: "Neu", manual: { kcal: 500 }, status: "gegessen" });
  await st.saveProfile("p2", { goalMode: "abnehmen", deficitKcal: 400 });
  assert.equal(st.dayDoc("p2", "2026-10-10").goalKcal, 2046);
  assert.equal(st.dayDoc("p2", DAY).goalKcal, 1646);
});

test("17/18 Fehlende Nährwerte machen einen Tag unvollständig statt ihn zu schönen", async () => {
  const { st } = await ready();
  const rid = await st.saveRecipe({ title: "Mystery", servings: 1, ingredients: [{ name: "Unbekanntes Pulver", amount: 50, unit: "g" }] });
  assert.equal(st.recipe(rid).nut.quality, "fehlt");
  await st.addMeal("p1", DAY, "abend", { recipeId: rid, status: "gegessen" });
  await st.setDayFlag("p1", DAY, "complete", true);
  const h = st.historyDays("p1", DAY, DAY);
  assert.equal(h.days[0].unknown, true);
  assert.equal(h.stats.completeDays, 0); // nicht als erfolgreich gewertet
  assert.equal(st.day("p1", DAY).budget.eatenUnknown, 1);
});

test("Historie: vollständige Tage, Abweichung, Zielerreichung", async () => {
  const { st } = await ready();
  await st.addMeal("p1", "2026-10-14", "abend", { title: "a", manual: { kcal: 1800, protein: 100 }, status: "gegessen" });
  await st.setDayFlag("p1", "2026-10-14", "complete", true);
  await st.addMeal("p1", "2026-10-15", "abend", { title: "b", manual: { kcal: 2300, protein: 90 }, status: "gegessen" });
  await st.setDayFlag("p1", "2026-10-15", "complete", true);
  await st.addMeal("p1", "2026-10-16", "abend", { title: "c", manual: { kcal: 900 }, status: "gegessen" }); // nicht abgeschlossen
  const h = st.historyDays("p1", "2026-10-13", "2026-10-17");
  assert.equal(h.stats.completeDays, 2); assert.equal(h.stats.partialDays, 1);
  assert.equal(h.stats.avgKcal, 2050); assert.equal(h.stats.avgDev, 50); assert.equal(h.stats.hitRate, 50);
  assert.equal(h.days[0].hasData, false); // leerer Tag: weder Erfolg noch Misserfolg
  assert.equal(h.days[0].hit, null);
});

test("19 Gewichtseinträge bearbeiten und löschen", async () => {
  const { st } = await ready();
  await st.upsertWeight("p1", "2026-10-01", 84);
  await st.upsertWeight("p1", "2026-10-10", 82.6);
  await st.upsertWeight("p1", "2026-10-11", 82.2, "nach Korrektur", "2026-10-10"); // Datum + Wert korrigiert
  await st.saveProfile("p1", { targetWeightKg: 78 });
  let w = st.weights("p1");
  assert.deepEqual(w.entries.map((e) => e.date), ["2026-10-01", "2026-10-11", DAY]);
  assert.equal(w.summary.start, 84); assert.equal(w.summary.current, 80); assert.equal(w.summary.delta, -4);
  assert.equal(w.summary.progress, 67); // (84 − 80) / (84 − 78)
  await st.deleteWeight("p1", DAY);
  w = st.weights("p1");
  assert.equal(w.summary.current, 82.2);
  assert.equal(st.energyFor("p1", DAY).bmr, 1767); // Bedarf folgt dem aktuellen Gewicht: 822 + 1125 − 185 + 5
});

test("Duplikaterkennung vor dem Speichern", async () => {
  const { st } = await ready();
  assert.ok(st.findDuplicates("Testcurry", []).length >= 1);
  assert.ok(st.findDuplicates("Test-Curry", []).length >= 1);
  assert.equal(st.findDuplicates("Zitronenkuchen", ["Mehl", "Zucker"]).length, 0);
});

test("Startdaten: Startrezepte berechnen sich vollständig aus der Lebensmitteltabelle", async () => {
  const { st } = await setup();
  const rs = st.recipes("p1");
  assert.equal(rs.length, 8);
  for (const r of rs) assert.equal(r.nut.quality, "berechnet", r.title);
  // Overnight Oats von Hand: 60 g Hafer 227,4 + 150 g Joghurt 88,5 + 100 ml Milch (103 g) 62,83 + 1 Banane (118 g) 105,02 + 10 g Walnüsse 65,4 = 549,15
  assert.equal(rs.find((r) => r.title.startsWith("Overnight")).nut.perPortion.kcal, 549);
});

test("Link-Import: vormerken, Duplikat, Status, ungültiger Link", async () => {
  const { st } = await setup();
  const a = await st.addLinkImport("https://example.com/rezept");
  assert.equal(await st.addLinkImport("https://example.com/rezept"), a);
  await assert.rejects(() => st.addLinkImport("kein link"));
  assert.equal(st.linkImports().length, 1);
  assert.equal(st.linkImports()[0].status, "offen");
  await st.setImportStatus(a, "uebernommen");
  assert.equal(st.linkImports()[0].status, "uebernommen");
  await st.deleteImport(a);
  assert.equal(st.linkImports().length, 0);
});

test("Wocheneinkauf: Gerichte der restlichen Woche werden zusammengezählt, vergangene Tage nicht", async () => {
  const { st, rid } = await ready();
  const mon = st.mondayOf(DAY); // 2026-10-12 (Sa 17.10. ist heute)
  assert.equal(mon, "2026-10-12");
  await st.addMeal("p1", "2026-10-13", "abend", { recipeId: rid, servings: 2 }); // vergangen
  await st.addMeal("p1", "2026-10-18", "abend", { recipeId: rid, servings: 2 });
  await st.addMeal("p2", "2026-10-18", "mittag", { recipeId: rid, servings: 4 });
  const w = st.shopping(mon + "__w", "alle");
  assert.equal(w.mealCount, 2); assert.ok(w.week);
  const reis = w.items.find((i) => i.name === "Reis");
  assert.equal(reis.amount, 450); // 150 g (2 Pers.) + 300 g (4 Pers.)
  await st.shoppingSet(mon + "__w", "alle", reis.key, { checked: true });
  assert.ok(st.shopping(mon + "__w", "alle").items.find((i) => i.name === "Reis").checked);
  assert.ok(!st.shopping(DAY, "alle").items.some((i) => i.checked)); // Tagesliste bleibt unberührt
});

test("Match: Gerichte, die die andere Person heute auswählt, stehen vorn und tragen ihren Namen", async () => {
  const { st } = await ready();
  await st.radarDraw("p1", DAY, {}, 5); await st.radarDraw("p2", DAY, {}, 20);
  const [a, b] = st.radarStack("p1", DAY);
  await st.radarDecide("p1", DAY, a.id, "fav"); await st.radarDecide("p1", DAY, b.id, "fav");
  assert.deepEqual(st.radarStack("p1", DAY, { stage: "fav" }).map((r) => r.matchWith), ["", ""]);
  if (!st.radarStack("p2", DAY).some((r) => r.id === b.id)) await st.radarDecide("p2", DAY, b.id, "undo");
  await st.radarDecide("p2", DAY, b.id, "fav");
  const s2 = st.radarStack("p1", DAY, { stage: "fav" });
  assert.equal(s2[0].id, b.id); assert.ok(s2[0].matchWith.length > 0); assert.equal(s2[1].matchWith, "");
});

test("Apple Health: Gewicht und Workout mit kcal werden übernommen, Unbrauchbares verworfen, Eingang leer", async () => {
  const { db, st } = await ready();
  await db.doc("health/p1").set({ entries: {
    w1: { type: "weight", date: DAY, kg: 79.6 },
    s1: { type: "workout", date: DAY, name: "Laufen", kcal: 350, minutes: 30 },
    s2: { type: "workout", date: DAY, name: "Yoga", kcal: 0, minutes: 30 },   // ohne Verbrauchswert: nicht anrechnen
    w2: { type: "weight", date: DAY, kg: 5 },                                   // unmöglich
    a1: { type: "active", date: DAY, kcal: 480 },
  } });
  await new Promise((r) => setTimeout(r, 20));
  const n = await st.importHealth("p1");
  assert.equal(n, 3);
  assert.equal(st.weights("p1").entries.find((e) => e.date === DAY).kg, 79.6);
  const acts = st.activities("p1", DAY);
  assert.equal(acts.length, 2); assert.equal(acts.find((a) => a.kind === "laufen").kcal, 350); assert.equal(acts.find((a) => a.id === "hkactive20261017").kcal, 480);
  assert.equal(st.hkOpen("p1").length, 0);
  assert.equal(await st.importHealth("p1"), 0);
});

test("Apple Health: Tagesverbrauch landet im Tag, ändert aber weder Budget noch Sport", async () => {
  const { db, st } = await ready();
  const before = st.day("p1", DAY).budget.total;
  await db.doc("health/p1").set({ entries: { b1: { type: "burn", date: DAY, rest: 2033, active: 239 }, b2: { type: "burn", date: "2026-10-16", rest: 0, active: 0 } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await st.importHealth("p1"), 1);               // 0/0 wird nicht übernommen
  const d = st.day("p1", DAY);
  assert.equal(d.burn.rest, 2033); assert.equal(d.burn.active, 239);
  assert.equal(d.budget.total, before); assert.equal(d.sport, 0); assert.equal(d.activities.length, 0);
});
