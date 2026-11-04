/* Foody – eigenständiger Betrieb (GitHub Pages + Supabase).
 * Ersetzt die Claude-Artifact-Capabilities (db, user, assets, downloads) durch Supabase und liefert
 * sie über window.claude.use(name), damit app.js und store.js unverändert bleiben.
 * Datenmodell: eine Tabelle docs(path, coll, data) – gleiche Dokumentpfade wie in der Artifact-Datenbank.
 * Wird nur aktiv, wenn window.FR_CONFIG gesetzt ist und keine Claude-Umgebung vorhanden ist. */
(function (root) {
  "use strict";
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  function merge(target, src) {
    for (const [k, v] of Object.entries(src)) {
      if (isObj(v) && isObj(target[k])) merge(target[k], v);
      else target[k] = isObj(v) ? JSON.parse(JSON.stringify(v)) : v;
    }
    return target;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** Supabase-REST-Client mit Anmeldung (E-Mail + Passwort) und automatischer Token-Erneuerung. */
  function createClient(cfg, fetchFn, storage) {
    const f = fetchFn || root.fetch.bind(root);
    const KEY = "fr:session";
    let session = null;
    try { session = JSON.parse(storage.getItem(KEY) || "null"); } catch (e) { session = null; }
    const save = (s) => { session = s; try { s ? storage.setItem(KEY, JSON.stringify(s)) : storage.removeItem(KEY); } catch (e) { /* ohne Speicher weiter */ } };
    const tokenCall = async (grant, body) => {
      const r = await f(`${cfg.url}/auth/v1/token?grant_type=${grant}`, { method: "POST", headers: { apikey: cfg.key, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) throw new Error(j.error_description || j.msg || "Anmeldung fehlgeschlagen");
      save({ access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000, email: body.email || (session && session.email) });
    };
    const login = (email, password) => tokenCall("password", { email, password });
    const refresh = () => tokenCall("refresh_token", { refresh_token: session.refresh });
    const signedIn = () => !!session;
    const logout = () => save(null);
    async function req(path, opt = {}, retry = true) {
      if (!session) throw Object.assign(new Error("nicht angemeldet"), { code: "unauthenticated" });
      if (Date.now() > session.exp) { try { await refresh(); } catch (e) { save(null); throw Object.assign(e, { code: "unauthenticated" }); } }
      const r = await f(cfg.url + path, { ...opt, headers: { apikey: cfg.key, Authorization: "Bearer " + session.access, ...(opt.headers || {}) } });
      if (r.status === 401 && retry) { try { await refresh(); } catch (e) { save(null); throw Object.assign(e, { code: "unauthenticated" }); } return req(path, opt, false); }
      if (!r.ok) { const t = await r.text().catch(() => ""); throw Object.assign(new Error(t || "Fehler " + r.status), { code: "http_" + r.status }); }
      return r;
    }
    return { login, logout, signedIn, req, email: () => (session ? session.email : "") };
  }

  /** db-Schnittstelle (doc/collection/onSnapshot) auf der Tabelle docs. */
  function createDb(client, opts = {}) {
    const POLL = opts.pollMs ?? 5000;
    const enc = encodeURIComponent;
    const cache = {};      // coll -> Map(id -> data)
    const loaded = {};     // coll -> true
    const subs = {};       // coll -> Set(listener)
    const pending = {};    // coll -> Anzahl laufender Schreibvorgänge
    const timers = {};
    const sig = {};

    const split = (path) => { const p = path.split("/"); return { coll: p.slice(0, -1).join("/"), id: p[p.length - 1] }; };
    const fireAll = (coll) => (subs[coll] || new Set()).forEach((l) => l.fire());
    const snapOf = (coll) => {
      const docs = [...(cache[coll] || new Map()).entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, d]) => ({ id, exists: true, data: () => clone(d), metadata: {} }));
      return { docs, size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] };
    };
    async function fetchColl(coll) {
      const r = await client.req(`/rest/v1/docs?coll=eq.${enc(coll)}&select=path,data&limit=10000`);
      const rows = await r.json();
      const m = new Map(); rows.forEach((x) => m.set(split(x.path).id, x.data));
      return m;
    }
    async function refreshColl(coll, force) {
      if (!force && pending[coll]) return;
      const m = await fetchColl(coll);
      if (pending[coll]) return; // lokale Änderungen laufen noch: nicht überschreiben
      const canon = (v) => (Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : isObj(v) ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v));
      const of = (mm) => canon([...mm.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
      const s = of(m);
      if (loaded[coll] && s === of(cache[coll] || new Map())) { sig[coll] = s; return; } // Server = lokaler Stand: nichts neu zeichnen
      sig[coll] = s; cache[coll] = m; loaded[coll] = true; fireAll(coll);
    }
    const write = async (coll, fn) => {
      pending[coll] = (pending[coll] || 0) + 1;
      try { return await fn(); } finally { pending[coll]--; }
    };
    const upsert = (path, data) => client.req("/rest/v1/docs?on_conflict=path", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ path, coll: split(path).coll, data }) });
    const invalid = (m) => Object.assign(new Error(m), { code: "invalid_argument" });

    function doc(path) {
      const { coll, id } = split(path);
      const getRemote = async () => {
        const r = await client.req(`/rest/v1/docs?path=eq.${enc(path)}&select=data`);
        const rows = await r.json();
        return rows.length ? rows[0].data : undefined;
      };
      const local = (d) => { if (!cache[coll]) cache[coll] = new Map(); if (d === undefined) cache[coll].delete(id); else cache[coll].set(id, d); if (loaded[coll]) fireAll(coll); };
      return {
        id, path,
        async get() { const d = loaded[coll] ? (cache[coll] || new Map()).get(id) : await getRemote(); return { id, exists: d !== undefined, data: () => (d === undefined ? undefined : clone(d)), metadata: {} }; },
        set: (data) => write(coll, async () => {
          if (!isObj(data)) throw invalid("Body muss ein Objekt sein");
          if (JSON.stringify(data).length > 256 * 1024) throw invalid("zu groß");
          local(clone(data)); // sofort anzeigen, Speichern läuft im Hintergrund
          try { await upsert(path, clone(data)); } catch (e) { refreshColl(coll, true).catch(() => {}); throw e; }
        }),
        update: (data) => write(coll, async () => {
          const hit = loaded[coll] ? (cache[coll] || new Map()).get(id) : undefined;
          const cur = hit !== undefined ? clone(hit) : await getRemote();
          if (cur === undefined) throw invalid("Dokument existiert nicht");
          merge(cur, clone(data)); local(cur); // sofort anzeigen, Speichern läuft im Hintergrund
          try { await upsert(path, cur); } catch (e) { refreshColl(coll, true).catch(() => {}); throw e; }
        }),
        delete: () => write(coll, async () => { local(undefined); try { await client.req(`/rest/v1/docs?path=eq.${enc(path)}`, { method: "DELETE" }); } catch (e) { refreshColl(coll, true).catch(() => {}); throw e; } }),
      };
    }
    function collection(coll) {
      return {
        path: coll,
        doc: (id) => doc(coll + "/" + (id || Math.random().toString(36).slice(2))),
        onSnapshot(next, err) {
          const l = { fire: () => { if (loaded[coll]) next(snapOf(coll)); } };
          (subs[coll] = subs[coll] || new Set()).add(l);
          if (loaded[coll]) l.fire(); else refreshColl(coll, true).catch((e) => err && err(e));
          if (!timers[coll] && POLL > 0) timers[coll] = setInterval(() => { if (typeof document !== "undefined" && document.hidden) return; refreshColl(coll).catch(() => {}); }, POLL);
          return () => { subs[coll].delete(l); if (!subs[coll].size && timers[coll]) { clearInterval(timers[coll]); timers[coll] = null; } };
        },
      };
    }
    return { doc, collection };
  }

  /** Bilder: öffentlicher Storage-Bucket "images"; ältere Bilder liegen als img/<id>.jpg im Repository. */
  function createAssets(client, cfg) {
    const rid = () => "u" + Array.from(root.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    return {
      async upload(blob, o = {}) {
        const id = rid();
        await client.req(`/storage/v1/object/images/${id}`, { method: "POST", headers: { "Content-Type": o.type || blob.type || "image/jpeg", "x-upsert": "true" }, body: blob });
        return { id };
      },
      async delete(id) { if (/^u[0-9a-f]{24}$/.test(id)) await client.req(`/storage/v1/object/images/${id}`, { method: "DELETE" }); },
      url: (id) => (/^u[0-9a-f]{24}$/.test(id) ? `${cfg.url}/storage/v1/object/public/images/${id}` : `img/${id}.jpg`),
    };
  }

  /** Anmeldemaske; löst auf, sobald angemeldet. */
  let loginP = null;
  function loginScreen(client) {
    if (loginP) return loginP;
    return (loginP = new Promise((resolve) => {
      if (client.signedIn()) return resolve();
      const el = document.createElement("div");
      el.style.cssText = "position:fixed;inset:0;z-index:99;background:var(--bg,#f5f1ea);display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif";
      el.innerHTML = `<form style="width:100%;max-width:340px;display:grid;gap:12px"><h2 style="margin:0">Foody</h2><div style="opacity:.7;font-size:14px">Bitte anmelden</div>
        <input name="email" type="email" autocomplete="username" placeholder="E-Mail" required style="padding:12px;font-size:16px;border-radius:10px;border:1px solid #bbb">
        <input name="pw" type="password" autocomplete="current-password" placeholder="Passwort" required style="padding:12px;font-size:16px;border-radius:10px;border:1px solid #bbb">
        <button style="padding:12px;font-size:16px;border-radius:10px;border:0;background:#7a5a3a;color:#fff">Anmelden</button><div class="err" style="color:#b00;font-size:14px;min-height:18px"></div></form>`;
      document.body.appendChild(el);
      el.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try { await client.login(String(fd.get("email")).trim(), String(fd.get("pw"))); el.remove(); resolve(); }
        catch (err) { el.querySelector(".err").textContent = err.message; }
      });
    }));
  }

  function install(cfg) {
    const client = createClient(cfg, null, root.localStorage);
    const db = createDb(client);
    const assets = createAssets(client, cfg);
    root.FR_ASSET = assets.url;
    const downloads = { async save({ filename, data }) {
      const b = new Blob([typeof data === "string" ? data : JSON.stringify(data)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    } };
    const user = { can: async () => true };
    root.claude = { use: async (name) => {
      if (name === "db") { await loginScreen(client); const map = cfg.profiles || {}; const mine = map[String(client.email()).toLowerCase()]; if (mine) root.FR_PROFILE = mine; return db; }
      if (name === "assets") { await loginScreen(client); return assets; }
      if (name === "user") return user;
      if (name === "downloads") return downloads;
      return null; // sample (KI) gibt es hier nicht
    } };
  }

  const api = { createClient, createDb, createAssets, merge, install };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (root.FR_CONFIG && !root.claude) install(root.FR_CONFIG);
})(typeof window !== "undefined" ? window : globalThis);
