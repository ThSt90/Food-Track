/* Foody – Oberfläche. Rendert aus dem Speicher (store.js), schreibt nur auf Nutzeraktionen. */
(function () {
  "use strict";
  const L = window.FRL, X = window.FRS;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const de = L.de, deA = L.deAmount;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("fr:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("fr:" + k, JSON.stringify(v)); } catch (e) { /* nur Komfort */ } },
  };
  const SLOT_LABEL = Object.fromEntries(X.SLOTS);
  /** Einkaufsliste: heute oder die restliche Woche (Schlüssel „Montag__w“). */
  const shopDate = () => (ui.shopSpan === "woche" ? store.mondayOf(today()) + "__w" : today());
  const CAT_SHORT = { fruehstueck: "Frühstück", main: "Mittag / Abend", mittag: "Mittag", abend: "Abend", snack: "Frühstück" };
  const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  // ------------------------------------------------------------------ Symbole
  const P = {
    home: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    radar: "M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l7-7",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    checklist: "M4 7l2 2 3-3.5M4 16l2 2 3-3.5M12 7.5h8M12 16.5h8",
    book: "M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10",
    cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L21 8H6.2M9 20.5h.01M17 20.5h.01",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    scale: "M4 20h16l-2-13H6zM12 7V4M9 12l3-2 3 2",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
    check: "M5 12.5l4.5 4.5L19 7.5", next: "M5 5l7 7-7 7M13 5l7 7-7 7", x: "M6 6l12 12M18 6 6 18", undo: "M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3",
    plus: "M12 5v14M5 12h14", left: "M15 5l-7 7 7 7", right: "M9 5l7 7-7 7", cam: "M4 8h3l2-3h6l2 3h3v11H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  };
  const ic = (n, s = 22, fill = false) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
  const PIN = `<svg class="mark" viewBox="0 0 22 26" aria-hidden="true"><path d="M11 25s8-8.2 8-14A8 8 0 0 0 3 11c0 5.8 8 14 8 14z" fill="currentColor"/><circle cx="11" cy="11" r="3.2" fill="var(--surface)"/></svg>`;
  const FLAG = `<svg class="mark flag" viewBox="0 0 22 26" aria-hidden="true"><path d="M3 2v23" stroke="currentColor" stroke-width="2.4"/><path d="M4 2h15l-4 5 4 5H4z" fill="currentColor"/></svg>`;

  // ------------------------------------------------------------------ Zustand der Oberfläche
  let store = null, caps = {};
  const ui = {
    later: [],
    view: LS.get("view", "radar"), pid: LS.get("pid", "p1"), date: null, radar: { slot: null, meal: null, maxMinutes: null, stage: (LS.get("radar", {}) || {}).stage || "alle" },
    shopSpan: LS.get("shopSpan", "tag"), hmode: LS.get("hmode", "tag"), scope: LS.get("scope", "alle"), lib: { q: "", cat: null, fav: false, max: null, tag: null, sort: "name" }, hist: { period: "monat", month: null },
    sheet: null, toast: null, open: new Set(LS.get("extras", false) ? ["extras"] : []), busy: new Set(), readOnly: false, lastDecision: null, status: "laden",
  };

  const today = () => (store ? store.today() : L.todayISO());
  const fmtDate = (s) => { const d = L.parseISO(s); return `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`; };
  const relDay = (s) => { const n = L.daysBetween(today(), s); return n === 0 ? "Heute" : n === -1 ? "Gestern" : n === 1 ? "Morgen" : fmtDate(s); };
  const img = (id, cls, title) => id
    ? `<div class="thumb ${cls}" style="background-image:url('${esc(assetUrl(id))}')" role="img" aria-label="${esc(title)}"></div>`
    : `<div class="thumb ph ${cls}" aria-hidden="true">${esc(initials(title))}</div>`;
  const initials = (t) => String(t || "?").split(/[\s-]+/).filter((w) => /^[A-ZÄÖÜa-zäöü]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  const kcal = (v) => (v == null ? "–" : de(v));
  const qualityChip = (q) => `<span class="chip ${q === "original" || q === "berechnet" ? "line" : q === "geschaetzt" ? "warn" : "bad"}" title="Datenqualität der Nährwerte">${esc(L.QUALITY_LABEL[q] || q)}</span>`;

  // ================================================================== Rendern
  let rafPending = false, deferred = false;
  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }
  function typing() {
    const a = document.activeElement;
    return a && $("#app").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox" && a.type !== "range";
  }
  function render() {
    try { if (typing()) { deferred = true; } else { deferred = false; renderMain(); } }
    catch (err) { console.error(err); toast("Konnte nicht anzeigen: " + (err && err.message || err)); }
    renderNav(); renderSheet(false); renderToast();
  }
  document.addEventListener("focusout", () => setTimeout(() => { if (deferred && !typing()) { deferred = false; renderMain(); } }, 0));

  /** Eigenständige Variante: angemeldete Person sieht nur ihr eigenes Profil (window.FR_PROFILE, aus config.js). */
  const visibleProfiles = () => (window.FR_PROFILE ? store.profiles().filter((p) => p.id === window.FR_PROFILE) : store.profiles());

  function renderMain() {
    const app = $("#app");
    if (!store || ui.status !== "ok") { app.innerHTML = header(false) + bootState(); return; }
    if (window.FR_PROFILE && ui.pid !== window.FR_PROFILE) { ui.pid = window.FR_PROFILE; LS.set("pid", ui.pid); }
    if (!store.profile(ui.pid)) ui.pid = (store.profiles()[0] || {}).id || "p1";
    const views = { heute: vHeute, radar: vRadar, rezepte: vRezepte, einkauf: vEinkauf, mehr: vMehr, historie: vHistorie, rueckblick: vRueckblick, health: vHealth, gewicht: vGewicht, profil: vProfil };
    const html = header(ui.view === "heute" && ui.hmode !== "woche") + (ui.readOnly ? `<div class="notice">Nur Ansicht: Du kannst diese Seite lesen, aber nichts ändern.</div>` : "") + (views[ui.view] || vHeute)();
    // Unveränderte Ansicht nicht neu aufbauen: ein Neuzeichnen zwischen Berühren und Loslassen verschluckt auf dem iPhone den Tipp
    if (html !== ui.lastHtml || app.dataset.v !== ui.view) { app.innerHTML = html; ui.lastHtml = html; app.dataset.v = ui.view; bindSwipe(); }
    const fit = ui.view === "radar" && !!ui.radar.meal;
    app.classList.toggle("fit", fit); document.documentElement.classList.toggle("fit-lock", fit);
  }

  function bootState() {
    if (ui.status === "laden") return `<div class="empty"><b>Daten werden geladen …</b><span>Foody verbindet sich mit deinem Speicher in der Claude-App.</span></div>`;
    if (ui.status === "ohne-db") return `<div class="empty"><b>Speicher in dieser Ansicht nicht verfügbar</b><span>Öffne Foody in der Claude-App oder auf claude.ai, angemeldet mit deinem Konto. Deine Daten liegen dort und sind nach jedem Öffnen wieder da.</span></div>`;
    if (ui.status === "leer") return `<div class="empty"><b>Noch keine Profile angelegt</b><span>Foody legt zwei Profile an: Profil 1 (Mann, 37) und Profil 2 (Frau, 35). Größe und Gewicht trägst du danach ein.</span><button class="btn primary" data-act="createProfiles">Profile anlegen</button></div>`;
    return "";
  }

  const themeIsDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : !(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches); };
  const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
  applyTheme(LS.get("theme", "light"));
  // Akzentfarbe: genau die gewählte Farbe wird für Flächen verwendet; Schrift/Text bekommt automatisch eine dunklere (hell) bzw. hellere (dunkel) Variante
  const hslToHex = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join(""); };
  const ACCENTS = [[150, "Salbei"], [172, "Mint"], [200, "Himmel"], [222, "Hortensie"], [262, "Lavendel"], [305, "Orchidee"], [345, "Rosé"], [14, "Pfirsich"], [32, "Aprikose"], [48, "Butter"]].map(([h, n]) => [hslToHex(h, 45, 80), n]);
  function hexParts(hex) { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2, sat = d ? d / (1 - Math.abs(2 * l - 1)) : 0; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); return { h: Math.round(((h * 60) + 360) % 360), s: Math.round(sat * 100), l: Math.round(l * 100), lum: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }; }
  const accentHex = () => { const a = LS.get("accent", null); if (!a) return null; if (a.hex) return String(a.hex).toLowerCase(); return typeof a.h === "number" ? hslToHex(a.h, 45, 80) : null; };
  function applyAccent() {
    const el = document.documentElement.style, hex = accentHex();
    const names = ["--accent", "--accent-soft", "--accent-ink", "--accent-text", "--glow"];
    if (!hex) { names.forEach((n) => el.removeProperty(n)); return; }
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const c = hexParts(hex), sat = Math.min(c.s, 60);
    el.setProperty("--accent", hex);
    el.setProperty("--accent-ink", c.lum > 0.4 ? "#2b2724" : "#ffffff");
    el.setProperty("--accent-text", dark ? `hsl(${c.h} ${sat}% ${Math.max(c.l, 72)}%)` : `hsl(${c.h} ${Math.max(sat, 30)}% ${Math.min(c.l, 34)}%)`);
    el.setProperty("--accent-soft", `color-mix(in srgb, ${hex} ${dark ? 22 : 30}%, var(--surface))`);
    el.setProperty("--glow", `0 0 0 1px color-mix(in srgb, ${hex} 40%, transparent), 0 8px 24px color-mix(in srgb, ${hex} 14%, transparent)`);
  }
  applyAccent();

  function header(withDate) {
    const ps = store && ui.status === "ok" ? visibleProfiles() : [];
    const who = ps.map((p) => `<button data-act="pid" data-id="${p.id}" aria-pressed="${p.id === ui.pid}" title="${esc(p.name)}">${esc(initials(p.name) || p.id)}</button>`).join("");
    const d = ui.date;
    const dateBar = withDate ? `<div class="datebar"><button class="iconbtn" data-act="day" data-n="-1" aria-label="Vortag">${ic("left", 18)}</button>
      <div style="text-align:center"><b>${esc(relDay(d))}</b><div class="sub">${esc(fmtDate(d))}</div></div>
      <button class="iconbtn" data-act="day" data-n="1" aria-label="Folgetag">${ic("right", 18)}</button></div>` : "";
    return `<header class="top"><button class="iconbtn" data-act="theme" aria-label="Hell oder dunkel umschalten" title="Hell / Dunkel" style="margin-right:auto">${themeIsDark() ? "☀︎" : "☾"}</button>${ps.length > 1 ? `<div class="who" role="group" aria-label="Person">${who}</div>` : ""}</header>${dateBar}`;
  }

  const assetUrl = (id) => (window.FR_ASSET ? window.FR_ASSET(id) : "/_blob/" + id);
  const NAV = [["radar", "Neu", "sparkle"], ["heute", "Ausgewählt", "checklist"], ["rezepte", "Rezepte", "book"], ["einkauf", "Einkauf", "cart"], ["mehr", "Mehr", "more"]];
  function renderNav() {
    const cur = ["historie", "gewicht", "profil", "rueckblick", "health"].includes(ui.view) ? "mehr" : ui.view;
    const navHtml = `${cur === "rezepte" ? `<button class="fab" data-act="fabLink" aria-label="Rezept-Link einfügen" title="Rezept-Link einfügen">${ic("plus", 26)}<span>Link</span></button>` : ""}<div class="in">${NAV.map(([k, t, i]) => `<button data-act="view" data-v="${k}" ${k === cur ? 'aria-current="page"' : ""}>${ic(i, 24)}<span>${t}</span></button>`).join("")}</div>`;
    if (navHtml !== ui.lastNav) { $("#nav").innerHTML = navHtml; ui.lastNav = navHtml; }
  }

  function renderToast() {
    const t = ui.toast;
    $("#toast").innerHTML = t ? `<div class="toast" role="status"><span>${esc(t.text)}</span>${t.undo ? `<button data-act="toastUndo">Rückgängig</button>` : ""}</div>` : "";
  }
  let toastTimer = null;
  // Keine Bestätigungs-Popups: nur Fehler, Warnungen und die zwei Hinweise, die sonst fehlen würden
  const TOAST_OK = /^(Kopiert|\d+ Werte? aus Apple|Konnte|Speicher|Nur Ansicht|Bild konnte|Bitte|Das ist kein|Kopieren nicht|Keine weiteren|Sicherung nicht|Liste kopiert|Link vorgemerkt|„.*“ gelöscht)/;
  function toast(text, undo) { if (!TOAST_OK.test(String(text))) return; ui.toast = { text, undo }; renderToast(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = null; renderToast(); }, undo ? 6000 : 3000); }

  // ================================================================== Gemeinsame Bausteine
  /** Hervorgehobene Budget-Box. used = was schon fest ist, add = was hinzukäme, total = Ziel + Sport. */
  function track(total, used, add, labels) {
    if (!total || total <= 0) return "";
    const pct = (v) => Math.max(0, Math.min(100, (v / total) * 100));
    const over = used + add > total;
    return `<div class="track" aria-hidden="true"><div class="rail">
      <div class="fill" style="width:${pct(used)}%"></div>
      ${add > 0 ? `<div class="fill plan" style="left:${pct(used)}%;width:${pct(used + add) - pct(used)}%"></div>` : ""}
      ${over ? `<div class="fill over" style="left:${pct(total) - 1.5}%;width:1.5%"></div>` : ""}</div>
      ${labels.pin ? `<div style="position:absolute;left:${pct(used + (labels.pinAdd ? add : 0))}%">${PIN}</div>` : ""}
      ${labels.flag != null ? `<div style="position:absolute;left:${pct(labels.flag)}%">${FLAG}</div>` : ""}</div>`;
  }

  function ring(value, pct, cls, unit) {
    return `<div class="ring f-${cls}" style="--p:${Math.max(0, Math.min(100, pct || 0))}"><span>${value}${unit ? `<small>${unit}</small>` : ""}</span></div>`;
  }

  // ================================================================== Heute
  function vHeute() {
    const seg = `<div class="filters" role="group" aria-label="Ansicht">${[["tag", "Tag"], ["woche", "Woche"]].map(([k, t]) => `<button class="chip line" data-act="hmode" data-v="${k}" aria-pressed="${ui.hmode === k}">${t}</button>`).join("")}</div>`;
    return seg + (ui.hmode === "woche" ? vWoche() : vTag());
  }
  function vWoche() {
    const mon = store.mondayOf(ui.date), t = today();
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => L.addDays(mon, i));
    const total = days.reduce((n, d) => n + store.meals(ui.pid, d).length, 0);
    const rows = days.map((d) => {
      const ms = store.meals(ui.pid, d).sort((a, b) => X.SLOTS.findIndex(([k]) => k === a.slot) - X.SLOTS.findIndex(([k]) => k === b.slot));
      return `<section class="card wday ${d === t ? "today" : ""}"><div class="row"><div><h3>${esc(fmtDate(d))}${d === t ? ' <span class="chip hot">Heute</span>' : ""}</h3></div>
        <button class="btn sm" data-act="weekAdd" data-date="${d}">${ic("plus", 16)} Gericht</button></div>
        ${ms.length ? `<div class="minilist">${ms.map((m) => `<div><span><b>${esc(m.title)}</b><br><span class="note">${esc(SLOT_LABEL[m.slot] || "")}${m.status === "gegessen" ? " · gegessen" : ""}${m.total && m.total.kcal != null ? " · " + de(Math.round(m.total.kcal)) + " kcal" : ""}</span></span>
          <button class="btn sm ghost" data-act="weekDel" data-id="${m.id}" data-date="${d}" aria-label="Entfernen">${ic("trash", 16)}</button></div>`).join("")}</div>` : `<div class="note">Nichts geplant.</div>`}</section>`;
    }).join("");
    return `<div class="toprow"><button class="iconbtn" data-act="weekShift" data-n="-1" aria-label="Vorwoche">${ic("left", 18)}</button><b>${esc(fmtDate(mon))} – ${esc(fmtDate(days[6]))}</b><button class="iconbtn" data-act="weekShift" data-n="1" aria-label="Folgewoche">${ic("right", 18)}</button></div>
      ${rows}<button class="btn primary" data-act="shopWeek" ${total ? "" : "disabled"}>${ic("cart", 18)} Einkaufsliste für die Woche</button>`;
  }
  function sheetWeekPick() {
    const q = L.norm(ui.sheet.q || "");
    const rs = store.recipes(ui.pid).filter((r) => !q || L.norm(r.title).includes(q)).slice(0, 40);
    return `<input id="am-q" type="search" placeholder="Rezept suchen" value="${esc(ui.sheet.q || "")}" data-input="amq" aria-label="Rezept suchen">
      <div class="minilist">${rs.map((r) => `<div><span><b>${esc(r.title)}</b><br><span class="note">${kcal(r.nut.perPortion.kcal)} kcal je Portion</span></span><button class="btn sm primary" data-act="weekPick" data-id="${r.id}">Wählen</button></div>`).join("") || `<div class="note">Keine Rezepte gefunden.</div>`}</div>`;
  }
  function vTag() {
    const pid = ui.pid, date = ui.date;
    const d = store.day(pid, date), e = store.energyFor(pid, date), b = d.budget, st = d.settings;
    let extra = "";
    if (st.goalKcal == null) {
      // Ohne Kalorienziel: nur Übersicht, kein Budget und keine Pflichtangaben je Profil
      extra += `<section class="card" aria-label="Heute"><div class="row"><div><h2>Heute</h2><div class="sub">Ohne Kalorienziel · ${de(b.eaten)} kcal gegessen${b.planned ? ` · ${de(b.planned)} geplant` : ""}</div></div></div>
        ${d.unknown ? `<div class="chips"><span class="chip warn">Werte unvollständig</span></div>` : ""}
        <div class="macros">${[["protein", "Protein"], ["carbs", "Kohlenhydrate"], ["fat", "Fett"]].map(([k, t]) => `<div class="macro"><span>${t}</span><b>${de(d.macros[k].eaten)} g</b>${d.macros[k].planned ? `<span>+${de(d.macros[k].planned)} g geplant</span>` : `<span>&nbsp;</span>`}</div>`).join("")}</div>
        <div class="note">Ein Kalorienziel ist freiwillig. Wenn du eins willst: Mehr → Profile.</div></section>`;
    }
    const total = st.goalKcal != null ? st.goalKcal + b.sport : null;
    const eatenPct = total ? Math.round((b.eaten / total) * 100) : 0;
    const over = b.remaining != null && b.remaining < 0;
    const planOver = b.afterPlan != null && b.afterPlan < 0;
    if (st.goalKcal != null) extra += `<section class="card" aria-label="Kalorienbudget">
      <div class="row"><div><h2>Kalorien heute</h2><div class="sub">${st.goalKcal != null ? `Ziel ${de(st.goalKcal)} kcal${b.sport ? ` · Sport +${de(b.sport)}` : ""}${st.frozen ? "" : ""}` : "Ziel: keine Angabe"}</div></div>
      ${ring(total ? de(eatenPct) + "%" : "–", eatenPct, over ? "bad" : eatenPct > 85 ? "low" : "hi", "gegessen")}</div>
      <div class="chips">${b.remaining == null ? `<span class="chip">Budget: keine Angabe</span>` : over ? `<span class="chip bad">überschritten</span>` : planOver ? `<span class="chip warn">Plan zu groß</span>` : `<span class="chip ok">im Budget</span>`}
        ${st.sportDone ? `<span class="chip acc">Sport ✓</span>` : ""}${st.complete ? `<span class="chip line">vollständig erfasst</span>` : ""}
        ${d.unknown ? `<span class="chip warn">Werte unvollständig</span>` : ""}</div>
      <div class="strip"><span class="eyebrow">Tag</span>
        <div class="v"><b>${kcal(st.goalKcal)}</b><small>Ziel</small></div><span class="sep">›</span>
        <div class="v"><b>${de(b.eaten)}</b><small>gegessen</small></div><span class="sep">›</span>
        <div class="v"><b>${de(b.planned)}</b><small>geplant</small></div><span class="sep">›</span>
        <div class="v"><b>+${de(b.sport)}</b><small>Sport</small></div></div>
      <div class="pot ${over ? "over" : ""}">
        <div class="eyebrow">Noch frei</div>
        <div class="head"><div class="big">${b.remaining == null ? "–" : de(b.remaining)}<small>kcal</small></div>
          <div class="side"><b class="${planOver ? "neg" : ""}">≈ ${b.afterPlan == null ? "–" : de(b.afterPlan)} kcal</b><span>nach Plan</span></div></div>
        ${track(total, b.eaten, b.planned, { pin: true, flag: b.eaten + b.planned <= total ? b.eaten + b.planned : null })}
        <div class="legend"><span>0</span><span><i style="background:var(--accent)"></i>gegessen</span><span><i style="background:var(--accent-2)"></i>geplant</span><span>${total ? "Budget " + de(total) : ""}</span></div>
      </div>
      ${b.eatenUnknown || b.plannedUnknown ? `<div class="note">${b.eatenUnknown ? `${b.eatenUnknown} gegessene Mahlzeit(en) ohne Kalorienwert – nicht eingerechnet. ` : ""}${b.plannedUnknown ? `${b.plannedUnknown} geplante ohne Wert.` : ""}</div>` : ""}
      <div class="macros">${[["protein", "Protein"], ["carbs", "Kohlenhydrate"], ["fat", "Fett"]].map(([k, t]) => `<div class="macro"><span>${t}</span><b>${de(d.macros[k].eaten)} g</b>${d.macros[k].planned ? `<span>+${de(d.macros[k].planned)} g geplant</span>` : `<span>&nbsp;</span>`}</div>`).join("")}</div>
      ${e && e.warnings.length ? `<div class="notice">${esc(e.warnings.join(" "))}</div>` : ""}
    </section>`;

    let out = "";
    // Abendessen zuerst und groß, dann die übrigen Mahlzeiten
    const order = ["abend", "mittag", "fruehstueck"];
    for (const key of order) {
      const s = d.slots.find((x) => x.key === key);
      out += `<section class="slot ${key === "abend" ? "dinner" : ""}"><div class="slot-head"><h3>${key === "abend" ? "Heute Abend" : esc(s.label)}</h3>
        <button class="btn sm" data-act="addMeal" data-slot="${key}">${ic("plus", 16)} Eintrag</button></div>
        ${s.multiOpen ? `<div class="note">Mehrere Gerichte vorgemerkt – die Prognose zählt alle. Entferne, was du nicht isst.</div>` : ""}
        ${s.meals.length ? s.meals.map(mealRow).join("") : `<div class="note">${key === "abend" ? "Noch nichts geplant. Unter „Entdecken“ erst Favoriten sammeln, dann daraus fürs Kochen wählen – oder einen Eintrag anlegen." : "Kein Eintrag."}${key === "abend" ? `<div><button class="btn sm primary" data-act="view" data-v="radar" style="margin-top:8px">Zu „Neu“ wechseln</button></div>` : ""}</div>`}</section>`;
    }

    // Sport
    extra += `<section class="slot"><div class="slot-head"><h3>Sport</h3><button class="btn sm" data-act="addSport">${ic("plus", 16)} Aktivität</button></div>
      <button class="toggle" data-act="flag" data-flag="sportDone" aria-pressed="${st.sportDone}"><span><b>Sport gemacht</b><br><span class="note">Nur Dokumentation – bringt allein keine Kalorien.</span></span><span class="sw"></span></button>
      ${d.activities.map((a) => `<div class="minilist"><div><span><b>${esc(a.kindName)}</b>${a.minutes ? " · " + de(a.minutes) + " Min" : ""}${a.intensity ? " · " + esc(a.intensity) : ""}<br><span class="note">${a.kcal ? `${de(a.kcal)} kcal · ${esc(a.kcalSource)}` : "kein Verbrauchswert – nicht angerechnet"}</span></span>
        <button class="btn sm ghost" data-act="delSport" data-id="${a.id}" aria-label="Aktivität entfernen">${ic("trash", 16)}</button></div></div>`).join("")}
      ${d.activities.length && st.sportCreditPct < 100 ? `<div class="note">Angerechnet werden ${st.sportCreditPct} % der Verbrauchswerte (Profileinstellung).</div>` : ""}</section>`;

    extra += `<button class="toggle" data-act="flag" data-flag="complete" aria-pressed="${st.complete}"><span><b>Tag vollständig erfasst</b><br><span class="note">Nur vollständige Tage zählen in Statistik und Zielerreichung.</span></span><span class="sw"></span></button>`;
    const openX = ui.open.has("extras");
    return out + `<section class="slot extras"><button class="toggle" data-act="toggleExtras" aria-expanded="${openX}"><span><b>Extras: Kalorien und Sport</b><br><span class="note">${st.goalKcal != null ? `${de(b.eaten)} kcal gegessen · ` : ""}optional, nicht der Fokus</span></span><span>${openX ? "▴" : "▾"}</span></button></section>${openX ? extra : ""}`;
  }

  function mealRow(m) {
    const statusTxt = { vorgemerkt: "vorgemerkt", geplant: "geplant", gekocht: "gekocht", gegessen: "gegessen" }[m.status];
    const portions = `<div class="stepper" role="group" aria-label="Portionen"><button data-act="portion" data-id="${m.id}" data-d="-0.5" aria-label="weniger">−</button><span>${deA(m.portions)} P.</span><button data-act="portion" data-id="${m.id}" data-d="0.5" aria-label="mehr">+</button></div>`;
    const acts = m.status === "gegessen"
      ? `${portions}<button class="btn sm ghost" data-act="status" data-id="${m.id}" data-s="geplant">Doch nicht gegessen</button>${m.recipeChanged ? `<button class="btn sm" data-act="resnap" data-id="${m.id}">Neue Rezeptwerte übernehmen</button>` : ""}`
      : `${m.recipeId ? `<button class="btn sm" data-act="cookStart" data-id="${m.recipeId}" data-sv="${m.servings > 0 ? m.servings : 4}">Kochen</button>` : ""}<button class="btn sm primary" data-act="status" data-id="${m.id}" data-s="gegessen">${ic("check", 16)} Gegessen</button>${portions}
         `;
    return `<div class="meal ${m.status === "gegessen" ? "eaten" : ""}">
      ${img(m.image, "", m.title)}
      <div><div class="t">${m.recipeExists ? `<button class="link" style="padding:0;text-align:left" data-act="openRecipe" data-id="${m.recipeId}">${esc(m.title)}</button>` : esc(m.title)}</div>
        <div class="m"><span class="status ${m.status}">${statusTxt}</span>${m.recipeId && m.status !== "gegessen" ? `<span class="chip line" style="gap:2px;padding:2px 4px"><button class="link" style="padding:0 8px" data-act="svMeal" data-id="${m.id}" data-d="-1" aria-label="weniger Portionen kochen">−</button>Kochen für ${deA(m.servings > 0 ? m.servings : 4)}<button class="link" style="padding:0 8px" data-act="svMeal" data-id="${m.id}" data-d="1" aria-label="mehr Portionen kochen">+</button></span>` : ""}${m.recipeId && (m.slot === "mittag" || m.slot === "abend") && m.status !== "gegessen" ? `<button class="chip line" data-act="mealSwap" data-id="${m.id}" aria-label="Zwischen Mittag und Abend wechseln">${m.slot === "mittag" ? "→ Abend" : "→ Mittag"}</button>` : ""}${m.quality !== "original" && m.quality !== "berechnet" ? qualityChip(m.quality) : ""}${m.recipeChanged ? `<span class="chip warn">Rezept geändert</span>` : ""}</div></div>
      <div class="k">${kcal(m.total.kcal)}<small>kcal${m.portions !== 1 && m.per.kcal != null ? ` · ${de(m.per.kcal)}/P.` : ""}</small></div>
      <div class="meal-acts">${acts}<button class="btn sm ghost" data-act="mealMenu" data-id="${m.id}" aria-label="Weitere Aktionen">⋯</button></div></div>`;
  }

  // ================================================================== Recipe Radar
  function budgetNow() {
    const d = store.day(ui.pid, ui.date);
    return { remaining: d.budget.remaining, planned: d.budget.planned, total: d.settings.goalKcal != null ? d.settings.goalKcal + d.sport : null };
  }

  function tile(r, opts = {}) {
    const bn = budgetNow();
    const k = r.nut.perPortion.kcal;
    const f = L.fit(k, bn.remaining);
    const meta = [CAT_SHORT[r.category], r.prepMinutes ? `${r.prepMinutes} Min` : null, `${deA(r.servings)} ${r.servings === 1 ? "Portion" : "Portionen"}`].filter(Boolean).join(" · ");
    const feats = [...r.autoTags.map((t) => `<span class="chip hot" title="mind. 20 % der Energie aus Protein">${esc(t)}</span>`), ...r.tags.map((t) => `<span class="chip acc">${esc(t)}</span>`)];
    const effort = { leicht: 1, mittel: 2, aufwendig: 3 }[r.effortShown] || 0;
    const open = ui.open.has("ing:" + r.id);
    const used = bn.total != null && bn.remaining != null ? bn.total - bn.remaining : 0;
    if (opts.compact) {
      const stamps = opts.swipe ? `<div class="stamp keep">${opts.stage === "fav" ? "HEUTE KOCHEN" : "AUSWAHL"}</div><div class="stamp skip">${opts.stage === "fav" ? "HEUTE NICHT" : "RAUS"}</div>${opts.stage === "fav" ? "" : `<div class="stamp up">SUPERLIKE</div>`}` : "";
      return `<article class="card tile compact ${opts.swipe ? "swipe" : ""} ${opts.next ? "next" : ""}" data-rid="${r.id}">${stamps}
        <div class="herowrap">${img(r.image, "hero", r.title)}<button class="favstar" data-act="fav" data-id="${r.id}" aria-pressed="${!!r.favorite}" aria-label="${r.favorite ? "Favorit entfernen" : "Als Favorit speichern"}">${ic("star", 22, !!r.favorite)}</button></div>
        <div><h2>${esc(r.title)}</h2><div class="sub">${esc(meta)}</div></div>
        <div class="chips"><span class="chip">${[1, 2, 3].map((i) => `<i class="dot ${i <= effort ? "on" : ""}"></i>`).join("")} ${esc(r.effortShown || "Aufwand ?")}</span>${feats.slice(0, 3).join("")}${r.favorite ? `<span class="chip fav-on">★ Favorit</span>` : ""}${r.matchWith ? `<span class="chip match">♥ ${esc(r.matchWith)} will das auch</span>` : ""}</div>
        ${r.mainIngredients.length ? `<div class="ings">${r.mainIngredients.map((n) => `<span>${esc(n)}</span>`).join("")}</div>` : ""}
        <button class="link" style="align-self:flex-end" data-act="openRecipe" data-id="${r.id}">Rezept ansehen ›</button>
      </article>`;
    }
    return `<article class="card tile ${opts.swipe ? "swipe" : ""} ${opts.next ? "next" : ""}" data-rid="${r.id}">
      ${opts.swipe ? `<div class="stamp keep">${opts.stage === "fav" ? "HEUTE KOCHEN" : "FAVORIT"}</div><div class="stamp skip">${opts.stage === "fav" ? "HEUTE NICHT" : "NICHT JETZT"}</div>` : ""}
      ${img(r.image, "hero", r.title)}
      <div class="row"><div><h2>${esc(r.title)}</h2><div class="sub">${esc(meta)}</div></div>${ring(kcal(k), f.pct, f.cls, "kcal")}</div>
      <div class="chips"><span class="chip ${f.cls === "hi" || f.cls === "mid" ? "ok" : f.cls === "low" ? "warn" : f.cls === "bad" ? "bad" : ""}">${esc(f.label)}</span>${feats.join("")}${r.favorite ? `<span class="chip fav-on">★ Favorit</span>` : ""}${qualityChip(r.nut.quality)}</div>
      <div class="strip"><span class="eyebrow">je Portion</span>
        <div class="v"><b>${r.nut.perPortion.protein == null ? "–" : de(r.nut.perPortion.protein)}</b><small>Protein g</small></div><span class="sep">›</span>
        <div class="v"><b>${r.nut.perPortion.carbs == null ? "–" : de(r.nut.perPortion.carbs)}</b><small>KH g</small></div><span class="sep">›</span>
        <div class="v"><b>${r.nut.perPortion.fat == null ? "–" : de(r.nut.perPortion.fat)}</b><small>Fett g</small></div></div>
      <div class="pot ${f.after != null && f.after < 0 ? "over" : ""}">
        <div class="eyebrow">Passt ins Tagesbudget · danach frei</div>
        ${bn.remaining == null ? `<div class="sub">Budget: keine Angabe – trage im Profil Größe und Gewicht ein.</div>` : `
        <div class="head"><div class="big">${de(f.after ?? 0)}<small>kcal</small></div>
          <div class="side"><b>${k == null ? "Wert fehlt" : "− " + de(k) + " kcal"}</b><span>von ${de(bn.remaining)} frei</span></div></div>
        ${k != null ? track(bn.total, used, k, { pin: true, pinAdd: true, flag: bn.planned ? Math.min(bn.total, used + bn.planned) : null }) : ""}
        <div class="legend"><span>0</span><span>${PIN.replace('class="mark"', 'style="width:12px;height:14px;color:var(--text)"')} Gericht</span>${bn.planned ? `<span>${FLAG.replace('class="mark flag"', 'style="width:12px;height:14px;color:var(--accent-2)"')} schon geplant</span>` : ""}<span>Budget ${de(bn.total)}</span></div>`}
      </div>
      <div class="kv"><div><span class="eyebrow">Aufwand</span><b>${r.prepMinutes ? `≈ ${r.prepMinutes} Min` : "–"}</b><small>${esc(r.effortShown || "keine Angabe")}${r.effortDerived && r.effortShown ? " (aus der Zeit)" : ""}</small></div>
        <div><span class="eyebrow">Ganzes Rezept</span><b>${k == null ? "–" : de(k * r.servings) + " kcal"}</b><small>${deA(r.servings)} ${r.servings === 1 ? "Portion" : "Portionen"}</small></div></div>
      ${r.mainIngredients.length ? `<div class="ings">${r.mainIngredients.map((n) => `<span>${esc(n)}</span>`).join("")}</div>` : ""}
      ${open ? ingredientList(r, opts.fac) : ""}
      ${r.why && r.why.length ? `<div class="why">Warum jetzt: ${esc(r.why.join(" · "))}</div>` : ""}
      <div class="foot"><span class="dots" title="Aufwand">${[1, 2, 3].map((i) => `<i class="${i <= effort ? "on" : ""}"></i>`).join("")}</span>
        <button class="link" data-act="toggleIng" data-id="${r.id}" aria-expanded="${open}">Zutaten ${open ? "▴" : "▾"}</button>
        <button class="link" data-act="openRecipe" data-id="${r.id}">Details ›</button></div>
    </article>`;
  }

  function ingredientList(r, fac) {
    fac = fac || 4 / (r.servings || 1);
    return `<div class="note">Mengen für ${deA(Math.round(fac * (r.servings || 1) * 100) / 100)} Portionen</div><div class="scroll"><table class="tbl"><tbody>${r.nut.rows.map((i) => `<tr><td class="r">${(() => { const x = L.scaleAmount(i.amount, i.unit, fac); return x.amount == null ? "" : deA(x.amount) + " " + esc(x.unit || ""); })()}</td><td>${esc(i.name)}${!i.ok ? ` <span class="chip warn" title="${esc(i.note)}">ohne Wert</span>` : ""}</td><td class="r muted">${i.ok && i.kcal != null ? de(i.kcal * fac) + " kcal" : ""}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function vRadar() {
    const f = ui.radar, fav = f.stage === "fav";
    if (!f.meal) return `<div class="chooser"><div class="guck" aria-hidden="true">N' Guck Guck 👀</div><h2>Was suchst du?</h2><div class="note">Frühstück und Mittag/Abend bleiben getrennt.</div>
      <button class="btn primary big" data-act="pickMeal" data-v="main">Mittag / Abendessen</button>
      <button class="btn big" data-act="pickMeal" data-v="fruehstueck">Frühstück</button></div>`;
    let stack = store.radarStack(ui.pid, ui.date, f);
    if (ui.later.length) { const ix = (id) => ui.later.indexOf(id); stack = [...stack.filter((r) => ix(r.id) < 0), ...stack.filter((r) => ix(r.id) >= 0).sort((a, b) => ix(a.id) - ix(b.id))]; }
    const total = Object.keys(store.S.recipes).length;
    const nFav = store.radarFavCount(ui.pid, ui.date, f);
    let out = `<div class="seg2">${fav ? `<button class="btn" data-act="stage" data-v="alle">${ic("left", 16)} Sammeln</button>` : ""}<button class="btn" data-act="resetDeck">${ic("undo", 16)} Neu starten</button></div>`;
    const right = fav ? "keep" : "fav";
    if (!total) {
      out += `<div class="empty"><b>Noch keine Rezepte in der Bibliothek</b><span>Füge oben über „+ Link“ ein Rezept hinzu oder lege eins an. Danach kannst du hier Gerichte durchwischen.</span></div>`;
    } else if (!stack.length) {
      out += fav
        ? `<div class="empty"><b>Nichts mehr in der Auswahl</b><span>${nFav ? "" : "Wische Gerichte nach rechts oder hoch, dann erscheinen sie hier. "}Für ${esc(relDay(ui.date).toLowerCase())} ist hier nichts mehr offen${f.slot || f.maxMinutes ? " (mit diesem Filter)" : ""}.</span><button class="btn primary" data-act="resetDeck">Alles neu starten</button><button class="btn" data-act="stage" data-v="alle">Sammeln</button></div>`
        : `<div class="empty"><b>Keine offenen Karten</b><span>Alle passenden Rezepte sind durchgesehen${f.slot || f.maxMinutes ? " (mit diesem Filter)" : ""}. ${nFav ? "Weiter mit deiner Auswahl." : ""}</span>
          <button class="btn primary" data-act="resetDeck">Alles neu starten</button><button class="btn" data-act="draw">Weitere Gerichte laden</button>${nFav ? `<button class="btn" data-act="stage" data-v="fav">Weiter zur Auswahl</button>` : ""}</div>`;
    } else {
      out += `<div class="deck">${stack[1] ? tile(stack[1], { next: true, compact: true }) : ""}${tile(stack[0], { swipe: true, compact: true, stage: fav ? "fav" : "alle" })}</div>
        <div class="actions">
          <button class="abtn ghost" data-act="undoDecision" aria-label="Letzte Entscheidung rückgängig" ${ui.lastDecision ? "" : "disabled"}>${ic("undo", 22)}<span>Zurück</span></button>
          ${fav ? `<button class="abtn skip" data-act="decide" data-a="skip" data-id="${stack[0].id}">${ic("x", 22)}<span>Nein</span></button>
          <button class="abtn" data-act="decide" data-a="later" data-id="${stack[0].id}">${ic("next", 22)}<span>Später</span></button>
          <button class="abtn keep" data-act="decide" data-a="keep" data-id="${stack[0].id}">${ic("check", 22)}<span>Kochen</span></button>`
          : `<button class="abtn super" data-act="superlike" data-id="${stack[0].id}" aria-pressed="${!!stack[0].favorite}">${ic("star", 22, true)}<span>Superlike</span></button>
          <button class="abtn keep" data-act="stage" data-v="fav">${ic("next", 22)}<span>Weiter${nFav ? " (" + nFav + ")" : ""}</span></button>`}
        </div><div class="note hintline">${fav ? (stack.length <= nFav ? `Karte ${nFav - stack.length + 1} von ${nFav}` : `noch ${stack.length} Karte${stack.length === 1 ? "" : "n"}`) : (LS.get("hintSeen", false) ? "" : `<b class="hint">← Raus · Auswahl → · ↑ Superlike</b>`)}</div>`;
    }
    return out;
  }

  // Wischgesten auf der obersten Karte
  function bindSwipe() {
    const card = $(".swipe");
    if (!card) return;
    let x0 = null, y0 = null, dx = 0, dy = 0, mode = null, id = null, raf = 0, vx = 0, vy = 0, lx = 0, ly = 0, lt = 0;
    const keep = $(".stamp.keep", card), skip = $(".stamp.skip", card), up = $(".stamp.up", card);
    const stage2 = ui.radar.stage === "fav";
    const clear = () => { card.style.transform = ""; keep.style.opacity = 0; skip.style.opacity = 0; if (up) up.style.opacity = 0; };
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, a, input")) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0; mode = null; id = e.pointerId; lx = x0; ly = y0; lt = performance.now(); vx = 0; vy = 0;
    });
    card.addEventListener("pointermove", (e) => {
      if (x0 == null || e.pointerId !== id) return;
      const ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (!mode) {
        if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy)) mode = "x";
        else if (!stage2 && ddy < -12 && Math.abs(ddy) > Math.abs(ddx)) mode = "y";
        else return;
        card.setPointerCapture(id);
      }
      dx = ddx; dy = ddy;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        if (mode === "x") { card.style.transform = `translate3d(${dx}px,0,0) rotate(${dx / 24}deg)`; keep.style.opacity = Math.max(0, Math.min(1, dx / 90)); skip.style.opacity = Math.max(0, Math.min(1, -dx / 90)); }
        else { card.style.transform = `translate3d(0,${Math.min(0, dy)}px,0)`; if (up) up.style.opacity = Math.max(0, Math.min(1, -dy / 90)); }
      });
      const now = performance.now(), dt = Math.max(1, now - lt); vx = (e.clientX - lx) / dt; vy = (e.clientY - ly) / dt; lx = e.clientX; ly = e.clientY; lt = now;
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      if (!mode) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      card.classList.add("anim");
      if (mode === "y") {
        const lim = Math.min(130, card.offsetHeight * 0.25);
        if (-dy > lim || (vy < -1.0 && -dy > 60)) {
          clear(); ACT.superlike({ dataset: { id: card.dataset.rid } });
        } else clear();
        return;
      }
      const limit = Math.min(150, card.offsetWidth * 0.34);
      if (Math.abs(vx) > 1.2 && Math.abs(dx) > 70) dx = (vx > 0 ? 1 : -1) * (limit + 1);
      if (dx > limit && stage2 && ui.radar.meal === "main") { // Stufe 2, rechts: bei Mittag/Abend erst fragen, zu welcher Mahlzeit
        clear(); ACT.askSlot(card.dataset.rid); return;
      }
      if (Math.abs(dx) > limit) {
        card.style.transform = `translate3d(${dx > 0 ? 130 : -130}%,0,0) rotate(${dx > 0 ? 16 : -16}deg)`; card.style.opacity = "0";
        const act = dx > 0 ? (stage2 ? "keep" : "fav") : "skip";
        setTimeout(() => { ui.lastHtml = null; decide(card.dataset.rid, act); }, 180);
      } else clear();
    };
    card.addEventListener("pointerup", end); card.addEventListener("pointercancel", end);
  }

  async function decide(rid, action, servings, slot) {
    try { LS.set("hintSeen", true); } catch (e) { /* ohne Speicher weiter */ }
    if (action === "fav") toast("In der Auswahl"); if (action === "super") toast("★ Superlike – als Favorit gespeichert");
    await run("decide:" + rid, async () => {
      const r = store.S.recipes[rid];
      const copy = action === "del" && r ? JSON.parse(JSON.stringify(r)) : null;
      await store.radarDecide(ui.pid, ui.date, rid, action, servings, slot);
      ui.lastDecision = copy ? { rid, date: ui.date, pid: ui.pid, deleted: copy } : { rid, date: ui.date, pid: ui.pid };
      if (action !== "undo" && ui.radar.stage !== "fav" && !store.radarStack(ui.pid, ui.date, ui.radar).length) await store.radarDraw(ui.pid, ui.date, ui.radar);
    });
  }

  // ================================================================== Rezeptbibliothek
  function vRezepte() {
    const l = ui.lib;
    let rs = store.recipes(ui.pid);
    const allTags = [...new Set(rs.flatMap((r) => [...r.tags, ...r.autoTags]))].sort();
    if (l.q) { const q = L.norm(l.q); rs = rs.filter((r) => L.norm(r.title + " " + r.ingredients.map((i) => i.name).join(" ")).includes(q)); }
    if (l.cat) rs = rs.filter((r) => r.category === l.cat);
    if (l.fav) rs = rs.filter((r) => r.favorite);
    if (l.max) rs = rs.filter((r) => r.prepMinutes != null && r.prepMinutes <= l.max);
    if (l.tag) rs = rs.filter((r) => r.tags.includes(l.tag) || r.autoTags.includes(l.tag));
    const kv = (r) => r.nut.perPortion.kcal ?? Infinity;
    if (l.sort === "kcal") rs = [...rs].sort((a, b) => kv(a) - kv(b));
    if (l.sort === "kcal-") rs = [...rs].sort((a, b) => (b.nut.perPortion.kcal ?? -1) - (a.nut.perPortion.kcal ?? -1));
    if (l.sort === "zeit") rs = [...rs].sort((a, b) => (a.prepMinutes ?? 999) - (b.prepMinutes ?? 999));
    const chip = (k, v, t) => `<button class="chip line" data-act="lfilter" data-k="${k}" data-v="${v ?? ""}" aria-pressed="${l[k] === v || (k === "fav" && l.fav && v === true)}">${esc(t)}</button>`;
    return `<div class="row" style="align-items:center"><h2>Rezepte</h2><div class="btns"><button class="btn sm" data-act="newRecipe">${ic("plus", 16)} Neu</button><button class="btn sm primary" data-act="importStart">${ic("cam", 16)} Screenshot</button></div></div>
      <div class="search"><input id="lib-q" type="search" placeholder="Gericht oder Zutat suchen" value="${esc(l.q)}" data-input="libq" aria-label="Suchen">
        <select id="lib-sort" data-change="libsort" aria-label="Sortierung" style="width:auto">${[["name", "A–Z"], ["kcal", "kcal ↑"], ["kcal-", "kcal ↓"], ["zeit", "Zeit ↑"]].map(([k, t]) => `<option value="${k}" ${l.sort === k ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="filters">${chip("fav", true, "★ Favoriten")}${X.CATS.map(([k]) => chip("cat", k, CAT_SHORT[k])).join("")}${chip("max", 20, "≤ 20 Min")}${chip("max", 40, "≤ 40 Min")}${allTags.map((t) => chip("tag", t, t)).join("")}</div>
      <div class="note">${rs.length} von ${Object.keys(store.S.recipes).length} Rezepten</div>
      ${rs.length ? [["fruehstueck", "Frühstück"], ["main", "Mittag / Abend"]].map(([ck, ct]) => { const g = rs.filter((r) => X.normCat(r.category) === ck).sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)); return g.length ? `<h3 class="cat-h">${ct} <span class="cat-n">${g.length}</span></h3><div class="grid">${g.map((r) => `<button class="rcard ${r.favorite ? "isfav" : ""}" data-act="openRecipe" data-id="${r.id}"><span class="thumbwrap">${img(r.image, "", r.title)}${r.favorite ? `<span class="favmark" aria-label="Favorit">${ic("star", 18, true)}</span>` : ""}</span><div class="body">
        <div class="t">${r.favorite ? '<span class="star">★</span> ' : ""}${esc(r.title)}</div>
        <div class="m"><span><span class="chip hot">${esc(CAT_SHORT[X.normCat(r.category)])}</span>${r.prepMinutes ? " · " + r.prepMinutes + " Min" : ""}</span><b>${kcal(r.nut.perPortion.kcal)} kcal</b></div>
        <div class="chips">${qualityChip(r.nut.quality)}${r.autoTags.map((t) => `<span class="chip hot">${esc(t)}</span>`).join("")}</div></div></button>`).join("")}</div>` : ""; }).join("")
        : `<div class="empty"><b>Keine Treffer</b><span>Ändere Suche oder Filter – oder lege ein neues Rezept an.</span></div>`}`;
  }

  function sheetRecipe(id) {
    const r = store.recipe(id, ui.pid);
    if (!r) return `<div class="empty"><b>Rezept nicht gefunden</b></div>`;
    const n = r.nut;
    const steps = r.instructions.split("\n").filter((s) => s.trim());
    const confirm = ui.sheet.confirm;
    const sv = ui.sheet.sv || 4, fac = sv / (r.servings || 1);
    return `${tile(r, { fac })}
      <div class="btns"><button class="btn primary" data-act="cookStart" data-id="${r.id}" data-sv="${sv}">Kochen starten · Bildschirm bleibt an</button>
        <button class="btn" data-act="decide" data-a="keep" data-id="${r.id}" data-sv="${sv}">Für ${esc(relDay(ui.date).toLowerCase())} merken · Zutaten auf die Liste</button>
        <button class="btn" data-act="planSheet" data-id="${r.id}">Einplanen …</button>
        <button class="btn" data-act="fav" data-id="${r.id}">${r.favorite ? "★ Favorit entfernen" : "☆ Favorit"}</button>
        <button class="btn" data-act="editRecipe" data-id="${r.id}">Bearbeiten</button>
        <button class="btn danger" data-act="askDelete" data-id="${r.id}">Löschen</button></div>
      ${confirm ? `<div class="notice">„${esc(r.title)}“ endgültig löschen? Gegessene Mahlzeiten behalten ihre Werte.<div class="btns" style="margin-top:8px"><button class="btn danger" data-act="deleteRecipe" data-id="${r.id}">Endgültig löschen</button><button class="btn" data-act="askDelete" data-id="">Abbrechen</button></div></div>` : ""}
      <h3>Zutaten</h3>
      <div class="stepper" role="group" aria-label="Portionen für die Zutaten" style="align-self:flex-start"><button data-act="svStep" data-d="-1" aria-label="weniger Portionen">−</button><span>für ${deA(sv)} Portionen</span><button data-act="svStep" data-d="1" aria-label="mehr Portionen">+</button></div>
      <div class="scroll"><table class="tbl"><thead><tr><th class="r">Menge</th><th>Zutat</th><th>Referenz</th><th class="r">kcal</th></tr></thead><tbody>
        ${n.rows.map((i) => `<tr><td class="r">${(() => { const x = L.scaleAmount(i.amount, i.unit, fac); return x.amount == null ? "" : deA(x.amount) + " " + esc(x.unit || ""); })()}</td><td>${esc(i.name)}</td><td class="muted" title="${esc(i.foodSource || "")}">${i.foodName ? esc(i.foodName) : i.ok ? "vernachlässigbar" : '<span class="neg">fehlt</span>'}${i.ok && i.grams != null ? ` · ${de(i.grams)} g` : ""}${!i.ok ? ` · ${esc(i.note)}` : ""}</td><td class="r">${i.ok && i.kcal != null ? de(i.kcal * fac) : "–"}</td></tr>`).join("")}
      </tbody></table></div>
      <h3>Zubereitung</h3>${steps.length ? `<ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px">${steps.map((s) => `<li>${emph(s)}</li>`).join("")}</ol>` : `<div class="note">Keine Schritte hinterlegt.</div>`}
      <h3>Nährwerte je Portion</h3>
      <div class="scroll"><table class="tbl"><thead><tr><th></th><th class="r">kcal</th><th class="r">Protein</th><th class="r">KH</th><th class="r">Fett</th></tr></thead><tbody>
        ${n.original ? `<tr><td>Originalangabe${r.nutrition.basis === "gesamt" ? " (gesamt ÷ Portionen)" : ""}${r.nutrition.quality === "geschaetzt" ? " – geschätzt" : ""}</td>${["kcal", "protein", "carbs", "fat"].map((k) => `<td class="r">${n.original[k] == null ? "–" : de(n.original[k], k === "kcal" ? 0 : 1)}</td>`).join("")}</tr>` : ""}
        ${n.computed ? `<tr><td>Aus Zutaten${n.missing.length ? " (unvollständig)" : ""}</td>${["kcal", "protein", "carbs", "fat"].map((k) => `<td class="r">${n.computed[k] == null ? "–" : de(n.computed[k], k === "kcal" ? 0 : 1)}</td>`).join("")}</tr>` : ""}
      </tbody></table></div>
      <div class="note">Verwendet: ${esc(L.QUALITY_LABEL[n.quality])}.${n.deviationPct != null ? ` Abweichung Berechnung zu Original: ${n.deviationPct > 0 ? "+" : ""}${n.deviationPct} %.` : ""}${n.missing.length ? ` Ohne Wert: ${esc(n.missing.join(", "))}.` : ""}</div>
      ${r.source ? `<div class="note">Quelle: ${/^https?:\/\//.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source)}</div>` : ""}
      <div class="note">Version ${r.version || 1}${r.importId ? " · aus Screenshot importiert, Original aufbewahrt" : ""}</div>`;
  }

  // ================================================================== Rezept-Editor und Import
  function emptyRecipe() {
    return { title: "", category: "", prepMinutes: "", servings: 2, effort: "", tags: "", source: "", instructions: "",
      ingredients: [{ name: "", amount: "", unit: "g", foodId: "auto" }], nutrition: { kcal: "", protein: "", carbs: "", fat: "", basis: "portion", quality: "original" } };
  }
  function fromParsed(p) {
    return { title: p.title || "", category: p.category ? X.normCat(p.category) : "", prepMinutes: p.prepMinutes ?? "", servings: p.servings ?? "", effort: "", tags: p.tags || "",
      source: p.source || "", instructions: p.instructions || "",
      ingredients: p.ingredients.map((i) => ({ name: i.name, amount: i.amount ?? "", unit: i.unit || "", foodId: "auto", raw: i.raw, unsure: i.unsure })),
      nutrition: { kcal: p.nutrition.kcal ?? "", protein: p.nutrition.protein ?? "", carbs: p.nutrition.carbs ?? "", fat: p.nutrition.fat ?? "", basis: p.nutrition.basis || "portion", quality: "original" } };
  }

  function sheetEditor() {
    const ed = ui.sheet.ed, r = ed.data;
    const foods = store.foodList();
    const unsure = new Set(ed.missing || []);
    const flag = (cond) => (cond ? "unsure" : "");
    const fo = (sel) => `<option value="auto" ${sel === "auto" ? "selected" : ""}>automatisch zuordnen</option><option value="none" ${sel === "none" ? "selected" : ""}>ohne Referenz</option>${foods.map((f) => `<option value="${f.id}" ${sel === f.id ? "selected" : ""}>${esc(f.name)} (${de(f.kcal)} kcal/100 g)</option>`).join("")}`;
    const auto = (name) => { const id = L.matchFood(name, foods); const f = foods.find((x) => x.id === id); return f ? `→ ${f.name}` : name ? "→ keine Referenz gefunden" : ""; };
    return `${ed.importInfo ? `<div class="notice acc">${esc(ed.importInfo)}</div>` : ""}
      ${(ed.unsure || []).length || (ed.missing || []).length ? `<div class="notice">${ed.missing.length ? `Nicht im Screenshot gefunden: ${esc(ed.missing.join(", "))}. ` : ""}${ed.unsure.length ? `Bitte prüfen: ${esc(ed.unsure.join(" · "))}` : ""}</div>` : ""}
      ${ed.dupes && ed.dupes.length ? `<div class="notice">Mögliches Duplikat: ${ed.dupes.map((d) => `„${esc(d.title)}“ (${d.score} %)`).join(", ")}. Nochmal „Speichern“ legt trotzdem ein neues Rezept an.</div>` : ""}
      ${ed.image ? `<div class="crop"><canvas id="crop-canvas" width="600" height="400"></canvas></div>
        <div class="eyebrow">Bildausschnitt</div><div class="fgrid">${[["l", "Links"], ["r", "Rechts"], ["t", "Oben"], ["b", "Unten"]].map(([k, t]) => `<label class="f">${t} (${Math.round(ed.box[k])} %)<input id="crop-${k}" type="range" min="0" max="100" step="1" value="${ed.box[k]}" data-input="crop" data-k="${k}"></label>`).join("")}</div>
        <div class="note">Das Rezeptbild wird aus diesem Ausschnitt gespeichert; der Original-Screenshot bleibt zusätzlich erhalten.</div>` : ""}
      <label class="f">Rezeptbild ${ed.image ? "ersetzen" : "hinzufügen"}<input id="ed-image" type="file" accept="image/*" data-change="edImage"></label>
      <label class="f">Name<input id="ed-title" class="${flag(unsure.has("Titel"))}" value="${esc(r.title)}" data-bind="title" required></label>
      <div class="fgrid three">
        <label class="f">Kategorie (Pflicht)<select id="ed-cat" data-bind="category"><option value="" ${r.category ? "" : "selected"}>Bitte wählen …</option>${X.CATS.map(([k]) => `<option value="${k}" ${r.category && X.normCat(r.category) === k ? "selected" : ""}>${CAT_SHORT[k]}</option>`).join("")}</select></label>
        <label class="f">Portionen<input id="ed-serv" class="${flag(unsure.has("Portionszahl"))}" type="number" inputmode="decimal" min="0.5" step="0.5" value="${esc(r.servings)}" data-bind="servings"></label>
        <label class="f">Minuten<input id="ed-min" class="${flag(unsure.has("Zubereitungszeit"))}" type="number" inputmode="numeric" min="0" value="${esc(r.prepMinutes)}" data-bind="prepMinutes"></label>
        <label class="f">Aufwand<select id="ed-eff" data-bind="effort"><option value="">auto</option>${["leicht", "mittel", "aufwendig"].map((x) => `<option ${r.effort === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
        <label class="f full">Merkmale (Komma)<input id="ed-tags" value="${esc(r.tags)}" placeholder="vegetarisch, schnell" data-bind="tags"></label>
      </div>
      <h3>Zutaten</h3>
      <div class="note">Menge · Einheit (g, ml, EL, TL, Stück …) · Zutat. Die Referenz liefert die Nährwerte je 100 g.</div>
      <div class="${flag(unsure.has("Zutaten"))}" style="display:flex;flex-direction:column;gap:8px;border-radius:12px">
      ${r.ingredients.map((i, n) => `<div class="ingrow">
        <input id="ing-a-${n}" class="${flag(i.amount === "" && (i.unsure || []).length)}" inputmode="decimal" placeholder="Menge" value="${esc(i.amount)}" data-ing="${n}" data-k="amount" aria-label="Menge">
        <input id="ing-u-${n}" placeholder="Einh." value="${esc(i.unit || "")}" data-ing="${n}" data-k="unit" aria-label="Einheit">
        <input id="ing-n-${n}" class="${flag((i.unsure || []).some((u) => !u.includes("keine Menge")))}" placeholder="Zutat" value="${esc(i.name)}" data-ing="${n}" data-k="name" aria-label="Zutat" title="${esc(i.raw || "")}">
        <button class="btn sm ghost" data-act="ingDel" data-n="${n}" aria-label="Zutat entfernen">${ic("x", 16)}</button>
        <select id="ing-f-${n}" data-ing="${n}" data-k="foodId" aria-label="Lebensmittel-Referenz">${fo(i.foodId || "auto")}</select>
        <span class="note" style="grid-column:-2/-1"></span>
        ${i.foodId === "auto" || !i.foodId ? `<span class="note" style="grid-column:1/-1">${esc(auto(i.name))}</span>` : ""}</div>`).join("")}
      </div><button class="btn sm" data-act="ingAdd">${ic("plus", 16)} Zutat</button>
      <label class="f">Zubereitung (ein Schritt pro Zeile)<textarea id="ed-steps" class="${flag(unsure.has("Zubereitungsschritte"))}" data-bind="instructions">${esc(r.instructions)}</textarea></label>
      <h3>Nährwerte laut Rezept</h3>
      <div class="note">Nur eintragen, was im Rezept steht – sonst leer lassen, dann rechnet Foody aus den Zutaten.</div>
      <div class="fgrid">${[["kcal", "kcal"], ["protein", "Protein g"], ["carbs", "Kohlenhydrate g"], ["fat", "Fett g"]].map(([k, t]) => `<label class="f">${t}<input id="ed-n-${k}" class="${flag(unsure.has("Nährwerte") && k === "kcal")}" type="number" inputmode="decimal" min="0" step="0.1" value="${esc(r.nutrition[k])}" data-nut="${k}"></label>`).join("")}
        <label class="f">Bezug<select id="ed-basis" data-nut="basis"><option value="portion" ${r.nutrition.basis === "portion" ? "selected" : ""}>je Portion</option><option value="gesamt" ${r.nutrition.basis === "gesamt" ? "selected" : ""}>ganzes Rezept</option></select></label>
        <label class="f">Art<select id="ed-q" data-nut="quality"><option value="original" ${r.nutrition.quality !== "geschaetzt" ? "selected" : ""}>Originalwert</option><option value="geschaetzt" ${r.nutrition.quality === "geschaetzt" ? "selected" : ""}>eigene Schätzung</option></select></label></div>
      <label class="f">Quelle<input id="ed-src" value="${esc(r.source)}" placeholder="Link, Buch oder Account" data-bind="source"></label>
      ${ed.raw ? `<details><summary class="link acc">Erkannter Originaltext</summary><div class="formula" style="white-space:pre-wrap">${esc(ed.raw)}</div></details>` : ""}
      <div class="btns"><button class="btn primary" data-act="saveRecipe">${ed.saving ? "Speichert …" : "Speichern"}</button><button class="btn" data-act="closeSheet">Abbrechen</button></div>`;
  }

  function sheetImport() {
    const im = ui.sheet.im;
    const canAI = !!(caps.sampleImages);
    return `<label class="f">Rezept-Link<input id="imp-url" type="url" inputmode="url" placeholder="https://…" value="${esc(im.url || "")}" data-input="impUrl"></label>
      <div class="note">Kategorie wählen (Pflicht):</div>
      <div class="filters">${X.CATS.map(([k]) => `<button class="chip line" data-act="impCat" data-v="${k}" aria-pressed="${im.cat === k}">${CAT_SHORT[k]}</button>`).join("")}</div>
      <button class="btn primary" data-act="impLink" ${im.cat ? "" : "disabled"}>Link vormerken</button>
      <div class="note">Die App darf keine Webseiten laden. Der Link wird vorgemerkt – schreib dann im Chat mit Claude „Links importieren“, danach liegt das Rezept hier bereit.</div>
      ${linkListHtml()}
      <div class="eyebrow" style="margin-top:14px">Oder Screenshot</div>
      <div class="note">${canAI ? "Claude liest Zutaten, Mengen, Schritte und Nährwerte aus – nur was wirklich im Bild steht." : "In dieser Ansicht kann Claude keine Bilder lesen – nutze den Text darunter."}</div>
      <label class="f">Screenshot<input id="imp-file" type="file" accept="image/*" data-change="impFile"></label>
      ${im.preview ? `<img src="${im.preview}" alt="Gewählter Screenshot" style="max-height:260px;object-fit:contain;border-radius:12px;background:var(--surface-2)">` : ""}
      ${canAI ? `<button class="btn primary" data-act="impAI" ${im.file && !im.busy ? "" : "disabled"}>${im.busy ? "Claude liest den Screenshot …" : "Mit Claude auslesen"}</button>` : ""}
      ${im.error ? `<div class="notice">${esc(im.error)}</div>` : ""}
      <details ${canAI ? "" : "open"}><summary class="link acc">Text einfügen (ohne Bild-KI)</summary>
        <div class="note" style="margin:8px 0">iPhone: Text lange drücken → „Alles auswählen“ → „Kopieren“, dann hier einfügen. Funktioniert auch mit Rezepttext aus Webseiten oder JSON.</div>
        <textarea id="imp-text" placeholder="Rezepttext hier einfügen" data-input="impText">${esc(im.text || "")}</textarea>
        <button class="btn" data-act="impText" style="margin-top:8px">Text auswerten</button></details>
      <button class="btn ghost" data-act="impManual">Ohne Import manuell anlegen</button>`;
  }

  function linkListHtml() {
    const L2 = store.linkImports();
    if (!L2.length) return "";
    const lab = { offen: "wartet auf Claude", fertig: "bereit zur Prüfung", fehler: "nicht lesbar", uebernommen: "übernommen" };
    return `<div class="list">${L2.slice(0, 8).map((l) => `<div class="row" style="gap:8px;align-items:center;margin-top:8px">
      <div style="flex:1;min-width:0"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.title || l.url)}</div>
      <div class="note">${l.category ? esc(CAT_SHORT[l.category] || "") + " · " : ""}${esc(lab[l.status] || l.status)}${l.status === "fehler" && l.error ? ": " + esc(l.error) : ""}</div></div>
      ${l.status === "fertig" ? `<button class="btn primary" data-act="impLinkUse" data-id="${esc(l.id)}">Prüfen</button>` : ""}
      <button class="btn ghost" data-act="impLinkDel" data-id="${esc(l.id)}" aria-label="Entfernen">✕</button></div>`).join("")}</div>`;
  }

  // Versuch, die Seite direkt in der App zu lesen (Lesedienst + Claude). Klappt nur, wenn die Ansicht Netzzugriff erlaubt.
  async function readLinkNow(url, id) {
    if (!caps.sample) return false;
    let text = "";
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch("https://r.jina.ai/" + url, { signal: ctl.signal, headers: { Accept: "text/plain" } });
      clearTimeout(t);
      if (!res.ok) return false;
      text = (await res.text()).slice(0, 24000);
    } catch (e) { return false; }
    if (text.length < 200) return false;
    try {
      const out = await caps.sample.json(AI_PROMPT.replace("den Screenshot eines Kochrezepts", "den Text einer Rezeptseite").replace(/"photo_box":[^\n]*?\|null,/, "") + "\n\nSeitentext:\n" + text);
      if (!out || typeof out !== "object" || !(out.ingredients && out.ingredients.length)) return false;
      await store.setImportRecipe(id, out);
      const parsed = L.parseRecipeJson(out); if (!parsed.source) parsed.source = url;
      ui.linkImportId = id;
      toEditor(parsed, JSON.stringify(out, null, 1), "Aus dem Link gelesen. Orange markierte Felder bitte prüfen.", "claude-link");
      return true;
    } catch (e) { return false; }
  }

  const AI_PROMPT = `Du liest den Screenshot eines Kochrezepts. Antworte nur mit einem JSON-Objekt in diesem Format:
{"title": string|null, "servings": number|null, "prep_minutes": number|null, "category": "fruehstueck"|"mittag"|"abend"|"snack"|null,
 "tags": [string], "ingredients": [{"raw": string, "name": string, "amount": number|null, "unit": string|null}],
 "steps": [string], "nutrition": {"kcal": number|null, "protein": number|null, "carbs": number|null, "fat": number|null, "basis": "portion"|"gesamt"|null},
 "source": string|null, "photo_box": {"l": number, "t": number, "r": number, "b": number}|null, "unsure": [string]}
Regeln:
- Übernimm nur, was im Bild steht. Erfinde keine Mengen, Schritte, Zeiten oder Nährwerte. Fehlt etwas, setze null bzw. eine leere Liste.
- "raw" ist die Zutatenzeile genau wie im Bild. Einheiten wie im Bild (g, kg, ml, l, EL, TL, Stück, Prise, Dose, Bund …). Brüche als Dezimalzahl.
- nutrition.basis: "portion" nur wenn das Bild Werte pro Portion/Person/Stück nennt, "gesamt" bei Werten fürs ganze Rezept; sonst null. Werte pro 100 g nicht übernehmen, sondern in "unsure" erwähnen.
- photo_box: Bereich des Speisefotos im Screenshot in Prozent der Bildbreite/-höhe (links, oben, rechts, unten), null wenn kein Foto zu sehen ist.
- "unsure": kurze deutsche Hinweise zu allem, was schlecht lesbar oder mehrdeutig ist.
- Schreibe Titel, Zutaten und Schritte auf Deutsch, wie im Bild.`;

  // ================================================================== Einkaufsliste
  function vEinkauf() {
    const ps = store.profiles();
    const s = store.shopping(shopDate(), ui.scope === "alle" || ps.some((p) => p.id === ui.scope) ? ui.scope : "alle");
    const scopes = [...ps.map((p) => [p.id, p.name]), ["alle", "Beide"]];
    const open = s.items.filter((i) => !i.checked && !i.have), done = s.items.filter((i) => i.checked || i.have);
    const showDone = !!ui.showDone;
    const row = (i) => `<label class="${i.checked || i.have ? "done" : ""}"><input type="checkbox" data-change="shopCheck" data-key="${esc(i.key)}" ${i.checked ? "checked" : ""} aria-label="${esc(i.name)} gekauft">
      <span><span class="n">${esc(i.name)}</span>${[i.extra ? "zusätzlich ohne Mengenangabe" : "", i.have ? "schon vorhanden" : "", i.override != null ? "Menge angepasst" : ""].filter(Boolean).map((t) => `<span class="s">${t}</span>`).join("")}</span>
      <span style="display:flex;gap:6px;align-items:center"><button class="btn sm ghost a" data-act="shopAmount" data-key="${esc(i.key)}">${i.shown == null ? "nach Bedarf" : `${deA(i.shown)} ${esc(i.unit || "")}`}</button>
        ${i.auto ? "" : `<button class="btn sm ghost" data-act="shopDel" data-id="${esc(i.id)}" aria-label="Entfernen">${ic("trash", 15)}</button>`}</span></label>`;
    return `<div class="toprow"><span class="note">${s.mealCount} Gericht${s.mealCount === 1 ? "" : "e"} · ${open.length} offen</span><button class="btn sm" data-act="shopResetAll">${ic("undo", 16)} Alles zurücksetzen</button></div><div class="filters">${[["tag", "Heute"], ["woche", "Diese Woche"]].map(([k, t]) => `<button class="chip line" data-act="span" data-v="${k}" aria-pressed="${(ui.shopSpan === "woche") === (k === "woche")}">${t}</button>`).join("")}</div><div class="filters">${scopes.map(([k, t]) => `<button class="chip line" data-act="scope" data-v="${k}" aria-pressed="${s.scope === k}">${esc(t)}</button>`).join("")}</div>
      <section class="card"><div class="row"><div><h2>Einkaufsliste</h2><div class="sub">${s.mealCount} Gericht${s.mealCount === 1 ? "" : "e"} · ${open.length} offen</div></div>${ring(String(done.length), s.items.length ? (done.length / s.items.length) * 100 : 0, "hi", "erledigt")}</div>
      ${s.meals.length ? `<div class="minilist">${s.meals.map((m) => `<div><span><b>${esc(m.title)}</b>${ps.length > 1 && s.scope === "alle" ? ` <span class="note">(${esc(m.who)})</span>` : ""}<br><span class="note">${s.week ? esc(fmtDate(m.date)) + " · " : ""}${esc(SLOT_LABEL[m.slot] || "")} · Rezept ist für ${deA(m.recipeServings)}</span></span>
        <span class="chip line" style="gap:2px;padding:2px 4px"><button class="link" style="padding:0 10px" data-act="svMeal" data-pid="${m.pid}" data-date="${m.date}" data-id="${m.id}" data-d="-1" aria-label="weniger Portionen kochen">−</button>für ${deA(m.servings)} Pers.<button class="link" style="padding:0 10px" data-act="svMeal" data-pid="${m.pid}" data-date="${m.date}" data-id="${m.id}" data-d="1" aria-label="mehr Portionen kochen">+</button></span></div>`).join("")}</div>` : ""}
      ${s.items.length ? `<div class="shop">${open.map(row).join("")}</div>${!open.length && done.length ? `<div class="note">Alles abgehakt.</div>` : ""}${done.length ? `<button class="link acc" data-act="toggleDone">${showDone ? "Erledigte ausblenden" : `${done.length} erledigt/vorhanden ausgeblendet – anzeigen`}</button>${showDone ? `<div class="shop">${done.map(row).join("")}</div>` : ""}` : ""}`
        : `<div class="empty"><b>Noch nichts geplant</b><span>Wähle unter „Neu“ Gerichte für heute oder plane sie unter „Ausgewählt“ – die Zutaten erscheinen hier automatisch und passen sich an Portionen an.</span><button class="btn primary" data-act="view" data-v="radar">Gerichte in „Neu“ wählen</button></div>`}
            ${open.length ? `<button class="btn" data-act="shopShare">Offene Posten teilen / kopieren (z. B. für Bring!)</button>` : ""}
      <form class="fgrid three" data-submit="shopAdd"><input id="shop-n" placeholder="Eigener Posten" aria-label="Eigener Posten" required class="full">
        <input id="shop-a" inputmode="decimal" placeholder="Menge" aria-label="Menge"><input id="shop-u" placeholder="Einheit" aria-label="Einheit"><button class="btn">${ic("plus", 16)} Hinzufügen</button></form>
      <div class="note">Gleiche Zutaten werden über alle Gerichte addiert, wenn die Einheiten zusammenpassen (g/kg, ml/l/EL/TL). Andere Einheiten bleiben getrennte Posten.</div>${ps.length > 1 ? `<div class="note">Die Liste ist live geteilt: Abhaken und Änderungen der anderen Person erscheinen nach wenigen Sekunden.</div>` : ""}</section>`;
  }

  // ================================================================== Mehr, Historie, Gewicht
  function vMehr() {
    const curHex = accentHex(), saved = LS.get("accentSaved", []) || [], savedHere = curHex != null && saved.some((c) => String(c.hex).toLowerCase() === curHex);
    const palette = `<details class="card fold" ${ui.palOpen ? "open" : ""}><summary data-act="palToggle"><h2>Farbe der App</h2><span class="sub">Gilt nur auf diesem Gerät</span></summary>
      <div class="swatches" role="radiogroup" aria-label="Akzentfarbe">${ACCENTS.map(([hex, n]) => `<button class="sw-c" role="radio" aria-checked="${curHex === hex}" aria-label="${n}" title="${n}" data-act="accent" data-hex="${hex}" style="--c:${hex}"></button>`).join("")}</div>
      ${saved.length ? `<div class="eyebrow">Meine Farben</div><div class="swatches">${saved.map((c) => `<button class="sw-c" role="radio" aria-checked="${curHex === String(c.hex).toLowerCase()}" aria-label="Eigene Farbe" data-act="accent" data-hex="${esc(c.hex)}" style="--c:${esc(c.hex)}"></button>`).join("")}</div>` : ""}
      <label class="f" style="flex-direction:row;align-items:center;gap:12px">Neue Farbe<input type="color" id="accent-custom" data-change="accentCustom" value="${esc(ui.pendingHex || curHex || "#8fb39b")}" aria-label="Neue Farbe wählen"></label>
      ${ui.pendingHex ? `<button class="btn sm primary" data-act="accentSave" style="align-self:flex-start">Farbe in „Meine Farben“ speichern</button>` : ""}
      ${savedHere ? `<button class="btn sm ghost" data-act="accentDel" style="align-self:flex-start">Diese gespeicherte Farbe entfernen</button>` : ""}
      ${curHex ? `<button class="btn sm ghost" data-act="accentReset" style="align-self:flex-start">Zurück zum Standard</button>` : ""}</details>`;
    return `<h2>Mehr</h2><div class="eyebrow">Auswertung</div><div class="more">
      <button data-act="view" data-v="rueckblick">${ic("radar")}<span>Wochenrückblick<br><span class="note">Die letzten 7 Tage auf einen Blick</span></span></button>
      <button data-act="view" data-v="health">${ic("check")}<span>Apple Health<br><span class="note">Workouts und Waage per Kurzbefehl</span></span></button>
      <button data-act="view" data-v="historie">${ic("cal")}<span>Historie und Statistik<br><span class="note">Kalender, Wochen und Monate</span></span></button>
      <button data-act="view" data-v="gewicht">${ic("scale")}<span>Gewicht<br><span class="note">Verlauf, Trend und Ziel</span></span></button></div>
      <div class="eyebrow">Einstellungen</div><div class="more">
      <button data-act="view" data-v="profil">${ic("user")}<span>Profile und Einstellungen<br><span class="note">Kalorienbedarf, Sportwerte, Lebensmittel, Datensicherung</span></span></button></div>
      <div class="eyebrow">Darstellung</div>${palette}`;
  }

  function vHistorie() {
    const h = ui.hist;
    const month = h.month || today().slice(0, 7);
    let from, to;
    if (h.period === "woche") { to = ui.date; from = L.addDays(to, -6); }
    else { from = month + "-01"; const d = L.parseISO(from); to = L.todayISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
    const { days, stats } = store.historyDays(ui.pid, from, to);
    const [y, m] = month.split("-").map(Number);
    const tiles = [
      [stats.avgKcal == null ? "–" : de(stats.avgKcal), "Ø kcal pro vollständigem Tag"],
      [stats.avgDev == null ? "–" : (stats.avgDev > 0 ? "+" : "") + de(stats.avgDev), "Ø Abweichung vom Budget (kcal)"],
      [`${stats.completeDays} / ${stats.partialDays}`, "Tage vollständig / unvollständig"],
      [stats.hitRate == null ? "–" : stats.hitRate + " %", "Budget eingehalten"],
    ];
    if (stats.avgProtein != null) tiles.push([de(stats.avgProtein) + " g", "Ø Protein"]);
    const first = L.parseISO(from).getDay();
    const lead = h.period === "monat" ? (first + 6) % 7 : 0;
    const cal = h.period === "monat" ? `<div class="cal">${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((w) => `<div class="wd">${w}</div>`).join("")}${"<button class=\"out\" disabled></button>".repeat(lead)}
      ${days.map((d) => `<button class="${d.date === today() ? "today " : ""}${d.hit === true ? "hit" : d.hit === false ? "miss" : d.hasData ? "part" : ""}" data-act="gotoDay" data-d="${d.date}" aria-label="${esc(fmtDate(d.date))}">${L.parseISO(d.date).getDate()}<i></i></button>`).join("")}</div>
      <div class="legend"><span><i style="background:var(--ok);border-radius:50%"></i>Budget eingehalten</span><span><i style="background:var(--bad);border-radius:50%"></i>überschritten</span><span><i style="background:var(--muted);border-radius:50%"></i>unvollständig</span></div>` : "";
    return `<div class="row" style="align-items:center"><h2>Historie</h2><div class="filters">${[["woche", "Woche"], ["monat", "Monat"]].map(([k, t]) => `<button class="chip line" data-act="hperiod" data-v="${k}" aria-pressed="${h.period === k}">${t}</button>`).join("")}</div></div>
      ${h.period === "monat" ? `<div class="datebar"><button class="iconbtn" data-act="hmonth" data-n="-1" aria-label="Vormonat">${ic("left", 18)}</button><b>${MONTHS[m - 1]} ${y}</b><button class="iconbtn" data-act="hmonth" data-n="1" aria-label="Folgemonat">${ic("right", 18)}</button></div>` : `<div class="sub">${esc(fmtDate(from))} – ${esc(fmtDate(to))}</div>`}
      <div class="stats">${tiles.map(([v, t]) => `<div class="stat"><b>${v}</b><span>${t}</span></div>`).join("")}</div>
      <section class="card"><h3>Kalorien pro Tag</h3>${histChart(days)}<div class="note">Balken = gegessen, Linie = Budget (Ziel + Sport). Grau = Tag nicht als vollständig markiert.</div></section>
      ${cal}
      <div class="note">Ein Tag zählt erst, wenn du ihn unter „Ausgewählt“ als vollständig erfasst markierst und alle gegessenen Mahlzeiten einen Kalorienwert haben. Tage ohne Einträge werden weder als Erfolg noch als Misserfolg gewertet.</div>`;
  }

  const HEALTH_URL = () => `${(window.FR_CONFIG && window.FR_CONFIG.url) || "https://DEIN-PROJEKT.supabase.co"}/functions/v1/health-import`;
  function vHealth() {
    const pid = ui.pid;
    const code = (label, text) => `<div class="codeblock"><div class="row"><b>${label}</b><button class="btn sm" data-act="copyText" data-text="${esc(text)}">Kopieren</button></div><pre>${esc(text)}</pre></div>`;
    const ex = JSON.stringify({ profile: pid, activeKcal: 480 }, null, 2);
    const open = store.hkOpen(pid).length;
    return `<div class="toprow"><button class="btn sm" data-act="view" data-v="mehr">${ic("left", 16)} Mehr</button></div>
      <section class="card"><h2>Apple Health</h2>
        <div class="sub">Der iPhone-Kurzbefehl schickt Gewicht und Workouts an Foody. Die App übernimmt sie beim Öffnen${open ? ` (jetzt ${open} wartend)` : ""}.</div>
        <div class="note">Übernommen wird nur, was einen echten Wert hat: Gewicht zwischen 20 und 300 kg, Workouts nur mit Kalorienwert. Foody schätzt nichts.</div></section>
      <section class="card"><h3>1. Einmalig: Geheimwort setzen</h3><div class="note">In Supabase unter Edge Functions → Secrets ein Secret <b>HEALTH_KEY</b> mit einem selbst gewählten langen Wort anlegen.</div></section>
      <section class="card"><h3>2. Kurzbefehl bauen</h3>
        <div class="note">Kurzbefehle → Automation → Persönlich: „Tageszeit“ (z. B. 21:00) oder „Workout beenden“. Aktionen: „Health-Werte suchen“ (Gewicht bzw. Workouts), danach „Inhalte von URL abrufen“ mit diesen Angaben:</div>
        ${code("URL (Methode POST)", HEALTH_URL())}${code("Header", "x-health-key: <dein Geheimwort>")}${code("Anfragetext (JSON)", ex)}
        <div class="note">activeKcal ist die aktive Energie von heute (nicht der Gesamtverbrauch, den Ruhe- und Alltagsverbrauch rechnet Foody schon über Grundumsatz und PAL ein). Optional geht auch weightKg (Gewicht) und workouts. Der Wert wird bei jedem Lauf für heute überschrieben. Datum ist optional ("date": "JJJJ-MM-TT"), sonst gilt heute.</div></section>`;
  }

  function vRueckblick() {
    const end = ui.rbEnd && ui.rbEnd <= today() ? ui.rbEnd : today(), from = L.addDays(end, -6);
    const { days } = store.historyDays(ui.pid, from, end);
    const tracked = days.filter((d) => d.eaten > 0);
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const avgK = avg(tracked.map((d) => d.eaten)), avgP = avg(tracked.filter((d) => d.protein != null).map((d) => d.protein));
    const avgG = avg(tracked.filter((d) => d.goal != null).map((d) => d.goal + d.sport));
    const sport = days.reduce((n, d) => n + (d.sport || 0), 0);
    const ws = store.weights(ui.pid).entries;
    const inP = ws.filter((e) => e.date >= from && e.date <= end), before = ws.filter((e) => e.date < from).slice(-1)[0];
    const wNow = inP.length ? inP[inP.length - 1].kg : null, wRef = before ? before.kg : inP.length > 1 ? inP[0].kg : null;
    const dw = wNow != null && wRef != null ? Math.round((wNow - wRef) * 10) / 10 : null;
    const counts = {};
    for (let i = 0; i < 7; i++) for (const m of store.meals(ui.pid, L.addDays(from, i))) if (m.status === "gegessen" && m.title) counts[m.title] = (counts[m.title] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
    const tile = (t, v, sub) => `<div class="stat"><b>${v}</b><span>${t}</span>${sub ? `<small class="note">${sub}</small>` : ""}</div>`;
    return `<div class="toprow"><button class="iconbtn" data-act="rbShift" data-n="-7" aria-label="Vorwoche">${ic("left", 18)}</button><div style="text-align:center"><h2 style="margin:0">Wochenrückblick</h2><div class="sub">${esc(fmtDate(from))} – ${esc(fmtDate(end))}</div></div><button class="iconbtn" data-act="rbShift" data-n="7" aria-label="Folgewoche" ${end >= today() ? "disabled" : ""}>${ic("right", 18)}</button></div>
      ${tracked.length ? `<section class="card"><div class="stats">${tile("Ø kcal / Tag", de(avgK), avgG != null ? "Budget Ø " + de(avgG) : "")}${tile("Ø Protein / Tag", avgP != null ? de(avgP) + " g" : "–")}${tile("Tage erfasst", tracked.length + " von 7")}</div>
        <div class="stats">${tile("Sport", sport ? de(Math.round(sport)) + " kcal" : "–", "angerechnet")}${tile("Gewicht", wNow != null ? de(wNow) + " kg" : "–", dw != null ? (dw > 0 ? "+" : "") + de(dw) + " kg zur Vorwoche" : "")}</div></section>
        <section class="card"><h3>Kalorien pro Tag</h3>${histChart(days)}<div class="note">Balken = gegessen, Strich = Budget.</div></section>
        ${top.length ? `<section class="card"><h3>Am häufigsten gegessen</h3><div class="minilist">${top.map(([t, n]) => `<div><span>${esc(t)}</span><b>${n}×</b></div>`).join("")}</div></section>` : ""}`
      : `<div class="empty"><b>Noch keine gegessenen Mahlzeiten</b><span>Markiere Mahlzeiten unter „Ausgewählt“ als gegessen, dann erscheint hier deine Woche.</span></div>`}`;
  }

  function histChart(days) {
    const W = 340, H = 150, padL = 34, padB = 18, padT = 8;
    const budgets = days.map((d) => (d.goal != null ? d.goal + d.sport : null));
    const max = Math.max(500, ...days.map((d) => d.eaten || 0), ...budgets.filter((b) => b != null)) * 1.1;
    const n = days.length, bw = (W - padL - 4) / n;
    const y = (v) => padT + (H - padT - padB) * (1 - v / max);
    const ticks = [0, Math.round(max / 2 / 100) * 100, Math.floor(max / 100) * 100];
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalorien pro Tag">`;
    for (const t of ticks) s += `<line class="grid" x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 4}" y="${y(t) + 3}" text-anchor="end">${de(t)}</text>`;
    days.forEach((d, i) => {
      const x = padL + i * bw + bw * 0.15, w = bw * 0.7;
      if (d.eaten) s += `<rect x="${x}" y="${y(d.eaten)}" width="${w}" height="${y(0) - y(d.eaten)}" rx="${Math.min(3, w / 2)}" fill="${d.hit === true ? "var(--ok)" : d.hit === false ? "var(--bad)" : "var(--muted)"}" opacity="${d.complete ? 1 : 0.45}"/>`;
      if (budgets[i] != null) s += `<line x1="${x - bw * 0.1}" x2="${x + w + bw * 0.1}" y1="${y(budgets[i])}" y2="${y(budgets[i])}" stroke="var(--accent-2)" stroke-width="2"/>`;
    });
    const lbl = (i) => `<text x="${padL + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${L.parseISO(days[i].date).getDate()}.</text>`;
    s += lbl(0) + (n > 2 ? lbl(Math.floor(n / 2)) : "") + lbl(n - 1);
    return s + "</svg>";
  }

  function vGewicht() {
    const w = store.weights(ui.pid), s = w.summary, p = store.profile(ui.pid);
    const list = [...w.entries].reverse();
    return `<h2>Gewicht · ${esc(p.name)}</h2>
      <div class="stats">
        <div class="stat"><b>${s.start == null ? "–" : de(s.start, 1)}</b><span>Start (kg)</span></div>
        <div class="stat"><b>${s.current == null ? "–" : de(s.current, 1)}</b><span>Aktuell (kg)</span></div>
        <div class="stat"><b class="${s.delta < 0 ? "pos" : s.delta > 0 ? "neg" : ""}">${s.delta == null ? "–" : (s.delta > 0 ? "+" : "") + de(s.delta, 1)}</b><span>Veränderung kg${s.deltaPct != null ? ` (${s.deltaPct > 0 ? "+" : ""}${de(s.deltaPct, 1)} %)` : ""}</span></div>
        <div class="stat"><b>${p.targetWeightKg ? de(p.targetWeightKg, 1) : "–"}</b><span>Ziel (kg)${s.toGo != null ? ` · noch ${de(Math.abs(s.toGo), 1)}` : ""}</span></div></div>
      ${s.progress != null ? `<div><div class="legend"><span>Fortschritt zum Ziel</span><b>${s.progress} %</b></div><div class="mbar" style="height:10px"><i style="width:${s.progress}%"></i></div></div>` : ""}
      <section class="card"><h3>Verlauf</h3>${w.entries.length >= 2 ? weightChart(w.entries, p.targetWeightKg) : `<div class="note">Ab zwei Messungen erscheint hier der Verlauf.</div>`}
        <div class="note">Punkte = einzelne Messungen, Linie = geglätteter Trend. Schwankungen von 1–2 kg über wenige Tage sind meist Wasser, Salz oder Verdauung – nicht Fett. Aussagekräftig ist der Trend über Wochen.</div></section>
      <form class="card" data-submit="weightAdd"><h3>Messung eintragen</h3><div class="fgrid">
        <label class="f">Datum<input id="w-date" type="date" value="${today()}" max="${today()}" required></label>
        <label class="f">Gewicht (kg)<input id="w-kg" type="number" inputmode="decimal" step="0.1" min="25" max="350" required></label>
        <label class="f full">Notiz<input id="w-note" placeholder="optional"></label></div>
        <button class="btn primary">Speichern</button><div class="note">Ein Eintrag pro Tag – ein zweiter am selben Tag ersetzt den ersten.</div></form>
      ${list.length ? `<section class="card"><h3>Messungen</h3><div class="scroll"><table class="tbl"><thead><tr><th>Datum</th><th class="r">kg</th><th class="r">Trend</th><th></th></tr></thead><tbody>
        ${list.map((e) => `<tr><td>${esc(fmtDate(e.date))}${e.note ? `<br><span class="note">${esc(e.note)}</span>` : ""}</td><td class="r">${de(e.kg, 1)}</td><td class="r muted">${de(e.trend, 1)}</td>
        <td class="r"><button class="btn sm ghost" data-act="weightEdit" data-d="${e.date}">Bearbeiten</button></td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }

  function weightChart(entries, target) {
    const W = 340, H = 170, padL = 36, padB = 20, padT = 10, padR = 8;
    const vals = entries.map((e) => e.kg).concat(entries.map((e) => e.trend)).concat(target ? [Number(target)] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const span = Math.max(2, hi - lo); lo -= span * 0.12; hi += span * 0.12;
    const t0 = L.parseISO(entries[0].date).getTime(), t1 = Math.max(t0 + 86400000, L.parseISO(entries[entries.length - 1].date).getTime());
    const x = (d) => padL + (W - padL - padR) * ((L.parseISO(d).getTime() - t0) / (t1 - t0));
    const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsverlauf">`;
    for (const v of [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15]) s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 4}" y="${y(v) + 3}" text-anchor="end">${de(v, 1)}</text>`;
    if (target) s += `<line x1="${padL}" x2="${W - padR}" y1="${y(target)}" y2="${y(target)}" stroke="var(--accent-2)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${W - padR}" y="${y(target) - 4}" text-anchor="end">Ziel</text>`;
    s += `<path d="${entries.map((e, i) => (i ? "L" : "M") + x(e.date).toFixed(1) + " " + y(e.trend).toFixed(1)).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>`;
    s += entries.map((e) => `<circle cx="${x(e.date).toFixed(1)}" cy="${y(e.kg).toFixed(1)}" r="3" fill="var(--muted)"/>`).join("");
    const last = entries[entries.length - 1];
    s += `<circle cx="${x(last.date)}" cy="${y(last.trend)}" r="5" fill="var(--accent)"/>`;
    s += `<text x="${padL}" y="${H - 4}">${esc(fmtDate(entries[0].date))}</text><text x="${W - padR}" y="${H - 4}" text-anchor="end">${esc(fmtDate(last.date))}</text>`;
    return s + "</svg>";
  }

  // ================================================================== Profil & Einstellungen
  function vProfil() {
    const p = store.profile(ui.pid), e = store.energyFor(ui.pid, today()), w = store.currentWeight(ui.pid);
    const rates = store.sportRates(ui.pid);
    const v = (x) => (x == null ? "" : esc(x));
    const formula = e && e.bmr != null
      ? `Grundumsatz (Mifflin-St. Jeor):\n10 × ${de(w, 1)} kg + 6,25 × ${de(p.heightCm)} cm − 5 × ${e.age} J. ${p.sex === "m" ? "+ 5" : "− 161"} = ${de(e.bmr)} kcal\nGesamtbedarf: ${de(e.bmr)} × PAL ${de(p.pal, 2)} = ${de(e.tdee)} kcal\nTagesziel: ${e.goal == null ? "–" : de(e.goal) + " kcal"} (${e.goalSource || "–"})`
      : `Es fehlen: ${(e ? e.missing : []).join(", ") || "–"}. Ohne diese Angaben zeigt Foody keinen Bedarf an.${e && e.goal != null ? `\nTagesziel (manuell): ${de(e.goal)} kcal` : ""}`;
    return `<h2>Profil · ${esc(p.name)}</h2>
      <section class="card"><div class="eyebrow">Energiebedarf</div>
        <div class="stats"><div class="stat"><b>${e && e.bmr != null ? de(e.bmr) : "–"}</b><span>Grundumsatz kcal</span></div><div class="stat"><b>${de(p.pal, 2)}</b><span>Aktivitätsfaktor (PAL)</span></div>
          <div class="stat"><b>${e && e.tdee != null ? de(e.tdee) : "–"}</b><span>Gesamtbedarf kcal</span></div><div class="stat"><b class="pos">${e && e.goal != null ? de(e.goal) : "–"}</b><span>Tagesziel kcal</span></div></div>
        <div class="formula">${esc(formula)}</div>
        ${e && e.warnings.length ? `<div class="notice">${esc(e.warnings.join(" "))}</div>` : ""}
        <div class="note">Bedarf = Schätzung, was du verbrauchst. Ziel = was du essen willst. Der PAL beschreibt deinen Alltag ohne geplanten Sport (DGE). Sport kommt nur mit echtem Verbrauchswert dazu – so wird Bewegung nicht doppelt gezählt.</div></section>
      <form class="card" data-submit="profile"><h3>Angaben</h3><div class="fgrid">
        <label class="f full">Name<input id="p-name" value="${v(p.name)}" required></label>
        <label class="f">Geschlecht (für die Formel)<select id="p-sex"><option value="m" ${p.sex === "m" ? "selected" : ""}>männlich</option><option value="w" ${p.sex === "w" ? "selected" : ""}>weiblich</option></select></label>
        <label class="f">Geburtsdatum<input id="p-birth" type="date" value="${v(p.birthDate)}"></label>
        <label class="f">Alter (falls kein Datum)<input id="p-age" type="number" inputmode="numeric" min="14" max="100" value="${v(p.ageYears)}"></label>
        <label class="f">Größe (cm)<input id="p-height" type="number" inputmode="numeric" min="120" max="230" value="${v(p.heightCm)}" placeholder="z. B. 180"></label>
        <label class="f">Aktuelles Gewicht (kg)<input id="p-weight" type="number" inputmode="decimal" step="0.1" min="25" max="350" value="${v(w)}" placeholder="z. B. 80"></label>
        <label class="f">Zielgewicht (kg)<input id="p-target" type="number" inputmode="decimal" step="0.1" value="${v(p.targetWeightKg)}"></label>
        <label class="f full">Aktivität im Alltag (ohne Sport)<select id="p-pal">${L.PAL_LEVELS.map(([x, t]) => `<option value="${x}" ${Number(p.pal) === x ? "selected" : ""}>${de(x, 1)} – ${t}</option>`).join("")}</select></label>
        <label class="f">Ziel<select id="p-mode"><option value="halten" ${p.goalMode === "halten" ? "selected" : ""}>Gewicht halten</option><option value="abnehmen" ${p.goalMode === "abnehmen" ? "selected" : ""}>Abnehmen</option><option value="manuell" ${p.goalMode === "manuell" ? "selected" : ""}>Tagesziel selbst festlegen</option></select></label>
        <label class="f">Defizit beim Abnehmen (kcal/Tag)<input id="p-deficit" type="number" inputmode="numeric" min="0" max="1500" step="50" value="${v(p.deficitKcal)}"></label>
        <label class="f">Eigenes Tagesziel (kcal)<input id="p-manual" type="number" inputmode="numeric" min="800" max="6000" value="${v(p.goalKcalManual)}"></label>
        <label class="f">Sport anrechnen<select id="p-sport">${[[100, "100 % der Verbrauchswerte"], [50, "50 % (vorsichtig)"], [0, "gar nicht, nur dokumentieren"]].map(([x, t]) => `<option value="${x}" ${Number(p.sportCreditPct) === x ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="f full">Mag ich (Merkmale, Komma)<input id="p-likes" value="${v(p.likes)}" placeholder="proteinreich, vegetarisch"></label>
        <label class="f full">Mag ich nicht (Zutaten, Komma)<input id="p-dislikes" value="${v(p.dislikes)}" placeholder="Pilze, Koriander"></label></div>
        <div class="note">Rund 500 kcal Defizit pro Tag entsprechen grob 0,5 kg pro Woche (Faustregel 7.700 kcal je kg Fett). Änderungen gelten ab heute; vergangene Tage behalten ihr damaliges Ziel.</div>
        <button class="btn primary">Profil speichern</button></form>
      <section class="card"><h3>Sport: eigene Verbrauchswerte</h3><div class="note">Trage hier deine Durchschnittswerte ein (kcal pro Stunde, z. B. von deiner Uhr). Aktivitäten ohne Wert werden nicht angerechnet; bereits erfasste Einheiten ohne Wert bekommen den neuen Durchschnitt.</div>
        <form data-submit="rates" class="fgrid">${store.sportKinds().map((k) => `<label class="f">${esc(k.name)} (kcal/h)<input id="rate-${k.id}" data-kind="${k.id}" type="number" inputmode="numeric" min="0" max="2000" value="${rates[k.id] ? rates[k.id].kcalPerHour : ""}" placeholder="kein Wert"></label>`).join("")}
          <button class="btn full">Werte speichern</button></form>
        <form data-submit="kind" class="search"><input id="kind-name" placeholder="Weitere Sportart" required aria-label="Weitere Sportart"><button class="btn">Hinzufügen</button></form></section>
      <section class="card"><div class="row" style="align-items:center"><h3>Lebensmittel (je 100 g)</h3><button class="btn sm" data-act="foodEdit" data-id="">${ic("plus", 16)} Neu</button></div>
        <div class="note">Grundlage für „aus Zutaten berechnet“. Startwerte aus USDA FoodData Central (SR Legacy) – prüfe und korrigiere sie bei Bedarf.</div>
        <div class="scroll"><table class="tbl"><thead><tr><th>Name</th><th class="r">kcal</th><th class="r">P</th><th class="r">KH</th><th class="r">F</th></tr></thead><tbody>
        ${store.foodList().map((f) => `<tr data-act="foodEdit" data-id="${f.id}" style="cursor:pointer"><td>${esc(f.name)}<br><span class="note">${esc(f.source)}</span></td><td class="r">${de(f.kcal)}</td><td class="r">${f.protein == null ? "–" : de(f.protein, 1)}</td><td class="r">${f.carbs == null ? "–" : de(f.carbs, 1)}</td><td class="r">${f.fat == null ? "–" : de(f.fat, 1)}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="card"><h3>Daten</h3><div class="note">Alle Daten liegen privat in deinem Claude-Konto bei dieser Seite – auf jedem Gerät gleich, solange du angemeldet bist. Teilst du die Seite, sieht die andere Person die Daten.</div>
        ${caps.downloads ? `<button class="btn" data-act="backup">Sicherung als JSON herunterladen</button>` : `<div class="note">Herunterladen ist in dieser Ansicht nicht möglich.</div>`}</section>`;
  }

  function sheetFood(id) {
    const f = id ? store.S.foods[id] : { name: "", aliases: "", kcal: "", protein: "", carbs: "", fat: "", density: "", pieceG: "", source: "eigene Angabe" };
    const v = (x) => (x == null ? "" : esc(x));
    return `<form data-submit="food" data-id="${id || ""}" class="fgrid">
      <label class="f full">Name<input id="fd-name" value="${v(f.name)}" required></label>
      <label class="f full">Andere Namen (Komma, für die Zuordnung)<input id="fd-alias" value="${v(f.aliases)}"></label>
      ${[["kcal", "kcal"], ["protein", "Protein g"], ["carbs", "Kohlenhydrate g"], ["fat", "Fett g"]].map(([k, t]) => `<label class="f">${t} je 100 g<input id="fd-${k}" type="number" inputmode="decimal" step="0.01" min="0" value="${v(f[k])}" ${k === "kcal" ? "required" : ""}></label>`).join("")}
      <label class="f">Dichte g/ml (für ml, EL, TL)<input id="fd-density" type="number" inputmode="decimal" step="0.01" min="0" value="${v(f.density)}"></label>
      <label class="f">Gewicht je Stück (g)<input id="fd-piece" type="number" inputmode="decimal" step="1" min="0" value="${v(f.pieceG)}"></label>
      <label class="f full">Quelle<input id="fd-source" value="${v(f.source)}" required></label>
      <button class="btn primary full">Speichern</button></form>`;
  }

  // ================================================================== Blätter (Bottom Sheets)
  function openSheet(type, data = {}) { ui.sheet = { type, ...data }; renderSheet(true); }
  function closeSheet() { ui.sheet = null; renderSheet(true); }
  const LIVE_SHEETS = new Set(["recipe"]);
  function renderSheet(force) {
    const root = $("#sheet");
    const s = ui.sheet;
    if (!s) { root.innerHTML = ""; document.documentElement.style.overflow = ""; return; }
    if (!force && !LIVE_SHEETS.has(s.type)) return;
    const titles = { recipe: "", editor: s.ed && s.ed.id ? "Rezept bearbeiten" : "Neues Rezept", import: "Rezept importieren", addMeal: `Eintrag: ${SLOT_LABEL[s.slot] || ""}`, plan: "Einplanen", sport: "Aktivität eintragen", mealMenu: "Mahlzeit", pickSlot: "Wann kochst du das?", weekPick: `Gericht für ${fmtDate(s.date || ui.date)}`, shopAmount: "Menge anpassen", weight: "Messung bearbeiten", food: "Lebensmittel" };
    const body = { recipe: () => sheetRecipe(s.id), editor: sheetEditor, import: sheetImport, addMeal: sheetAddMeal, plan: sheetPlan, sport: sheetSport, mealMenu: sheetMealMenu, pickSlot: sheetPickSlot, weekPick: sheetWeekPick, shopAmount: sheetShopAmount, weight: sheetWeight, food: () => sheetFood(s.id) }[s.type];
    const scrollTop = root.querySelector(".sheet") ? root.querySelector(".sheet").scrollTop : 0;
    root.innerHTML = `<div class="sheet-bg" data-act="bgClose"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(titles[s.type] || "Details")}">
      <div class="grip"></div><div class="shead"><h3>${esc(titles[s.type] || "")}</h3><button class="iconbtn" data-act="closeSheet" aria-label="Schließen">${ic("x", 18)}</button></div>${body()}</div></div>`;
    root.querySelector(".sheet").scrollTop = scrollTop;
    document.documentElement.style.overflow = "hidden";
    if (s.type === "editor") drawCrop();
  }

  /** Text für Schritte: nur das Wichtigste fett – Temperaturen und Zeiten (Mengen und Zutaten bleiben normal). */
  const EMPH = /(\d+(?:[.,]\d+)?(?:\s?[–-]\s?\d+(?:[.,]\d+)?)?\s?(?:°\s?C|Minuten|Minute|Min\.?|Stunden|Stunde|Std\.?|Sekunden|Sek\.?)(?![A-Za-zäöüß]))/g;
  const emph = (t) => esc(t).replace(EMPH, "<b>$1</b>");

  // ================================================================== Kochmodus
  let wake = null;
  async function wakeOn() {
    if (!ui.cook) return;
    try {
      if (!navigator.wakeLock) throw new Error("nicht unterstützt");
      wake = await navigator.wakeLock.request("screen");
      if (ui.cook) ui.cook.awake = true;
      wake.addEventListener("release", () => { if (ui.cook) { ui.cook.awake = false; renderCook(); } });
    } catch (e) { if (ui.cook) ui.cook.awake = false; }
    renderCook();
  }
  function wakeOff() { try { if (wake) wake.release(); } catch (e) { /* egal */ } wake = null; }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && ui.cook) wakeOn(); }); // iOS gibt die Sperre beim Wegwischen frei

  function renderCook() {
    const root = $("#cook"), c = ui.cook;
    if (!root) return;
    if (!c) { root.innerHTML = ""; document.documentElement.style.overflow = ui.sheet ? "hidden" : ""; return; }
    const r = store.recipe(c.id, ui.pid);
    if (!r) { ui.cook = null; root.innerHTML = ""; return; }
    const steps = r.instructions.split("\n").filter((s) => s.trim());
    const n = steps.length, i = Math.max(0, Math.min(n - 1, c.step));
    const fac = c.sv / (r.servings || 1);
    const ing = r.nut.rows.map((x) => { const a = L.scaleAmount(x.amount, x.unit, fac); return `<li><span class="q">${a.amount == null ? "" : deA(a.amount) + " " + esc(a.unit || "")}</span><span>${esc(x.name)}</span></li>`; }).join("");
    const awake = c.awake === true ? `<span class="chip ok">Bildschirm bleibt an</span>` : c.awake === false ? `<span class="chip warn">Bildschirm kann ausgehen</span>` : "";
    root.innerHTML = `<div class="cook" role="dialog" aria-modal="true" aria-label="Kochmodus">
      <div class="cook-top"><button class="iconbtn" data-act="cookEnd" aria-label="Kochmodus beenden">${ic("x", 20)}</button>
        <div class="cook-title"><b>${esc(r.title)}</b><span class="note">für ${deA(c.sv)} Portionen</span></div></div>
      <div class="filters"><button class="chip line" data-act="cookTab" data-v="steps" aria-pressed="${c.tab === "steps"}">Schritte</button><button class="chip line" data-act="cookTab" data-v="zutaten" aria-pressed="${c.tab === "zutaten"}">Zutaten</button>${awake}</div>
      ${c.awake === false ? `<div class="note">Dieses Gerät hält den Bildschirm hier nicht automatisch an. Stell „Automatische Sperre“ in den iPhone-Einstellungen (Anzeige &amp; Helligkeit) für das Kochen auf „Nie“.</div>` : ""}
      ${c.tab === "zutaten" ? `<div class="cook-body"><ul class="cook-ing">${ing}</ul></div>`
        : n ? `<div class="cook-prog"><b>Schritt ${i + 1} von ${n}</b><div class="bar"><i style="width:${((i + 1) / n) * 100}%"></i></div></div>
          <div class="cook-body"><p class="cook-step">${emph(steps[i])}</p>${i + 1 < n ? `<p class="cook-next"><span class="note">Danach:</span> ${emph(steps[i + 1])}</p>` : ""}</div>
          <div class="cook-nav"><button class="btn" data-act="cookNav" data-d="-1" ${i === 0 ? "disabled" : ""}>‹ Zurück</button>${i + 1 < n ? `<button class="btn primary" data-act="cookNav" data-d="1">Weiter ›</button>` : `<button class="btn primary" data-act="cookEnd">Fertig ✓</button>`}</div>`
          : `<div class="cook-body"><div class="note">Zu diesem Rezept sind keine Schritte hinterlegt.</div></div>`}
    </div>`;
    document.documentElement.style.overflow = "hidden";
  }

  function sheetPickSlot() {
    const r = store.S.recipes[ui.sheet.id];
    return `<div class="note" style="margin-bottom:8px">„${esc(r ? r.title : "")}“ kommt unter „Ausgewählt“ auf die Liste. Zu welcher Mahlzeit?</div>
      <div class="minilist">${X.SLOTS.filter(([k]) => k !== "fruehstueck").map(([k, t]) => `<div><span><b>${esc(t)}</b></span><button class="btn primary" data-act="pickSlot" data-slot="${k}">Auswählen</button></div>`).join("")}</div>`;
  }

  function sheetAddMeal() {
    const s = ui.sheet;
    const q = L.norm(s.q || "");
    const rs = store.recipes(ui.pid).filter((r) => !q || L.norm(r.title).includes(q)).slice(0, 30);
    return `<div class="filters">${[["rezept", "Aus Bibliothek"], ["manuell", "Ohne Rezept"]].map(([k, t]) => `<button class="chip line" data-act="amTab" data-v="${k}" aria-pressed="${s.tab === k}">${t}</button>`).join("")}</div>
      ${s.tab === "rezept" ? `<input id="am-q" type="search" placeholder="Rezept suchen" value="${esc(s.q || "")}" data-input="amq" aria-label="Rezept suchen">
        <div class="minilist">${rs.map((r) => `<div><span><b>${esc(r.title)}</b><br><span class="note">${kcal(r.nut.perPortion.kcal)} kcal je Portion · ${esc(L.QUALITY_LABEL[r.nut.quality])}</span></span>
          <span class="btns"><button class="btn sm" data-act="amAdd" data-id="${r.id}" data-s="geplant">Planen</button><button class="btn sm primary" data-act="amAdd" data-id="${r.id}" data-s="gegessen">Gegessen</button></span></div>`).join("") || `<div class="note">Keine Rezepte gefunden.</div>`}</div>`
      : `<form data-submit="manualMeal" class="fgrid"><label class="f full">Was?<input id="mm-title" required placeholder="z. B. Brezel"></label>
        <label class="f">kcal je Portion<input id="mm-kcal" type="number" inputmode="decimal" min="0" placeholder="keine Angabe"></label><label class="f">Portionen<input id="mm-p" type="number" inputmode="decimal" min="0.25" step="0.25" value="1"></label>
        <label class="f">Protein g<input id="mm-protein" type="number" inputmode="decimal" min="0"></label><label class="f">Kohlenhydrate g<input id="mm-carbs" type="number" inputmode="decimal" min="0"></label><label class="f">Fett g<input id="mm-fat" type="number" inputmode="decimal" min="0"></label>
        <label class="f">Status<select id="mm-status"><option value="gegessen">gegessen</option><option value="geplant">geplant</option></select></label>
        <div class="note full">Ohne Kalorienwert wird nichts angerechnet und der Tag gilt als unvollständig.</div><button class="btn primary full">Eintragen</button></form>`}`;
  }

  function sheetPlan() {
    const r = store.recipe(ui.sheet.id, ui.pid);
    return `<form data-submit="plan" class="fgrid"><div class="full"><b>${esc(r.title)}</b><div class="note">${kcal(r.nut.perPortion.kcal)} kcal je Portion</div></div>
      <label class="f">Tag<input id="pl-date" type="date" value="${ui.sheet.date || ui.date}" required></label>
      <label class="f">Mahlzeit<select id="pl-slot">${X.SLOTS.map(([k, t]) => `<option value="${k}" ${X.slotForCategory(r.category, new Date().getHours()) === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label class="f">Kochen für (Portionen)<input id="pl-sv" type="number" inputmode="decimal" min="1" step="1" value="${ui.sheet.sv || 4}"></label>
      <label class="f">Davon gegessen (Portionen)<input id="pl-p" type="number" inputmode="decimal" min="0.25" step="0.25" value="1"></label>
      <label class="f">Für<select id="pl-pid">${visibleProfiles().map((p) => `<option value="${p.id}" ${p.id === ui.pid ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <button class="btn primary full">Einplanen</button></form>`;
  }

  function sheetSport() {
    const rates = store.sportRates(ui.pid);
    return `<form data-submit="sport" class="fgrid">
      <label class="f full">Sportart<select id="sp-kind">${store.sportKinds().map((k) => `<option value="${k.id}">${esc(k.name)}${rates[k.id] ? ` (${rates[k.id].kcalPerHour} kcal/h)` : ""}</option>`).join("")}</select></label>
      <label class="f">Dauer (Minuten)<input id="sp-min" type="number" inputmode="numeric" min="1" max="600" required></label>
      <label class="f">Intensität<select id="sp-int"><option value="">–</option><option>locker</option><option>mittel</option><option>hart</option></select></label>
      <label class="f full">Verbrauch laut Uhr/Gerät (kcal, optional)<input id="sp-kcal" type="number" inputmode="numeric" min="0" max="5000" placeholder="leer = eigener Durchschnitt, falls hinterlegt"></label>
      <div class="note full">Ohne Gerätewert und ohne hinterlegten Durchschnitt wird die Einheit nur dokumentiert – nicht angerechnet.</div>
      <button class="btn primary full">Eintragen</button></form>`;
  }

  function sheetMealMenu() {
    const m = store.meals(ui.pid, ui.date).find((x) => x.id === ui.sheet.id);
    if (!m) return `<div class="note">Eintrag nicht mehr vorhanden.</div>`;
    return `<div><b>${esc(m.title)}</b><div class="note">${esc(SLOT_LABEL[m.slot])} · ${deA(m.portions)} Portion(en) · ${kcal(m.total.kcal)} kcal · ${esc(L.QUALITY_LABEL[m.quality] || "")}</div></div>
      <label class="f">Mahlzeit verschieben<select id="mm-slot" data-change="mealSlot" data-id="${m.id}">${X.SLOTS.map(([k, t]) => `<option value="${k}" ${m.slot === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${!m.recipeId ? `<form data-submit="manualEdit" data-id="${m.id}" class="fgrid">${[["kcal", "kcal je Portion"], ["protein", "Protein g"], ["carbs", "KH g"], ["fat", "Fett g"]].map(([k, t]) => `<label class="f">${t}<input id="me-${k}" type="number" inputmode="decimal" min="0" value="${m.per[k] ?? ""}"></label>`).join("")}<button class="btn full">Werte korrigieren</button></form>` : ""}
      <div class="btns">${m.recipeId && m.recipeExists ? `<button class="btn" data-act="openRecipe" data-id="${m.recipeId}">Rezept öffnen</button>` : ""}<button class="btn danger" data-act="delMeal" data-id="${m.id}">Eintrag entfernen</button></div>`;
  }

  /** Auswahlliste statt Tastatur: sinnvolle Schritte je Einheit, der aktuelle Wert ist immer enthalten. */
  function amountOptions(it) {
    const u = String(it.unit || "").toLowerCase(), cur = it.shown;
    const vals = [];
    const range = (a, b, st) => { for (let v = a; v <= b + 1e-9; v += st) vals.push(Math.round(v * 100) / 100); };
    if (u === "g" || u === "ml") { range(5, 100, 5); range(125, 500, 25); range(550, 1000, 50); range(1100, 3000, 100); }
    else if (u === "kg" || u === "l") range(0.25, 5, 0.25);
    else { range(0.25, 3, 0.25); range(3.5, 10, 0.5); range(11, 30, 1); }
    if (cur != null && !vals.includes(cur)) { vals.push(cur); vals.sort((a, b) => a - b); }
    return `<option value="" ${cur == null ? "selected" : ""}>nach Bedarf</option>` + vals.map((v) => `<option value="${v}" ${v === cur ? "selected" : ""}>${deA(v)}${it.unit ? " " + esc(it.unit) : ""}</option>`).join("");
  }
  function sheetShopAmount() {
    const s = store.shopping(shopDate(), ui.scope);
    const it = s.items.find((i) => i.key === ui.sheet.key);
    if (!it) return `<div class="note">Posten nicht mehr vorhanden.</div>`;
    return `<form data-submit="shopAmount" data-key="${esc(it.key)}" class="fgrid"><div class="full"><b>${esc(it.name)}</b><div class="note">${it.auto ? `Berechnet: ${it.amount == null ? "ohne Menge" : deA(it.amount) + " " + esc(it.unit || "")}` : "Eigener Posten"}</div></div>
      <label class="f full">Menge (${esc(it.unit || "ohne Einheit")})<select id="sa-amount">${amountOptions(it)}</select></label>
      <button class="btn primary">Übernehmen</button>${it.auto && it.override != null ? `<button class="btn" type="button" data-act="shopReset" data-key="${esc(it.key)}">Berechnete Menge</button>` : ""}</form>`;
  }

  function sheetWeight() {
    const e = store.weights(ui.pid).entries.find((x) => x.date === ui.sheet.date);
    if (!e) return `<div class="note">Messung nicht mehr vorhanden.</div>`;
    return `<form data-submit="weightEdit" data-old="${e.date}" class="fgrid"><label class="f">Datum<input id="we-date" type="date" value="${e.date}" required></label>
      <label class="f">Gewicht (kg)<input id="we-kg" type="number" inputmode="decimal" step="0.1" min="25" max="350" value="${e.kg}" required></label>
      <label class="f full">Notiz<input id="we-note" value="${esc(e.note)}"></label>
      <button class="btn primary">Speichern</button><button class="btn danger" type="button" data-act="weightDel" data-d="${e.date}">Löschen</button></form>`;
  }

  // ================================================================== Bildzuschnitt
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
    return { el: im, url };
  }
  function autoBox(imEl) {
    const c = document.createElement("canvas"); const w = 120, h = Math.max(1, Math.round((120 * imEl.naturalHeight) / imEl.naturalWidth));
    c.width = w; c.height = h; const ctx = c.getContext("2d"); ctx.drawImage(imEl, 0, 0, w, h);
    return L.detectPhotoBox(ctx.getImageData(0, 0, w, h));
  }
  function drawCrop() {
    const ed = ui.sheet && ui.sheet.ed, c = $("#crop-canvas");
    if (!ed || !ed.image || !c) return;
    const im = ed.image.el, w = 600, h = Math.round((600 * im.naturalHeight) / im.naturalWidth);
    c.width = w; c.height = Math.min(h, 900);
    const scale = c.height / h;
    const ctx = c.getContext("2d");
    ctx.drawImage(im, 0, 0, w, c.height);
    const b = ed.box, X0 = (b.l / 100) * w, Y0 = (b.t / 100) * c.height, X1 = (b.r / 100) * w, Y1 = (b.b / 100) * c.height;
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, 0, w, Y0); ctx.fillRect(0, Y1, w, c.height - Y1); ctx.fillRect(0, Y0, X0, Y1 - Y0); ctx.fillRect(X1, Y0, w - X1, Y1 - Y0);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#3fd1a6"; ctx.lineWidth = 3; ctx.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    void scale;
  }
  async function croppedBlob(ed) {
    const im = ed.image.el, b = ed.box;
    const sx = (b.l / 100) * im.naturalWidth, sy = (b.t / 100) * im.naturalHeight;
    const sw = Math.max(20, ((b.r - b.l) / 100) * im.naturalWidth), sh = Math.max(20, ((b.b - b.t) / 100) * im.naturalHeight);
    const scale = Math.min(1, 1200 / sw);
    const c = document.createElement("canvas"); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    c.getContext("2d").drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  }

  // ================================================================== Aktionen
  async function run(key, fn) {
    if (ui.readOnly) { toast("Nur Ansicht – Änderungen sind hier nicht möglich."); return; }
    if (ui.busy.has(key)) return; // Doppeltipp abfangen
    ui.busy.add(key);
    try { await fn(); } catch (e) {
      console.error(e);
      const code = e && e.code;
      toast(code === "quota_exceeded" ? "Speicher voll – bitte alte Einträge löschen." : code === "invalid_argument" ? "Konnte nicht speichern: keine Schreibrechte." : "Konnte nicht speichern. Bitte nochmal versuchen.");
      if (code === "invalid_argument") ui.readOnly = true;
    } finally { ui.busy.delete(key); schedule(); }
  }
  const num = (id) => { const el = document.getElementById(id); const v = el ? el.value.trim().replace(",", ".") : ""; return v === "" || isNaN(Number(v)) ? null : Number(v); };
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };

  function setView(v) {
    ui.view = v; LS.set("view", v); window.scrollTo(0, 0);
    if (v === "radar") ensureDrawn();
    schedule();
  }
  async function ensureDrawn() {
    if (ui.radar.stage === "fav" || !ui.radar.meal) return;
    const key = `${ui.pid}|${ui.date}|${ui.radar.slot}|${ui.radar.maxMinutes}`;
    if (ui.readOnly || ui.drawnKey === key || !Object.keys(store.S.recipes).length) return;
    ui.drawnKey = key;
    if (!store.radarStack(ui.pid, ui.date, ui.radar).length) await run("draw", () => store.radarDraw(ui.pid, ui.date, ui.radar));
  }

  const ACT = {
    view: (t) => { if (t.dataset.v === "radar" && ui.view === "radar" && ui.radar.meal) return ACT.pickMeal({ dataset: { v: "" } }); setView(t.dataset.v); },
    superlike: (t) => run("fav:" + t.dataset.id, async () => { const already = store.favSet(ui.pid).has(t.dataset.id); if (!already) await store.toggleFavorite(ui.pid, t.dataset.id); toast(already ? "★ Ist schon Favorit" : "★ Superlike – als Favorit gespeichert"); }),
    pid: (t) => { ui.pid = t.dataset.id; LS.set("pid", ui.pid); ui.lastDecision = null; if (ui.view === "radar") ensureDrawn(); schedule(); },
    day: (t) => { ui.date = L.addDays(ui.date, Number(t.dataset.n)); if (ui.view === "radar") ensureDrawn(); schedule(); },
    gotoDay: (t) => { ui.date = t.dataset.d; setView("heute"); },
    createProfiles: () => run("profiles", () => store.createDefaultProfiles()),
    flag: (t) => run("flag:" + t.dataset.flag, () => store.setDayFlag(ui.pid, ui.date, t.dataset.flag, t.getAttribute("aria-pressed") !== "true")),
    status: (t) => run("meal:" + t.dataset.id, async () => {
      await store.setMealStatus(ui.pid, ui.date, t.dataset.id, t.dataset.s);
      if (t.dataset.s === "gegessen") { const d = store.day(ui.pid, ui.date); toast(`Gebucht · noch ${d.budget.remaining == null ? "–" : de(d.budget.remaining)} kcal frei`); }
    }),
    portion: (t) => run("meal:" + t.dataset.id, async () => {
      const m = store.meals(ui.pid, ui.date).find((x) => x.id === t.dataset.id);
      const p = Math.max(0.5, Math.round((m.portions + Number(t.dataset.d)) * 4) / 4);
      if (p !== m.portions) await store.updateMeal(ui.pid, ui.date, m.id, { portions: p });
    }),
    copyText: async (t) => { try { await navigator.clipboard.writeText(t.dataset.text); toast("Kopiert"); } catch (e) { toast("Kopieren nicht möglich in dieser Ansicht."); } },
    rbShift: (t) => { const e = L.addDays(ui.rbEnd || today(), Number(t.dataset.n)); ui.rbEnd = e >= today() ? null : e; schedule(); },
    hmode: (t) => { ui.hmode = t.dataset.v; LS.set("hmode", ui.hmode); schedule(); },
    weekShift: (t) => { ui.date = L.addDays(ui.date, 7 * Number(t.dataset.n)); schedule(); },
    weekAdd: (t) => openSheet("weekPick", { date: t.dataset.date, q: "", token: "wk-" + Math.random().toString(36).slice(2, 10) }),
    weekPick: (t) => { const d = ui.sheet.date; openSheet("plan", { id: t.dataset.id, date: d, token: "pl-" + Math.random().toString(36).slice(2, 10) }); },
    weekDel: (t) => run("meal:" + t.dataset.id, () => store.deleteMeal(ui.pid, t.dataset.date, t.dataset.id)),
    shopWeek: () => { ui.shopSpan = "woche"; LS.set("shopSpan", ui.shopSpan); setView("einkauf"); },
    span: (t) => { ui.shopSpan = t.dataset.v; LS.set("shopSpan", ui.shopSpan); schedule(); },
    svMeal: (t) => run("meal:" + t.dataset.id, async () => {
      const pid = t.dataset.pid || ui.pid; const dd = t.dataset.date || ui.date;
      const m = store.meals(pid, dd).find((x) => x.id === t.dataset.id);
      const n = Math.max(1, Math.min(40, (m.servings > 0 ? m.servings : 4) + Number(t.dataset.d)));
      await store.updateMeal(pid, dd, m.id, { servings: n });
    }),
    mealSwap: (t) => run("meal:" + t.dataset.id, async () => {
      const m = store.meals(ui.pid, ui.date).find((x) => x.id === t.dataset.id);
      await store.updateMeal(ui.pid, ui.date, m.id, { slot: m.slot === "mittag" ? "abend" : "mittag" });
    }),
    resnap: (t) => run("meal:" + t.dataset.id, () => store.resnapshotMeal(ui.pid, ui.date, t.dataset.id)),
    mealMenu: (t) => openSheet("mealMenu", { id: t.dataset.id }),
    delMeal: (t) => run("meal:" + t.dataset.id, async () => { await store.deleteMeal(ui.pid, ui.date, t.dataset.id); closeSheet(); toast("Eintrag entfernt"); }),
    addMeal: (t) => openSheet("addMeal", { slot: t.dataset.slot, tab: "rezept", q: "", token: "add-" + Math.random().toString(36).slice(2, 10) }),
    amTab: (t) => { ui.sheet.tab = t.dataset.v; renderSheet(true); },
    amAdd: (t) => run("am", async () => {
      await store.addMeal(ui.pid, ui.date, ui.sheet.slot, { recipeId: t.dataset.id, status: t.dataset.s, id: ui.sheet.token, servings: 4 });
      closeSheet(); toast(t.dataset.s === "gegessen" ? "Als gegessen gebucht" : "Eingeplant");
    }),
    addSport: () => openSheet("sport", { token: "sp-" + Math.random().toString(36).slice(2, 10) }),
    delSport: (t) => run("sport", () => store.deleteActivity(ui.pid, ui.date, t.dataset.id)),
    rfilter: (t) => {
      const k = t.dataset.k, v = t.dataset.v === "" ? null : k === "maxMinutes" ? Number(t.dataset.v) : t.dataset.v;
      ui.radar = { ...ui.radar, [k]: ui.radar[k] === v ? null : v }; LS.set("radar", ui.radar); ensureDrawn(); schedule();
    },
    shopResetAll: () => run("shop", async () => { await store.shoppingReset(shopDate(), ui.scope === "alle" || store.profiles().some((p) => p.id === ui.scope) ? ui.scope : "alle"); ui.showDone = false; toast("Einkaufsliste zurückgesetzt"); }),
    later: (rid) => { ui.later = ui.later.filter((x) => x !== rid).concat(rid); ui.lastDecision = null; schedule(); },
    resetDeck: () => run("draw", async () => { ui.radar = { ...ui.radar, stage: "alle" }; LS.set("radar", ui.radar); ui.lastDecision = null; ui.later = []; await store.radarReset(ui.pid, ui.date, ui.radar); schedule(); }),
    toggleExtras: () => { ui.open.has("extras") ? ui.open.delete("extras") : ui.open.add("extras"); LS.set("extras", ui.open.has("extras")); schedule(); },
    cookStart: (t) => { const sv = Number(t.dataset.sv) || (ui.sheet && ui.sheet.sv) || 4; ui.sheet = null; renderSheet(true); ui.cook = { id: t.dataset.id, step: 0, sv, tab: "steps", awake: null }; renderCook(); wakeOn(); },
    cookNav: (t) => { ui.cook.step += Number(t.dataset.d); renderCook(); },
    cookTab: (t) => { ui.cook.tab = t.dataset.v; renderCook(); },
    cookEnd: () => { ui.cook = null; wakeOff(); renderCook(); },
    pickMeal: (t) => { ui.radar = { ...ui.radar, meal: t.dataset.v || null, slot: t.dataset.v || null, stage: "alle" }; LS.set("radar", { stage: "alle" }); ui.lastDecision = null; ui.drawnKey = null; if (t.dataset.v) ensureDrawn(); schedule(); },
    askSlot: (rid) => openSheet("pickSlot", { id: rid }),
    pickSlot: (t) => { const rid = ui.sheet.id; closeSheet(); decide(rid, "keep", undefined, t.dataset.slot); },
    stage: (t) => { ui.radar = { ...ui.radar, stage: t.dataset.v }; LS.set("radar", ui.radar); ui.lastDecision = null; ensureDrawn(); schedule(); },
    draw: () => run("draw", async () => { const n = await store.radarDraw(ui.pid, ui.date, ui.radar); if (!n) toast("Keine weiteren passenden Gerichte – Filter lockern oder Rezepte ergänzen."); }),
    svStep: (t) => { ui.sheet.sv = Math.max(1, Math.min(40, (ui.sheet.sv || 4) + Number(t.dataset.d))); renderSheet(true); },
    decide: (t) => { if (t.dataset.a === "later") return ACT.later(t.dataset.id); if (t.dataset.a === "keep" && !ui.sheet && ui.radar.meal === "main") return ACT.askSlot(t.dataset.id); decide(t.dataset.id, t.dataset.a, t.dataset.sv); if (ui.sheet && ui.sheet.type === "recipe" && t.dataset.a === "keep") closeSheet(); },
    undoDecision: () => { const d = ui.lastDecision; if (d && d.pid === ui.pid && d.date === ui.date) { ui.lastDecision = null; if (d.deleted) run("undo:" + d.rid, () => store.restoreRecipe(d.rid, d.deleted)); else decide(d.rid, "undo"); } },
    toastUndo: () => { ui.toast = null; ACT.undoDecision(); },
    fav: (t) => run("fav:" + t.dataset.id, async () => { const on = await store.toggleFavorite(ui.pid, t.dataset.id); toast(on ? "★ Favorit gespeichert – erscheint öfter" : "Favorit entfernt"); }),
    toggleIng: (t) => { const k = "ing:" + t.dataset.id; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); schedule(); if (ui.sheet && ui.sheet.type === "recipe") renderSheet(true); },
    openRecipe: (t) => openSheet("recipe", { id: t.dataset.id }),
    planSheet: (t) => openSheet("plan", { id: t.dataset.id, sv: ui.sheet && ui.sheet.sv, token: "pl-" + Math.random().toString(36).slice(2, 10) }),
    askDelete: (t) => { ui.sheet.confirm = !!t.dataset.id; renderSheet(true); },
    deleteRecipe: (t) => run("del", async () => {
      const image = await store.deleteRecipe(t.dataset.id);
      if (image && caps.assets) { try { await caps.assets.delete(image); } catch (e) { /* Bild bleibt liegen */ } }
      closeSheet(); toast("Rezept gelöscht");
    }),
    lfilter: (t) => {
      const k = t.dataset.k;
      const v = k === "fav" ? !ui.lib.fav : k === "max" ? Number(t.dataset.v) : t.dataset.v;
      ui.lib[k] = k === "fav" ? v : ui.lib[k] === v ? null : v; schedule();
    },
    newRecipe: () => openSheet("editor", { ed: { id: null, data: emptyRecipe(), missing: [], unsure: [], box: { l: 0, t: 0, r: 100, b: 100 } } }),
    editRecipe: (t) => {
      const r = store.S.recipes[t.dataset.id];
      const data = JSON.parse(JSON.stringify(r));
      data.ingredients = (data.ingredients || []).map((i) => ({ ...i, amount: i.amount ?? "", foodId: i.foodId || "none" }));
      data.nutrition = { kcal: "", protein: "", carbs: "", fat: "", basis: "portion", quality: "original", ...Object.fromEntries(Object.entries(data.nutrition || {}).map(([k, v]) => [k, v ?? ""])) };
      openSheet("editor", { ed: { id: t.dataset.id, data, missing: [], unsure: [], box: { l: 0, t: 0, r: 100, b: 100 } } });
    },
    ingAdd: () => { ui.sheet.ed.data.ingredients.push({ name: "", amount: "", unit: "", foodId: "auto" }); renderSheet(true); },
    ingDel: (t) => { ui.sheet.ed.data.ingredients.splice(Number(t.dataset.n), 1); renderSheet(true); },
    saveRecipe: () => saveEditor(),
    fabLink: () => { openSheet("import", { im: { file: null, preview: null, text: "", busy: false, error: null } }); setTimeout(() => { const f = $("#imp-url"); if (f) f.focus(); }, 60); },
    importStart: () => openSheet("import", { im: { file: null, preview: null, text: "", busy: false, error: null } }),
    theme: () => { const t = themeIsDark() ? "light" : "dark"; LS.set("theme", t); applyTheme(t); applyAccent(); render(); },
    accent: (t) => { ui.pendingHex = null; LS.set("accent", { hex: t.dataset.hex }); applyAccent(); render(); },
    accentSave: () => { const hex = (ui.pendingHex || "").toLowerCase(); if (!/^#[0-9a-f]{6}$/.test(hex)) return; const l = (LS.get("accentSaved", []) || []).filter((c) => String(c.hex).toLowerCase() !== hex); l.push({ hex }); LS.set("accentSaved", l.slice(-10)); LS.set("accent", { hex }); ui.pendingHex = null; applyAccent(); render(); },
    accentDel: () => { const hex = accentHex(); LS.set("accentSaved", (LS.get("accentSaved", []) || []).filter((c) => String(c.hex).toLowerCase() !== hex)); render(); },
    palToggle: (t, e) => { if (e && e.preventDefault) e.preventDefault(); ui.palOpen = !ui.palOpen; render(); },
    accentReset: () => { LS.set("accent", null); applyAccent(); render(); },
    shopShare: async () => {
      const ps = store.profiles();
      const s = store.shopping(shopDate(), ui.scope === "alle" || ps.some((p) => p.id === ui.scope) ? ui.scope : "alle");
      const lines = s.items.filter((i) => !i.checked && !i.have).map((i) => (i.shown == null ? i.name : `${i.name} ${deA(i.shown)}${i.unit ? " " + i.unit : ""}`));
      if (!lines.length) return;
      const text = lines.join("\n");
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(text); toast("Liste kopiert – in Bring! einfügen"); } catch (e) { toast("Kopieren nicht möglich in dieser Ansicht."); }
    },
    impManual: () => ACT.newRecipe(),
    impCat: (t) => { ui.sheet.im.cat = t.dataset.v; renderSheet(true); },
    impLink: () => run("impLink", async () => {
      const u = (ui.sheet.im.url || val("imp-url") || "").trim();
      let id;
      if (!ui.sheet.im.cat) { toast("Bitte Kategorie wählen: Frühstück oder Mittag / Abend."); return; }
      try { id = await store.addLinkImport(u, ui.sheet.im.cat); } catch (e) { toast("Das ist kein gültiger Link (https://…)."); return; }
      ui.sheet.im.url = "";
      toast("Link vorgemerkt – jetzt im Chat „Links importieren“ schreiben");
      renderSheet(true);
    }),
    impLinkDel: (f) => run("impLinkDel", async () => { await store.deleteImport(f.dataset.id); renderSheet(true); }),
    impLinkUse: (f) => {
      const l = store.linkImports().find((x) => x.id === f.dataset.id);
      if (!l || !l.recipe) return;
      const parsed = L.parseRecipeJson(l.recipe);
      if (!parsed.source) parsed.source = l.url;
      toEditor(parsed, JSON.stringify(l.recipe, null, 1), "Von Claude aus dem Link gelesen. Orange markierte Felder bitte prüfen.", "claude-link");
      ui.linkImportId = l.id;
    },
    impText: () => { const text = ui.sheet.im.text || val("imp-text"); if (!text.trim()) { toast("Bitte zuerst Text einfügen."); return; } toEditor(L.parseRecipeText(text), text, "Text eingefügt"); },
    impAI: () => importWithClaude(),
    closeSheet: () => closeSheet(),
    bgClose: (t, e) => { if (e.target === t) closeSheet(); },
    scope: (t) => { ui.scope = t.dataset.v; LS.set("scope", ui.scope); schedule(); },
    toggleDone: () => { ui.showDone = !ui.showDone; schedule(); },
    shopHave: (t) => run("shop:" + t.dataset.key, () => { const it = store.shopping(shopDate(), ui.scope).items.find((i) => i.key === t.dataset.key); return store.shoppingSet(shopDate(), ui.scope, t.dataset.key, { have: !it.have }); }),
    shopAmount: (t) => openSheet("shopAmount", { key: t.dataset.key }),
    shopReset: (t) => run("shop:" + t.dataset.key, async () => { await store.shoppingSet(shopDate(), ui.scope, t.dataset.key, { override: null }); closeSheet(); }),
    shopDel: (t) => run("shop", () => store.shoppingRemove(shopDate(), ui.scope, t.dataset.id)),
    hperiod: (t) => { ui.hist.period = t.dataset.v; schedule(); },
    hmonth: (t) => { const m = ui.hist.month || today().slice(0, 7); const d = L.parseISO(m + "-01"); d.setMonth(d.getMonth() + Number(t.dataset.n)); ui.hist.month = L.todayISO(d).slice(0, 7); schedule(); },
    weightEdit: (t) => openSheet("weight", { date: t.dataset.d }),
    weightDel: (t) => run("weight", async () => { await store.deleteWeight(ui.pid, t.dataset.d); closeSheet(); toast("Messung gelöscht"); }),
    foodEdit: (t) => openSheet("food", { id: t.dataset.id || null }),
    backup: async () => {
      try {
        const data = JSON.stringify({ exportiert: new Date().toISOString(), ...Object.fromEntries(["profiles", "foods", "recipes", "favorites", "days", "weights", "shopping", "settings"].map((k) => [k, store.S[k]])) }, null, 1);
        await caps.downloads.save({ filename: `foody-sicherung-${today()}.json`, data });
      } catch (e) { if (e && e.code !== "cancelled") toast("Sicherung nicht gespeichert."); }
    },
  };

  const SUBMIT = {
    profile: () => run("profile", async () => {
      const age = num("p-age");
      await store.saveProfile(ui.pid, { name: val("p-name") || "Profil", sex: val("p-sex"), birthDate: val("p-birth") || null, ageYears: age,
        heightCm: num("p-height"), pal: num("p-pal") || 1.5, goalMode: val("p-mode"), deficitKcal: num("p-deficit") ?? 0, goalKcalManual: num("p-manual"),
        targetWeightKg: num("p-target"), sportCreditPct: num("p-sport") ?? 100, likes: val("p-likes"), dislikes: val("p-dislikes") }, num("p-weight"));
      toast("Profil gespeichert");
    }),
    rates: (f) => run("rates", async () => {
      for (const el of f.querySelectorAll("[data-kind]")) {
        const v = el.value.trim() === "" ? null : Number(el.value), cur = store.sportRates(ui.pid)[el.dataset.kind];
        if ((cur ? cur.kcalPerHour : null) !== v) await store.setSportRate(ui.pid, el.dataset.kind, v, "eigener Durchschnitt");
      }
      toast("Sportwerte gespeichert");
    }),
    kind: () => run("kind", async () => { await store.addSportKind(val("kind-name")); toast("Sportart hinzugefügt"); }),
    sport: () => run("sport", async () => {
      await store.addActivity(ui.pid, ui.date, { id: ui.sheet.token, kind: val("sp-kind"), minutes: num("sp-min"), intensity: val("sp-int") || null, kcal: num("sp-kcal") });
      closeSheet(); toast("Aktivität eingetragen");
    }),
    manualMeal: () => run("am", async () => {
      const manual = { kcal: num("mm-kcal"), protein: num("mm-protein"), carbs: num("mm-carbs"), fat: num("mm-fat") };
      await store.addMeal(ui.pid, ui.date, ui.sheet.slot, { id: ui.sheet.token, title: val("mm-title"), manual, portions: num("mm-p") || 1, status: val("mm-status") });
      closeSheet(); toast("Eingetragen");
    }),
    manualEdit: (f) => run("meal:" + f.dataset.id, async () => {
      await store.updateMeal(ui.pid, ui.date, f.dataset.id, { manual: { kcal: num("me-kcal"), protein: num("me-protein"), carbs: num("me-carbs"), fat: num("me-fat") } });
      closeSheet(); toast("Werte korrigiert");
    }),
    plan: () => run("plan", async () => {
      const pid = val("pl-pid"), date = val("pl-date");
      await store.addMeal(pid, date, val("pl-slot"), { recipeId: ui.sheet.id, portions: num("pl-p") || 1, servings: num("pl-sv") || 4, status: "geplant", id: ui.sheet.token });
      closeSheet(); toast(`Eingeplant für ${relDay(date)}`);
    }),
    shopAdd: () => run("shopAdd", async () => { await store.shoppingAdd(shopDate(), ui.scope, val("shop-n"), num("shop-a"), val("shop-u")); }),
    shopAmount: (f) => run("shop:" + f.dataset.key, async () => {
      const key = f.dataset.key, v = num("sa-amount");
      if (key.startsWith("m:")) await store.shoppingSet(shopDate(), ui.scope, key, { amount: v }); else await store.shoppingSet(shopDate(), ui.scope, key, { override: v });
      closeSheet();
    }),
    weightAdd: () => run("weight", async () => { await store.upsertWeight(ui.pid, val("w-date"), num("w-kg"), val("w-note")); toast("Gewicht gespeichert"); }),
    weightEdit: (f) => run("weight", async () => { await store.upsertWeight(ui.pid, val("we-date"), num("we-kg"), val("we-note"), f.dataset.old); closeSheet(); toast("Messung geändert"); }),
    food: (f) => run("food", async () => {
      await store.saveFood({ name: val("fd-name"), aliases: val("fd-alias"), kcal: num("fd-kcal"), protein: num("fd-protein"), carbs: num("fd-carbs"), fat: num("fd-fat"), density: num("fd-density"), pieceG: num("fd-piece"), source: val("fd-source") }, f.dataset.id || null);
      closeSheet(); toast("Lebensmittel gespeichert");
    }),
  };

  // Import mit Claude (Bild-KI über die eigene Claude-Nutzung, keine kostenpflichtige API)
  async function importWithClaude() {
    const im = ui.sheet.im;
    if (!im.file || im.busy) return;
    im.busy = true; im.error = null; renderSheet(true);
    try {
      const out = await caps.sample.json(AI_PROMPT, { images: [im.file] });
      if (!out || typeof out !== "object") throw { code: "invalid_json" };
      const parsed = L.parseRecipeJson(out);
      if (out.nutrition && out.nutrition.kcal != null && !out.nutrition.basis) parsed.unsure.push("Bezug der Nährwerte unklar – als „je Portion“ angenommen");
      toEditor(parsed, JSON.stringify(out, null, 1), "Claude hat den Screenshot gelesen. Orange markierte Felder bitte prüfen.", "claude");
    } catch (e) {
      const c = e && e.code;
      im.error = c === "not_granted" || c === "sampling_disabled" ? "Claude darf in dieser Ansicht keine Bilder lesen. Nutze „Text einfügen“."
        : c === "rate_limited" ? "Gerade zu viele Anfragen – bitte gleich nochmal versuchen." : c === "image_rejected" ? "Dieses Bild konnte nicht gelesen werden. Versuche ein anderes Format (JPG/PNG)."
        : "Das hat nicht geklappt. Versuche es nochmal oder nutze „Text einfügen“.";
      if (c === "not_granted" || c === "sampling_disabled" || c === "images_unavailable") caps.sampleImages = false;
    } finally { if (ui.sheet && ui.sheet.im) { ui.sheet.im.busy = false; renderSheet(true); } }
  }

  async function toEditor(parsed, raw, info, extractor = "text") {
    const im = ui.sheet && ui.sheet.im;
    const ed = { id: null, data: fromParsed(parsed), missing: parsed.missing, unsure: parsed.unsure, raw, importInfo: info, extractor, box: { l: 0, t: 0, r: 100, b: 100 }, parsed };
    if (im && im.file) {
      ed.original = im.file;
      try {
        ed.image = await loadImage(im.file);
        const pb = parsed.photoBox;
        const box = pb && pb.r > pb.l && pb.b > pb.t ? pb : autoBox(ed.image.el);
        if (box) ed.box = { l: box.l, t: box.t, r: box.r, b: box.b };
      } catch (e) { /* ohne Bild weiter */ }
    }
    openSheet("editor", { ed });
  }

  async function saveEditor() {
    const ed = ui.sheet.ed, r = ed.data;
    if (!r.title.trim()) { toast("Bitte einen Namen eingeben."); $("#ed-title") && $("#ed-title").focus(); return; }
    if (!r.category) { toast("Bitte Kategorie wählen: Frühstück oder Mittag / Abend."); $("#ed-cat") && $("#ed-cat").focus(); return; }
    if (!ed.id && !ed.dupesShown) {
      const d = store.findDuplicates(r.title, r.ingredients.map((i) => i.name));
      if (d.length) { ed.dupes = d; ed.dupesShown = true; renderSheet(true); $(".sheet").scrollTop = 0; return; }
    }
    ed.saving = true; renderSheet(true);
    await run("saveRecipe", async () => {
      let image = undefined, importId = undefined;
      if (ed.image && caps.assets) {
        const blob = await croppedBlob(ed);
        image = (await caps.assets.upload(blob, { type: "image/jpeg" })).id;
      }
      if (ed.original || ed.raw) {
        let original = null;
        if (ed.original && caps.assets) { try { original = (await caps.assets.upload(ed.original)).id; } catch (e) { /* Original optional */ } }
        importId = await store.saveImport({ original, rawText: String(ed.raw || "").slice(0, 60000), extractor: ed.extractor || "text", parsed: ed.parsed ? { missing: ed.parsed.missing, unsure: ed.parsed.unsure } : null });
      }
      const data = { ...r, ingredients: r.ingredients.map((i) => ({ ...i })) };
      if (image !== undefined) data.image = image;
      if (importId !== undefined) data.importId = importId;
      const id = await store.saveRecipe(data, ed.id || undefined);
      if (ui.linkImportId) { try { await store.setImportStatus(ui.linkImportId, "uebernommen"); } catch (e) {} ui.linkImportId = null; }
      openSheet("recipe", { id });
      toast(ed.id ? "Rezept aktualisiert" : "Rezept gespeichert");
    });
    if (ui.sheet && ui.sheet.ed) { ui.sheet.ed.saving = false; renderSheet(true); }
  }

  // ------------------------------------------------------------------ Ereignisse
  /** Führt die Aktion eines Buttons aus (gemeinsam für Tipp und Klick). */
  function trigger(t, e) {
    const fn = ACT[t.dataset.act];
    if (!fn) return;
    // iOS nimmt einem Eingabefeld beim Tippen auf einen Button den Fokus nicht: sonst bliebe die Anzeige bis zum zweiten Tipp "eingefroren"
    const act = document.activeElement; if (act && act !== t && typing()) act.blur();
    if (t.tagName === "BUTTON" && t.type === "submit" && !t.closest("form")) e.preventDefault();
    try { const res = fn(t, e); if (res && res.catch) res.catch((err) => { console.error(err); toast("Konnte nicht ausführen: " + (err && err.message || err)); }); }
    catch (err) { console.error(err); toast("Konnte nicht ausführen: " + (err && err.message || err)); }
  }
  // Tipps werden schon beim Loslassen erkannt. Wird die Anzeige zwischen Berühren und Loslassen neu aufgebaut, verwirft der Browser
  // (vor allem iOS) das Klick-Ereignis; der Vergleich über Attribute statt über das Element hält den Tipp am Leben.
  const keyOf = (t) => ["act", "id", "key", "v", "a", "d", "n", "slot", "pid", "hex"].map((k) => t.dataset[k] ?? "").join("|");
  let down = null, tapped = null;
  document.addEventListener("pointerdown", (e) => {
    const t = e.target.closest && e.target.closest("button[data-act]");
    down = t && !t.disabled ? { key: keyOf(t), x: e.clientX, y: e.clientY, at: performance.now() } : null;
  }, true);
  document.addEventListener("pointerup", (e) => {
    const d = down; down = null;
    if (!d) return;
    const t = e.target.closest && e.target.closest("button[data-act]");
    if (!t || t.disabled || keyOf(t) !== d.key || Math.abs(e.clientX - d.x) > 12 || Math.abs(e.clientY - d.y) > 12 || performance.now() - d.at > 700) return;
    tapped = { key: d.key, at: performance.now() };
    trigger(t, e);
  }, true);
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || t.disabled) return;
    if (tapped && performance.now() - tapped.at < 800 && tapped.key === keyOf(t)) { tapped = null; return; } // schon beim Loslassen erledigt
    trigger(t, e);
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-submit]");
    if (!f) return;
    e.preventDefault();
    SUBMIT[f.dataset.submit] && SUBMIT[f.dataset.submit](f);
  });
  document.addEventListener("input", (e) => {
    const t = e.target, ed = ui.sheet && ui.sheet.ed;
    if (t.dataset.input === "libq") { ui.lib.q = t.value; clearTimeout(t._tm); t._tm = setTimeout(() => { const pos = t.selectionStart; renderMain(); const n = $("#lib-q"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); }
    if (t.dataset.input === "amq") { ui.sheet.q = t.value; clearTimeout(t._tm); t._tm = setTimeout(() => { renderSheet(true); const n = $("#am-q"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); }
    if (t.dataset.input === "impUrl") ui.sheet.im.url = t.value;
    if (t.dataset.input === "impText") ui.sheet.im.text = t.value;
    if (ed && t.dataset.bind) ed.data[t.dataset.bind] = t.value;
    if (ed && t.dataset.nut) ed.data.nutrition[t.dataset.nut] = t.value;
    if (ed && t.dataset.ing != null && t.tagName === "INPUT") ed.data.ingredients[Number(t.dataset.ing)][t.dataset.k] = t.value;
    if (ed && t.dataset.input === "crop") {
      const k = t.dataset.k, v = Number(t.value), b = ed.box;
      if (k === "l") b.l = Math.min(v, b.r - 5); if (k === "r") b.r = Math.max(v, b.l + 5); if (k === "t") b.t = Math.min(v, b.b - 5); if (k === "b") b.b = Math.max(v, b.t + 5);
      t.previousSibling && (t.parentElement.firstChild.textContent = t.parentElement.firstChild.textContent.replace(/\(\d+ %\)/, `(${Math.round(b[k])} %)`));
      drawCrop();
    }
  });
  document.addEventListener("change", async (e) => {
    const t = e.target, ed = ui.sheet && ui.sheet.ed;
    if (t.dataset.change === "libsort") { ui.lib.sort = t.value; schedule(); }
    if (ed && t.dataset.ing != null && t.tagName === "SELECT") { ed.data.ingredients[Number(t.dataset.ing)].foodId = t.value; renderSheet(true); }
    if (ed && (t.dataset.bind || t.dataset.nut) && t.tagName === "SELECT") (t.dataset.bind ? (ed.data[t.dataset.bind] = t.value) : (ed.data.nutrition[t.dataset.nut] = t.value));
    if (ed && t.dataset.ing != null && t.dataset.k === "name") renderSheet(true); // Zuordnung neu anzeigen
    if (t.dataset.change === "accentCustom") { if (/^#[0-9a-f]{6}$/i.test(t.value)) { ui.pendingHex = t.value.toLowerCase(); LS.set("accent", { hex: ui.pendingHex }); applyAccent(); render(); } return; }
    if (t.dataset.change === "shopCheck") run("shop:" + t.dataset.key, () => store.shoppingSet(shopDate(), ui.scope, t.dataset.key, t.dataset.key.startsWith("m:") ? { checked: t.checked } : { checked: t.checked }));
    if (t.dataset.change === "mealSlot") run("meal:" + t.dataset.id, async () => { await store.updateMeal(ui.pid, ui.date, t.dataset.id, { slot: t.value }); toast("Verschoben"); });
    if (t.dataset.change === "impFile" && t.files[0]) {
      const f = t.files[0];
      ui.sheet.im.file = f; ui.sheet.im.error = null;
      if (ui.sheet.im.preview) URL.revokeObjectURL(ui.sheet.im.preview);
      ui.sheet.im.preview = URL.createObjectURL(f);
      renderSheet(true);
    }
    if (ed && t.dataset.change === "edImage" && t.files[0]) {
      try { ed.image = await loadImage(t.files[0]); const b = autoBox(ed.image.el); ed.box = b || { l: 0, t: 0, r: 100, b: 100 }; } catch (err) { toast("Bild konnte nicht geladen werden."); }
      renderSheet(true);
    }
  });

  // ================================================================== Start
  async function boot() {
    ui.date = L.todayISO();
    render();
    const c = window.claude;
    const use = async (n) => { try { return c && c.use ? await c.use(n) : null; } catch (e) { return null; } };
    const [db, user, assets, sample, downloads] = await Promise.all(["db", "user", "assets", "sample", "downloads"].map(use));
    caps = { user, assets, sample, downloads };
    if (sample && sample.limits) { try { caps.sampleImages = !!(await sample.limits()).images; } catch (e) { caps.sampleImages = false; } }
    if (!db) { ui.status = "ohne-db"; render(); return; }
    if (user && user.can) { try { const can = await user.can("data.write"); if (can === false) ui.readOnly = true; } catch (e) { /* unbekannt: Eingaben anbieten */ } }
    store = X.createStore(db);
    ui.date = store.today();
    store.onChange(() => {
      const S = store.S;
      if (ui.status !== "ok" && S.ready.profiles && S.ready.recipes && S.ready.days && S.ready.foods) {
        ui.status = Object.keys(S.profiles).length ? "ok" : "leer";
        if (ui.status === "ok" && ui.view === "radar") ensureDrawn();
      } else if (ui.status === "leer" && Object.keys(S.profiles).length) ui.status = "ok";
      if (ui.status === "ok" && S.ready.health && S.ready.weights && S.ready.days) for (const pr of visibleProfiles()) if (store.hkOpen(pr.id).length) store.importHealth(pr.id).then((n) => n && toast(n + " Wert" + (n === 1 ? "" : "e") + " aus Apple Health übernommen")).catch((e) => console.error(e));
      schedule();
    });
    store.subscribe();
    // Tageswechsel, wenn die App über Mitternacht offen bleibt
    setInterval(() => { const t = store.today(); if (ui.today !== t) { if (ui.today && ui.date === ui.today) ui.date = t; ui.today = t; schedule(); } }, 60000);
    ui.today = store.today();
  }
  boot();
})();
