/* Supabase-Adapter: gleiche Semantik wie die Artifact-Datenbank, geprüft mit dem Fake und den echten Store-Regeln. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/backend.js");
const { createStore } = require("../src/store.js");
const { createFakeSupabase } = require("./fakesupabase.js");
const { docs } = require("../tools/make_seed.js");

const mem = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; }, removeItem: (k) => { delete m[k]; } }; };
async function connect() {
  const fake = createFakeSupabase();
  const client = B.createClient({ url: "http://x.test", key: "anon" }, fake.fetchFn, mem());
  await client.login("t@x.de", "pw");
  return { fake, client, db: B.createDb(client, { pollMs: 0 }) };
}

test("Anmeldung: falsches Passwort wird abgelehnt, ohne Anmeldung kein Zugriff", async () => {
  const fake = createFakeSupabase();
  const client = B.createClient({ url: "http://x.test", key: "anon" }, fake.fetchFn, mem());
  await assert.rejects(() => client.login("t@x.de", "falsch"), /Invalid login/);
  await assert.rejects(() => client.req("/rest/v1/docs"), (e) => e.code === "unauthenticated");
});

test("set, get, update (Zusammenführen, null), delete", async () => {
  const { db } = await connect();
  const ref = db.doc("favorites/p1");
  await assert.rejects(() => ref.update({ a: 1 }), (e) => e.code === "invalid_argument");
  await ref.set({ ids: { a: true, b: true } });
  await ref.update({ ids: { b: null, c: true } });
  const d = (await ref.get()).data();
  assert.deepEqual(d, { ids: { a: true, b: null, c: true } });
  await ref.delete();
  assert.equal((await ref.get()).exists, false);
});

test("onSnapshot liefert Dokumente und meldet eigene Änderungen sofort", async () => {
  const { db } = await connect();
  await db.doc("recipes/r1").set({ title: "A" });
  const seen = [];
  const un = db.collection("recipes").onSnapshot((s) => seen.push(s.docs.map((x) => x.id + ":" + x.data().title).join(",")));
  await new Promise((r) => setTimeout(r, 20));
  await db.doc("recipes/r2").set({ title: "B" });
  assert.equal(seen[seen.length - 1], "r1:A,r2:B");
  un();
});

test("zweites Gerät sieht die Daten (gleiche Datenbank, neuer Client)", async () => {
  const { fake, db } = await connect();
  await db.doc("profiles/p1").set({ name: "Tommy" });
  const c2 = B.createClient({ url: "http://x.test", key: "anon" }, fake.fetchFn, mem()); await c2.login("c@x.de", "pw");
  const got = [];
  B.createDb(c2, { pollMs: 0 }).collection("profiles").onSnapshot((s) => got.push(...s.docs.map((x) => x.data().name)));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, ["Tommy"]);
});

test("Store läuft auf dem Adapter: Seed laden, Rezept speichern, Entdecken-Entscheidung", async () => {
  const { db } = await connect();
  for (const d of docs) await db.doc(d.path).set(d.data);
  const st = createStore(db, { now: () => new Date(2026, 9, 17, 12) });
  st.subscribe();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(Object.keys(st.S.recipes).length >= 1);
  await st.saveProfile("p1", { heightCm: 180, goalMode: "manuell", goalKcalManual: 2000 }, 80);
  assert.equal(st.energyFor("p1", "2026-10-17").goal, 2000);
  const rid = await st.saveRecipe({ title: "Testcurry", category: "main", servings: 2, prepMinutes: 30, ingredients: [{ name: "Reis", amount: 150, unit: "g" }], nutrition: { kcal: 700, protein: 30, carbs: 90, fat: 20, basis: "portion" } });
  assert.ok(st.S.recipes[rid]);
  await st.deleteRecipe(rid);
  assert.equal(st.S.recipes[rid], undefined);
});

test("Schnell: geladene Sammlung wird sofort angezeigt, bevor gespeichert ist", async () => {
  const { db } = await connect();
  await db.doc("days/a").set({ x: 1 });
  const seen = [];
  const un = db.collection("days").onSnapshot((snap) => seen.push(snap.docs.map((d) => d.data().x)));
  await new Promise((r) => setTimeout(r, 30));
  const p = db.doc("days/a").update({ x: 2 });
  assert.equal(seen[seen.length - 1][0], 2, "Anzeige ändert sich vor dem Speichern");
  await p;
  assert.equal((await db.doc("days/a").get()).data().x, 2);
  un();
});
