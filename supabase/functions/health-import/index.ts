// Foody – Apple-Health-Eingang. Ein iOS-Kurzbefehl schickt Gewicht und Workouts hierher (POST, JSON).
// Schutz: Header "x-health-key" muss dem Secret HEALTH_KEY entsprechen. Die App übernimmt die Werte
// beim nächsten Öffnen über ihre normalen Regeln (Gewicht 20–300 kg, Sport nur mit kcal > 0).
const URL_ = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, KEY = Deno.env.get("HEALTH_KEY") ?? "";
const H = { "Content-Type": "application/json", apikey: SRV, Authorization: "Bearer " + SRV };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const same = (a: string, b: string) => { if (a.length !== b.length || !b) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const berlinToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const num = (v: unknown) => Number(String(v ?? "").replace(",", "."));
// Echte Zahlen bleiben unverändert (2.908 = 2,908). Text wie "1.234,5 kcal": Einheit weg, Komma = Dezimaltrenner
const numK = (v: unknown) => { if (typeof v === "number") return v; let t = String(v ?? "").replace(/[^0-9.,]/g, ""); if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); return Number(t); };
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clean = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST erwartet" }, 405);
  if (!same(req.headers.get("x-health-key") ?? "", KEY)) return json({ error: "nicht erlaubt" }, 401);
  let b: any; try { b = await req.json(); } catch { return json({ error: "JSON erwartet" }, 400); }
  const pid = b.profile;
  if (pid !== "p1" && pid !== "p2") return json({ error: "profile muss p1 oder p2 sein" }, 400);
  const date = isDate(b.date) ? b.date : berlinToday();
  const entries: Record<string, unknown> = {}; const skipped: string[] = [];
  const kg = num(b.weightKg);
  if (b.weightKg != null && b.weightKg !== "") { if (kg >= 20 && kg <= 300) entries["w" + date] = { type: "weight", date, kg }; else skipped.push("Gewicht ungültig"); }
  const act = numK(b.activeKcal);
  if (b.activeKcal != null && b.activeKcal !== "") { if (act > 0 && act < 10000) entries["a" + date.replace(/-/g, "")] = { type: "active", date, kcal: Math.round(act) }; else skipped.push("Aktive kcal ungültig: " + JSON.stringify(b.activeKcal)); } // gleicher Tag überschreibt
  for (const w of Array.isArray(b.workouts) ? b.workouts : []) {
    const kcal = num(w.kcal), d = isDate(w.date) ? w.date : date;
    if (!(kcal > 0)) { skipped.push("Workout ohne kcal: " + String(w.name ?? "")); continue; } // nichts schätzen
    const key = "s" + d.replace(/-/g, "") + clean(String(w.id ?? (w.name ?? "x") + Math.round(kcal) + Math.round(num(w.minutes) || 0)));
    entries[key] = { type: "workout", date: d, name: String(w.name ?? "Sonstiges").slice(0, 60), kcal: Math.round(kcal), minutes: Math.max(0, Math.round(num(w.minutes) || 0)) };
  }
  if (!Object.keys(entries).length) return json({ ok: true, saved: 0, skipped });
  const path = "health/" + pid, q = `${URL_}/rest/v1/docs`;
  const cur = await (await fetch(`${q}?path=eq.${encodeURIComponent(path)}&select=data`, { headers: H })).json();
  const merged = { entries: { ...((cur[0]?.data?.entries) ?? {}), ...entries } };
  const r = await fetch(`${q}?on_conflict=path`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ path, coll: "health", data: merged }) });
  if (!r.ok) return json({ error: "Speichern fehlgeschlagen" }, 500);
  return json({ ok: true, saved: Object.keys(entries).length, skipped });
});
