/* Food Radar – Datenzugriff und Aktionen über die Artifact-Datenbank (db-Capability).
 *
 * Datenmodell (Dokumentpfade):
 *   profiles/{pid}             Personenprofil
 *   foods/{id}                 Lebensmittel-Referenz, Nährwerte je 100 g + Quelle
 *   recipes/{id}               Rezept inkl. Zutaten, Originalnährwerten, Bild-ID, Version
 *   imports/{id}               Originalscreenshot, erkannter Text, Extraktor
 *   favorites/{pid}            {ids: {rezeptId: true}}
 *   days/{pid}__{datum}        Tageswerte (eingefrorenes Ziel), Mahlzeiten, Sport, Radar-Entscheidungen
 *   weights/{pid}              {entries: {datum: {kg, note}}}
 *   health/{pid}               Eingang für Apple Health (Kurzbefehl → Edge Function): {entries: {schlüssel: {type: weight|workout, date, kg | kcal, minutes, name}}}
 *   shopping/{datum}__{scope}  Nutzerzustand der Einkaufsliste (abgehakt, vorhanden, eigene Posten)
 *   settings/sport             eigene Sportarten und Verbrauchswerte je Person
 *
 * Ein Tag = ein Dokument: hält die Zahl der Dokumente klein (Limit 25.000) und hält alles,
 * was eine Buchung betrifft, in einem Schreibvorgang zusammen. Gelöschte Einträge sind null.
 */
