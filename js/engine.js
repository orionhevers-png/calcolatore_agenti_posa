const DAY = 86400000, NW = 104;
const CATS = ["Serramenti", "Alluminio", "Scuri", "Oscuranti e zanzariere", "Cassonetti e monoblocchi", "Porte e blindati", "Garage"];
const TIPI_BASE = [
  ["pvc", 0, 4, 6], ["archi", 0, 10, 12], ["alzanti ventana", 0, 7, 7], ["trapezi ventana", 0, 8, 8], ["vetri", 0, 3, 6], ["accessori / ferram. FSD", 0, 8, 12],
  ["schuco", 1, 8, 10], ["anoxidal", 1, 3, 4], ["accessori ALL.", 1, 6, 6],
  ["scuri veka", 2, 4, 6], ["scuri all", 2, 5, 5], ["scuri vitale finito", 2, 6, 6], ["accessori scuri", 2, 2, 6],
  ["avvolgibili", 3, 4, 7], ["ALPAC avvolgibili", 3, 8, 8], ["zanzariere", 3, 3, 6], ["oscurante / filtrante", 3, 4, 6], ["frangisole", 3, 7, 7],
  ["cassonetti bomber", 4, 7, 7], ["cassonetti ALPAC", 4, 4, 4], ["cassonetti legno", 4, 4, 4], ["monoblocchi", 4, 10, 10], ["falsitelai", 4, 3, 3], ["pannelli", 4, 5, 5],
  ["porte interne mag", 5, 3, 8], ["porte interne", 5, 6, 8], ["blindati Torterolo / Bauxt", 5, 5, 8], ["blindati motorizzati", 5, 9, 9],
  ["blindati Silvelox", 5, 9, 9], ["blindati speciali Silvelox", 5, 12, 12], ["porte REI", 5, 1, 12],
  ["basculante Ballan", 6, 8, 8], ["sezionale Ballan", 6, 8, 8], ["basculante Silvelox", 6, 8, 8], ["sezionale Silvelox", 6, 8, 8]
].map(([name, cat, std, fsd]) => ({ name, cat, std, fsd, early: ["monoblocchi", "cassonetti ALPAC", "falsitelai"].includes(name) }));

const LINES = [
  { key: "ril", name: "Rilievo", unit: "fori" },
  { key: "pvc", name: "Ante PVC", unit: "pz" },
  { key: "alz", name: "Alzanti PVC", unit: "pz" },
  { key: "por", name: "Portoncini", unit: "pz" },
  { key: "alu", name: "Alluminio", unit: "ore" },
  { key: "scu", name: "Reparto scuri", unit: "ore" }
];

function defaultCfg() {
  return {
    tecnici: 4, foriTecnico: 37.5, capPvc: 170, capAlz: 8, capPor: 9, capAlu: 200, capScu: 64,
    tRil: 2, tCo: 2, buffer: 2, hAnteAlu: 1, hAlzAlu: 1, hScuriPvc: 3, hScuriAlu: 4.5,
    coda: { ril: 0, pvc: 0, alz: 0, por: 0, alu: 0, scu: 0 },
    closures: [
      { from: "2026-W52", to: "2026-W52", pct: 0.5 }, { from: "2027-W01", to: "2027-W01", pct: 0 },
      { from: "2027-W32", to: "2027-W33", pct: 0 }, { from: "2027-W51", to: "2027-W51", pct: 0.5 },
      { from: "2028-W01", to: "2028-W01", pct: 0 }, { from: "2028-W32", to: "2028-W33", pct: 0 }
    ],
    tipi: {}
  };
}
function mergeCfg(d) {
  const b = defaultCfg();
  if (!d) return b;
  const o = Object.assign({}, b, d);
  o.coda = Object.assign({}, b.coda, d.coda || {});
  o.closures = Array.isArray(d.closures) ? d.closures : b.closures;
  o.tipi = d.tipi || {};
  return o;
}
function tipiOf(cfg) {
  return TIPI_BASE.map(t => {
    const ov = (cfg.tipi || {})[t.name] || {};
    return { name: t.name, cat: t.cat, std: ov.std ?? t.std, fsd: ov.fsd ?? t.fsd, early: ov.early ?? t.early };
  });
}

