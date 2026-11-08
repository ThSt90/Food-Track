// Foody – Rezeptvorschlag aus vorhandenen Zutaten (OpenAI). Eingabe: have (Zutaten, die da sind), missing (Zutaten, die NICHT da sind), tried (bisherige Titel), servings.
// Es wird nichts gespeichert: die App zeigt den Vorschlag, der Mensch hakt ab, was fehlt, und fragt neu an. Das Rezept wird vom Modell erstellt (keine Websuche).
// Schutz: nur angemeldete Nutzer; Secret OPENAI_API_KEY; Modell per OPENAI_MODEL_SUGGEST (Standard gpt-6.1-terra für bessere Rezepte; prüft den Geschmack selbst (mindestens 8 von 10), bis zu 3 Versuche; liefert zwei Vorschläge: einfach und besonders), Ausweichmodell OPENAI_MODEL_FALLBACK.
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_MODEL_SUGGEST") ?? "gpt-6.1-terra";
const FALLBACK = Deno.env.get("OPENAI_MODEL_FALLBACK") ?? "gpt-5-mini";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
async function ask(messages: unknown[]): Promise<any> {
  const call = (m: string, extra: Record<string, unknown>) => fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m, messages, response_format: { type: "json_object" }, max_completion_tokens: 9000, ...extra }) });
  let r = await call(MODEL, { reasoning_effort: "medium" });
  if (r.status === 400) r = await call(MODEL, {});
  if (!r.ok && FALLBACK && FALLBACK !== MODEL && [400, 403, 404].includes(r.status)) r = await call(FALLBACK, {});
  if (!r.ok) throw new Error("KI-Fehler " + r.status);
  const j = await r.json(); const text = j.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw new Error("Antwort nicht lesbar"); }
}
const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim().slice(0, 60)).filter(Boolean).slice(0, max);
const KINDS = ["vorhanden", "gewuerz", "zusaetzlich"];
const SYS = `Du bist Koch-Assistent der App Foody. Hauptziel: Zutaten, die weg müssen, sinnvoll verkochen, und zwar zu einem Gericht, das richtig lecker und gesund ist. Antworte auf Deutsch mit vollständigem Rezept.
Eingabe: "have" = Zutaten, die da sind und verbraucht werden sollen. "missing" = Zutaten, die der Nutzer NICHT hat und die du auf keinen Fall verwenden darfst. "tried" = Titel schon vorgeschlagener Gerichte (nicht wiederholen). "servings" = Portionen.
Annahme: Grundlegende, gängige Gewürze und Basics sind immer da: Salz, Pfeffer, Paprikapulver (edelsüß, geräuchert), Chili, Curry, Kurkuma, Kreuzkümmel, Koriander, Zimt, Muskat, Oregano, Thymian, Basilikum (getrocknet), Knoblauchpulver, Zwiebelpulver, Öl, Essig, Zucker, Mehl, Senf, Sojasauce, Brühe. Das zählt nicht als Zusatzzutat.
Eingabe "text" = der Originaltext des Nutzers. Ist es eine Zutatenliste oder ein Vorrat, ist "mode" = "vorrat" und es gilt alles Folgende. Beschreibt "text" stattdessen einen Gerichtswunsch (zum Beispiel "ich möchte heute eine Kürbissuppe essen" oder "heute Nudelauflauf"), ist "mode" = "wunsch": dann ist das Gericht vorgegeben, beide Vorschläge sind Varianten genau dieses Gerichts (einfach = klassisch und schnell, besonders = raffiniertere Version), "have" ist leer oder enthält Zutaten, die mit hinein sollen, und alle nötigen Zutaten außer den Gewürzen und Basics bekommen kind "zusaetzlich" (außer sie stehen in have). Bei einem Gerichtswunsch bleibt das Gericht auch bei Folgeanfragen dasselbe, nur ohne die Zutaten aus "missing".
Ist "only" gesetzt ("einfach" oder "besonders"), lieferst du nur diesen einen Vorschlag (options hat genau einen Eintrag). Im Modus "vorrat" muss er sich dann von den Titeln in "tried" unterscheiden.
Du lieferst sonst immer ZWEI Vorschläge: "einfach" = die einfachste, schnellste und alltäglichste Variante (Klassiker, wenige Schritte, ein Topf oder eine Pfanne, zum Beispiel Maultaschen mit Ei und Zwiebeln oder Maultaschensuppe in Hühnerbrühe) und "besonders" = ein etwas ausgefalleneres, aber trotzdem machbares Gericht. Beide verbrauchen die Zutaten aus "have", sind verschieden (anderes Grundgericht) und müssen jeweils mindestens 8 von 10 erreichen.
Zutaten in "have", die mehrere Dinge zusammenfassen (zum Beispiel "Maultaschen mit Ei"), behandelst du als einzelne Zutaten: jede bekommt in "ingredients" eine eigene Zeile mit eigener Menge (zum Beispiel Maultaschen 400 g und Eier 2 Stück).
Vorgehen:
1. Plane das Gericht so, dass möglichst ALLE Zutaten aus "have" verbraucht werden, verderbliche zuerst (Gemüse, Fleisch, Milchprodukte, Obst). Was nicht sinnvoll passt, listest du in "unused" mit kurzem Grund.
2. Für den Geschmack darfst du beliebig viele Zusatzzutaten ergänzen, die nicht in "have" stehen (zum Beispiel Zwiebel, Knoblauch, Ingwer, Zitrone oder Limette, frische Kräuter, Tomatenmark, Joghurt, Feta, Nüsse). Nimm sie, wenn sie das Gericht spürbar besser machen, und nicht mehr als nötig; gängige, günstige Zutaten sind besser als exotische. Nie etwas aus "missing".
3. Denke wie ein guter Koch: Aromaten (Zwiebel, Knoblauch, Ingwer) anschwitzen, Röstaromen durch scharfes Anbraten, Umami (Tomatenmark, Sojasauce, Parmesan, Pilze), Säure am Ende (Zitrone, Essig), etwas Frisches oder Knuspriges zum Servieren (Kräuter, Nüsse, Samen), genug Soße oder Feuchtigkeit, ausreichend Fett (Mengen realistisch, ein Gericht für 2 Personen braucht meist 1–2 EL Öl) und kräftig abgeschmeckt. Keine langweiligen oder pappigen Kombinationen (zum Beispiel zwei mehlige, süße Beilagen ohne Kontrast).
4. Einfach und alltagstauglich: Das Gericht soll leicht zu kochen sein (wenige Arbeitsschritte, möglichst ein Topf oder eine Pfanne, keine Spezialtechnik) und nicht lange dauern. Bevorzuge Gerichte, die in etwa 20 bis 40 Minuten fertig sind. Das ist ein Richtwert und keine harte Grenze: Wenn ein deutlich besseres Gericht etwas länger braucht (zum Beispiel Schmoren oder Ofen, das nebenbei gart), ist das in Ordnung.
5. Gesund heißt: viel Gemüse, eine Proteinquelle, sinnvolle Kohlenhydrate (Vollkorn bevorzugt), mäßig Fett, nicht frittiert, wenig Zucker. Das darf dem Geschmack nicht im Weg stehen.
6. Prüfe dein Gericht ehrlich wie ein kritischer Koch: Würdest du es selbst so kochen und essen? Bewerte den erwarteten Geschmack von 1 bis 10 ("taste_score"). Liegt er unter 8, verbessere das Rezept (andere Zutaten, mehr Würze, andere Zubereitung), bis du mindestens 8 vergeben kannst. Vergib keine 8 aus Gefälligkeit: ist der Vorrat zu schwierig, sag das im Fehlerfeld.
Mengen realistisch für die Portionen (Gramm, ml, EL, TL, Stück). 5–10 klare Schritte in der richtigen Reihenfolge mit Zeitangaben, Hinweise zu Garstufen (zum Beispiel Hähnchen vollständig durchgaren). Keine Nährwerte angeben.
Jede Zutat bekommt "kind": "vorhanden" (steht in have), "gewuerz" (gängiges Gewürz oder Basic aus der Liste oben) oder "zusaetzlich" (alles andere, muss der Nutzer prüfen).
Antworte nur mit JSON: {"mode":"vorrat"|"wunsch","options":[{"variant":"einfach"|"besonders","title":string,"servings":number,"prep_minutes":number,"why":"ein kurzer Satz, warum das lecker, gesund und passend ist","taste_score":number,"taste_check":"ein bis zwei Sätze, wie es schmeckt und warum","ingredients":[{"name":string,"amount":number|null,"unit":string|null,"kind":"vorhanden|gewuerz|zusaetzlich"}],"steps":[string],"unused":[{"name":string,"reason":string}],"note":"kurzer Hinweis oder leer"}, ...zweiter Vorschlag]}
Wenn aus "have" beim besten Willen kein richtig gutes Gericht möglich ist, antworte {"error":"kurzer deutscher Grund und was zusätzlich helfen würde"}.`;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!KEY) return json({ error: "OPENAI_API_KEY fehlt in Supabase (Edge Functions → Secrets)" }, 500);
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.get("authorization") ?? "" } });
  if (!who.ok) return json({ error: "nicht angemeldet" }, 401);
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const have = list(b.have, 60), missing = list(b.missing, 60), tried = list(b.tried, 12), servings = Math.max(1, Math.min(8, Math.round(Number(b.servings) || 2)));
  const text = String(b.text ?? "").trim().slice(0, 300), only = b.only === "einfach" || b.only === "besonders" ? b.only : null, want = only ? 1 : 2;
  if (!have.length && text.length < 3) return json({ error: "Bitte nenne mindestens eine Zutat oder ein Gericht." }, 400);
  const msgs: unknown[] = [{ role: "system", content: SYS }, { role: "user", content: JSON.stringify({ text, have, missing, tried, servings, only }) }];
  let opts: any[] = [], last = "", mode = "vorrat";
  for (let attempt = 0; attempt < 3; attempt++) {
    let o: any;
    try { o = await ask(msgs); } catch (e) { return json({ error: String((e as Error).message) }, 502); }
    if (o.error) return json({ error: String(o.error).slice(0, 300) }, 422);
    opts = (Array.isArray(o.options) ? o.options : o.title ? [o] : []).slice(0, want);
    mode = o.mode === "wunsch" ? "wunsch" : "vorrat";
    last = "";
    if (opts.length < want) last = only ? "Es muss genau ein Vorschlag in \"options\" stehen (" + only + ")." : "Es müssen genau zwei Vorschläge in \"options\" stehen: einer \"einfach\", einer \"besonders\".";
    for (const r of opts) {
      const names = (Array.isArray(r.ingredients) ? r.ingredients : []).map((i: any) => String(i?.name ?? "").toLowerCase());
      const hit = names.find((n: string) => missing.some((m) => n.includes(m.toLowerCase()) || m.toLowerCase().includes(n)));
      const score = Number(r.taste_score);
      if (hit) last = "Du hast \"" + hit + "\" verwendet, das der Nutzer nicht hat. Erstelle beide Rezepte ohne diese Zutat.";
      else if (!(score >= 8) && !last) last = "Dein Geschmackswert für \"" + String(r.title ?? "") + "\" war " + (Number.isFinite(score) ? score : "nicht angegeben") + ", gefordert sind mindestens 8. Verbessere das Gericht (mehr Aromen, Säure, Frische, bessere Kombination) und bewerte erneut. Liefere wieder beide Vorschläge.";
    }
    if (!last) break;
    msgs.push({ role: "assistant", content: JSON.stringify({ options: opts }) }, { role: "user", content: last });
  }
  if (last) return json({ error: "Aus diesen Zutaten ist mir kein wirklich leckeres Gericht (mindestens 8 von 10) gelungen. Nenne mir noch eine Zutat dazu oder streiche etwas, das nicht zusammenpasst." }, 422);
  const clean = (o: any, variant: string) => {
    const ing = (Array.isArray(o.ingredients) ? o.ingredients : []).slice(0, 40).map((i: any) => ({
      name: String(i.name ?? "").trim().slice(0, 80), amount: Number.isFinite(Number(i.amount)) && i.amount !== null && Number(i.amount) > 0 ? Math.round(Number(i.amount) * 100) / 100 : null,
      unit: i.unit ? String(i.unit).slice(0, 20) : null, kind: KINDS.includes(i.kind) ? i.kind : "zusaetzlich" })).filter((i: any) => i.name);
    const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, 14).map((s: unknown) => String(s ?? "").trim().slice(0, 500)).filter(Boolean);
    if (!ing.length || steps.length < 2 || !String(o.title ?? "").trim()) return null;
    return { variant, title: String(o.title).trim().slice(0, 80), servings: Math.max(1, Math.min(8, Math.round(Number(o.servings) || servings))), prep_minutes: Number.isFinite(Number(o.prep_minutes)) ? Math.round(Number(o.prep_minutes)) : null,
      why: String(o.why ?? "").slice(0, 240), taste_score: Math.min(10, Math.round(Number(o.taste_score) || 0)), taste_check: String(o.taste_check ?? "").slice(0, 300),
      unused: (Array.isArray(o.unused) ? o.unused : []).slice(0, 12).map((u: any) => ({ name: String(u?.name ?? "").slice(0, 60), reason: String(u?.reason ?? "").slice(0, 120) })).filter((u: any) => u.name), ingredients: ing, steps, note: String(o.note ?? "").slice(0, 240) };
  };
  const recipes = opts.map((o, i) => clean(o, only ? only : o.variant === "besonders" ? "besonders" : o.variant === "einfach" ? "einfach" : i ? "besonders" : "einfach")).filter(Boolean);
  if (!recipes.length) return json({ error: "Kein brauchbares Rezept erhalten, bitte nochmal versuchen." }, 422);
  return json({ recipes, recipe: recipes[0], mode });
});
