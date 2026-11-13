// Foody – Text-/Sprach-Schätzung über OpenAI. Nimmt einen frei formulierten Text, zerlegt ihn in Posten und schätzt Kalorien und Nährwerte.
// Es wird nichts gespeichert: die App zeigt die Aufstellung, der Mensch prüft und trägt ein. Schutz: nur angemeldete Foody-Nutzer; Secret OPENAI_API_KEY; Modell per Secret OPENAI_MODEL_TEXT änderbar.
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const FALLBACK = Deno.env.get("OPENAI_MODEL_FALLBACK") ?? "gpt-5-mini";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
/** Nur die zwei Konten aus der Tabelle owners (p1/p2) dürfen die KI nutzen: my_pid() liest die E-Mail aus dem Login, fremde Konten bekommen null. */
async function allowed(auth: string): Promise<boolean> {
  try { const r = await fetch(`${URL_}/rest/v1/rpc/my_pid`, { method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) return false; const p = await r.json(); return p === "p1" || p === "p2"; } catch { return false; }
}
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
  if (!who.ok) return json({ error: "nicht angemeldet" }, 401);
  return (await allowed(req.headers.get("authorization") ?? "")) ? null : json({ error: "Dieses Konto darf die KI nicht nutzen." }, 403);
}
const n = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x < 5000 ? x : null; };
const MODEL = Deno.env.get("OPENAI_MODEL_TEXT") ?? "gpt-6-luna";
const CONF = ["niedrig", "mittel", "hoch"];
function items(o: any) {
  const it = (Array.isArray(o.items) ? o.items : []).slice(0, 20).map((i: any) => ({ name: String(i.name ?? "").slice(0, 80), kcal: n(i.kcal), protein: n(i.protein), carbs: n(i.carbs), fat: n(i.fat) })).filter((i: any) => i.name && i.kcal !== null);
  const sum = (k: string) => it.every((i: any) => i[k] !== null) ? it.reduce((s: number, i: any) => s + i[k], 0) : null;
  return { items: it, kcal: sum("kcal"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") };
}
const PROMPT = `Du schätzt für ein Ernährungs-Tagebuch, was jemand gegessen hat. Der Text ist frei formuliert und kann gesprochen diktiert sein (Tippfehler, "ein Ei", "zwei Toast mit Philadelphia und einer mit Nutella").
Zerlege den Text in einzelne Posten, jeder Posten mit seiner Menge. Beispiel: "2 Toast mit Philadelphia" sind 2 Posten-Teile: 2 Scheiben Toast plus Philadelphia-Aufstrich darauf. Fasse Toast samt Belag in einem Posten zusammen, wenn es zusammengehört.
Nimm übliche deutsche Portionsgrößen an (z. B. 1 Scheibe Toastbrot ca. 25–30 g, 1 Ei Größe M ca. 55 g, Aufstrich dünn ca. 15 g je Scheibe) und nenne die Annahme kurz.
Antworte ausschließlich mit JSON ohne weiteren Text:
{"title":"kurzer Name der Mahlzeit, max. 60 Zeichen","items":[{"name":"Posten mit Menge, z. B. 3 Scheiben Toast","kcal":Zahl,"protein":Zahl,"carbs":Zahl,"fat":Zahl}],"confidence":"niedrig|mittel|hoch","note":"ein bis zwei kurze Sätze zu den getroffenen Annahmen"}
Alle Zahlen sind ganze Zahlen für den ganzen Posten (nicht je 100 g). Wenn der Text kein Essen enthält, antworte {"error":"Kein Essen erkannt"}.`;
Deno.serve(async (req) => {
  const g = await guard(req); if (g) return g;
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const text = String(b.text ?? "").trim();
  if (text.length < 3 || text.length > 1500) return json({ error: "Text zu kurz oder zu lang" }, 400);
  let o: any; try { o = await ask(MODEL, [{ role: "system", content: PROMPT }, { role: "user", content: "Text:\n" + text }], 4000); } catch (e) { return json({ error: String((e as Error).message) }, 502); }
  if (o.error) return json({ error: String(o.error) }, 422);
  const s = items(o); if (!s.items.length) return json({ error: "Keine brauchbare Schätzung" }, 422);
  return json({ title: String(o.title ?? "Mahlzeit").slice(0, 60), ...s, confidence: CONF.includes(o.confidence) ? o.confidence : "niedrig", note: String(o.note ?? "").slice(0, 300) });
});
