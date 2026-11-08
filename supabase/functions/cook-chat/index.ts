// Foody – Koch-Assistent über OpenAI. Beantwortet kurze Fragen während des Kochens zu Rezept, aktuellem Schritt, Mengen und Ersatz.
// Schutz: nur angemeldete Nutzer; Secret OPENAI_API_KEY; Modell per Secret OPENAI_MODEL_CHAT änderbar. Es wird nichts gespeichert.
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const FALLBACK = Deno.env.get("OPENAI_MODEL_FALLBACK") ?? "gpt-5-mini";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
/** Ruft OpenAI Chat Completions im JSON-Modus. Reihenfolge: Wunschmodell mit knappem Denken, ohne Zusatzparameter, dann Ausweichmodell. */
async function ask(model: string, messages: unknown[], maxTok: number): Promise<any> {
  const call = (m: string, extra: Record<string, unknown>) => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m, messages, response_format: { type: "json_object" }, max_completion_tokens: maxTok, ...extra }) });
  let r = await call(model, { reasoning_effort: "low" });
  if (r.status === 400) r = await call(model, {});
  if (!r.ok && FALLBACK && FALLBACK !== model && [400, 403, 404].includes(r.status)) r = await call(FALLBACK, {});
  if (!r.ok) throw new Error("KI-Fehler " + r.status);
  const j = await r.json(); const text = j.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw new Error("Antwort nicht lesbar"); }
}
async function guard(req: Request): Promise<Response | null> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!KEY) return json({ error: "OPENAI_API_KEY fehlt in Supabase (Edge Functions → Secrets)" }, 500);
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.get("authorization") ?? "" } });
  return who.ok ? null : json({ error: "nicht angemeldet" }, 401);
}
const n = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x < 5000 ? x : null; };
const MODEL = Deno.env.get("OPENAI_MODEL_CHAT") ?? "gpt-6-luna";
const CONF = ["niedrig", "mittel", "hoch"];
function items(o: any) {
  const it = (Array.isArray(o.items) ? o.items : []).slice(0, 20).map((i: any) => ({ name: String(i.name ?? "").slice(0, 80), kcal: n(i.kcal), protein: n(i.protein), carbs: n(i.carbs), fat: n(i.fat) })).filter((i: any) => i.name && i.kcal !== null);
  const sum = (k: string) => it.every((i: any) => i[k] !== null) ? it.reduce((s: number, i: any) => s + i[k], 0) : null;
  return { items: it, kcal: sum("kcal"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") };
}
const SYS = `Du bist der Koch-Assistent der App Foody und sprichst Deutsch, locker und sehr kurz (maximal 2 Sätze, sie werden vorgelesen).
Du kennst das Rezept, die Zutaten (bereits auf die Portionen umgerechnet) und den aktuellen Schritt. Beantworte Fragen dazu: wo man gerade ist, was als Nächstes kommt, wie viel von einer Zutat, wie lange etwas dauert, was man ersetzen kann, was bei Problemen hilft.
Erfinde keine Rezeptangaben: Wenn etwas nicht im Rezept steht, sag, dass es dort nicht steht, und gib dann eine allgemeine Kochempfehlung als solche gekennzeichnet.
Antworte ausschließlich mit JSON: {"answer":"Text zum Vorlesen","action":"none|next|prev|goto","step":Zahl,"timer_min":Zahl}
action nur setzen, wenn der Nutzer es ausdrücklich möchte ("weiter", "zurück", "geh zu Schritt 3"); step ist dann die Schrittnummer ab 1. timer_min nur, wenn ein Timer gewünscht wird (Minuten), sonst 0.`;
Deno.serve(async (req) => {
  const g = await guard(req); if (g) return g;
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const q = String(b.question ?? "").trim().slice(0, 500); if (q.length < 2) return json({ error: "Frage fehlt" }, 400);
  const r = b.recipe ?? {}; const steps: string[] = (Array.isArray(r.steps) ? r.steps : []).slice(0, 40).map((s: unknown) => String(s).slice(0, 400));
  const ing: string[] = (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 60).map((s: unknown) => String(s).slice(0, 80));
  const step = Math.max(0, Math.min(steps.length - 1, Number(b.step) || 0));
  const ctx = `Rezept: ${String(r.title ?? "").slice(0, 100)} für ${Number(r.servings) || 4} Portionen\nZutaten: ${ing.join("; ")}\nSchritte:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nAktuell: Schritt ${step + 1} von ${steps.length}`;
  const hist = (Array.isArray(b.history) ? b.history : []).slice(-8).map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "").slice(0, 400) }));
  let o: any; try { o = await ask(MODEL, [{ role: "system", content: SYS + "\n\n" + ctx }, ...hist, { role: "user", content: q }], 2500); } catch (e) { return json({ error: String((e as Error).message) }, 502); }
  const action = ["next", "prev", "goto"].includes(o.action) ? o.action : "none";
  return json({ answer: String(o.answer ?? "").slice(0, 400) || "Das habe ich nicht verstanden.", action, step: action === "goto" ? Math.max(1, Math.min(steps.length, Number(o.step) || 1)) : 0, timer_min: Math.max(0, Math.min(180, Math.round(Number(o.timer_min) || 0))) });
});