function mondayOfLabel(lbl) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(lbl || "").trim());
  if (!m) return null;
  const y = +m[1], w = +m[2];
  if (w < 1 || w > 53) return null;
  const jan4 = Date.UTC(y, 0, 4), dow = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - dow * DAY + (w - 1) * 7 * DAY;
}
function labelOfMs(ms) {
  const th = ms + 3 * DAY, y = new Date(th).getUTCFullYear();
  const w = Math.floor((th - Date.UTC(y, 0, 1)) / (7 * DAY)) + 1;
  return y + "-W" + String(w).padStart(2, "0");
}
function mondayOfDate(ms) { return ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY; }
const r6 = x => Math.round(x * 1e6) / 1e6;

function buildCalendar(cfg, todayMs) {
  const start = mondayOfDate(todayMs) - 7 * DAY;
  const cal = [null];
  for (let i = 1; i <= NW; i++) {
    const ms = start + (i - 1) * 7 * DAY;
    cal.push({ idx: i, ms, label: labelOfMs(ms), pct: 1, nextOpen: null });
  }
  const idxOf = lbl => { const m = mondayOfLabel(lbl); return m == null ? null : Math.round((m - start) / (7 * DAY)) + 1; };
  for (const c of cfg.closures || []) {
    const f = idxOf(c.from); if (f == null) continue;
    const t = c.to ? (idxOf(c.to) ?? f) : f;
    const p = Math.max(0, Math.min(1, Number(c.pct) || 0));
    for (let w = Math.max(1, f); w <= Math.min(NW, t); w++) cal[w].pct = Math.min(cal[w].pct, p);
  }
  for (let w = NW; w >= 1; w--) cal[w].nextOpen = cal[w].pct > 0 ? w : (w < NW ? cal[w + 1].nextOpen : null);
  return { start, cal, cur: Math.round((mondayOfDate(todayMs) - start) / (7 * DAY)) + 1, idxOf };
}

