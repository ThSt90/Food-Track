/* Nachbau von window.claude für Browsertests außerhalb der Claude-App.
 * db: dieselbe Semantik wie tests/fakedb.js, Inhalt bleibt über Neuladen erhalten (localStorage),
 * assets: speichert Bilder und meldet sie an den Testtreiber (window.__saveAsset),
 * sample: liefert window.__sampleAnswer zurück (simuliert Claude), user: Besitzer. */
(function () {
  const KEY = "__mockdb";
  const load = () => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) || "{}"))); } catch (e) { return new Map(); } };
  const docs = load();
  if (!docs.size && window.__seed) for (const d of window.__seed) docs.set(d.path, JSON.parse(JSON.stringify(d.data)));
  const persist = () => localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(docs)));
  persist();
  const listeners = new Set();
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (t, s) => { for (const [k, v] of Object.entries(s)) { if (isObj(v) && isObj(t[k])) merge(t[k], v); else t[k] = isObj(v) ? JSON.parse(JSON.stringify(v)) : v; } };
  const freeze = (o) => { if (o && typeof o === "object") { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
  const parent = (p) => p.split("/").slice(0, -1).join("/");
  const notify = (path) => queueMicrotask(() => { for (const l of listeners) if (l.coll === parent(path)) l.fire(); });
  window.__dbWrites = 0;
  const doc = (path) => ({
    id: path.split("/").pop(), path,
    async get() { const d = docs.get(path); return { id: path.split("/").pop(), exists: !!d, data: () => d && freeze(JSON.parse(JSON.stringify(d))), metadata: {} }; },
    async set(data) { docs.set(path, JSON.parse(JSON.stringify(data))); window.__dbWrites++; persist(); notify(path); },
    async update(data) { const d = docs.get(path); if (!d) throw { code: "invalid_argument", message: "missing" }; merge(d, data); window.__dbWrites++; persist(); notify(path); },
    async delete() { docs.delete(path); persist(); notify(path); },
  });
  const db = {
    doc,
    collection: (coll) => ({
      path: coll, doc: (id) => doc(coll + "/" + (id || Math.random().toString(36).slice(2))),
      onSnapshot(next) {
        const l = { coll, fire() { const ds = [...docs.entries()].filter(([p]) => parent(p) === coll).map(([p, d]) => ({ id: p.split("/").pop(), exists: true, data: () => freeze(JSON.parse(JSON.stringify(d))), metadata: {} })); next({ docs: ds, size: ds.length, empty: !ds.length, metadata: {}, docChanges: () => [] }); } };
        listeners.add(l); setTimeout(() => l.fire(), 30);
        return () => listeners.delete(l);
      },
    }),
  };
  let n = 0;
  const assets = {
    async upload(blob, opts) {
      const id = (++n).toString(16).padStart(32, "0");
      const buf = await blob.arrayBuffer();
      let bin = ""; new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
      if (window.__saveAsset) await window.__saveAsset(id, btoa(bin), (opts && opts.type) || blob.type);
      return { id, url: "/_blob/" + id, sizeBytes: buf.byteLength, contentType: blob.type };
    },
    async list() { return { assets: [], usage: {} }; }, async delete() { return { deleted: true }; },
  };
  const sample = Object.assign(async () => ({ text: "", truncated: false }), {
    async json(prompt, opts) { window.__sampleCalls = (window.__sampleCalls || 0) + 1; window.__samplePrompt = prompt; window.__sampleImages = opts && opts.images ? opts.images.length : 0; await new Promise((r) => setTimeout(r, 300)); return JSON.parse(JSON.stringify(window.__sampleAnswer)); },
    async limits() { return { maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ["image/png", "image/jpeg"] } }; },
  });
  const user = { isOwner: () => true, canEdit: () => true, can: async () => true, id: async () => "owner" };
  const downloads = { async save(o) { window.__download = o.filename; return { status: "saved" }; } };
  const caps = { db, assets, sample, user, downloads };
  window.claude = { use: async (name) => caps[name] || null };
})();
