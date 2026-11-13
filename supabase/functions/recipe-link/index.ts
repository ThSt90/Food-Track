// Foody – Rezept aus Link. Lädt die Webseite serverseitig, liest Zutaten/Schritte/Nährwerte per OpenAI aus und liefert zusätzlich das Hauptbild (og:image) als base64.
// Es wird nichts gespeichert: die App zeigt das Ergebnis im Prüf-Editor, der Mensch bestätigt. Schutz: nur angemeldete Nutzer; Secret OPENAI_API_KEY; Modell per OPENAI_MODEL_LINK (Standard gpt-6-luna).
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_MODEL_LINK") ?? Deno.env.get("OPENAI_MODEL_TEXT") ?? "gpt-6-luna";
const FALLBACK = Deno.env.get("OPENAI_MODEL_FALLBACK") ?? "gpt-5-mini";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
/** Nur die zwei Konten aus der Tabelle owners (p1/p2) dürfen die KI nutzen: my_pid() liest die E-Mail aus dem Login, fremde Konten bekommen null. */
async function allowed(auth: string): Promise<boolean> {
  try { const r = await fetch(`${URL_}/rest/v1/rpc/my_pid`, { method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) return false; const p = await r.json(); return p === "p1" || p === "p2"; } catch { return false; }
}
const UA = "Mozilla/5.0 (compatible; FoodyRecipeReader/1.0)";

/** Nur öffentliche https-Adressen (kein localhost, keine privaten Netze). */
function safeUrl(raw: string): URL | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || h.startsWith("[")) return null; // keine IP-Adressen
  return u;
}
async function grab(u: URL, maxBytes: number, accept: string): Promise<{ res: Response; bytes: Uint8Array } | null> {
  let cur = u;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(cur, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "de,en;q=0.8" }, signal: AbortSignal.timeout(12000) });
    if (res.status >= 300 && res.status < 400) { const loc = res.headers.get("location"); const n = loc ? safeUrl(new URL(loc, cur).toString()) : null; if (!n) return null; cur = n; continue; }
    if (!res.ok || !res.body) return null;
    const chunks: Uint8Array[] = []; let total = 0; const rd = res.body.getReader();
    while (true) { const { done, value } = await rd.read(); if (done) break; total += value.length; if (total > maxBytes) { try { await rd.cancel(); } catch { /* egal */ } break; } chunks.push(value); }
    const bytes = new Uint8Array(Math.min(total, maxBytes)); let o = 0; for (const c of chunks) { const take = Math.min(c.length, bytes.length - o); bytes.set(c.subarray(0, take), o); o += take; if (o >= bytes.length) break; }
    return { res, bytes };
  }
  return null;
}
const decodeEnt = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"); const m = html.match(re); if (!m) return null;
  const c = m[0].match(/content=["']([^"']*)["']/i); return c ? decodeEnt(c[1]) : null;
}
function jsonLdRecipes(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: any) => { if (!n) return; if (Array.isArray(n)) return n.forEach(walk); if (typeof n !== "object") return;
        const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) out.push(n); if (n["@graph"]) walk(n["@graph"]); };
      walk(JSON.parse(m[1].trim()));
    } catch { /* kaputtes JSON-LD ignorieren */ }
  }
  return out;
}
function visibleText(html: string): string {
  return decodeEnt(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t\f\v]+/g, " ").replace(/\n\s*/g, "\n").trim();
}
const SYS = `Du liest den Inhalt einer Rezept-Webseite (strukturierte Daten und sichtbarer Text) und gibst das Rezept als JSON zurück. Antworte nur mit einem JSON-Objekt in diesem Format:
{"title": string|null, "servings": number|null, "prep_minutes": number|null, "tags": [string], "ingredients": [{"raw": string, "name": string, "amount": number|null, "unit": string|null}],
 "steps": [string], "nutrition": {"kcal": number|null, "protein": number|null, "carbs": number|null, "fat": number|null, "basis": "portion"|"gesamt"|null}, "unsure": [string]}
Regeln:
- Übernimm nur, was auf der Seite steht. Erfinde keine Mengen, Schritte, Zeiten oder Nährwerte. Fehlt etwas, setze null bzw. eine leere Liste.
- "raw" ist die Zutatenzeile genau wie auf der Seite. Einheiten wie auf der Seite (g, kg, ml, l, EL, TL, Stück, Prise, Dose, Bund …). Brüche als Dezimalzahl.
- nutrition.basis: "portion" nur wenn die Seite Werte pro Portion/Person/Stück nennt, "gesamt" bei Werten fürs ganze Rezept; sonst null. Werte pro 100 g nicht übernehmen, sondern in "unsure" erwähnen.
- "steps" sind die Zubereitungsschritte in der Reihenfolge der Seite, ohne Werbung, Kommentare oder Nummern.
- "unsure": kurze deutsche Hinweise zu allem, was unklar oder mehrdeutig ist. Wenn die Seite kein Rezept enthält, antworte {"error":"Kein Rezept gefunden"}.
- Schreibe auf Deutsch wie auf der Seite.`;
async function ask(messages: unknown[]): Promise<any> {
  const call = (m: string, extra: Record<string, unknown>) => fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m, messages, response_format: { type: "json_object" }, max_completion_tokens: 6000, ...extra }) });
  let r = await call(MODEL, { reasoning_effort: "low" });
  if (r.status === 400) r = await call(MODEL, {});
  if (!r.ok && FALLBACK && FALLBACK !== MODEL && [400, 403, 404].includes(r.status)) r = await call(FALLBACK, {});
  if (!r.ok) throw new Error("KI-Fehler " + r.status);
  const j = await r.json(); const text = j.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { throw new Error("Antwort nicht lesbar"); }
}
const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function mainImage(html: string, base: URL, ld: any[]): Promise<{ data: string; type: string } | null> {
  let src = meta(html, "og:image") || meta(html, "twitter:image");
  if (!src) { const im = ld.map((r) => r.image).find(Boolean); src = typeof im === "string" ? im : Array.isArray(im) ? (typeof im[0] === "string" ? im[0] : im[0]?.url) : im?.url ?? null; }
  if (!src) return null;
  try {
    const u = safeUrl(new URL(src, base).toString()); if (!u) return null;
    const g = await grab(u, 5_000_000, "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5"); if (!g) return null;
    const type = (g.res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type) || g.bytes.length < 2000) return null;
    return { data: b64(g.bytes), type };
  } catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!KEY) return json({ error: "OPENAI_API_KEY fehlt in Supabase (Edge Functions → Secrets)" }, 500);
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.get("authorization") ?? "" } });
  if (!who.ok) return json({ error: "nicht angemeldet" }, 401);
  if (!(await allowed(req.headers.get("authorization") ?? ""))) return json({ error: "Dieses Konto darf die KI nicht nutzen." }, 403);
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const u = safeUrl(String(b.url ?? "").trim()); if (!u) return json({ error: "Das ist kein gültiger öffentlicher Link (https://…)." }, 400);
  let page; try { page = await grab(u, 2_500_000, "text/html,application/xhtml+xml"); } catch { return json({ error: "Die Seite hat nicht geantwortet." }, 502); }
  if (!page) return json({ error: "Die Seite konnte nicht geladen werden (gesperrt oder nicht erreichbar)." }, 502);
  const html = new TextDecoder("utf-8", { fatal: false }).decode(page.bytes);
  const ld = jsonLdRecipes(html) as any[];
  const text = visibleText(html).slice(0, 24000);
  const material = (ld.length ? "STRUKTURIERTE DATEN (JSON-LD):\n" + JSON.stringify(ld[0]).slice(0, 14000) + "\n\n" : "") + "SICHTBARER TEXT:\n" + text;
  if (material.length < 200) return json({ error: "Auf der Seite steht kein lesbarer Text (evtl. nur per JavaScript geladen)." }, 422);
  let o: any;
  try { o = await ask([{ role: "system", content: SYS }, { role: "user", content: "Seite: " + u.toString() + "\n\n" + material }]); } catch (e) { return json({ error: String((e as Error).message) }, 502); }
  if (o.error) return json({ error: String(o.error) }, 422);
  if (!Array.isArray(o.ingredients) || !o.ingredients.length || !Array.isArray(o.steps) || !o.steps.length) return json({ error: "Kein vollständiges Rezept gefunden (Zutaten oder Schritte fehlen)." }, 422);
  const image = await mainImage(html, u, ld);
  return json({ recipe: { ...o, source: u.toString() }, image, title: meta(html, "og:title") ?? null });
});
