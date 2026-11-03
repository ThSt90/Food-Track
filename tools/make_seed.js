/* Erzeugt die Startdokumente (Lebensmittel, Startrezepte, Profile) aus seed/*.
 * Ausgabe: seed/seed-docs.json = [{path, data}] zum Einspielen in die Artifact-Datenbank. */
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("../src/logic.js");
const { DEFAULT_PROFILES } = require("../src/store.js");

const root = path.join(__dirname, "..");
const csv = fs.readFileSync(path.join(root, "seed/lebensmittel.csv"), "utf8").trim().split("\n");
const head = csv.shift().split(";");
const num = (v) => (v === "" ? null : Number(v));
const foods = csv.map((line) => {
  const r = Object.fromEntries(line.split(";").map((v, i) => [head[i], v]));
  const id = "f-" + L.norm(r.name).replace(/ /g, "-");
  return { id, name: r.name, aliases: r.aliases, kcal: num(r.kcal), protein: num(r.protein), carbs: num(r.carbs), fat: num(r.fat), density: num(r.density), pieceG: num(r.piece_g), source: r.source };
});
const docs = foods.map(({ id, ...f }) => ({ path: "foods/" + id, data: f }));
const recipes = JSON.parse(fs.readFileSync(path.join(root, "seed/rezepte.json"), "utf8"));
recipes.forEach((r, i) => {
  const ingredients = r.ingredients.map((line) => {
    const p = L.parseIngredient(line);
    return { name: p.name, amount: p.amount, unit: p.unit, raw: line, foodId: L.matchFood(p.name, foods) };
  });
  docs.push({ path: "recipes/start-" + (i + 1), data: {
    title: r.title, titleKey: L.norm(r.title), category: r.category, prepMinutes: r.prep_minutes, servings: r.servings,
    effort: null, tags: r.tags || "", instructions: r.instructions, source: "Food-Radar-Startrezept (Nährwerte aus Zutaten berechnet)",
    image: null, importId: null, ingredients,
    nutrition: { kcal: null, protein: null, carbs: null, fat: null, basis: "portion", quality: "original" },
    version: 1, createdAt: "2026-10-17T12:00:00.000Z", updatedAt: "2026-10-17T12:00:00.000Z" } });
});
for (const [id, p] of Object.entries(DEFAULT_PROFILES)) docs.push({ path: "profiles/" + id, data: p });
fs.writeFileSync(path.join(root, "seed/seed-docs.json"), JSON.stringify(docs, null, 1));
module.exports = { docs, foods };
if (require.main === module) {
  const fmap = Object.fromEntries(foods.map((f) => [f.id, f]));
  for (const d of docs.filter((d) => d.path.startsWith("recipes/"))) {
    const n = L.recipeNutrition(d.data, fmap);
    console.log(d.data.title.padEnd(40), n.quality.padEnd(14), JSON.stringify(n.perPortion), n.missing.join(","));
    for (const i of d.data.ingredients) if (!i.foodId && !L.isNegligible(i.name)) console.log("   ohne Zuordnung:", i.name);
  }
  console.log(docs.length, "Dokumente");
}
