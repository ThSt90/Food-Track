/* Food Radar – reine Berechnungen (ohne Datenbank, ohne Oberfläche).
 * Läuft im Browser (window.FRL) und in Node (module.exports) und wird in tests/ gegen
 * von Hand gerechnete Referenzwerte geprüft. */
(function (root, factory) {
  const m = factory();
  if (typeof module === "object" && module.exports) module.exports = m;
  else root.FRL = m;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ======================================================================= Datum (lokale Kalendertage)
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = (now = new Date()) => iso(now);
  const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

  // ======================================================================= Energiebedarf
  // PAL nach DGE: beschreibt den Alltag OHNE geplanten Sport. Sport wird separat angerechnet.
  const PAL_LEVELS = [
    [1.4, "Büro, wenig Bewegung"],
    [1.5, "Büro, moderate Bewegung"],
    [1.6, "Sitzend, zeitweise gehend"],
    [1.7, "Sitzend, oft gehend/stehend"],
    [1.8, "Überwiegend gehend/stehend"],
    [1.9, "Gehend/stehend, körperlich fordernd"],
  ];

  function ageOn(birthDate, ageYears, onISO) {
    if (birthDate) {
      const b = parseISO(birthDate), o = parseISO(onISO);
      let a = o.getFullYear() - b.getFullYear();
      if (o.getMonth() < b.getMonth() || (o.getMonth() === b.getMonth() && o.getDate() < b.getDate())) a--;
      return a;
    }
    return ageYears ?? null;
  }

  /** Grundumsatz nach Mifflin-St. Jeor (1990). */
  function bmrMifflin(sex, kg, cm, age) {
    const base = 10 * kg + 6.25 * cm - 5 * age;
    return sex === "m" ? base + 5 : base - 161;
  }

  /** Grundumsatz, PAL, Gesamtbedarf und Tagesziel – oder was fehlt. Nie ein erfundener Wert. */
  function energy(p, weightKg, onISO) {
    const age = ageOn(p.birthDate, p.ageYears, onISO);
    const missing = [["Größe", p.heightCm], ["Gewicht", weightKg], ["Alter", age]].filter(([, v]) => !v).map(([k]) => k);
    const out = { bmr: null, tdee: null, pal: p.pal, age, missing, goal: null, goalSource: null, warnings: [] };
    if (!missing.length) {
      const b = bmrMifflin(p.sex, weightKg, p.heightCm, age);
      out.bmr = Math.round(b);
      out.tdee = Math.round(b * p.pal);
    }
    const mode = p.goalMode || "halten";
    const deficit = Number(p.deficitKcal) || 0;
    if (mode === "manuell" && p.goalKcalManual) {
      out.goal = Math.round(p.goalKcalManual); out.goalSource = "manuell festgelegt";
    } else if (out.tdee != null && mode === "abnehmen") {
      out.goal = out.tdee - deficit; out.goalSource = `Bedarf − ${deficit} kcal Defizit`;
    } else if (out.tdee != null) {
      out.goal = out.tdee; out.goalSource = "Bedarf (Gewicht halten)";
    }
    if (out.goal != null && out.bmr != null && out.goal < out.bmr)
      out.warnings.push("Ziel liegt unter dem Grundumsatz – ein so großes Defizit nur mit ärztlicher Begleitung.");
    if (mode === "abnehmen" && deficit > 1000) out.warnings.push("Ein Defizit über 1.000 kcal pro Tag ist sehr hoch.");
    return out;
  }

  // ======================================================================= Tagesbudget
  /** Nur Aktivitäten mit gültigem Verbrauchswert zählen; der Sport-Haken allein bringt 0 kcal. */
  function sportCredit(acts, pct) {
    const valid = acts.reduce((s, a) => s + (a.kcal > 0 ? a.kcal : 0), 0);
    return Math.round((valid * (pct ?? 100)) / 100);
  }

  /** Aktuell verbleibend = Ziel + Sport − Gegessenes. Geplantes reduziert nur die Prognose. */
  function dayBudget(goal, sport, eaten, planned) {
    const sum = (l) => l.reduce((s, k) => s + (k == null ? 0 : k), 0);
    const res = {
      goal, sport, eaten: Math.round(sum(eaten)), planned: Math.round(sum(planned)),
      eatenUnknown: eaten.filter((k) => k == null).length, plannedUnknown: planned.filter((k) => k == null).length,
      remaining: null, afterPlan: null,
    };
    if (goal != null) {
      res.remaining = Math.round(goal + sport - sum(eaten));
      res.afterPlan = Math.round(goal + sport - sum(eaten) - sum(planned));
    }
    return res;
  }

  /** Wie gut passt ein Gericht ins aktuell verbleibende Budget? */
  function fit(kcal, remaining) {
    if (kcal == null || remaining == null) return { cls: "none", label: "unbekannt", pct: 0, after: null };
    const after = Math.round(remaining - kcal);
    if (remaining <= 0) return { cls: "bad", label: "Budget aufgebraucht", pct: 100, after };
    const share = kcal / remaining;
    const pct = Math.min(100, Math.round(share * 100));
    if (share <= 0.6) return { cls: "hi", label: "passt gut", pct, after };
    if (share <= 1.0) return { cls: "mid", label: "passt", pct, after };
    if (share <= 1.15) return { cls: "low", label: "knapp drüber", pct, after };
    return { cls: "bad", label: "sprengt Budget", pct, after };
  }

  // ======================================================================= Text und Einheiten
  function norm(t) {
    return String(t || "").toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  const UNIT_ALIASES = {
    g: "g", gr: "g", gramm: "g", gram: "g", grams: "g", kg: "kg", kilo: "kg", kilogramm: "kg",
    ml: "ml", milliliter: "ml", cl: "cl", dl: "dl", l: "l", liter: "l", ltr: "l",
    el: "EL", essloeffel: "EL", essl: "EL", tbsp: "EL", tablespoon: "EL", tablespoons: "EL",
    tl: "TL", teeloeffel: "TL", teel: "TL", tsp: "TL", teaspoon: "TL", teaspoons: "TL",
    stueck: "Stück", stk: "Stück", st: "Stück", stck: "Stück", piece: "Stück", pieces: "Stück",
    zehe: "Zehe", zehen: "Zehe", clove: "Zehe", cloves: "Zehe", prise: "Prise", prisen: "Prise", pinch: "Prise",
    dose: "Dose", dosen: "Dose", can: "Dose", bund: "Bund", packung: "Packung", pck: "Packung", pckg: "Packung",
    becher: "Becher", tasse: "Tasse", tassen: "Tasse", cup: "cup", cups: "cup", scheibe: "Scheibe",
    scheiben: "Scheibe", handvoll: "Handvoll", msp: "Msp",
  };
  const VOLUME_ML = { ml: 1, cl: 10, dl: 100, l: 1000, EL: 15, TL: 5, cup: 236.6 };
  const MASS_G = { g: 1, kg: 1000 };

  const normUnit = (u) => { if (!u) return null; const k = norm(u).replace(/ /g, ""); return UNIT_ALIASES[k] || String(u).trim(); };
  const dimension = (u) => (u in MASS_G ? "mass" : u in VOLUME_ML ? "volume" : "count:" + (u || ""));

  // Zutaten, die ohne Mengenangabe energetisch vernachlässigbar sind (dokumentierte Regel)
  const NEGLIGIBLE = new Set(("salz pfeffer wasser gewuerz gewuerze kraeuter oregano basilikum petersilie schnittlauch dill " +
    "koriander muskat zimt kreuzkuemmel kurkuma currypulver curry paprikapulver chiliflocken chili lorbeer lorbeerblatt " +
    "thymian rosmarin minze essig zitronensaft limettensaft eis eiswuerfel").split(" "));
  const isNegligible = (name) => { const w = norm(name).split(" "); return w.some((x) => NEGLIGIBLE.has(x)); };

  /** Menge in Gramm. Ergebnis null, wenn es nur durch Raten ginge. */
  function toGrams(amount, unit, food) {
    if (unit === "Prise" || unit === "Msp") return [0, "Prise/Messerspitze = vernachlässigbar"];
    if (amount == null) return [null, "keine Menge"];
    if (unit in MASS_G) return [amount * MASS_G[unit], ""];
    if (unit in VOLUME_ML) {
      if (food && food.density) return [amount * VOLUME_ML[unit] * food.density, `Dichte ${food.density} g/ml`];
      return [null, "Volumen ohne bekannte Dichte"];
    }
    if (unit === "Stück" || unit === "Zehe" || !unit) {
      if (food && food.pieceG) return [amount * food.pieceG, `${food.pieceG} g je Stück`];
      return [null, "Stückgewicht unbekannt"];
    }
    return [null, `Einheit „${unit}“ nicht umrechenbar`];
  }

  const MACROS = ["kcal", "protein", "carbs", "fat"];
  const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

  function ingredientNutrition(ing, food) {
    if (ing.amount == null && ing.unit !== "Prise" && ing.unit !== "Msp" && isNegligible(ing.name))
      return { ok: true, grams: null, ...ZERO, note: "ohne Menge, vernachlässigbar" };
    if (!food) {
      if (isNegligible(ing.name) && ["Prise", "Msp", "TL", "EL"].includes(ing.unit))
        return { ok: true, grams: null, ...ZERO, note: "Gewürz, vernachlässigbar" };
      return { ok: false, grams: null, note: "kein Lebensmittel zugeordnet" };
    }
    const [g, note] = toGrams(ing.amount, ing.unit, food);
    if (g == null) return { ok: false, grams: null, note };
    const f = g / 100;
    const v = (x) => (x == null ? null : x * f);
    return { ok: true, grams: g, note, kcal: food.kcal * f, protein: v(food.protein), carbs: v(food.carbs), fat: v(food.fat) };
  }

  /** Nährwerte je Portion mit Datenqualität: Originalangabe > aus Zutaten berechnet > unvollständig.
   *  Basis „gesamt“ wird durch die Portionszahl geteilt – nie mit „je Portion“ verwechseln. */
  function recipeNutrition(recipe, foods) {
    const servings = recipe.servings || 1;
    const ings = recipe.ingredients || [];
    const total = { ...ZERO }, missing = [], gaps = new Set(), rows = [];
    for (const ing of ings) {
      const n = ingredientNutrition(ing, ing.foodId ? foods[ing.foodId] : null);
      rows.push({ ...ing, ...n });
      if (!n.ok) { missing.push(ing.name); continue; }
      for (const m of MACROS) { if (n[m] == null) gaps.add(m); else total[m] += n[m]; }
    }
    let computed = null;
    if (ings.length) { computed = {}; for (const m of MACROS) computed[m] = gaps.has(m) ? null : total[m] / servings; }
    const n = recipe.nutrition || {};
    let original = null;
    if (n.kcal != null && n.kcal !== "") {
      const div = n.basis === "gesamt" ? servings : 1;
      original = {}; for (const m of MACROS) original[m] = n[m] == null || n[m] === "" ? null : Number(n[m]) / div;
    }
    let per, quality;
    if (original) { per = original; quality = n.quality || "original"; }
    else if (computed && !missing.length) { per = computed; quality = "berechnet"; }
    else if (computed && missing.length < ings.length) { per = computed; quality = "unvollstaendig"; }
    else { per = { kcal: null, protein: null, carbs: null, fat: null }; quality = "fehlt"; }
    let deviationPct = null;
    if (original && computed && !missing.length && original.kcal) deviationPct = Math.round(((computed.kcal - original.kcal) / original.kcal) * 100);
    const rnd = (d) => { if (!d) return null; const o = {}; for (const m of MACROS) o[m] = d[m] == null ? null : m === "kcal" ? Math.round(d[m]) : Math.round(d[m] * 10) / 10; return o; };
    return { perPortion: rnd(per), quality, missing, rows, computed: rnd(computed), original: rnd(original), deviationPct, servings };
  }

  const QUALITY_LABEL = { original: "Originalwert", geschaetzt: "geschätzt", berechnet: "geschätzt (aus Zutaten)", unvollstaendig: "unvollständig", fehlt: "keine Nährwerte" };

  /** „Proteinreich“ nach EU-VO 1924/2006: mindestens 20 % der Energie aus Protein. */
  const derivedTags = (per) => (per && per.kcal > 0 && per.protein != null && (per.protein * 4) / per.kcal >= 0.2 ? ["proteinreich"] : []);
  const effortFromMinutes = (m) => (m == null || m === "" ? null : m <= 20 ? "leicht" : m <= 45 ? "mittel" : "aufwendig");

  // ======================================================================= Einkauf
  /** Zutaten zusammenfassen. lines: {name, amount, unit, factor, source}.
   *  Gleiche Zutat + gleiche Dimension wird addiert (g mit kg, ml mit l/EL/TL), sonst getrennte Posten. */
  function shoppingAggregate(lines) {
    const groups = new Map();
    for (const ln of lines) {
      const dim = dimension(ln.unit);
      const key = norm(ln.name) + "|" + dim;
      if (!groups.has(key)) groups.set(key, { key, name: ln.name.trim(), dim, parts: [], sources: [], noAmount: false });
      const g = groups.get(key);
      if (!g.sources.includes(ln.source)) g.sources.push(ln.source);
      if (ln.amount == null) g.noAmount = true; else g.parts.push([ln.amount * ln.factor, ln.unit]);
    }
    const out = [];
    for (const g of groups.values()) {
      let amount = null, unit = null;
      if (g.parts.length) {
        const units = new Set(g.parts.map((p) => p[1]));
        if (units.size === 1) { unit = g.parts[0][1]; amount = g.parts.reduce((s, p) => s + p[0], 0); }
        else if (g.dim === "mass") { unit = "g"; amount = g.parts.reduce((s, p) => s + p[0] * MASS_G[p[1]], 0); }
        else if (g.dim === "volume") { unit = "ml"; amount = g.parts.reduce((s, p) => s + p[0] * VOLUME_ML[p[1]], 0); }
        if (unit === "g" && amount >= 1000) { amount /= 1000; unit = "kg"; }
        if (unit === "ml" && amount >= 1000) { amount /= 1000; unit = "l"; }
        amount = Math.round(amount * 100) / 100;
      }
      out.push({ key: g.key, name: g.name, amount, unit, sources: g.sources.join(", "), extra: g.noAmount && amount != null });
    }
    return out.sort((a, b) => norm(a.name).localeCompare(norm(b.name)));
  }

  // ======================================================================= Portionen umrechnen
  /** Menge auf eine andere Portionszahl umrechnen und küchentauglich runden (Eigenentwicklung, keine Fremdbibliothek).
   *  g/ml: bis 10 auf 0,5 · bis 100 auf 5 · darüber auf 10; kg/l auf 0,05; EL/TL auf 0,25; Stück und Sonstiges auf 0,5 (ab 5 ganze Zahlen). */
  function scaleAmount(amount, unit, factor) {
    if (amount == null || amount === "" || isNaN(Number(amount))) return { amount: null, unit: unit || null };
    const v = Number(amount) * factor;
    const step = (x, s) => Math.round(x / s) * s;
    const clean = (x) => Math.round(x * 1000) / 1000;
    let a, u = unit || null;
    if (u === "g" || u === "ml") {
      a = v < 10 ? step(v, 0.5) : v < 100 ? step(v, 5) : step(v, 10);
      if (a >= 1000) { a = step(a / 1000, 0.05); u = u === "g" ? "kg" : "l"; }
    } else if (u === "kg" || u === "l") a = step(v, 0.05);
    else if (u === "EL" || u === "TL") a = step(v, 0.25);
    else a = v < 5 ? step(v, 0.5) : Math.round(v);
    if (a <= 0 && v > 0) a = u === "EL" || u === "TL" ? 0.25 : 0.5;
    return { amount: clean(a), unit: u };
  }

  // ======================================================================= Gewicht
  /** Exponentiell geglätteter Trend (dämpft Wasser- und Verdauungsschwankungen). */
  function weightTrend(values, alpha = 0.25) {
    let t = null;
    return values.map((v) => { t = t == null ? v : t + alpha * (v - t); return Math.round(t * 100) / 100; });
  }

  function weightSummary(entries, target) {
    if (!entries.length) return { start: null, current: null, delta: null, deltaPct: null, progress: null, toGo: null };
    const start = entries[0].kg, current = entries[entries.length - 1].kg;
    const delta = Math.round((current - start) * 10) / 10;
    const res = { start, current, delta, deltaPct: Math.round((delta / start) * 1000) / 10, progress: null, toGo: null };
    if (target != null && target !== "" && Number(target) !== start) {
      res.progress = Math.max(0, Math.min(100, Math.round(((start - current) / (start - target)) * 100)));
      res.toGo = Math.round((current - target) * 10) / 10;
    }
    return res;
  }

  // ======================================================================= Rezept-Parser
  const FRACTIONS = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };
  const NUM = "\\d+(?:[.,]\\d+)?";
  const FR = "[½¼¾⅓⅔⅛]";
  const AMOUNT_RE = new RegExp(`^(\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|${NUM}\\s*${FR}|${FR}|${NUM}(?:\\s*[-–]\\s*${NUM})?)\\s*(.*)$`);
  const TRAIL_RE = new RegExp(`^(.+?)[\\s:(,]+(${NUM}|\\d+\\s*/\\s*\\d+)\\s*([A-Za-zäöüÄÖÜ.]+)?\\)?\\s*$`);
  const BULLET_RE = /^[-*•·▪◦–—>□☐✓✔]+\s*/;

  function num(s) {
    s = s.trim();
    for (const [ch, v] of Object.entries(FRACTIONS)) if (s.endsWith(ch)) { const h = s.slice(0, -1).trim(); return (h ? parseFloat(h.replace(",", ".")) : 0) + v; }
    if (s.includes("/")) {
      const parts = s.split(/\s+/);
      const whole = parts.length === 2 ? parseFloat(parts[0]) : 0;
      const [a, b] = (parts.length === 2 ? parts[1] : s.replace(/\s/g, "")).split("/");
      return whole + parseFloat(a) / parseFloat(b);
    }
    return parseFloat(s.replace(",", "."));
  }

  const isUnitWord = (w) => !!w && norm(w).replace(/ /g, "") in UNIT_ALIASES;

  function parseIngredient(line) {
    const raw = String(line).trim();
    const text = raw.replace(BULLET_RE, "").trim();
    const res = { raw, name: text, amount: null, unit: null, unsure: [] };
    const m = text.match(AMOUNT_RE);
    if (m && m[2]) {
      const a = m[1];
      if (/[-–]/.test(a)) { res.amount = num(a.split(/[-–]/)[0]); res.unsure.push(`Mengenbereich „${a}“ – untere Grenze übernommen`); }
      else res.amount = num(a);
      let rest = m[2];
      const u = rest.match(/^([A-Za-zäöüÄÖÜß]+)\.?\s*(.*)$/);
      if (u && isUnitWord(u[1])) { res.unit = normUnit(u[1]); rest = u[2]; }
      res.name = rest.replace(/^[\s,:-]+|[\s,:-]+$/g, "") || text;
    } else {
      const t = text.match(TRAIL_RE);
      if (t && (!t[3] || isUnitWord(t[3]))) {
        res.name = t[1].replace(/^[\s,:(-]+|[\s,:(-]+$/g, "");
        res.amount = num(t[2]);
        res.unit = t[3] ? normUnit(t[3]) : null;
      }
    }
    if (res.amount == null && !isNegligible(res.name)) res.unsure.push("keine Menge erkannt");
    return res;
  }

  /** Lebensmittel mit dem längsten passenden Namen/Alias (ganze Wörter). */
  function matchFood(name, foods) {
    const padded = " " + norm(name) + " ";
    let best = null, bestLen = 0;
    for (const f of foods) {
      const cands = [norm(f.name), ...String(f.aliases || "").split(",").map(norm)];
      for (const a of cands) if (a && padded.includes(" " + a + " ") && a.length > bestLen) { best = f.id; bestLen = a.length; }
    }
    return best;
  }

  const H_ING = /^(zutaten|ingredients|du brauchst|das brauchst du|einkaufsliste)\b/i;
  const H_STEP = /^(zubereitung|anleitung|so geht'?s|so wird'?s gemacht|schritte|instructions|method|directions|preparation)\b/i;
  const H_NUT = /^(nährwerte|naehrwerte|nutrition|nährwertangaben)\b/i;
  const META = /(\bkcal\b|portion|person|\bmin\b|minuten|\bstunden?\b|schwierigkeit|zubereitungszeit|arbeitszeit)/i;
  const STEP_START = /^\s*(?:schritt\s*)?(\d{1,2})[.):]\s*/i;

  const findNum = (re, t) => { const m = t.match(re); return m ? parseFloat(m[1].replace(",", ".")) : null; };

  function parseNutrition(text) {
    const flat = text.replace(/\s+/g, " ");
    let kcal = findNum(new RegExp(`(${NUM})\\s*(?:kcal|kilokalorien)\\b`, "i"), flat);
    if (kcal == null) kcal = findNum(/(?:kalorien|energie|brennwert|calories)\D{0,12}?(\d{2,4})(?!\s*kj)/i, flat);
    const g = (names) => findNum(new RegExp(`(?:${names})\\D{0,10}?(${NUM})\\s*g\\b`, "i"), flat) ?? findNum(new RegExp(`(${NUM})\\s*g\\s*(?:${names})\\b`, "i"), flat);
    const out = { kcal, protein: g("protein|eiwei(?:ß|ss)"), carbs: g("kohlenhydrate?|carbs?|\\bkh"), fat: g("\\bfett|\\bfat"), basis: "portion", unsure: [] };
    if (out.kcal != null) {
      if (/(pro|je|per|\/)\s*(portion|person|serving|stück|stueck)/i.test(flat)) { /* eindeutig */ }
      else if (/(pro|je|per)\s*100\s*(g|ml)/i.test(flat)) {
        out.unsure.push("Nährwerte beziehen sich auf 100 g – nicht übernommen, bitte je Portion eintragen");
        Object.assign(out, { kcal: null, protein: null, carbs: null, fat: null });
      } else if (/(gesamt|insgesamt|total|ganzes rezept)/i.test(flat)) out.basis = "gesamt";
      else out.unsure.push("Bezug der Nährwerte nicht angegeben – als „je Portion“ angenommen");
    }
    return out;
  }

  function parseTime(head) {
    const flat = head.replace(/\s+/g, " ");
    const toMin = (v, u) => (/^(s|h)/i.test(u) ? Number(v) * 60 : Number(v));
    const tot = flat.match(/(gesamtzeit|gesamt|total(?: time)?)\D{0,12}?(\d+)\s*(min|minuten|std|stunden|h)\b/i);
    if (tot) return [toMin(tot[2], tot[3]), []];
    const re = /(arbeitszeit|zubereitungszeit|vorbereitung|kochzeit|backzeit|garzeit|prep time|cook time)\D{0,12}?(\d+)\s*(min|minuten|std|stunden|h)\b/gi;
    const labeled = [...flat.matchAll(re)];
    if (labeled.length) return [labeled.reduce((s, m) => s + toMin(m[2], m[3]), 0), labeled.length > 1 ? ["Zeiten addiert: " + labeled.map((m) => m[0]).join(", ")] : []];
    const m = flat.match(/(\d+)\s*(min\.?|minuten)\b/i);
    return m ? [Number(m[1]), ["Zeit ohne Beschriftung erkannt"]] : [null, []];
  }

  function parseServings(text) {
    const flat = text.replace(/\s+/g, " ");
    for (const re of [/(\d+)\s*(portionen|portion|personen|person|servings|serves)\b/i, /\bfür\s+(\d+)\b/i, /(?:portionen|servings|serves)\D{0,4}(\d+)/i]) {
      const m = flat.match(re);
      if (m) return Number(m[1]);
    }
    return null;
  }

  function finish(r, unsure) {
    const missing = [];
    if (!r.title) missing.push("Titel");
    if (!r.ingredients.length) missing.push("Zutaten");
    else if (r.ingredients.some((i) => i.amount == null && !isNegligible(i.name))) missing.push("Mengen einzelner Zutaten");
    if (!r.servings) missing.push("Portionszahl");
    if (!r.instructions) missing.push("Zubereitungsschritte");
    if (!r.prepMinutes) missing.push("Zubereitungszeit");
    if (r.nutrition.kcal == null) missing.push("Nährwerte");
    r.missing = missing; r.unsure = unsure;
    return r;
  }

  /** Freitext (OCR, iPhone-Livetext, Kopie) oder JSON → strukturierte Rezeptdaten. Nichts wird erfunden. */
  function parseRecipeText(text) {
    const st = String(text || "").trim();
    if (st.startsWith("{")) { try { return parseRecipeJson(JSON.parse(st)); } catch (e) { /* weiter als Text */ } }
    const lines = st.replace(/\r/g, "").split("\n").map((l) => l.trim());
    let section = "head";
    const head = [], ing = [], step = [];
    for (const ln of lines) {
      if (!ln) continue;
      if (H_ING.test(ln)) { section = "ing"; head.push(ln); const rest = ln.replace(H_ING, "").replace(/^[\s:]+/, ""); if (rest && !META.test(rest) && AMOUNT_RE.test(rest)) ing.push(rest); continue; }
      if (H_STEP.test(ln)) { section = "step"; continue; }
      if (H_NUT.test(ln)) { section = "nut"; continue; }
      ({ head, ing, step, nut: head })[section].push(ln);
    }
    const unsure = [];
    let title = null;
    for (const ln of head) {
      if (H_ING.test(ln) || META.test(ln) || /^(https?:\/\/|www\.|@|\d|[½¼¾])/.test(ln) || ln.length > 90) continue;
      if ((ln.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 3) { title = ln.replace(/^[\s#*]+|[\s#*]+$/g, ""); break; }
    }
    if (!ing.length) {
      for (const ln of head) if (AMOUNT_RE.test(ln) && /^\S*\d|^[½¼¾]/.test(ln) && !META.test(ln)) ing.push(ln);
      if (ing.length) unsure.push("Keine Überschrift „Zutaten“ gefunden – Zutaten anhand der Mengen erkannt");
    }
    const steps = [];
    for (const ln of step) {
      if (STEP_START.test(ln) || !steps.length || /[.!:]$/.test(steps[steps.length - 1])) steps.push(ln.replace(STEP_START, ""));
      else steps[steps.length - 1] += " " + ln; // Zeilenumbruch aus der Texterkennung zusammenführen
    }
    const [minutes, tUnsure] = parseTime(head.join("\n"));
    const nut = parseNutrition(st);
    const src = st.match(/(https?:\/\/\S+|www\.\S+|@[\w.]{3,})/);
    unsure.push(...tUnsure, ...nut.unsure);
    delete nut.unsure;
    return finish({
      title, servings: parseServings(head.join("\n")), prepMinutes: minutes,
      ingredients: ing.filter((l) => l.length > 1).map(parseIngredient), instructions: steps.join("\n"),
      nutrition: nut, source: src ? src[1] : "", category: null, tags: "", photoBox: null,
    }, unsure);
  }

  /** Strukturierte Daten eines Extraktors (Claude liest den Screenshot). */
  function parseRecipeJson(d) {
    const ings = (d.ingredients || []).map((it) => (typeof it === "string" ? parseIngredient(it) : {
      raw: it.raw || it.name || "", name: it.name || "", amount: it.amount == null || it.amount === "" ? null : Number(it.amount),
      unit: normUnit(it.unit), unsure: [...(it.unsure || [])],
    }));
    for (const i of ings) if (i.amount == null && !isNegligible(i.name) && !i.unsure.includes("keine Menge erkannt")) i.unsure.push("keine Menge erkannt");
    const nut = d.nutrition || {};
    const numOrNull = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
    const steps = d.steps || d.instructions || "";
    return finish({
      title: d.title || null, servings: numOrNull(d.servings), prepMinutes: numOrNull(d.prep_minutes ?? d.prepMinutes),
      ingredients: ings, instructions: Array.isArray(steps) ? steps.join("\n") : steps,
      nutrition: { kcal: numOrNull(nut.kcal), protein: numOrNull(nut.protein), carbs: numOrNull(nut.carbs), fat: numOrNull(nut.fat), basis: nut.basis === "gesamt" ? "gesamt" : "portion" },
      source: d.source || "", category: ["fruehstueck", "main", "mittag", "abend", "snack"].includes(d.category) ? d.category : null,
      tags: Array.isArray(d.tags) ? d.tags.join(", ") : d.tags || "", photoBox: d.photo_box || d.photoBox || null,
    }, [...(d.unsure || [])]);
  }

  // ======================================================================= Bildausschnitt
  /** Größter farbiger Fotobereich in einem verkleinerten Screenshot (Text ist meist farblos).
   *  img: {width, height, data: RGBA}. Ergebnis in Prozent {l, t, r, b} oder null. */
  function detectPhotoBox(img) {
    const { width: w, height: h, data } = img;
    const photo = (x, y) => {
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx ? ((mx - mn) / mx) * 255 : 0;
      return s > 35 && mx > 35 && mx < 235;
    };
    const rows = [];
    for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += photo(x, y); rows.push(c / w > 0.35); }
    let best = [0, -1], cur = null, gap = 0;
    rows.concat([false, false, false, false]).forEach((ok, y) => {
      if (ok) { cur = cur || [y, y]; cur[1] = y; gap = 0; }
      else if (cur && ++gap > 2) { if (cur[1] - cur[0] > best[1] - best[0]) best = cur; cur = null; gap = 0; }
    });
    if (best[1] - best[0] + 1 < 0.12 * h) return null;
    const [y0, y1] = best;
    const xs = [];
    for (let x = 0; x < w; x++) { let c = 0; for (let y = y0; y <= y1; y++) c += photo(x, y); if (c / (y1 - y0 + 1) > 0.3) xs.push(x); }
    const x0 = xs.length ? xs[0] : 0, x1 = xs.length ? xs[xs.length - 1] : w - 1;
    const pc = (v, t) => Math.round((v / t) * 1000) / 10;
    return { l: pc(x0, w), t: pc(y0, h), r: pc(x1 + 1, w), b: pc(y1 + 1, h) };
  }

  // ======================================================================= Recipe-Radar-Rotation
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = hashStr(seed); return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /** Nachvollziehbare Gewichtung; jede Regel hinterlässt einen sichtbaren Grund.
   *  c: {today, remaining, slot, maxMinutes, favorites:Set, taken:Set, lastShown:{id:date}, lastEaten:{id:date}, skipped:Set, dislikes:[], likes:[]} */
  function scoreCandidates(recipes, c) {
    const out = [];
    for (const r of recipes) {
      if (c.taken.has(r.id)) continue;
      if (c.slot && r.category !== c.slot) continue;
      if (c.maxMinutes && (r.prepMinutes == null || r.prepMinutes > c.maxMinutes)) continue;
      const text = " " + norm(r.title + " " + (r.ingredients || []).map((i) => i.name).join(" ")) + " ";
      if ((c.dislikes || []).some((x) => x && text.includes(" " + norm(x) + " "))) continue;
      let w = 1; const why = [];
      if (c.favorites.has(r.id)) { w *= 3; why.push("Favorit"); }
      if (c.lastShown[r.id]) {
        const d = daysBetween(c.lastShown[r.id], c.today);
        const f = d <= 1 ? 0.25 : d <= 3 ? 0.5 : d <= 7 ? 0.8 : 1;
        w *= f; if (f < 1) why.push(`vor ${d} T. gezeigt`);
      } else why.push("neu im Radar");
      if (c.lastEaten[r.id]) {
        const d = daysBetween(c.lastEaten[r.id], c.today);
        const f = d <= 2 ? 0.2 : d <= 6 ? 0.5 : d <= 13 ? 0.8 : 1;
        w *= f; why.push(f < 1 ? `vor ${d} T. gegessen` : "lange nicht gegessen");
      }
      if (c.skipped.has(r.id)) w *= 0.6;
      const kcal = r.nut ? r.nut.perPortion.kcal : null;
      if (kcal == null) w *= 0.7;
      else if (c.remaining != null) {
        const ft = fit(kcal, c.remaining);
        w *= { hi: 1.2, mid: 1, low: 0.6, bad: 0.3 }[ft.cls] || 1;
        if (ft.cls === "hi" || ft.cls === "mid") why.push("passt ins Budget");
      }
      const tags = norm((r.tags || []).join(" ") + " " + (r.autoTags || []).join(" "));
      if ((c.likes || []).some((x) => x && tags.includes(norm(x)))) { w *= 1.3; why.push("Vorliebe"); }
      out.push({ recipe: r, weight: Math.round(w * 1000) / 1000, why });
    }
    return out;
  }

  /** Gewichtete Zufallsauswahl ohne Zurücklegen (Efraimidis-Spirakis), reproduzierbar je Tag und Person. */
  function weightedPick(cands, seed, n) {
    const rand = rng(seed);
    return cands.map((c) => ({ c, k: -Math.log(rand() || 1e-12) / Math.max(c.weight, 1e-6) }))
      .sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.c);
  }

  // ======================================================================= Historie
  /** Kennzahlen nur aus vollständig dokumentierten Tagen; leere Tage werden nie gewertet. */
  function historyStats(days) {
    const full = days.filter((d) => d.complete && !d.unknown);
    const withGoal = full.filter((d) => d.deviation != null);
    const prot = full.filter((d) => d.protein != null).map((d) => d.protein);
    const avg = (l) => Math.round(l.reduce((s, x) => s + x, 0) / l.length);
    return {
      completeDays: full.length,
      partialDays: days.filter((d) => d.hasData && !(d.complete && !d.unknown)).length,
      avgKcal: full.length ? avg(full.map((d) => d.eaten)) : null,
      avgDev: withGoal.length ? avg(withGoal.map((d) => d.deviation)) : null,
      hitRate: withGoal.length ? Math.round((100 * withGoal.filter((d) => d.hit).length) / withGoal.length) : null,
      avgProtein: prot.length >= 3 ? avg(prot) : null,
    };
  }

  // ======================================================================= Anzeige
  function de(v, digits = 0) {
    if (v == null || v === "" || isNaN(v)) return "–";
    return Number(v).toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  const deAmount = (v) => (v == null ? "" : Number(v).toLocaleString("de-DE", { maximumFractionDigits: 2 }));

  return {
    todayISO, addDays, parseISO, daysBetween, PAL_LEVELS, ageOn, bmrMifflin, energy, sportCredit, dayBudget, fit,
    norm, UNIT_ALIASES, VOLUME_ML, MASS_G, normUnit, dimension, isNegligible, toGrams, ingredientNutrition,
    recipeNutrition, QUALITY_LABEL, derivedTags, effortFromMinutes, shoppingAggregate, scaleAmount, weightTrend, weightSummary,
    parseIngredient, matchFood, parseNutrition, parseTime, parseServings, parseRecipeText, parseRecipeJson,
    detectPhotoBox, scoreCandidates, weightedPick, historyStats, de, deAmount, MACROS,
  };
});