function baseOf(c) {
  return { ril: c.tecnici * c.foriTecnico, pvc: c.capPvc, alz: c.capAlz, por: c.capPor, alu: c.capAlu, scu: c.capScu };
}
// opts.occ      = [{r:'ril', s:'2026-W45', c:12}]  carico già occupato da altre offerte (anonimo)
// opts.versions = [{from:'2026-W40', cfg}]          capacità valide da una certa settimana
function plan(commesse, cfg, todayMs, opts) {
  opts = opts || {};
  const C = buildCalendar(cfg, todayMs), cal = C.cal, cur = C.cur;
  const base = baseOf(cfg);
  const vers = (opts.versions || []).slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const baseAt = w => {
    if (!vers.length) return base;
    let v = vers[0].cfg;
    for (const x of vers) if (x.from <= cal[w].label) v = x.cfg;
    return baseOf(v);
  };
  const cap = {}, load = {};
  for (const L of LINES) { cap[L.key] = [0]; load[L.key] = [0]; }
  for (let w = 1; w <= NW; w++) {
    const b = baseAt(w);
    for (const L of LINES) { cap[L.key].push(b[L.key] * cal[w].pct); load[L.key].push(0); }
  }
  for (const o of opts.occ || []) {
    const i = C.idxOf(o.s);
    if (i != null && i >= 1 && i <= NW && load[o.r]) load[o.r][i] = r6(load[o.r][i] + Number(o.c));
  }
  const tipi = tipiOf(cfg), tmap = Object.fromEntries(tipi.map(t => [t.name, t]));
  function alloc(key, need, ready) {
    const parts = [];
    if (need <= 0) return { first: null, last: null, fit: true, parts };
    let rem = need, first = null, last = null;
    for (let w = Math.max(1, ready); w <= NW && rem > 0.001; w++) {
      const free = cap[key][w] - load[key][w];
      if (free <= 1e-9) continue;
      const take = r6(Math.max(0, Math.min(rem, free)));
      if (take <= 0) continue;
      load[key][w] = r6(load[key][w] + take); rem = r6(rem - take);
      parts.push([cal[w].label, take]);
      if (first == null) first = w; last = w;
    }
    return { first, last, fit: rem <= 0.001, parts };
  }
  const res = [];
  for (const c of commesse) {
    const r = { id: c.id, nome: c.nome, warnings: [], ok: false };
    const avvioIdx = c.avvio ? C.idxOf(c.avvio) : null, reqIdx = c.posaRich ? C.idxOf(c.posaRich) : null;
    if (c.avvio && avvioIdx == null) r.warnings.push("Settimana di avvio non valida.");
    if (c.posaRich && reqIdx == null) r.warnings.push("Posa richiesta non valida.");
    const s = avvioIdx != null ? Math.max(1, avvioIdx) : cur;
    const req = reqIdx != null ? Math.max(1, reqIdx) : null;
    let early = 0, main = 0, nSel = 0;
    for (const [name, v] of Object.entries(c.tipi || {})) {
      const t = tmap[name]; if (!t || (v !== "std" && v !== "fsd")) continue;
      nSel++; const lead = Number(v === "std" ? t.std : t.fsd) || 0;
      if (t.early) early = Math.max(early, lead); else main = Math.max(main, lead);
    }
    const fori = +c.fori || 0;
    const need = {
      pvc: +c.antePvc || 0, alz: +c.alzPvc || 0, por: +c.port || 0,
      alu: (+c.anteAlu || 0) * cfg.hAnteAlu + (+c.alzAlu || 0) * cfg.hAlzAlu + (+c.oreExtra || 0),
      scu: (+c.scuriPvc || 0) * cfg.hScuriPvc + (+c.scuriAlu || 0) * cfg.hScuriAlu
    };
    if (fori === 0) r.warnings.push("Inserire n° fori.");
    if (nSel + need.pvc + need.alz + need.por + need.alu === 0) r.warnings.push("Selezionare tipologie / quantità.");
    const E = s + early, G = Math.max(E, cur + 1 + cfg.coda.ril); // il rilievo parte dalla settimana successiva all'inserimento
    const ril = fori > 0 ? alloc("ril", fori, G) : { first: G, last: G, fit: true, parts: [] };
    const codaRil = fori > 0 && ril.first != null ? Math.max(0, ril.first - Math.max(E, cur + 1)) : 0;
    if (codaRil > 0) r.warnings.push(`Coda rilievo +${codaRil} sett.`);
    let dur = 1;
    for (const k of ["pvc", "alz", "por", "alu", "scu"]) if (need[k] > 0 && base[k] > 0) dur = Math.max(dur, Math.ceil(need[k] / base[k]));
    const AQ = req != null ? req - cfg.buffer - dur + 1 : 0;
    const L = (ril.last ?? G) + cfg.tRil;
    const M = Math.max(L + cfg.tCo, AQ - main), N = M + main;
    const firsts = [], lasts = []; let fit = ril.fit;
    const foot = { ril: ril.parts };
    for (const k of ["pvc", "alz", "por", "alu", "scu"]) {
      if (need[k] <= 0) continue;
      const a = alloc(k, need[k], Math.max(N, cur + cfg.coda[k]));
      fit = fit && a.fit; foot[k] = a.parts;
      if (a.first != null) { firsts.push(a.first); lasts.push(a.last); }
    }
    const pFirst = firsts.length ? Math.min(...firsts) : N, pLast = Math.max(N, ...lasts);
    const codaProd = Math.max(0, pFirst - N);
    if (codaProd > 0) r.warnings.push(`Produzione in coda / satura +${codaProd} sett.`);
    const AI = pLast + cfg.buffer;
    const posa = fit && AI <= NW ? cal[AI].nextOpen : null;
    if (!fit || posa == null) r.warnings.push("Oltre l'orizzonte del calendario.");
    const late = req != null && posa != null ? posa - req : null;
    if (late != null && late > 0) r.warnings.push(`Posa oltre la data richiesta +${late} sett.`);
    Object.assign(r, { s, early, main, E, rilFirst: ril.first ?? G, rilLast: ril.last ?? G, codaRil, L, M, N, pFirst, pLast, codaProd, AI, posa, req, late, fit, need, fori, dur, foot });
    r.ok = fit && posa != null;
    r.stock = r.ok ? posa - pLast - cfg.buffer : 0;
    res.push(r);
  }
  return { C, cal, cur, res, cap, load, base, cfg };
}

