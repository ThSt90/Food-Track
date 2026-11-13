// Foody – Sprachgespräch im Kochmodus mit GPT-Live (OpenAI, WebRTC). Der Browser schickt sein SDP-Angebot und den Rezept-Kontext hierher,
// diese Funktion startet die Sitzung bei OpenAI (der API-Schlüssel bleibt hier) und gibt die SDP-Antwort zurück.
// Die Stimme übernimmt GPT-Live; Denken und Werkzeuge (Schritt wechseln, Timer) laufen über ein günstiges Textmodell im Hintergrund.
// Schutz: nur angemeldete Nutzer; Secret OPENAI_API_KEY; Modelle per OPENAI_MODEL_LIVE, OPENAI_MODEL_LIVE_BACKEND, Stimme per OPENAI_LIVE_VOICE.
const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_MODEL_LIVE") ?? "gpt-live-1";
const BACKEND = Deno.env.get("OPENAI_MODEL_LIVE_BACKEND") ?? "gpt-6-luna";
const VOICE = Deno.env.get("OPENAI_LIVE_VOICE") ?? "cedar";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
/** Nur die zwei Konten aus der Tabelle owners (p1/p2) dürfen die KI nutzen: my_pid() liest die E-Mail aus dem Login, fremde Konten bekommen null. */
async function allowed(auth: string): Promise<boolean> {
  try { const r = await fetch(`${URL_}/rest/v1/rpc/my_pid`, { method: "POST", headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" }, body: "{}" }); if (!r.ok) return false; const p = await r.json(); return p === "p1" || p === "p2"; } catch { return false; }
}
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const TOOLS = [
  { type: "function", name: "next_step", description: "Zum nächsten Rezeptschritt wechseln, wenn der Nutzer weiter möchte.", parameters: obj({}) },
  { type: "function", name: "previous_step", description: "Zum vorherigen Rezeptschritt zurück, wenn der Nutzer zurück möchte.", parameters: obj({}) },
  { type: "function", name: "go_to_step", description: "Zu einem bestimmten Rezeptschritt springen (Nummer ab 1).", parameters: obj({ step: { type: "integer", description: "Schrittnummer ab 1" } }, ["step"]) },
  { type: "function", name: "start_timer", description: "Einen Küchen-Timer in Minuten starten.", parameters: obj({ minutes: { type: "number", description: "Dauer in Minuten" } }, ["minutes"]) },
  { type: "function", name: "stop_timer", description: "Den laufenden Timer stoppen.", parameters: obj({}) },
  { type: "function", name: "end_conversation", description: "Das Gespräch beenden, wenn der Nutzer sich verabschiedet oder fertig ist.", parameters: obj({}) },
];
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!KEY) return json({ error: "OPENAI_API_KEY fehlt in Supabase (Edge Functions → Secrets)" }, 500);
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.get("authorization") ?? "" } });
  if (!who.ok) return json({ error: "nicht angemeldet" }, 401);
  if (!(await allowed(req.headers.get("authorization") ?? ""))) return json({ error: "Dieses Konto darf die KI nicht nutzen." }, 403);
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const sdp = String(b.sdp ?? ""); if (!/^v=0/.test(sdp) || sdp.length > 60000) return json({ error: "SDP ungültig" }, 400);
  const c = b.context ?? {};
  const steps: string[] = (Array.isArray(c.steps) ? c.steps : []).slice(0, 40).map((s: unknown) => clip(s, 400));
  const ing: string[] = (Array.isArray(c.ingredients) ? c.ingredients : []).slice(0, 60).map((s: unknown) => clip(s, 80));
  const step = Math.max(0, Math.min(Math.max(0, steps.length - 1), Number(c.step) || 0));
  const ctx = `Rezept: ${clip(c.title, 100)} für ${Number(c.servings) || 4} Portionen\nZutaten (schon auf die Portionen umgerechnet): ${ing.join("; ")}\nSchritte:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nAktuell: Schritt ${step + 1} von ${steps.length}`;
  const RULES = `Du bist Foody, der Koch-Assistent einer Ernährungs-App, und führst ein freies Gespräch auf Deutsch mit jemandem, der gerade kocht und nicht auf den Bildschirm schaut.
Sprich natürlich, locker und kurz (meist ein bis zwei Sätze), ohne Aufzählungen. Beantworte Fragen zum Rezept, zum aktuellen Schritt, zu Mengen, Zeiten und Ersatzzutaten. Wechsle Schritte und stelle Timer nur über die Werkzeuge, wenn der Nutzer es möchte. Wenn du einen Schritt vorliest, lies ihn verständlich und ohne Nummerierungsfloskeln.
Erfinde keine Rezeptangaben. Steht etwas nicht im Rezept, sag das kurz und gib dann eine allgemeine Kochempfehlung als solche gekennzeichnet.\n\n`;
  const r = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: { model: MODEL, instructions: RULES + ctx, audio: { output: { voice: VOICE } },
        delegation: { type: "responses", responses: { model: BACKEND, instructions: RULES + ctx, tools: TOOLS, tool_choice: "auto" } } },
      transport: { type: "webrtc", sdp },
    }),
  });
  const j = await r.json().catch(() => ({}));
  const answer = j?.transport?.sdp;
  if (!r.ok || !answer) return json({ error: "Sprachdienst nicht erreichbar (" + r.status + ")" + (j?.error?.message ? ": " + clip(j.error.message, 200) : "") }, 502);
  return json({ sdp: answer, id: j?.session?.id ?? null, model: MODEL });
});
