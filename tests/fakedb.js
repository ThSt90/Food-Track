/* In-Memory-Nachbau der Artifact-Datenbank (db-Capability) für Tests.
 * Bildet die Semantik nach, auf die sich store.js verlässt: set ersetzt, update verlangt ein
 * existierendes Dokument und führt verschachtelte Objekte zusammen (Arrays/null ersetzen),
 * Snapshots sind eingefroren. Mehrere Stores auf derselben FakeDB = Neustart/zweites Gerät. */
"use strict";

function deepFreeze(o) {
  if (o && typeof o === "object") { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(target[k])) merge(target[k], v);
    else target[k] = isObj(v) ? JSON.parse(JSON.stringify(v)) : v;
  }
  return target;
}

class FakeDB {
  constructor() { this.docs = new Map(); this.listeners = new Set(); this.writes = 0; }
  _check(path, even) {
    const n = path.split("/").length;
    if ((n % 2 === 0) !== even) throw new TypeError("Pfad-Parität falsch: " + path);
    if (!/^[A-Za-z0-9_\-.~:@+/]+$/.test(path)) throw new TypeError("Ungültige Zeichen: " + path);
  }
  _notify(path) {
    const coll = path.split("/").slice(0, -1).join("/");
    for (const l of this.listeners) if (l.coll === coll) l.fire();
  }
  doc(path) {
    this._check(path, true);
    const db = this;
    return {
      id: path.split("/").pop(), path,
      async get() { const d = db.docs.get(path); return { id: path.split("/").pop(), exists: !!d, data: () => (d ? deepFreeze(JSON.parse(JSON.stringify(d))) : undefined), metadata: {} }; },
      async set(data) {
        if (!isObj(data)) throw { code: "invalid_argument", message: "Body muss ein Objekt sein" };
        if (JSON.stringify(data).length > 256 * 1024) throw { code: "invalid_argument", message: "zu groß" };
        db.docs.set(path, JSON.parse(JSON.stringify(data))); db.writes++; db._notify(path);
      },
      async update(data) {
        const d = db.docs.get(path);
        if (!d) throw { code: "invalid_argument", message: "Dokument existiert nicht" };
        merge(d, data); db.writes++; db._notify(path);
      },
      async delete() { db.docs.delete(path); db.writes++; db._notify(path); },
    };
  }
  collection(coll) {
    this._check(coll, false);
    const db = this;
    return {
      path: coll,
      doc: (id) => db.doc(coll + "/" + (id || Math.random().toString(36).slice(2))),
      onSnapshot(next) {
        const l = {
          coll,
          fire() {
            const docs = [...db.docs.entries()].filter(([p]) => p.split("/").slice(0, -1).join("/") === coll).sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([p, d]) => ({ id: p.split("/").pop(), exists: true, data: () => deepFreeze(JSON.parse(JSON.stringify(d))), metadata: {} }));
            next({ docs, size: docs.length, empty: !docs.length, metadata: {}, docChanges: () => [] });
          },
        };
        db.listeners.add(l); l.fire();
        return () => db.listeners.delete(l);
      },
    };
  }
}

module.exports = { FakeDB };
