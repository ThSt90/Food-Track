/* Minimaler Nachbau der Supabase-REST-Routen (auth, docs, storage) für Tests des Adapters. */
"use strict";
function createFakeSupabase() {
  const rows = new Map(); let calls = 0;
  const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) });
  const fetchFn = async (url, opt = {}) => {
    calls++;
    const u = new URL(url); const q = (k) => { const v = u.searchParams.get(k); return v && v.replace(/^eq\./, ""); };
    if (u.pathname === "/auth/v1/token") { const b = JSON.parse(opt.body); if (b.password === "falsch") return json({ error_description: "Invalid login credentials" }, 400); return json({ access_token: "a", refresh_token: "r", expires_in: 3600 }); }
    if (!opt.headers || opt.headers.Authorization !== "Bearer a") return json({}, 401);
    if (u.pathname === "/rest/v1/docs") {
      if (opt.method === "POST") { const b = JSON.parse(opt.body); rows.set(b.path, { path: b.path, coll: b.coll, data: b.data }); return json({}, 201); }
      if (opt.method === "DELETE") { rows.delete(q("path")); return json({}, 204); }
      let out = [...rows.values()];
      if (q("path")) out = out.filter((r) => r.path === q("path")); if (q("coll")) out = out.filter((r) => r.coll === q("coll"));
      return json(JSON.parse(JSON.stringify(out.map((r) => ({ path: r.path, data: r.data })))));
    }
    return json({}, 404);
  };
  return { fetchFn, rows, calls: () => calls };
}
module.exports = { createFakeSupabase };