// ---- congelamento: l'offerta confermata viene salvata con settimane in formato etichetta (2026-W45),
// così non si sposta quando passa il tempo né quando cambiano le altre offerte.
const plur = (n, a, b) => n + " " + (n === 1 ? a : b);
function humanWarn(w) {
  let m;
  if ((m = /Coda rilievo \+(\d+)/.exec(w))) return `Il rilievo parte ${plur(+m[1], "settimana", "settimane")} più tardi perché i tecnici sono già impegnati con altre offerte.`;
  if ((m = /Produzione in coda \/ satura \+(\d+)/.exec(w))) return `La produzione parte ${plur(+m[1], "settimana", "settimane")} più tardi perché i reparti sono già pieni.`;
  if ((m = /Posa oltre la data richiesta \+(\d+)/.exec(w))) return `La posa slitta di ${plur(+m[1], "settimana", "settimane")} rispetto alla data richiesta dal cliente.`;
  if (/orizzonte/.test(w)) return "Non c'è abbastanza disponibilità nei prossimi due anni per calcolare la posa.";
  if (/Inserire n° fori/.test(w)) return "Indica il numero di fori.";
  if (/Selezionare tipologie/.test(w)) return "Seleziona almeno una tipologia o una quantità.";
  if (/non valida/.test(w)) return "La settimana indicata non è valida.";
  return w;
}
const IDX_FIELDS = ["s", "E", "rilFirst", "rilLast", "L", "M", "N", "pFirst", "pLast", "AI", "posa", "req"];
function labelOfIdx(C, i) { return labelOfMs(C.start + (i - 1) * 7 * DAY); }
function freeze(r, C) {
  const o = {};
  for (const k of Object.keys(r)) {
    if (k === "nome" || k === "id") continue;
    o[k] = IDX_FIELDS.includes(k) ? (r[k] == null ? null : labelOfIdx(C, r[k])) : r[k];
  }
  return o;
}
function thaw(p, C) {
  const o = {};
  for (const k of Object.keys(p)) o[k] = IDX_FIELDS.includes(k) ? (p[k] == null ? null : C.idxOf(p[k])) : p[k];
  return o;
}
function phaseAt(r, w, cfg) {
  if (!r.ok) return "";
  if (w === r.posa) return "P";
  if (w >= r.pFirst && w <= r.pLast) return "L";
  if (w >= r.N && w < r.pFirst) return "Q";
  if (w > r.pLast && w < r.posa) return "S";
  if (w > r.M && w < r.N) return "A";
  if ((w > r.rilLast && w <= r.L) || (w > r.M - cfg.tCo && w <= r.M)) return "O";
  if (w >= r.rilFirst && w <= r.rilLast) return "R";
  if (r.early > 0 && w >= r.s && w < r.rilFirst) return "E";
  return "";
}
const Engine = { humanWarn, plan, freeze, thaw, defaultCfg, mergeCfg, tipiOf, phaseAt, buildCalendar, labelOfMs, mondayOfLabel, mondayOfDate, labelOfIdx, baseOf, TIPI_BASE, LINES, CATS, NW, DAY };
if (typeof module !== "undefined") module.exports = Engine;
if (typeof window !== "undefined") window.Engine = Engine;
