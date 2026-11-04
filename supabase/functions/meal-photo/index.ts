// Foody – Foto-Schätzung. Nimmt ein verkleinertes Foto (JPEG, base64) eines Tellers und gibt eine GESCHÄTZTE Mahlzeit zurück.
// Es wird nichts gespeichert: die App füllt damit nur die Eintragsmaske vor, der Mensch bestätigt oder korrigiert.
// Schutz: nur angemeldete Foody-Nutzer (gültiges Supabase-Login-Token), Secret ANTHROPIC_API_KEY.
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", AKEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const PROMPT = `Du schätzt eine Mahlzeit anhand eines Fotos für ein Ernährungs-Tagebuch. Schätze nur, was auf dem Foto zu sehen ist (die gezeigte Portion insgesamt).
Antworte ausschließlich mit JSON ohne weiteren Text:
{"title":"kurzer deutscher Name des Gerichts","kcal":Zahl,"protein":Zahl,"carbs":Zahl,"fat":Zahl,"confidence":"niedrig|mittel|hoch","note":"ein kurzer Satz, was du gesehen und angenommen hast, z. B. Menge oder unsichtbare Zutaten"}
kcal, protein (g), carbs (g), fat (g) sind Gesamtwerte der sichtbaren Portion, ganze Zahlen. Wenn auf dem Foto kein Essen zu erkennen ist, antworte {"error":"Kein Essen erkannt"}.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!AKEY) return json({ error: "ANTHROPIC_API_KEY fehlt in Supabase (Edge Functions → Secrets)" }, 500);
  const auth = req.headers.get("authorization") ?? "";
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return json({ error: "nicht angemeldet" }, 401);
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const img = String(b.image ?? "").replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(img) || img.length < 1000 || img.length > 4_500_000) return json({ error: "Bild ungültig oder zu groß" }, 400);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 400, messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } }, { type: "text", text: PROMPT }] }] }),
  });
  if (!r.ok) return json({ error: "KI-Fehler " + r.status }, 502);
  const j = await r.json(); const text = (j.content ?? []).map((c: any) => c.text ?? "").join("");
  let o: any; try { o = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return json({ error: "Antwort nicht lesbar" }, 502); }
  if (o.error) return json({ error: String(o.error) }, 422);
  const n = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x < 5000 ? x : null; };
  const kcal = n(o.kcal); if (kcal === null || kcal === 0) return json({ error: "Keine brauchbare Schätzung" }, 422);
  return json({ title: String(o.title ?? "Mahlzeit").slice(0, 80), kcal, protein: n(o.protein), carbs: n(o.carbs), fat: n(o.fat), confidence: ["niedrig", "mittel", "hoch"].includes(o.confidence) ? o.confidence : "niedrig", note: String(o.note ?? "").slice(0, 200) });
});