(function (root, factory) {
  const L = typeof module === "object" && module.exports ? require("./logic.js") : root.FRL;
  const m = factory(L);
  if (typeof module === "object" && module.exports) module.exports = m;
  else root.FRS = m;
})(typeof self !== "undefined" ? self : this, function (L) {
  "use strict";

  const SLOTS = [["fruehstueck", "Frühstück"], ["mittag", "Mittagessen"], ["abend", "Abendessen"]];
  const slotOf = (m) => (m.slot === "snack" ? "fruehstueck" : m.slot); // Snacks gibt es nicht mehr; Altes landet beim Frühstück
  /** Rezept-Kategorien: Mittag und Abend sind eine gemeinsame Kategorie („main“); erst beim Einplanen wird gewählt. */
  const CATS = [["fruehstueck", "Frühstück"], ["main", "Mittag / Abend"]];
  const normCat = (c) => (c === "mittag" || c === "abend" || c === "main" ? "main" : c === "fruehstueck" || c === "snack" ? "fruehstueck" : "main");
  /** Vorgeschlagene Mahlzeit beim Einplanen: Hauptgerichte vor 15 Uhr zum Mittag, sonst zum Abend. */
  const slotForCategory = (c, hour = 18) => (normCat(c) === "main" ? (hour < 15 ? "mittag" : "abend") : normCat(c));
  const OPEN = ["vorgemerkt", "geplant", "gekocht"];
  const SPORT_KINDS = [["kraft", "Krafttraining"], ["laufen", "Laufen"], ["rad", "Radfahren"], ["schwimmen", "Schwimmen"], ["golf", "Golf"], ["sonstiges", "Sonstiges"]];
  const COLLECTIONS = ["profiles", "foods", "recipes", "favorites", "days", "weights", "shopping", "settings", "imports", "health"];
  const DEFAULT_PROFILES = {
    p1: { name: "Profil 1", sex: "m", ageYears: 37, birthDate: null, heightCm: null, pal: 1.5, goalMode: "halten", deficitKcal: 500, goalKcalManual: null, targetWeightKg: null, sportCreditPct: 100, dislikes: "", likes: "" },
    p2: { name: "Profil 2", sex: "w", ageYears: 35, birthDate: null, heightCm: null, pal: 1.5, goalMode: "halten", deficitKcal: 500, goalKcalManual: null, targetWeightKg: null, sportCreditPct: 100, dislikes: "", likes: "" },
  };

  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const live = (map) => Object.entries(map || {}).filter(([, v]) => v != null);
  const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  function createStore(db, opts = {}) {
    const S = { ready: {}, errors: [] };
    for (const c of COLLECTIONS) S[c] = {};
    const listeners = new Set();
    const now = opts.now || (() => new Date());
    const today = () => L.todayISO(now());
    const chains = {};
    let memo = { key: null, recipes: null };

    const emit = () => { memo.key = null; listeners.forEach((f) => f(S)); };

    function subscribe() {
      const unsubs = COLLECTIONS.map((c) => db.collection(c).onSnapshot((snap) => {
        const o = {};
        snap.docs.forEach((d) => { o[d.id] = d.data(); });
        S[c] = o; S.ready[c] = true; emit();
      }, (e) => { S.errors.push({ c, code: e && e.code }); emit(); }));
      return () => unsubs.forEach((u) => u());
    }

    /** Ein Schreibvorgang nach dem anderen je Dokument (Vorgabe der Datenbank). */
    function queue(path, fn) {
      const p = (chains[path] || Promise.resolve()).catch(() => {}).then(() => fn(db.doc(path)));
      chains[path] = p;
      return p;
    }
    /** Dokument anlegen, falls es fehlt, dann Teiländerung zusammenführen. */
    const patch = (path, base, change) => queue(path, async (ref) => {
      const snap = await ref.get();
      if (!snap.exists) await ref.set(clone(base));
      if (change && Object.keys(change).length) await ref.update(clone(change));
    });

    // ------------------------------------------------------------------ Profile & Energie
    const profiles = () => Object.keys(S.profiles).sort().map((id) => ({ id, ...S.profiles[id] }));
    const profile = (pid) => (S.profiles[pid] ? { id: pid, ...S.profiles[pid] } : null);

    function weightEntries(pid) {
      return live((S.weights[pid] || {}).entries).map(([date, v]) => ({ date, kg: v.kg, note: v.note || "" }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    /** Letzte Wägung bis zum Datum; für Tage vor der ersten Wägung gilt die erste (dokumentierte Regel). */
    function currentWeight(pid, date = today()) {
      const all = weightEntries(pid);
      const e = all.filter((x) => x.date <= date);
      return e.length ? e[e.length - 1].kg : all.length ? all[0].kg : null;
    }
    const energyFor = (pid, date = today()) => (profile(pid) ? L.energy(profile(pid), currentWeight(pid, date), date) : null);

    async function createDefaultProfiles() {
      for (const [id, p] of Object.entries(DEFAULT_PROFILES)) if (!S.profiles[id]) await queue("profiles/" + id, (ref) => ref.set(clone(p)));
    }

    async function saveProfile(pid, fields, weightKg) {
      await patch("profiles/" + pid, DEFAULT_PROFILES[pid] || DEFAULT_PROFILES.p1, fields);
      Object.assign(S.profiles[pid] = { ...(S.profiles[pid] || {}) }, fields); // lokal sofort sichtbar für die Neuberechnung
      if (weightKg != null && weightKg !== "" && Number(weightKg) !== currentWeight(pid)) await upsertWeight(pid, today(), Number(weightKg), "", null, false);
      await refreshDaySnapshots(pid);
    }

    // ------------------------------------------------------------------ Tage
    const dayKey = (pid, date) => `${pid}__${date}`;
    const dayDoc = (pid, date) => S.days[dayKey(pid, date)] || null;

    function dayBase(pid, date) {
      const e = energyFor(pid, date);
      return { pid, date, goalKcal: e ? e.goal : null, sportCreditPct: profile(pid) ? profile(pid).sportCreditPct ?? 100 : 100,
        sportDone: false, complete: false, meals: {}, sport: {}, radar: {} };
    }
    /** Tagesziel und Sportanrechnung werden beim ersten Eintrag des Tages eingefroren. */
    const dayPatch = (pid, date, change) => patch("days/" + dayKey(pid, date), dayBase(pid, date), change);

    /** Profiländerungen gelten ab heute; vergangene Tage behalten ihre eingefrorenen Werte. */
    async function refreshDaySnapshots(pid) {
      const t = today();
      for (const [k, d] of Object.entries(S.days)) {
        if (d && d.pid === pid && d.date >= t) {
          const e = energyFor(pid, d.date);
          await queue("days/" + k, (ref) => ref.update({ goalKcal: e ? e.goal : null, sportCreditPct: profile(pid).sportCreditPct ?? 100 }));
        }
      }
    }

    function daySettings(pid, date) {
      const d = dayDoc(pid, date);
      if (d) return { goalKcal: d.goalKcal, sportCreditPct: d.sportCreditPct, sportDone: !!d.sportDone, complete: !!d.complete, frozen: true };
      const e = energyFor(pid, date);
      return { goalKcal: e ? e.goal : null, sportCreditPct: profile(pid) ? profile(pid).sportCreditPct ?? 100 : 100, sportDone: false, complete: false, frozen: false };
    }

    const setDayFlag = (pid, date, flag, value) => dayPatch(pid, date, { [flag]: !!value });

    // ------------------------------------------------------------------ Rezepte
    const foodList = () => Object.entries(S.foods).filter(([, f]) => f).map(([id, f]) => ({ id, ...f })).sort((a, b) => a.name.localeCompare(b.name, "de"));
    const foodMap = () => { const o = {}; for (const f of foodList()) o[f.id] = f; return o; };
    const favSet = (pid) => new Set(live((S.favorites[pid] || {}).ids).map(([k]) => k));

    function recipeView(id, r, fm, favs) {
      const nut = L.recipeNutrition(r, fm);
      for (const row of nut.rows) { const f = row.foodId ? fm[row.foodId] : null; row.foodName = f ? f.name : null; row.foodSource = f ? f.source : null; }
      const tags = String(r.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      return { id, ...r, category: normCat(r.category), nut, tags, autoTags: L.derivedTags(nut.perPortion).filter((t) => !tags.includes(t)),
        effortShown: r.effort || L.effortFromMinutes(r.prepMinutes), effortDerived: !r.effort, favorite: favs ? favs.has(id) : false,
        mainIngredients: nut.rows.filter((x) => !L.isNegligible(x.name)).sort((a, b) => (b.grams || 0) - (a.grams || 0)).slice(0, 4).map((x) => x.name) };
    }
    /** Alle Rezepte mit berechneten Nährwerten (zwischengespeichert bis zur nächsten Datenänderung). */
    function recipes(pid) {
      const key = "r|" + pid;
      if (memo.key === key && memo.recipes) return memo.recipes;
      const fm = foodMap(), favs = pid ? favSet(pid) : null;
      memo = { key, recipes: Object.entries(S.recipes).filter(([, r]) => r).map(([id, r]) => recipeView(id, r, fm, favs)).sort((a, b) => a.title.localeCompare(b.title, "de")) };
      return memo.recipes;
    }
    const recipe = (id, pid) => (S.recipes[id] ? recipeView(id, S.recipes[id], foodMap(), pid ? favSet(pid) : null) : null);

    function findDuplicates(title, ingredientNames, excludeId) {
      const flat = (t) => L.norm(t).replace(/ /g, "");
      const key = flat(title);
      const names = new Set(ingredientNames.map(L.norm).filter(Boolean));
      const hits = [];
      for (const [id, r] of Object.entries(S.recipes)) {
        if (!r || id === excludeId) continue;
        const sim = key ? similarity(key, flat(r.title)) : 0;
        const other = new Set((r.ingredients || []).map((i) => L.norm(i.name)));
        const inter = [...names].filter((n) => other.has(n)).length;
        const jac = names.size && other.size ? inter / new Set([...names, ...other]).size : 0;
        if (sim >= 0.85 || (jac >= 0.8 && names.size >= 3)) hits.push({ id, title: r.title, score: Math.round(Math.max(sim, jac) * 100) });
      }
      return hits.sort((a, b) => b.score - a.score);
    }

    /** Rezept anlegen oder ändern. Zutaten ohne feste Zuordnung werden automatisch zugeordnet. */
    async function saveRecipe(data, id) {
      const old = id ? S.recipes[id] : null;
      id = id || newId();
      const foods = foodList();
      const ingredients = (data.ingredients || []).filter((i) => (i.name || "").trim()).map((i) => ({
        name: i.name.trim(), amount: i.amount === "" || i.amount == null || isNaN(Number(i.amount)) ? null : Number(i.amount),
        unit: L.normUnit(i.unit), raw: i.raw || "",
        foodId: i.foodId === "none" ? null : i.foodId && i.foodId !== "auto" ? i.foodId : L.matchFood(i.name, foods),
      }));
      const n = data.nutrition || {};
      const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
      const doc = {
        title: data.title.trim(), titleKey: L.norm(data.title), category: normCat(data.category),
        prepMinutes: num(data.prepMinutes), servings: num(data.servings) || 1, effort: data.effort || null,
        tags: String(data.tags || "").split(",").map((t) => t.trim()).filter(Boolean).join(", "),
        instructions: data.instructions || "", source: data.source || "", image: data.image ?? (old ? old.image || null : null),
        importId: data.importId ?? (old ? old.importId || null : null), ingredients,
        nutrition: { kcal: num(n.kcal), protein: num(n.protein), carbs: num(n.carbs), fat: num(n.fat), basis: n.basis === "gesamt" ? "gesamt" : "portion", quality: n.quality === "geschaetzt" ? "geschaetzt" : "original" },
        version: old ? (old.version || 1) + 1 : 1, createdAt: old ? old.createdAt : now().toISOString(), updatedAt: now().toISOString(),
      };
      await queue("recipes/" + id, (ref) => ref.set(doc));
      return id;
    }

    /** Löscht das Rezept; gegessene Mahlzeiten behalten Titel und eingefrorene Werte. */
    async function deleteRecipe(id) {
      const r = S.recipes[id];
      const t = today();
      for (const [k, d] of Object.entries(S.days)) {
        if (!d || d.date < t) continue;
        const gone = {};
        for (const [mid, m] of live(d.meals)) if (m.recipeId === id && m.status !== "gegessen") gone[mid] = null;
        const radar = d.radar && d.radar[id] ? { [id]: null } : null;
        if (Object.keys(gone).length || radar) await queue("days/" + k, (ref) => ref.update({ ...(Object.keys(gone).length ? { meals: gone } : {}), ...(radar ? { radar } : {}) }));
      }
      for (const pid of Object.keys(S.favorites)) if (favSet(pid).has(id)) await queue("favorites/" + pid, (ref) => ref.update({ ids: { [id]: null } }));
      await queue("recipes/" + id, (ref) => ref.delete());
      return r ? r.image : null;
    }

    const toggleFavorite = (pid, rid) => { const on = !favSet(pid).has(rid); return patch("favorites/" + pid, { ids: {} }, { ids: { [rid]: on ? true : null } }).then(() => on); };

    // ------------------------------------------------------------------ Mahlzeiten
    function perPortionLive(m) {
      if (m.recipeId && S.recipes[m.recipeId]) { const n = L.recipeNutrition(S.recipes[m.recipeId], foodMap()); return [n.perPortion, n.quality]; }
      const v = m.manual || {};
      const per = { kcal: v.kcal ?? null, protein: v.protein ?? null, carbs: v.carbs ?? null, fat: v.fat ?? null };
      return [per, per.kcal != null ? "geschaetzt" : "fehlt"];
    }

    function snapshotFor(m) {
      const [per, quality] = perPortionLive(m);
      const r = m.recipeId ? S.recipes[m.recipeId] : null;
      return { ...per, quality, recipeVersion: r ? r.version || 1 : null };
    }

    /** Mahlzeit anlegen. Gleiche ID (z. B. Doppeltipp) = derselbe Eintrag, nie ein zweiter. */
    async function addMeal(pid, date, slot, o = {}) {
      const id = o.id || newId();
      const existing = dayDoc(pid, date);
      if (existing && existing.meals && existing.meals[id]) return id;
      const r = o.recipeId ? S.recipes[o.recipeId] : null;
      const meal = { slot, recipeId: o.recipeId || null, title: r ? r.title : o.title || "Mahlzeit", status: o.status === "gegessen" ? "geplant" : o.status || "geplant",
        portions: Number(o.portions) > 0 ? Number(o.portions) : 1, servings: Number(o.servings) > 0 ? Number(o.servings) : 4, manual: o.manual || null, snap: null, eatenAt: null, createdAt: now().toISOString() };
      if (o.status === "gegessen") Object.assign(meal, { status: "gegessen", snap: snapshotFor(meal), eatenAt: now().toISOString() });
      await dayPatch(pid, date, { meals: { [id]: meal } });
      return id;
    }

    const mealOf = (pid, date, id) => { const d = dayDoc(pid, date); const m = d && d.meals ? d.meals[id] : null; if (!m) throw new Error("Mahlzeit nicht gefunden"); return m; };

    /** Idempotent: setzt einen Zustand statt etwas zu addieren. Erst „gegessen“ zählt in die Bilanz. */
    async function setMealStatus(pid, date, id, status, portions) {
      const m = mealOf(pid, date, id);
      const change = {};
      if (Number(portions) > 0) change.portions = Number(portions);
      if (status === "gegessen" && m.status !== "gegessen") Object.assign(change, { status, snap: snapshotFor(m), eatenAt: now().toISOString() });
      else if (status !== "gegessen" && OPEN.includes(status)) Object.assign(change, { status, snap: null, eatenAt: null });
      if (Object.keys(change).length) await dayPatch(pid, date, { meals: { [id]: change } });
    }

    async function updateMeal(pid, date, id, o) {
      const m = mealOf(pid, date, id);
      const change = {};
      if (Number(o.portions) > 0) change.portions = Number(o.portions);
      if (Number(o.servings) > 0) change.servings = Number(o.servings);
      if (o.slot) change.slot = o.slot;
      if (o.title) change.title = o.title;
      if (o.manual && !m.recipeId) {
        change.manual = o.manual;
        if (m.status === "gegessen") change.snap = { ...o.manual, quality: o.manual.kcal != null ? "geschaetzt" : "fehlt", recipeVersion: null };
      }
      if (Object.keys(change).length) await dayPatch(pid, date, { meals: { [id]: change } });
    }

    /** Bewusste Übernahme der aktuellen Rezeptwerte in einen bereits gebuchten Verzehr. */
    async function resnapshotMeal(pid, date, id) {
      const m = mealOf(pid, date, id);
      if (m.status === "gegessen") await dayPatch(pid, date, { meals: { [id]: { snap: snapshotFor(m) } } });
    }

    async function deleteMeal(pid, date, id) {
      const m = mealOf(pid, date, id);
      const d = dayDoc(pid, date);
      const change = { meals: { [id]: null } };
      if (m.recipeId && d.radar && d.radar[m.recipeId] && d.radar[m.recipeId].status === "vorgemerkt") change.radar = { [m.recipeId]: { status: "vorgeschlagen" } };
      await dayPatch(pid, date, change);
    }

    function meals(pid, date) {
      const d = dayDoc(pid, date);
      return live(d && d.meals).map(([id, m]) => {
        let per, quality, changed = false;
        if (m.status === "gegessen" && m.snap) {
          per = { kcal: m.snap.kcal, protein: m.snap.protein, carbs: m.snap.carbs, fat: m.snap.fat }; quality = m.snap.quality;
          const r = m.recipeId ? S.recipes[m.recipeId] : null;
          changed = !!(r && m.snap.recipeVersion && (r.version || 1) !== m.snap.recipeVersion);
        } else [per, quality] = perPortionLive(m);
        const total = {}; for (const k of L.MACROS) total[k] = per[k] == null ? null : Math.round(per[k] * m.portions * 10) / 10;
        const r = m.recipeId ? S.recipes[m.recipeId] : null;
        return { id, ...m, per, total, quality, recipeChanged: changed, image: r ? r.image || null : null, recipeExists: !!r };
      }).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }

    // ------------------------------------------------------------------ Sport
    const sportSettings = () => S.settings.sport || { kinds: {}, rates: {} };
    const sportKinds = () => [...SPORT_KINDS.map(([id, name]) => ({ id, name })), ...live(sportSettings().kinds).map(([id, k]) => ({ id, name: k.name }))];
    const sportRates = (pid) => Object.fromEntries(live((sportSettings().rates || {})[pid]));

    async function setSportRate(pid, kind, kcalPerHour, source) {
      const v = Number(kcalPerHour) > 0 ? { kcalPerHour: Number(kcalPerHour), source: source || "eigener Durchschnitt" } : null;
      await patch("settings/sport", { kinds: {}, rates: {} }, { rates: { [pid]: { [kind]: v } } });
      if (!v) return;
      // Bisher ohne Verbrauchswert erfasste Einheiten dieser Sportart erhalten den neuen Durchschnitt.
      for (const d of Object.values(S.days)) {
        if (!d || d.pid !== pid) continue;
        const ch = {};
        for (const [aid, a] of live(d.sport)) if (a.kind === kind && a.kcal == null) ch[aid] = { kcal: Math.round((a.minutes * v.kcalPerHour) / 60), kcalSource: `Durchschnitt ${v.kcalPerHour} kcal/h` };
        if (Object.keys(ch).length) await dayPatch(pid, d.date, { sport: ch });
      }
    }
    const addSportKind = (name) => patch("settings/sport", { kinds: {}, rates: {} }, { kinds: { ["k" + newId().slice(0, 8)]: { name } } });

    async function addActivity(pid, date, o) {
      const id = o.id || newId();
      let kcal = Number(o.kcal) > 0 ? Math.round(Number(o.kcal)) : null, source;
      if (kcal) source = o.source || "eigener Wert (z. B. Uhr)";
      else {
        const rate = sportRates(pid)[o.kind];
        if (rate) { kcal = Math.round((Number(o.minutes) * rate.kcalPerHour) / 60); source = `Durchschnitt ${rate.kcalPerHour} kcal/h`; }
        else source = "kein Verbrauchswert hinterlegt";
      }
      await dayPatch(pid, date, { sportDone: true, sport: { [id]: { kind: o.kind, minutes: Number(o.minutes), intensity: o.intensity || null, kcal, kcalSource: source, createdAt: now().toISOString() } } });
      return id;
    }
    const deleteActivity = (pid, date, id) => dayPatch(pid, date, { sport: { [id]: null } });
    const activities = (pid, date) => { const kinds = Object.fromEntries(sportKinds().map((k) => [k.id, k.name])); return live((dayDoc(pid, date) || {}).sport).map(([id, a]) => ({ id, ...a, kindName: kinds[a.kind] || a.kind })); };

    // ------------------------------------------------------------------ Tagesübersicht
    function day(pid, date) {
      const st = daySettings(pid, date);
      const ms = meals(pid, date);
      const acts = activities(pid, date);
      const sport = L.sportCredit(acts, st.sportCreditPct);
      const eaten = ms.filter((m) => m.status === "gegessen"), planned = ms.filter((m) => OPEN.includes(m.status));
      const budget = L.dayBudget(st.goalKcal, sport, eaten.map((m) => m.total.kcal), planned.map((m) => m.total.kcal));
      const macros = {};
      for (const k of ["protein", "carbs", "fat"]) macros[k] = { eaten: Math.round(eaten.reduce((s, m) => s + (m.total[k] || 0), 0)), complete: eaten.every((m) => m.total[k] != null), planned: Math.round(planned.reduce((s, m) => s + (m.total[k] || 0), 0)) };
      const slots = SLOTS.map(([key, label]) => { const list = ms.filter((m) => slotOf(m) === key); return { key, label, meals: list, multiOpen: list.filter((m) => OPEN.includes(m.status)).length > 1 }; });
      return { date, settings: st, budget, macros, slots, meals: ms, activities: acts, sport,
        unknown: budget.eatenUnknown > 0 || eaten.some((m) => m.quality === "unvollstaendig" || m.quality === "fehlt") };
    }

    // ------------------------------------------------------------------ Recipe Radar
    function radarEntries(pid, date) { return live((dayDoc(pid, date) || {}).radar).map(([rid, v]) => ({ rid, ...v })); }

    function radarContext(pid, date) {
      const lastShown = {}, lastEaten = {}, skipped = new Set();
      const since = L.addDays(date, -3);
      for (const d of Object.values(S.days)) {
        if (!d || d.pid !== pid || d.date > date) continue;
        if (d.date < date) for (const [rid, v] of live(d.radar)) {
          if (!lastShown[rid] || lastShown[rid] < d.date) lastShown[rid] = d.date;
          if (v.status === "uebersprungen" && d.date >= since) skipped.add(rid);
        }
        for (const [, m] of live(d.meals)) if (m.status === "gegessen" && m.recipeId && (!lastEaten[m.recipeId] || lastEaten[m.recipeId] < d.date)) lastEaten[m.recipeId] = d.date;
      }
      return { lastShown, lastEaten, skipped };
    }

    /** Aktueller Kartenstapel (bleibt über den Tag stabil). */
    function radarStack(pid, date, filter = {}) {
      const all = Object.fromEntries(recipes(pid).map((r) => [r.id, r]));
      const slot = filter.slot ? normCat(filter.slot) : null;
      const okF = (r) => (!slot || r.category === slot) && (!filter.maxMinutes || (r.prepMinutes != null && r.prepMinutes <= filter.maxMinutes));
      if (filter.stage === "fav") {
        // Stufe 2: die in Stufe 1 nach rechts (oder per Superlike) gewählten Gerichte, über die heute noch nicht endgültig entschieden wurde
        return radarEntries(pid, date).filter((e) => e.status === "favorit" && all[e.rid]).sort((a, b) => (a.pos || 0) - (b.pos || 0))
          .map((e) => ({ ...all[e.rid], why: e.super ? ["Superlike"] : ["Ausgewählt"], matchWith: (radarMatches(pid, date)[e.rid] || []).join(", ") })).filter(okF)
          .sort((a, b) => (b.matchWith ? 1 : 0) - (a.matchWith ? 1 : 0));
      }
      // Stufe 1: alle Rezepte durchwischen; Favoriten aus früheren Tagen kommen hier dreifach so oft vor
      return radarEntries(pid, date).filter((e) => e.status === "vorgeschlagen" && all[e.rid]).sort((a, b) => a.pos - b.pos)
        .map((e) => ({ ...all[e.rid], why: e.why || [], matchWith: (radarMatches(pid, date)[e.rid] || []).join(", ") })).filter(okF);
    }
    /** Gerichte, die eine andere Person heute in der engeren Auswahl oder schon vorgemerkt hat -> Name. */
    function radarMatches(pid, date) {
      const out = {};
      for (const p of profiles()) if (p.id !== pid) for (const e of radarEntries(p.id, date)) if (e.status === "favorit" || e.status === "vorgemerkt") (out[e.rid] = out[e.rid] || []).push(p.name);
      return out;
    }
    const radarFavCount = (pid, date, filter = {}) => radarStack(pid, date, { ...filter, stage: "fav" }).length;

    /** Neue Karten ziehen – nur auf Nutzeraktion (Tab öffnen, „Weitere laden“, Filter ändern). */
    async function radarDraw(pid, date, filter = {}, n = 5) {
      const entries = radarEntries(pid, date);
      const p = profile(pid);
      const ctx = { today: date, remaining: day(pid, date).budget.remaining, slot: filter.slot ? normCat(filter.slot) : null, maxMinutes: filter.maxMinutes || null,
        favorites: favSet(pid), taken: new Set(entries.map((e) => e.rid)), dislikes: String(p.dislikes || "").split(","), likes: String(p.likes || "").split(","),
        ...radarContext(pid, date) };
      const picked = L.weightedPick(L.scoreCandidates(recipes(pid), ctx), `${pid}|${date}|${entries.length}|${filter.slot || ""}|${filter.maxMinutes || ""}`, n);
      if (!picked.length) return 0;
      const pos0 = entries.reduce((m, e) => Math.max(m, e.pos || 0), 0);
      const radar = {};
      picked.forEach((c, i) => { radar[c.recipe.id] = { status: "vorgeschlagen", pos: pos0 + i + 1, why: c.why, at: now().toISOString() }; });
      await dayPatch(pid, date, { radar });
      return picked.length;
    }

    /** skip = heute überspringen, keep = für heute vormerken, undo = zurücknehmen. Löscht nie ein Rezept. */
    async function radarDecide(pid, date, rid, action, servings, slot) {
      const r = S.recipes[rid];
      if (!r) throw new Error("Rezept nicht gefunden");
      if (action === "del") { await deleteRecipe(rid); return "geloescht"; } // nur auf ausdrücklichen Wunsch; die App hält eine Kopie für „Rückgängig“
      const status = { skip: "uebersprungen", keep: "vorgemerkt", fav: "favorit", super: "favorit", undo: "vorgeschlagen" }[action];
      const mealId = `radar-${rid}`;
      const d = dayDoc(pid, date);
      const prev = d && d.radar && d.radar[rid];
      const change = { radar: { [rid]: { status, at: now().toISOString(), ...(action === "super" ? { super: true } : action === "undo" ? { super: null } : {}), ...(prev ? {} : { pos: 9999, why: [] }) } } };
      const m = d && d.meals ? d.meals[mealId] : null;
      if (action === "keep" && !m) change.meals = { [mealId]: { slot: slot || slotForCategory(r.category, now().getHours()), recipeId: rid, title: r.title, status: "vorgemerkt", portions: 1, servings: Number(servings) > 0 ? Number(servings) : 4, manual: null, snap: null, eatenAt: null, createdAt: now().toISOString() } };
      if (action !== "keep" && m && (m.status === "vorgemerkt" || m.status === "geplant")) change.meals = { [mealId]: null };
      await dayPatch(pid, date, change);
      // Stufe 1: rechts = in die engere Auswahl (Stufe 2), nach oben (Superlike) = zusätzlich dauerhafter Favorit.
      // „Zurücknehmen“ entfernt nur den Favoriten wieder, den dieser Tag per Superlike gesetzt hat.
      if (action === "super" && !favSet(pid).has(rid)) await patch("favorites/" + pid, { ids: {} }, { ids: { [rid]: true } });
      if (action === "undo" && prev && prev.super && favSet(pid).has(rid)) await patch("favorites/" + pid, { ids: {} }, { ids: { [rid]: null } });
      return status;
    }

    /** Kompletter Neustart von „Entdecken“: alle Rezepte zurück in Stufe 1. Favoriten und alle Entscheidungen dieses Tages
     *  werden geleert, nur vorgemerkte (noch nicht gegessene) Gerichte aus dem Radar verschwinden von „Heute“. Rezepte bleiben. */
    async function radarReset(pid, date, filter = {}) {
      const radar = {};
      for (const e of radarEntries(pid, date)) radar[e.rid] = null;
      const change = {};
      if (Object.keys(radar).length) change.radar = radar;
      if (Object.keys(change).length) await dayPatch(pid, date, change);
      // vorgemerkte Radar-Gerichte aller Profile von heute entfernen, damit die gemeinsame Einkaufsliste wirklich leer ist
      for (const p of profiles()) {
        const mm = {};
        const dd = dayDoc(p.id, date);
        for (const [id, m] of live(dd && dd.meals)) if (id.startsWith("radar-") && m.status === "vorgemerkt") mm[id] = null;
        if (Object.keys(mm).length) await dayPatch(p.id, date, { meals: mm });
      }
      for (const key of Object.keys(S.shopping)) if (S.shopping[key] && key.startsWith(date + "__") && !key.slice(date.length + 2).startsWith("w__")) await shoppingReset(date, key.slice(date.length + 2)); // auch die Einkaufsliste des Tages
      if (filter.slot) await radarDraw(pid, date, { ...filter, stage: "alle" }, 8);
      return true;
    }

    function radarLists(pid, date) {
      const res = { vorgemerkt: [], uebersprungen: [] };
      for (const e of radarEntries(pid, date)) if (res[e.status] && S.recipes[e.rid]) res[e.status].push({ id: e.rid, title: S.recipes[e.rid].title, at: e.at });
      for (const k in res) res[k].sort((a, b) => (a.at < b.at ? 1 : -1));
      return res;
    }

    // ------------------------------------------------------------------ Einkaufsliste
    /** Abgeleitet aus den Gerichten des Tages; abgehakt/vorhanden/geänderte Mengen bleiben gespeichert. */
    /** Montag der Woche, in der `date` liegt. */
    const mondayOf = (date) => L.addDays(date, -((L.parseISO(date).getDay() + 6) % 7));
    /** date = "JJJJ-MM-TT" (ein Tag) oder "JJJJ-MM-TT__w" (Montag; Einkauf für den Rest der Woche ab heute). */
    function shopping(dateKey, scope) {
      const [date, flag] = String(dateKey).split("__");
      const dates = flag === "w" ? [0, 1, 2, 3, 4, 5, 6].map((i) => L.addDays(date, i)).filter((d) => d >= today()) : [date];
      const pids = scope === "alle" ? profiles().map((p) => p.id) : [scope];
      const lines = [];
      let mealCount = 0; const mealList = [];
      for (const day_ of dates) for (const pid of pids) for (const m of meals(pid, day_)) {
        const r = m.recipeId ? S.recipes[m.recipeId] : null;
        if (!r) continue;
        mealCount++;
        mealList.push({ pid, id: m.id, date: day_, title: r.title, servings: m.servings > 0 ? m.servings : 4, recipeServings: r.servings || 1, slot: m.slot, who: (profiles().find((p) => p.id === pid) || {}).name || "" });
        const factor = (m.servings > 0 ? m.servings : 4) / (r.servings || 1);
        for (const i of r.ingredients || []) lines.push({ name: i.name, amount: i.amount, unit: i.unit, factor, source: r.title });
      }
      const doc = S.shopping[`${dateKey}__${scope}`] || {};
      const state = doc.state || {};
      const items = L.shoppingAggregate(lines).map((a) => { const s = state[a.key] || {}; return { ...a, auto: true, checked: !!s.checked, have: !!s.have, override: s.override ?? null, shown: s.override ?? a.amount }; });
      for (const [id, x] of live(doc.manual)) items.push({ key: "m:" + id, id, name: x.name, amount: x.amount, unit: x.unit, shown: x.amount, auto: false, checked: !!x.checked, have: false, sources: "eigener Posten" });
      items.sort((a, b) => (a.checked || a.have) - (b.checked || b.have) || L.norm(a.name).localeCompare(L.norm(b.name)));
      return { date: dateKey, scope, items, mealCount, meals: mealList, week: flag === "w" };
    }
    const shopPath = (date, scope) => `shopping/${date}__${scope}`;
    const shoppingSet = (date, scope, key, change) => (key.startsWith("m:")
      ? patch(shopPath(date, scope), { state: {}, manual: {} }, { manual: { [key.slice(2)]: change } })
      : patch(shopPath(date, scope), { state: {}, manual: {} }, { state: { [key]: change } }));
    /** Komplett zurücksetzen: Haken, „schon da“, angepasste Mengen und eigene Posten dieser Liste. Die Gerichte bleiben. */
    const shoppingReset = (date, scope) => {
      if (!S.shopping[`${date}__${scope}`]) return Promise.resolve();
      return queue(shopPath(date, scope), (ref) => ref.set({ state: {}, manual: {} })); // Dokument ersetzen statt viele Felder einzeln zu löschen
    };
    const shoppingAdd = (date, scope, name, amount, unit) => patch(shopPath(date, scope), { state: {}, manual: {} },
      { manual: { [newId()]: { name, amount: amount === "" || amount == null ? null : Number(amount), unit: L.normUnit(unit), checked: false } } });
    const shoppingRemove = (date, scope, id) => patch(shopPath(date, scope), { state: {}, manual: {} }, { manual: { [id]: null } });

    // ------------------------------------------------------------------ Historie
    function historyDays(pid, from, to) {
      const out = [];
      const t = today();
      for (let d = from; d <= to; d = L.addDays(d, 1)) {
        const doc = dayDoc(pid, d);
        const info = { date: d, hasData: false, complete: false, goal: null, eaten: null, sport: 0, protein: null, remaining: null, deviation: null, hit: null, eatenN: 0, plannedN: 0, sportDone: false, unknown: false, future: d > t };
        if (doc) {
          const ms = meals(pid, d), acts = activities(pid, d);
          const eaten = ms.filter((m) => m.status === "gegessen");
          const sport = L.sportCredit(acts, doc.sportCreditPct);
          const kc = eaten.map((m) => m.total.kcal), pr = eaten.map((m) => m.total.protein);
          Object.assign(info, { hasData: !!(ms.length || acts.length || doc.sportDone), complete: !!doc.complete, goal: doc.goalKcal, sport, eatenN: eaten.length,
            plannedN: ms.filter((m) => OPEN.includes(m.status)).length, eaten: Math.round(kc.reduce((s, k) => s + (k || 0), 0)),
            protein: eaten.length && pr.every((p) => p != null) ? Math.round(pr.reduce((s, p) => s + p, 0)) : null, sportDone: !!doc.sportDone,
            unknown: kc.some((k) => k == null) || eaten.some((m) => m.quality === "unvollstaendig" || m.quality === "fehlt") });
          if (doc.goalKcal != null) {
            info.remaining = Math.round(doc.goalKcal + sport - info.eaten);
            if (info.complete && !info.unknown) { info.deviation = info.eaten - (doc.goalKcal + sport); info.hit = info.deviation <= 0; }
          }
        }
        out.push(info);
      }
      return { days: out, stats: L.historyStats(out) };
    }

    // ------------------------------------------------------------------ Gewicht
    async function upsertWeight(pid, date, kg, note = "", oldDate = null, refresh = true) {
      const entries = { [date]: { kg: Number(kg), note: note || "" } };
      if (oldDate && oldDate !== date) entries[oldDate] = null;
      await patch("weights/" + pid, { entries: {} }, { entries });
      const w = clone(S.weights[pid] || { entries: {} });
      Object.assign(w.entries, entries); S.weights[pid] = w; // lokal sofort für die Neuberechnung
      if (refresh) await refreshDaySnapshots(pid);
    }
    async function deleteWeight(pid, date) {
      await patch("weights/" + pid, { entries: {} }, { entries: { [date]: null } });
      const w = clone(S.weights[pid] || { entries: {} }); w.entries[date] = null; S.weights[pid] = w;
      await refreshDaySnapshots(pid);
    }
    // ------------------------------------------------------------------ Apple Health (Eingang)
    const HK_KIND = [[/kraft|strength|functional/i, "kraft"], [/lauf|run|walk|geh/i, "laufen"], [/rad|cycl|bike/i, "rad"], [/schwimm|swim/i, "schwimmen"], [/golf/i, "golf"]];
    const hkOpen = (pid) => live((S.health[pid] || {}).entries);
    let hkBusy = false;
    /** Übernimmt eingegangene Health-Werte über die normalen Wege: Gewicht nur 20–300 kg, Sport nur mit Verbrauchswert (kcal > 0). */
    async function importHealth(pid) {
      if (hkBusy) return 0;
      hkBusy = true; let n = 0;
      try {
        for (const [key, e] of hkOpen(pid)) {
          const okDate = /^\d{4}-\d{2}-\d{2}$/.test(e.date || "");
          if (okDate && e.type === "weight" && Number(e.kg) >= 20 && Number(e.kg) <= 300) { await upsertWeight(pid, e.date, Math.round(Number(e.kg) * 10) / 10, "Apple Health"); n++; }
          else if (okDate && e.type === "active" && Number(e.kcal) > 0 && Number(e.kcal) < 10000) { // aktive Energie des Tages: eine Einheit je Tag, wird bei jedem Lauf überschrieben
            await addActivity(pid, e.date, { id: "hkactive" + e.date.replace(/-/g, ""), kind: "sonstiges", minutes: 0, kcal: Number(e.kcal), source: "Apple Health (aktive Energie)" }); n++;
          }
          else if (okDate && e.type === "workout" && Number(e.kcal) > 0) {
            const kind = (HK_KIND.find(([re]) => re.test(e.name || "")) || [null, "sonstiges"])[1];
            await addActivity(pid, e.date, { id: "hk" + key, kind, minutes: Math.max(0, Number(e.minutes) || 0), kcal: Number(e.kcal), source: "Apple Health" }); n++;
          }
          await patch("health/" + pid, { entries: {} }, { entries: { [key]: null } }); // gültig oder unbrauchbar: aus dem Eingang nehmen
        }
      } finally { hkBusy = false; }
      return n;
    }

    function weights(pid) {
      const entries = weightEntries(pid);
      const trend = L.weightTrend(entries.map((e) => e.kg));
      entries.forEach((e, i) => { e.trend = trend[i]; });
      const p = profile(pid);
      return { entries, summary: L.weightSummary(entries, p ? p.targetWeightKg : null) };
    }

    // ------------------------------------------------------------------ Lebensmittel & Importe
    async function saveFood(data, id) {
      id = id || "f" + newId().slice(0, 10);
      const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
      await queue("foods/" + id, (ref) => ref.set({ name: data.name.trim(), aliases: data.aliases || "", kcal: num(data.kcal) ?? 0, protein: num(data.protein), carbs: num(data.carbs), fat: num(data.fat), density: num(data.density), pieceG: num(data.pieceG), source: data.source || "eigene Angabe" }));
      return id;
    }
    async function saveImport(data) {
      const id = newId();
      await queue("imports/" + id, (ref) => ref.set({ ...data, createdAt: now().toISOString() }));
      return id;
    }

    const linkImports = () => Object.keys(S.imports).filter((id) => S.imports[id] && S.imports[id].type === "link").map((id) => ({ id, ...S.imports[id] })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    /** Gelöschtes Rezept mit gleicher ID wiederherstellen („Rückgängig“). */
    const restoreRecipe = (id, doc) => queue("recipes/" + id, (ref) => ref.set(clone(doc)));
    async function addLinkImport(url, category) {
      url = String(url || "").trim();
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("bad_url");
      const dup = linkImports().find((l) => l.url === url && l.status !== "uebernommen");
      if (dup) return dup.id;
      return saveImport({ type: "link", url, status: "offen", category: normCat(category) });
    }
    const setImportStatus = (id, status) => queue("imports/" + id, (ref) => ref.update({ status }));
    const setImportRecipe = (id, recipe) => queue("imports/" + id, (ref) => ref.update({ recipe, status: "fertig" }));
    const deleteImport = (id) => queue("imports/" + id, (ref) => ref.delete());

    return {
      linkImports, addLinkImport, restoreRecipe, setImportRecipe, setImportStatus, deleteImport,
      S, subscribe, mondayOf, radarMatches, onChange: (f) => (listeners.add(f), () => listeners.delete(f)), emit, today,
      profiles, profile, createDefaultProfiles, saveProfile, energyFor, currentWeight,
      dayDoc, daySettings, setDayFlag, day, meals, addMeal, setMealStatus, updateMeal, resnapshotMeal, deleteMeal,
      foodList, foodMap, recipes, recipe, saveRecipe, deleteRecipe, findDuplicates, toggleFavorite, favSet,
      sportKinds, sportRates, setSportRate, addSportKind, addActivity, deleteActivity, activities,
      radarStack, radarFavCount, radarReset, radarDraw, radarDecide, radarLists, shopping, shoppingSet, shoppingReset, shoppingAdd, shoppingRemove,
      importHealth, hkOpen, historyDays, weights, upsertWeight, deleteWeight, saveFood, saveImport,
    };
  }

  function similarity(a, b) {
    // Dice-Koeffizient über Buchstabenpaare: robust gegen kleine Abweichungen im Titel
    const bi = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bi(a), B = bi(b);
    let inter = 0;
    for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
    return (2 * inter) / (a.length - 1 + b.length - 1);
  }

  return { createStore, SLOTS, CATS, normCat, slotForCategory, OPEN, SPORT_KINDS, DEFAULT_PROFILES, similarity };
});
