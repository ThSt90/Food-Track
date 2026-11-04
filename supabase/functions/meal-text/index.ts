// Foody – Text-/Sprach-Schätzung. Nimmt einen frei formulierten Text ("3 Toast, ein Ei, 2 Toast mit Philadelphia …"),
// zerlegt ihn in Einzelposten und schätzt Kalorien und Nährwerte. Es wird nichts gespeichert: die App zeigt die Aufstellung,
// der Mensch prüft und trägt ein. Schutz: nur angemeldete Foody-Nutzer; Secret ANTHROPIC_API_KEY.
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", AKEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const PROMPT = `Du schätzt für ein Ernährungs-Tagebuch, was jemand gegessen hat. Der Text ist frei formuliert und kann gesprochen diktiert sein (Tippfehler, "ein Ei", "zwei Toast mit Philadelphia und einer mit Nutella").
Zerlege den Text in einzelne Posten, jeder Posten mit seiner Menge. Beispiel: "2 Toast mit Philadelphia" sind 2 Posten-Teile: 2 Scheiben Toast plus Philadelphia-Aufstrich darauf. Fasse Toast samt Belag in einem Posten zusammen, wenn es zusammengehört.
Nimm übliche deutsche Portionsgrößen an (z. B. 1 Scheibe Toastbrot ca. 25–30 g, 1 Ei Größe M ca. 55 g, Aufstrich dünn ca. 15 g je Scheibe) und nenne die Annahme kurz.
Antworte ausschließlich mit JSON ohne weiteren Text:
{"title":"kurzer Name der Mahlzeit, max. 60 Zeichen","items":[{"name":"Posten mit Menge, z. B. 3 Scheiben Toast","kcal":Zahl,"protein":Zahl,"carbs":Zahl,"fat":Zahl}],"confidence":"niedrig|mittel|hoch","note":"ein bis zwei kurze Sätze zu den getroffenen Annahmen"}
Alle Zahlen sind ganze Zahlen für den ganzen Posten (nicht je 100 g). Wenn der Text kein Essen enthält, antworte {"error":"Kein Essen erkannt"}.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!AKEY) return json({ error: "ANTHROPIC_API_KEY fehlt in Supabase (Edge Functions → Secrets)" }, 500);
  const auth = req.headers.get("authorization") ?? "";
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: auth } });
  if (!who.ok) return json({ error: "nicht angemeldet" }, 401);
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const text = String(b.text ?? "").trim();
  if (text.length < 3 || text.length > 1500) return json({ error: "Text zu kurz oder zu lang" }, 400);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 900, messages: [{ role: "user", content: PROMPT + "\n\nText:\n" + text }] }),
  });
  if (!r.ok) return json({ error: "KI-Fehler " + r.status }, 502);
  const j = await r.json(); const out = (j.content ?? []).map((c: any) => c.text ?? "").join("");
  let o: any; try { o = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch { return json({ error: "Antwort nicht lesbar" }, 502); }
  if (o.error) return json({ error: String(o.error) }, 422);
  const n = (v: unknown) => { const x = Math.round(Number(v)); return Number.isFinite(x) && x >= 0 && x < 5000 ? x : null; };
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 20).map((i: any) => ({ name: String(i.name ?? "").slice(0, 80), kcal: n(i.kcal), protein: n(i.protein), carbs: n(i.carbs), fat: n(i.fat) })).filter((i: any) => i.name && i.kcal !== null);
  if (!items.length) return json({ error: "Keine brauchbare Schätzung" }, 422);
  const sum = (k: string) => items.every((i: any) => i[k] !== null) ? items.reduce((s: number, i: any) => s + i[k], 0) : null;
  return json({ title: String(o.title ?? "Mahlzeit").slice(0, 60), items, kcal: sum("kcal"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat"), confidence: ["niedrig", "mittel", "hoch"].includes(o.confidence) ? o.confidence : "niedrig", note: String(o.note ?? "").slice(0, 300) });
});
