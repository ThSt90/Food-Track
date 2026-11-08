// Foody – Foto-Schätzung über OpenAI (Bild-Eingabe). Nimmt ein verkleinertes JPEG (base64) und optional einen Hinweistext (z. B. "ich habe die Hälfte gegessen").
// Es wird nichts gespeichert: die App zeigt den Vorschlag, der Mensch bestätigt. Schutz: nur angemeldete Nutzer; Secret OPENAI_API_KEY; Modell per Secret OPENAI_MODEL_PHOTO änderbar.
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
const MODEL = Deno.env.get("OPENAI_MODEL_PHOTO") ?? "gpt-6.1-terra";
const CONF = ["niedrig", "mittel", "hoch"];
function items(o: any) {
  const it = (Array.isArray(o.items) ? o.items : []).slice(0, 20).map((i: any) => ({ name: String(i.name ?? "").slice(0, 80), kcal: n(i.kcal), protein: n(i.protein), carbs: n(i.carbs), fat: n(i.fat) })).filter((i: any) => i.name && i.kcal !== null);
  const sum = (k: string) => it.every((i: any) => i[k] !== null) ? it.reduce((s: number, i: any) => s + i[k], 0) : null;
  return { items: it, kcal: sum("kcal"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") };
}
const PROMPT = `Du schätzt eine Mahlzeit anhand eines Fotos für ein Ernährungs-Tagebuch. Schätze, was gegessen wird: bei einem Hinweistext des Nutzers (z. B. "die Hälfte der Pfanne") gilt dessen Mengenangabe, sonst die gezeigte Portion.
Zerlege die Mahlzeit in einzelne Posten mit geschätzter Menge (Gramm oder Stück). Nimm übliche deutsche Portionsgrößen und Zubereitungen an (Öl, Käse, Soßen berücksichtigen) und nenne die Annahmen kurz.
Antworte ausschließlich mit JSON ohne weiteren Text:
{"title":"kurzer deutscher Name der Mahlzeit, max. 60 Zeichen","items":[{"name":"Posten mit Menge","kcal":Zahl,"protein":Zahl,"carbs":Zahl,"fat":Zahl}],"confidence":"niedrig|mittel|hoch","note":"ein bis zwei kurze Sätze zu den Annahmen"}
Alle Zahlen sind ganze Zahlen für den ganzen Posten (nicht je 100 g), protein/carbs/fat in Gramm. Wenn auf dem Foto kein Essen zu erkennen ist, antworte {"error":"Kein Essen erkannt"}.`;
Deno.serve(async (req) => {
  const g = await guard(req); if (g) return g;
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const img = String(b.image ?? "").replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(img) || img.length < 1000 || img.length > 4_500_000) return json({ error: "Bild ungültig oder zu groß" }, 400);
  const hint = String(b.text ?? "").trim().slice(0, 800);
  let o: any;
  try { o = await ask(MODEL, [{ role: "system", content: PROMPT }, { role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/jpeg;base64," + img, detail: "high" } },
    { type: "text", text: hint ? "Hinweis des Nutzers: " + hint : "Kein Hinweis, schätze die gezeigte Portion." }] }], 4000); }
  catch (e) { return json({ error: String((e as Error).message) }, 502); }
  if (o.error) return json({ error: String(o.error) }, 422);
  const s = items(o); if (!s.items.length) return json({ error: "Keine brauchbare Schätzung" }, 422);
  return json({ title: String(o.title ?? "Mahlzeit").slice(0, 60), ...s, confidence: CONF.includes(o.confidence) ? o.confidence : "niedrig", note: String(o.note ?? "").slice(0, 300) });
});
