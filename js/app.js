/* Pianificatore Posa — interfaccia agenti e gestore */
(function () {
  const E = window.Engine, Api = window.Api;
  const $app = document.getElementById("app");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const S = {
    me: null, versions: [], offerte: [], occ: { versione: 0, righe: [] }, profili: [],
    tab: "cruscotto", showDone: false, agentF: "", loginErr: "", busy: false, drawer: null,
    piano: [], prForm: { off: "", comm: "", ril: "", oid: null, form: null }, open: {}, pin: {},
    fl: { q: "", ag: "", stato: "", rilDa: "", rilA: "", posaDa: "", posaA: "", comp: "", conf: "", ord: "rilievo" }, gq: "", gord: "posa"
  };
  window.S = S;

  /* ---------- utilità ---------- */
  function toast(msg, bad) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.className = "on" + (bad ? " bad" : "");
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ""), bad ? 6000 : 3500);
  }
  const fmtDay = iso => {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" }) + " · sett. " + E.labelOfMs(E.mondayOfDate(d.getTime()));
  };
  const info = t => `<button type="button" class="info" data-info="${esc(t)}" aria-label="Spiegazione" aria-expanded="false">i</button>`;
  document.addEventListener("click", e => {
    const b = e.target.closest(".info"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const host = b.closest("h3,.field,.stat,.legend,.sub"); if (!host) return;
    const head = host.matches("h3");
    let box = head ? (host.nextElementSibling && host.nextElementSibling.classList.contains("infobox") ? host.nextElementSibling : null) : host.querySelector(":scope > .infobox");
    if (box) { box.remove(); b.setAttribute("aria-expanded", "false"); return; }
    box = document.createElement("div"); box.className = "infobox"; box.textContent = b.dataset.info;
    if (head) host.insertAdjacentElement("afterend", box); else host.appendChild(box);
    b.setAttribute("aria-expanded", "true");
  });
  const num = x => (Math.round(x * 10) / 10).toString().replace(".", ",");
  const wl = i => (i == null ? "—" : E.labelOfIdx(S.C, i));
  const PH = { R: "Rilievo", E: "Rilievo anticipato", O: "Ordine materiali", A: "Attesa materiali", Q: "In coda di produzione", L: "In produzione", S: "Pronto, in attesa di posa", P: "Posa questa settimana" };
  const GL = { R: "Rilievo", E: "Rilievo anticipato", O: "Ordine materiali", A: "Attesa materiali", Q: "Coda produzione", L: "Produzione", S: "Cuscinetto", P: "Posa" };

  function compute() {
    const vers = S.versions.length ? S.versions : [{ valida_da: "2000-W01", cfg: E.defaultCfg() }];
    S.vlist = vers.map(v => ({ from: v.valida_da, cfg: E.mergeCfg(v.cfg) }));
    S.cfg = S.vlist[S.vlist.length - 1].cfg;
    S.today = Date.now();
    S.P = E.plan([], S.cfg, S.today, { occ: S.occ.righe, versions: S.vlist });
    S.C = S.P.C; S.cur = S.P.cur;
    S.rows = S.offerte.map(o => ({ ...o, r: E.thaw(o.piano, S.C) })).sort((a, b) => a.seq - b.seq);
    S.sosp = Math.max(1, Number(S.cfg.giorniSospesa) || 15);
    S.realOcc = realOccOf(S.piano);
    S.PR = E.plan([], S.cfg, S.today, { occ: S.realOcc, versions: S.vlist });   // carico del piano reale (separato dalle offerte)
  }
  function realOccOf(list) {
    const m = {};
    for (const p of list) for (const [k, arr] of Object.entries((p.piano && p.piano.foot) || {})) for (const [w, c] of arr) { const key = k + "|" + w; m[key] = (m[key] || 0) + Number(c); }
    return Object.entries(m).map(([key, c]) => { const [r, w] = key.split("|"); return { r, s: w, c }; });
  }
  const giorniDa = iso => Math.floor((Date.now() - new Date(iso).getTime()) / DAYMS);
  const DAYMS = 86400000;
  // sospesa = senza numero di commessa da almeno N giorni (default 15)
  const isSospesa = row => !row.commessa && giorniDa(row.creata_il) >= S.sosp;
  const isActive = row => !isSospesa(row) && (row.r.posa == null || row.r.posa >= S.cur);
  function phaseNow(row) {
    const r = row.r;
    if (!r.ok) return "Da verificare";
    if (r.posa < S.cur) return "Conclusa";
    const p = E.phaseAt(r, S.cur, S.cfg);
    return PH[p] || (S.cur < r.s ? "In programma" : "In lavorazione");
  }
  function commessaOf(input, cliente) {
    return {
      id: "x", nome: cliente, fori: input.fori, antePvc: input.antePvc, alzPvc: input.alzPvc, port: input.port,
      anteAlu: input.anteAlu, alzAlu: input.alzAlu,
      scuriPvc: input.scuriPvc || 0, scuriAlu: input.scuriAlu != null ? input.scuriAlu : (input.scuri || 0), tipi: input.tipi, posaRich: input.posaRich || undefined
    };
  }
  function occMinus(righe, foot) {
    const m = {};
    for (const x of righe) m[x.r + "|" + x.s] = (m[x.r + "|" + x.s] || 0) + Number(x.c);
    for (const [k, arr] of Object.entries(foot || {})) for (const [s, c] of arr) { const key = k + "|" + s; if (m[key] != null) m[key] -= c; }
    return Object.entries(m).filter(([, c]) => c > 1e-9).map(([key, c]) => { const [r, s] = key.split("|"); return { r, s, c }; });
  }
  const sumSerr = i => (+i.antePvc || 0) + (+i.alzPvc || 0) + (+i.port || 0) + (+i.anteAlu || 0) + (+i.alzAlu || 0);

  /* ---------- caricamento dati ---------- */
  async function refresh(silent) {
    try {
      const d = await Api.fetchAll(S.me);
      S.versions = d.versions; S.offerte = d.offerte; S.occ = d.occ; S.profili = d.profili; S.piano = d.piano || [];
      compute();
      if (!silent) render();
      else if (!S.drawer && !document.activeElement.closest(".settings")) render();
    } catch (e) { if (!silent) toast("Impossibile aggiornare i dati: " + e.message, true); }
  }
  async function busy(fn) {
    S.busy = true; document.body.insertAdjacentHTML("beforeend", '<div class="busy" id="busy"><div class="spin"></div></div>');
    try { return await fn(); } finally { S.busy = false; const b = document.getElementById("busy"); if (b) b.remove(); }
  }

  /* ---------- accesso ---------- */
  function renderLogin() {
    const demo = Api.mode === "demo";
    const miss = window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL && demo;
    $app.innerHTML = `<div class="login"><form class="card" id="lf">
      <img src="assets/logo-longato.png" alt="Longato">
      <h1>Stima tempi di posa</h1><p class="s">Accedi con il tuo account</p>
      ${S.loginErr ? `<div class="errbox">${esc(S.loginErr)}</div>` : ""}
      ${miss ? `<div class="errbox">Libreria di collegamento non caricata: controlla la connessione e ricarica la pagina.</div>` : ""}
      <label class="field"><span>Email</span><input class="inp" id="lem" type="email" autocomplete="username" required ${demo ? 'placeholder="es. rossi@demo"' : ""}></label>
      <label class="field"><span>Password</span><input class="inp" id="lpw" type="password" autocomplete="current-password" ${demo ? "" : "required"}></label>
      <button class="btn pri" style="width:100%;justify-content:center;padding:11px">Accedi</button>
      ${demo ? `<div class="demo"><b>Modalità demo</b> — i dati restano solo in questo browser. Entra come:
        <div class="row">${Api.demoUsers().map(u => `<button type="button" class="btn sm" data-demo="${esc(u.email)}">${esc(u.nome)}</button>`).join("")}</div></div>` : ""}
    </form></div>`;
    const go = async (email, pw) => {
      try { S.loginErr = ""; S.me = await busy(() => Api.login(email, pw)); await start(); }
      catch (e) { S.loginErr = e.message; renderLogin(); }
    };
    document.getElementById("lf").onsubmit = ev => { ev.preventDefault(); go(document.getElementById("lem").value, document.getElementById("lpw").value); };
    $app.querySelectorAll("[data-demo]").forEach(b => (b.onclick = () => go(b.dataset.demo, "")));
  }

  async function seedDemo() {
    if (Api.mode !== "demo" || !Api.empty()) return;
    const seeds = [
      ["rossi@demo", "2026-118", "Condominio Aurora", { fori: 27, antePvc: 25, alzPvc: 1, port: 1, anteAlu: 0, alzAlu: 0, tipi: { pvc: "std", vetri: "std", avvolgibili: "std", zanzariere: "std" }, posaRich: "" }],
      ["rossi@demo", "2026-131", "Villa Brenta", { fori: 12, antePvc: 0, alzPvc: 0, port: 0, anteAlu: 10, alzAlu: 2, scuriAlu: 6, tipi: { schuco: "fsd", anoxidal: "std", "scuri all": "std" }, posaRich: "" }],
      ["bianchi@demo", "2026-122", "Ristrutturazione Zanon", { fori: 120, antePvc: 100, alzPvc: 8, port: 4, anteAlu: 6, alzAlu: 2, tipi: { pvc: "fsd", vetri: "fsd", "alzanti ventana": "std" }, posaRich: "" }],
      ["bianchi@demo", "2026-140", "Casa Moretti", { fori: 18, antePvc: 14, alzPvc: 2, port: 2, anteAlu: 0, alzAlu: 0, tipi: { pvc: "std", monoblocchi: "std", "porte interne": "std" }, posaRich: "" }, 20]
    ];
    const cur = S.me;
    for (const [em, numero, cliente, input, giorni] of seeds) {
      await Api.login(em);
      const d = await Api.fetchAll({ id: (await Api.init()).id, ruolo: "agente" });
      const pl = E.plan([commessaOf(input, cliente)], S.cfg, Date.now(), { occ: d.occ.righe, versions: S.vlist });
      await Api.salva({ numero, cliente, input, piano: E.freeze(pl.res[0], pl.C), versione: d.occ.versione, creata_il: giorni ? new Date(Date.now() - giorni * 86400000).toISOString() : undefined });
    }
    await Api.login(cur.email);
  }

  async function start() {
    await refresh(true);
    if (Api.mode === "demo" && Api.empty()) { await seedDemo(); await refresh(true); }
    S.tab = S.me.ruolo === "gestore" ? "panoramica" : "cruscotto";
    render();
    clearInterval(start.t); start.t = setInterval(() => { if (!document.hidden && S.me) refresh(true); }, 60000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.me && !S.drawer) refresh(true); });

  /* ---------- struttura comune ---------- */
  const TABS_A = [["cruscotto", "Cruscotto"], ["calendario", "Calendario slot liberi"]];
  // gestore: tre sezioni. DEFINITIVO (protagonista), STIME AGENTI (consultazione), IMPOSTAZIONI.
  const TABS_DEF = [["panoramica", "Panoramica"], ["reale", "Commesse"], ["elenco", "Tutte le commesse"], ["gantt_r", "Gantt"], ["carico_r", "Carico"]];
  const TABS_PROV = [["p_riep", "Riepilogo stime"], ["offerte", "Offerte degli agenti"], ["gantt", "Gantt stime"], ["carico", "Carico stime"]];
  const TABS_SET = [["impostazioni", "Impostazioni"], ["utenti", "Utenti"]];
  const SECS = [["def", "Piano definitivo", TABS_DEF], ["prov", "Stime agenti", TABS_PROV], ["set", "Impostazioni", TABS_SET]];
  const secOf = tab => (TABS_PROV.some(t => t[0] === tab) ? "prov" : TABS_SET.some(t => t[0] === tab) ? "set" : "def");
  const lastTab = { def: "panoramica", prov: "p_riep", set: "impostazioni" };

  function shell(inner) {
    const g = S.me.ruolo === "gestore", sec = g ? secOf(S.tab) : "", tabs = g ? SECS.find(x => x[0] === sec)[2] : TABS_A;
    return `${Api.mode === "demo" ? `<div class="demobar">Modalità demo — dati salvati solo in questo browser. <a href="#" id="dreset" style="color:inherit">Azzera demo</a></div>` : ""}
    <div class="top"><div class="in">
      <div class="bar"><img src="assets/logo-longato.png" alt="Longato">
        <div class="tt">Stima tempi di posa<small>Serramenti PVC · Alluminio</small></div>
        <div class="sp"></div>
        <span class="wk">Settimana ${wl(S.cur)}</span>
        ${g ? `<button class="btn" id="xls">Scarica Excel</button>` : ""}
        <div class="who"><b>${esc(S.me.nome)}</b><span>${g ? "Gestore" : "Agente"}</span></div>
        <button class="btn" id="logout">Esci</button></div>
      ${g ? `<div class="secs" role="tablist" aria-label="Sezione">${SECS.map(([k, l]) => `<button role="tab" data-sec="${k}" class="s-${k}" aria-selected="${sec === k}">${l}</button>`).join("")}</div>` : ""}
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join("")}</div>
    </div></div>
    ${g ? (sec === "def"
      ? `<div class="indic"><b>Piano definitivo.</b> Qui assegni il rilievo e decidi le date che contano. Gli agenti non le vedono.</div>`
      : sec === "prov" ? `<div class="indic"><b>Stime degli agenti.</b> Sono solo indicative e servono per consultazione: le date che contano sono nel Piano definitivo.</div>` : "")
      : `<div class="indic"><b>Stima indicativa.</b> La settimana mostrata serve solo per orientarsi con il cliente. Non è una data confermata: la programmazione definitiva la fa l'ufficio produzione.</div>`}
    <main class="shell">${inner}</main>`;
  }

  function render() {
    if (!S.me) return renderLogin();
    const g = S.me.ruolo === "gestore";
    const views = g
      ? { panoramica: vDefPanoramica, reale: vReale, elenco: vElenco, gantt_r: () => vGantt(true), carico_r: () => vCarico(true), p_riep: vPanoramica, offerte: vOfferte, gantt: () => vGantt(false), carico: () => vCarico(false), impostazioni: vImpostazioni, utenti: vUtenti }
      : { cruscotto: vCruscotto, gantt: vGantt, calendario: vCalendario };
    const keepScroll = window.scrollY;
    if (g && !views[S.tab]) S.tab = "panoramica";
    document.documentElement.dataset.sec = g ? secOf(S.tab) : "";
    $app.innerHTML = shell((views[S.tab] || Object.values(views)[0])());
    window.scrollTo(0, keepScroll);
    bind();
  }

  function doGoto(e, b) { e.preventDefault(); S.tab = b.dataset.goto; if (b.dataset.open) { S.open[b.dataset.open] = true; S.pin[b.dataset.open] = true; } lastTab[secOf(S.tab)] = S.tab; render(); window.scrollTo(0, 0); }
  function bind() {
    $app.querySelectorAll("[data-tab]").forEach(b => (b.onclick = () => { S.tab = b.dataset.tab; if (S.me.ruolo === "gestore") lastTab[secOf(S.tab)] = S.tab; render(); window.scrollTo(0, 0); }));
    $app.querySelectorAll("[data-sec]").forEach(b => (b.onclick = () => { S.tab = lastTab[b.dataset.sec]; render(); window.scrollTo(0, 0); }));
    $app.querySelectorAll("[data-goto]").forEach(b => (b.onclick = e => doGoto(e, b)));
    const lo = document.getElementById("logout");
    if (lo) lo.onclick = async () => { await Api.logout(); S.me = null; S.offerte = []; document.documentElement.dataset.sec = ""; clearInterval(start.t); renderLogin(); };
    const dr = document.getElementById("dreset"); if (dr) dr.onclick = e => { e.preventDefault(); if (confirm("Azzerare i dati demo?")) Api.reset(); };
    $app.querySelectorAll("[data-new]").forEach(b => (b.onclick = () => openForm(null)));
    $app.querySelectorAll("[data-edit]").forEach(b => (b.onclick = () => openForm(S.rows.find(r => r.id === b.dataset.edit))));
    $app.querySelectorAll("[data-del]").forEach(b => (b.onclick = () => delOfferta(b.dataset.del)));
    $app.querySelectorAll("[data-repro]").forEach(b => (b.onclick = () => openForm(S.rows.find(r => r.id === b.dataset.repro), { repro: true })));
    const sd = document.getElementById("showdone"); if (sd) sd.onchange = () => { S.showDone = sd.checked; render(); };
    const af = document.getElementById("agentf"); if (af) af.onchange = () => { S.agentF = af.value; render(); };
    const xl = document.getElementById("xls"); if (xl) xl.onclick = () => busy(async () => { try { await window.exportExcel(S); toast("Excel scaricato."); } catch (e) { toast("Errore nell'export: " + e.message, true); } });
    if (S.tab === "impostazioni" && S.me.ruolo === "gestore") bindSettings();
    if (S.tab === "reale" && S.me.ruolo === "gestore") bindReale();
    if (S.tab === "elenco" && S.me.ruolo === "gestore") bindElenco();
    if (S.tab === "gantt_r" && S.me.ruolo === "gestore") bindGanttR();
    if (S.tab === "utenti") bindUtenti();
  }

  async function delOfferta(id) {
    const row = S.rows.find(r => r.id === id); if (!row) return;
    if (!confirm(`Eliminare l'offerta ${row.numero} – ${row.cliente}?\nLo slot occupato verrà liberato.`)) return;
    await busy(async () => { try { await Api.elimina(id); await refresh(true); toast("Offerta eliminata: slot liberato."); } catch (e) { toast(e.message, true); } });
    render();
  }

  /* ---------- blocchi comuni ---------- */
  function avvisiOf(row) {
    const out = [];
    if (row.commessa) return out;
    if (!row.r.ok) out.push({ t: E.humanWarn("orizzonte"), bad: true });
    for (const w of row.r.warnings) if (!/orizzonte/.test(w)) out.push({ t: E.humanWarn(w), bad: /oltre la data richiesta/.test(w) });
    return out;
  }
  function offertaCard(row, canEdit) {
    const r = row.r, av = avvisiOf(row), done = !isActive(row), conf = !!row.commessa;
    return `<article class="oc ${done ? "done" : ""}">
      <div class="h"><div class="t"><b>Offerta ${esc(row.numero)} · ${esc(row.cliente)}</b>
        <span>Inserita il ${esc(fmtDay(row.creata_il))} · ${r.fori} fori</span></div>
        ${conf ? `<div class="p"><span class="badge ok">Confermata</span><div class="posa" style="font-size:18px">Commessa ${esc(row.commessa)}</div></div>`
          : `<div class="p"><small>Settimana indicativa di posa</small><div class="posa">${r.ok ? wl(r.posa) : "—"}</div>
        ${r.req != null ? `<small>Richiesta dal cliente: ${wl(r.req)}</small>` : ""}</div>`}</div>
      ${av.length ? `<div class="warns">${av.map(a => `<div>⚠ ${esc(a.t)}</div>`).join("")}</div>` : ""}
      ${canEdit && !conf ? `<div class="a"><div class="sp"></div><button class="btn sm" data-edit="${row.id}">Modifica</button><button class="btn sm danger" data-del="${row.id}">Elimina</button></div>` : ""}
    </article>`;
  }
  function sospesaCard(row) {
    return `<article class="oc sosp">
      <div class="h"><div class="t"><b>Offerta ${esc(row.numero)} · ${esc(row.cliente)}</b>
        <span>Inserita il ${esc(fmtDay(row.creata_il))} · ${giorniDa(row.creata_il)} giorni fa · ${row.r.fori} fori</span></div>
        <div class="p"><span class="badge warn">Sospesa</span></div></div>
      <div class="a"><div class="sp"></div><button class="btn sm pri" data-repro="${row.id}">Riprogramma</button><button class="btn sm danger" data-del="${row.id}">Elimina</button></div>
    </article>`;
  }

  /* ---------- AGENTE: cruscotto ---------- */
  function vCruscotto() {
    const all = S.rows, act = all.filter(isActive), conAv = act.filter(r => avvisiOf(r).length), sosp = all.filter(isSospesa);
    const show = S.showDone ? all.filter(r => !isSospesa(r)) : act;
    const alerts = act.flatMap(r => avvisiOf(r).map(a => ({ r, a })));
    return `<div class="pagehead"><h2>Ciao ${esc(S.me.nome.split(" ")[0])}</h2><div class="sp"></div>
        <button class="btn pri" data-new>+ Nuova offerta</button></div>
      <div class="stats">
        <div class="stat"><div class="l">Offerte attive ${info("Offerte inserite la cui settimana indicativa di posa non è ancora passata.")}</div><div class="v num">${act.length}</div></div>
        <div class="stat ${conAv.length ? "warn" : "good"}"><div class="l">Con avvisi ${info("Offerte con una segnalazione, ad esempio un ritardo. Il dettaglio è nel riquadro a destra.")}</div><div class="v num">${conAv.length}</div></div>
        <div class="stat ${sosp.length ? "warn" : ""}"><div class="l">Sospese ${info("Offerte senza numero di commessa dopo " + S.sosp + " giorni. Occupano ancora il loro posto: cancellale per liberarlo oppure riprogrammale.")}</div><div class="v num">${sosp.length}</div></div>
      </div>
      <div class="cols"><div>
        <div class="toolbar"><h3 style="margin:0">Le tue offerte</h3><div style="flex:1"></div>
          <label class="chk"><input type="checkbox" id="showdone" ${S.showDone ? "checked" : ""}> Mostra anche offerte con settimana già passata</label></div>
        ${show.length ? `<div class="cards">${show.slice().reverse().map(r => offertaCard(r, true)).join("")}</div>`
          : `<div class="panel empty"><b>Nessuna offerta attiva</b>Premi «Nuova offerta» per inserirne una.</div>`}
        <div class="panel sospp" style="margin-top:20px"><h3>Offerte sospese ${info("Offerte che non sono diventate ordine entro " + S.sosp + " giorni. Il loro posto nel calendario è ancora occupato. «Elimina» lo libera; «Riprogramma» le rimette in corso come se le inserissi oggi, senza perdere i dati.")}</h3>
          ${sosp.length ? `<p class="sub">Queste offerte non risultano ancora confermate. Eliminale per liberare il posto oppure riprogrammale.</p><div class="cards">${sosp.slice().reverse().map(sospesaCard).join("")}</div>`
            : `<div class="empty" style="padding:14px"><b>Nessuna offerta sospesa</b></div>`}</div>
      </div><aside><div class="panel"><h3>I tuoi avvisi</h3>
        ${alerts.length ? alerts.map(({ r, a }) => `<div class="alert ${a.bad ? "bad" : ""}"><i></i><div><b>Offerta ${esc(r.numero)} · ${esc(r.cliente)}</b><span>${esc(a.t)}</span></div></div>`).join("")
          : `<div class="empty" style="padding:18px"><b>Tutto regolare</b>Nessun avviso sulle tue offerte.</div>`}
        </div></aside></div>`;
  }

  /* ---------- Gantt ---------- */
  function ganttRows(real) {
    const g = S.me.ruolo === "gestore";
    let rows = real
      ? S.piano.map(p => ({ numero: p.commessa, off: p.offerta_num || "", cliente: p.cliente || "", agente_nome: p.agente_nome || "", agente_id: null, rilievo: p.rilievo, r: E.thaw(p.piano, S.C) })).filter(r => r.r.ok && r.r.posa >= S.cur)
      : S.rows.filter(r => r.r.ok && isActive(r));
    if (g && !real && S.agentF) rows = rows.filter(r => r.agente_id === S.agentF);
    if (real) rows.sort((a, b) => {
      const ka = S.gord === "rilievo" ? [a.rilievo, a.r.posa] : S.gord === "commessa" ? [String(a.numero).toLowerCase(), 0] : [a.r.posa, a.rilievo];
      const kb = S.gord === "rilievo" ? [b.rilievo, b.r.posa] : S.gord === "commessa" ? [String(b.numero).toLowerCase(), 0] : [b.r.posa, b.rilievo];
      return ka[0] < kb[0] ? -1 : ka[0] > kb[0] ? 1 : ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
    });
    return rows;
  }
  function ganttTable(rows, all, real) {
    const g = S.me.ruolo === "gestore";
    const last = Math.min(E.NW, Math.max(S.cur + 26, ...all.map(r => r.r.posa + 2)));
    const ws = []; for (let w = Math.max(1, S.cur - 1); w <= last; w++) ws.push(w);
    const head = ws.map(w => `<th class="wh ${w === S.cur ? "cur" : ""}">${S.P.cal[w].label}</th>`).join("");
    const body = rows.map(r => `<tr><td class="sl" title="${esc(r.cliente)}">${esc(r.numero)} · ${esc(r.cliente)}${g ? `<br><span class="muted small">${esc(r.agente_nome)}</span>` : ""}</td>
      <td class="sl2">${wl(r.r.posa)}</td>${ws.map(w => { const p = E.phaseAt(r.r, w, S.cfg); return `<td class="c ${p ? "ph-" + p : ""} ${w === S.cur ? "cur" : ""}">${p}</td>`; }).join("")}</tr>`).join("");
    return rows.length ? `<div class="gwrap"><table class="g"><thead><tr><th class="sl">${real ? "Commessa" : "Offerta"}</th><th class="sl2">Posa</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : `<div class="panel empty"><b>${all.length ? "Nessuna commessa trovata" : "Nessuna offerta da mostrare"}</b>${all.length ? "Controlla il testo cercato." : "Le offerte attive compariranno qui."}</div>`;
  }
  function ganttFiltered(rows) {
    const q = S.gq.trim().toLowerCase();
    return q ? rows.filter(r => `${r.numero} ${r.off || ""} ${r.cliente} ${r.agente_nome}`.toLowerCase().includes(q)) : rows;
  }
  function vGantt(real) {
    const g = S.me.ruolo === "gestore", all = ganttRows(real);
    const tools = real ? `<input class="inp" id="gq" value="${esc(S.gq)}" placeholder="Cerca commessa o cliente…" autocomplete="off" style="width:220px">
      <select class="inp" id="gord" style="width:auto" aria-label="Ordine">${[["posa", "Ordine: posa"], ["rilievo", "Ordine: rilievo"], ["commessa", "Ordine: n° commessa"]].map(([v, l]) => `<option value="${v}" ${S.gord === v ? "selected" : ""}>${l}</option>`).join("")}</select>` : "";
    return `<div class="pagehead"><h2>Gantt${real ? " — piano definitivo" : g ? " — stime di tutti gli agenti" : " — le tue offerte"}</h2><div class="sp"></div>
      ${g && !real ? agentSelect() : ""}${tools}</div>
      <div id="g-res">${ganttTable(real ? ganttFiltered(all) : all, all, real)}</div>
      ${all.length ? `<div class="legend">${info("Ogni riga è " + (real ? "una commessa" : "un'offerta") + " e ogni colonna una settimana. I colori mostrano cosa succede in ciascuna settimana, dal rilievo fino alla posa (P). La settimana corrente è evidenziata." + (real ? " Le commesse sono in ordine di data di posa: puoi cambiare l'ordine o cercarne una." : ""))}${Object.entries(GL).map(([k, l]) => `<span><i class="ph-${k}"></i>${k} · ${l}</span>`).join("")}</div>` : ""}`;
  }
  function bindGanttR() {
    const draw = () => { const all = ganttRows(true); document.getElementById("g-res").innerHTML = ganttTable(ganttFiltered(all), all, true); };
    document.getElementById("gq").oninput = e => { S.gq = e.target.value; draw(); };
    document.getElementById("gord").onchange = e => { S.gord = e.target.value; draw(); };
  }
  function agentSelect() {
    const ag = S.profili.filter(p => p.ruolo === "agente");
    return `<select class="inp" id="agentf" style="width:auto"><option value="">Tutti gli agenti</option>${ag.map(a => `<option value="${a.id}" ${S.agentF === a.id ? "selected" : ""}>${esc(a.nome)}</option>`).join("")}</select>`;
  }

  /* ---------- AGENTE: calendario slot liberi ---------- */
  function vCalendario() {
    const L = E.LINES, P = S.P, wks = []; for (let w = S.cur; w <= Math.min(E.NW, S.cur + 51); w++) wks.push(w);
    const cells = wks.map(w => {
      const cal = P.cal[w];
      return `<div class="wk ${w === S.cur ? "cur" : ""}">${cal.label}${w === S.cur ? " ·oggi" : ""}</div>` + L.map(l => {
        const cp = P.cap[l.key][w], ld = P.load[l.key][w];
        if (cp <= 0) return `<div class="cl">chiuso</div>`;
        const fr = Math.max(0, (cp - ld) / cp), used = 1 - fr, c = fr >= .6 ? "g" : fr >= .25 ? "m" : "b";
        return `<div><span class="free ${c}">${fr <= 0.001 ? "Pieno" : Math.round(fr * 100) + "% libero"}</span><div class="meter"><i class="${used >= .95 ? "full" : used >= .75 ? "hi" : ""}" style="width:${Math.min(100, used * 100).toFixed(0)}%"></i></div></div>`;
      }).join("");
    }).join("");
    return `<div class="pagehead"><h2>Calendario slot liberi</h2></div>
      <p class="sub">${info("Verde: c'è molto spazio, puoi promettere la data. Giallo: spazio ridotto. Rosso o «Pieno»: quella settimana è già occupata da altre offerte.")} Quanta capacità è ancora libera in ogni settimana, tenuto conto di tutte le offerte già inserite da tutti gli agenti. Più la barra è piena, più il periodo è occupato: una nuova offerta verrà spostata alla prima settimana con spazio.</p>
      <div class="panel scroll" style="padding:0"><div class="cg"><div class="h">Settimana</div>${L.map(l => `<div class="h">${l.name}</div>`).join("")}${cells}</div></div>
      <div class="legend"><span><b class="free" style="color:var(--good)">Verde</b> molto spazio</span><span><b style="color:var(--warn)">Giallo</b> spazio ridotto</span><span><b style="color:var(--bad)">Rosso</b> quasi pieno</span><span>chiuso = ferie / chiusura</span></div>`;
  }

  /* ---------- GESTORE: panoramica ---------- */
  function sovraccarichi(P) {
    const out = []; P = P || S.P;
    for (const l of E.LINES) for (let w = S.cur; w <= E.NW; w++) {
      const ex = P.load[l.key][w] - P.cap[l.key][w];
      if (ex > 0.01) out.push({ l, w, ex });
    }
    return out;
  }
  function meters(P) {
    P = P || S.P;
    return E.LINES.map(l => {
      let c = 0, u = 0;
      for (let w = S.cur; w < S.cur + 8; w++) { c += P.cap[l.key][w]; u += P.load[l.key][w]; }
      const p = c > 0 ? u / c : 0;
      return `<div class="line"><div class="nm">${l.name}</div><div class="meter"><i class="${p >= .95 ? "full" : p >= .75 ? "hi" : ""}" style="width:${Math.min(100, p * 100).toFixed(0)}%"></i></div><div class="nf"><b>${Math.round(p * 100)}%</b> prossime 8 sett.</div></div>`;
    }).join("");
  }
  function vPanoramica() {
    const act = S.rows.filter(isActive), av = act.filter(r => avvisiOf(r).length);
    const sov = sovraccarichi();
    const ag = S.profili.filter(p => p.ruolo === "agente");
    const agRows = ag.map(a => {
      const mine = act.filter(r => r.agente_id === a.id), nx = mine.filter(r => r.r.ok).sort((x, y) => x.r.posa - y.r.posa)[0];
      return `<tr><td>${esc(a.nome)}${a.attivo ? "" : ' <span class="badge warn">disattivo</span>'}</td><td class="num">${mine.length}</td><td class="num">${mine.reduce((s, r) => s + r.r.fori, 0)}</td><td>${mine.filter(r => avvisiOf(r).length).length ? `<span class="badge warn">${mine.filter(r => avvisiOf(r).length).length}</span>` : '<span class="badge ok">0</span>'}</td></tr>`;
    }).join("");
    return `<div class="pagehead"><h2>Stime degli agenti — riepilogo</h2></div>
      <div class="stats">
        <div class="stat"><div class="l">Offerte attive</div><div class="v num">${act.length}</div></div>
        <div class="stat"><div class="l">Fori in lavorazione</div><div class="v num">${act.reduce((s, r) => s + r.r.fori, 0)}</div></div>
        <div class="stat ${av.length ? "warn" : "good"}"><div class="l">Offerte con avvisi</div><div class="v num">${av.length}</div></div>
        <div class="stat"><div class="l">Offerte sospese ${info("Offerte senza numero di commessa da oltre " + S.sosp + " giorni. Occupano ancora il posto: decide l'agente se cancellarle o riprogrammarle.")}</div><div class="v num">${S.rows.filter(isSospesa).length}</div></div>
        <div class="stat ${sov.length ? "bad" : "good"}"><div class="l">Settimane sovraccariche ${info("Settimane in cui il lavoro già assegnato supera la capacità, ad esempio dopo una riduzione di capacità. Le offerte confermate non si spostano da sole.")}</div><div class="v num">${new Set(sov.map(s => s.w)).size}</div></div>
      </div>
      <div class="cols"><div>
        <div class="panel"><h3>Saturazione delle linee</h3><div class="lines">${meters()}</div></div>
        <div class="panel"><h3>Agenti</h3><div class="scroll"><table class="t"><thead><tr><th>Agente</th><th>Offerte attive</th><th>Fori</th><th>Avvisi</th></tr></thead><tbody>${agRows || `<tr><td colspan="4" class="muted">Nessun agente.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><h3>Avvisi su tutte le offerte</h3>
          ${av.length ? av.map(r => avvisiOf(r).map(a => `<div class="alert ${a.bad ? "bad" : ""}"><i></i><div><b>${esc(r.agente_nome)} · Offerta ${esc(r.numero)} · ${esc(r.cliente)}</b><span>${esc(a.t)}</span></div></div>`).join("")).join("")
            : `<div class="empty" style="padding:18px"><b>Nessun avviso</b></div>`}</div>
      </div><aside>
        <div class="panel"><h3>Sovraccarichi</h3><p class="sub">Settimane in cui il carico supera la capacità (ad es. dopo una riduzione di capacità).</p>
          ${sov.length ? sov.slice(0, 12).map(s => `<div class="alert bad"><i></i><div><b>${S.P.cal[s.w].label} · ${s.l.name}</b><span>+${num(s.ex)} ${s.l.unit} oltre la capacità</span></div></div>`).join("") : `<div class="empty" style="padding:18px"><b>Nessuno</b></div>`}</div>
      </aside></div>`;
  }

  /* ---------- GESTORE: tutte le offerte ---------- */
  function vOfferte() {
    let rows = S.rows;
    if (S.agentF) rows = rows.filter(r => r.agente_id === S.agentF);
    if (!S.showDone) rows = rows.filter(r => isActive(r) || isSospesa(r));
    const stato = r => r.commessa ? `<span class="badge ok" title="Commessa ${esc(r.commessa)}">Confermata · ${esc(r.commessa)}</span>` : isSospesa(r) ? `<span class="badge warn">Sospesa</span>` : `<span class="badge info">In attesa</span>`;
    return `<div class="pagehead"><h2>Tutte le offerte</h2><div class="sp"></div>${agentSelect()}
      <label class="chk"><input type="checkbox" id="showdone" ${S.showDone ? "checked" : ""}> Mostra concluse</label></div>
      <div class="panel scroll" style="padding:0">${rows.length ? `<table class="t"><thead><tr><th>Agente</th><th>N° offerta</th><th>Cliente</th><th>Inserita</th><th>Fori</th><th>Richiesta</th><th>Posa indicativa</th><th>Stato</th><th>Avvisi</th><th></th></tr></thead><tbody>
      ${rows.slice().reverse().map(r => { const av = avvisiOf(r); return `<tr><td>${esc(r.agente_nome)}</td><td>${esc(r.numero)}</td><td>${esc(r.cliente)}</td><td class="num small">${esc(fmtDay(r.creata_il))}</td><td class="num">${r.r.fori}</td>
        <td class="num">${r.r.req != null ? wl(r.r.req) : "—"}</td><td class="posa">${r.r.ok ? wl(r.r.posa) : "—"}</td><td>${stato(r)}</td>
        <td>${av.length ? `<span class="badge ${av.some(a => a.bad) ? "bad" : "warn"}" title="${esc(av.map(a => a.t).join(" · "))}">${av.length}</span>` : '<span class="badge ok">ok</span>'}</td>
        <td><button class="btn sm danger" data-del="${r.id}">Elimina</button></td></tr>`; }).join("")}</tbody></table>`
        : `<div class="empty"><b>Nessuna offerta</b></div>`}</div>`;
  }

  /* ---------- GESTORE: piano definitivo ---------- */
  const WKRE = /^\d{4}-W\d{2}$/;
  const wkOk = v => WKRE.test(v) && E.mondayOfLabel(v) != null;
  const sortReale = list => list.slice().sort((a, b) => (a.rilievo < b.rilievo ? -1 : a.rilievo > b.rilievo ? 1 : a.seq - b.seq));
  function realCommessa(p) { const c = commessaOf(p.input, p.cliente); c.rilievo = p.rilievo; c.fix = p.manuali || {}; c.posaRich = p.posa_rich || undefined; return c; }
  function calcReale(p, occ) {
    const pl = E.plan([realCommessa(p)], S.cfg, Date.now(), { occ, versions: S.vlist });
    return E.freeze(pl.res[0], pl.C);
  }
  const diffSett = (a, b) => (a && b ? Math.round((E.mondayOfLabel(a) - E.mondayOfLabel(b)) / (7 * E.DAY)) : null);
  function offertaPerNumero(v) {
    v = String(v || "").trim().toLowerCase(); if (!v) return { list: [] };
    return { list: S.offerte.filter(o => String(o.numero).trim().toLowerCase() === v) };
  }
  // composizione e tipologie (standard / fuori standard) in forma leggibile
  const COMP = [["antePvc", "ante PVC"], ["alzPvc", "alzanti PVC"], ["port", "portoncini"], ["anteAlu", "ante alluminio"], ["alzAlu", "alzanti alluminio"], ["scuriPvc", "scuri PVC"], ["scuriAlu", "scuri alluminio"]];
  function chipsComp(i) {
    const c = COMP.filter(([k]) => +i[k] > 0).map(([k, l]) => `<span class="chip"><b>${i[k]}</b> ${l}</span>`);
    if (!c.length && +i.scuri > 0) c.push(`<span class="chip"><b>${i.scuri}</b> scuri</span>`);
    return `<span class="chip fori"><b>${i.fori}</b> fori</span>` + c.join("");
  }
  function chipsTipi(i) {
    const sel = E.tipiOf(S.cfg).filter(t => (i.tipi || {})[t.name]);
    if (!sel.length) return `<span class="muted small">nessuna tipologia</span>`;
    return E.CATS.map((cat, ci) => {
      const rows = sel.filter(t => t.cat === ci); if (!rows.length) return "";
      return `<div class="tcat"><span class="tc">${cat}</span>${rows.map(t => { const v = i.tipi[t.name]; return `<span class="chip ${v}">${esc(t.name)} · ${v === "fsd" ? "fuori std" : "standard"}</span>`; }).join("")}</div>`;
    }).join("");
  }
  const nFsd = i => Object.values(i.tipi || {}).filter(v => v === "fsd").length;
  // ---- modulo composizione condiviso (collegamento e finestra di modifica)
  function formOf(inp, posaRich) {
    return { fori: inp.fori || "", antePvc: inp.antePvc || "", alzPvc: inp.alzPvc || "", port: inp.port || "", anteAlu: inp.anteAlu || "", alzAlu: inp.alzAlu || "", scuriPvc: inp.scuriPvc || "", scuriAlu: inp.scuriAlu || inp.scuri || "", tipi: Object.assign({}, inp.tipi || {}), posaRich: posaRich || "" };
  }
  function compFormHtml(form) {
    const tipi = E.tipiOf(S.cfg), weeks = []; for (let w = Math.max(1, S.cur); w <= Math.min(E.NW, S.cur + 90); w++) weeks.push(S.P.cal[w].label);
    if (form.posaRich && !weeks.includes(form.posaRich)) weeks.unshift(form.posaRich);
    const nf = (k, l) => `<label class="field"><span>${l}</span><input class="inp" type="number" inputmode="numeric" min="0" step="1" data-n="${k}" value="${esc(form[k])}" placeholder="0"></label>`;
    return `<h3>Fori e serramenti</h3>
      <div class="fgrid"><label class="field req"><span>Numero fori</span><input class="inp" type="number" inputmode="numeric" min="0" step="1" data-n="fori" value="${esc(form.fori)}" placeholder="0"></label></div>
      <div class="fgrid">${nf("antePvc", "Ante PVC")}${nf("alzPvc", "Alzanti PVC")}${nf("port", "Portoncini")}${nf("anteAlu", "Ante alluminio")}${nf("alzAlu", "Alzanti alluminio")}${nf("scuriPvc", "Scuri PVC")}${nf("scuriAlu", "Scuri alluminio")}</div>
      <div class="sumbox" data-sum></div>
      <h3>Tipologie ordinate</h3>
      ${E.CATS.map((cat, ci) => `<div class="cat"><h4>${cat}</h4>${tipi.filter(t => t.cat === ci).map(t => `<div class="trow"><div class="n">${esc(t.name)}</div>
        <div class="seg" data-t="${esc(t.name)}"><button type="button" data-v="" aria-pressed="false">—</button><button type="button" data-v="std" aria-pressed="false">Standard</button><button type="button" class="fsd" data-v="fsd" aria-pressed="false">Fuori std</button></div></div>`).join("")}</div>`).join("")}
      <h3>Posa desiderata dal cliente (facoltativa) ${info("Se c'è una data precisa, gli acquisti e la produzione si programmano a ritroso per rispettarla. Altrimenti la posa è la prima possibile.")}</h3>
      <label class="field"><span>Settimana</span><select class="inp" data-req><option value="">Prima possibile</option>${weeks.map(w => `<option value="${w}" ${w === form.posaRich ? "selected" : ""}>${w}</option>`).join("")}</select></label>`;
  }
  function bindCompForm(root, form, onChange) {
    const syncSeg = () => root.querySelectorAll(".seg").forEach(sg => { const v = form.tipi[sg.dataset.t] || ""; sg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v))); });
    root.querySelectorAll(".seg button").forEach(b => (b.onclick = () => { const t = b.parentElement.dataset.t; if (b.dataset.v) form.tipi[t] = b.dataset.v; else delete form.tipi[t]; syncSeg(); onChange(); }));
    root.querySelectorAll("[data-n]").forEach(i => (i.oninput = () => { form[i.dataset.n] = i.value; onChange(); }));
    root.querySelector("[data-req]").onchange = e => { form.posaRich = e.target.value; onChange(); };
    syncSeg();
  }
  function inputFromForm(base, form) {
    const n = k => Math.max(0, Math.floor(Number(form[k]) || 0));
    return { ...base, fori: n("fori"), antePvc: n("antePvc"), alzPvc: n("alzPvc"), port: n("port"), anteAlu: n("anteAlu"), alzAlu: n("alzAlu"), scuriPvc: n("scuriPvc"), scuriAlu: n("scuriAlu"), tipi: { ...form.tipi } };
  }
  function checkForm(i) {
    const tot = sumSerr(i), errs = [];
    if (!(i.fori > 0)) errs.push("Indicare il numero di fori");
    else if (tot !== i.fori) errs.push(`I serramenti indicati (${tot}) devono essere esattamente ${i.fori}, come i fori`);
    if (!Object.keys(i.tipi).length) errs.push("Selezionare almeno una tipologia");
    return { i, tot, errs };
  }
  function sumFill(root, v) {
    const diff = v.tot - v.i.fori, el = root.querySelector("[data-sum]");
    el.className = "sumbox " + (v.i.fori > 0 && diff === 0 ? "ok" : v.i.fori > 0 && v.tot > 0 ? "bad" : "");
    el.innerHTML = `Serramenti totali <b class="num">${v.tot}</b> · Fori <b class="num">${v.i.fori}</b> ${v.i.fori > 0 && diff === 0 ? "✓ coincidono" : v.i.fori > 0 || v.tot > 0 ? `— ${diff > 0 ? "sovrabbondano " + diff : "mancano " + (-diff)}` : ""}`;
  }
  function lookupHtml() {
    const v = S.prForm.off.trim();
    if (!v) { S.prForm.oid = null; return `<p class="sub" style="margin:8px 0 0">Scrivi il numero dell'offerta: cliente, agente, composizione e tipologie si ricompongono da soli e le puoi correggere subito.</p>`; }
    const { list } = offertaPerNumero(v);
    if (!list.length) { S.prForm.oid = null; return `<div class="errbox" style="margin:10px 0 0">Nessuna offerta con il numero «${esc(v)}».</div>`; }
    if (list.length > 1) { S.prForm.oid = null; return `<div class="errbox" style="margin:10px 0 0">Ci sono ${list.length} offerte con questo numero (agenti diversi). Chiedi di correggere il numero.</div>`; }
    const o = list[0], dup = S.piano.find(x => x.offerta_id === o.id);
    const head = `<div class="sumbox ${dup ? "bad" : "ok"}" style="display:block;margin:10px 0 0"><b>${esc(o.cliente)}</b> · agente ${esc(o.agente_nome)} · inserita il ${esc(fmtDay(o.creata_il))}<br>
      <span class="small">Posa indicata dall'agente: <b>${o.piano.posa || "—"}</b>${o.input.posaRich ? ` · richiesta dal cliente: <b>${esc(o.input.posaRich)}</b>` : ""}${dup ? ` · <b>già presente nel piano (commessa ${esc(dup.commessa)})</b>` : ""}</span></div>`;
    if (dup) return head;
    if (S.prForm.oid !== o.id) { S.prForm.oid = o.id; S.prForm.form = formOf(o.input, o.input.posaRich); }
    return head + `<div class="cform" id="pr-cform"><p class="sub" style="margin:10px 0 0">Composizione ricostruita dall'offerta: correggila qui se serve (vale solo per il piano definitivo).</p>${compFormHtml(S.prForm.form)}<div id="pr-res"></div></div>`;
  }

  // ---- panoramica definitiva
  function vDefPanoramica() {
    const rows = sortReale(S.piano), PR = S.PR, sov = sovraccarichi(PR), curL = S.P.cal[S.cur].label;
    const act = rows.filter(p => !p.piano.posa || p.piano.posa >= curL), verif = act.filter(p => !p.approvata);
    const late = act.filter(p => (diffSett(p.piano.posa, p.posa_agente) || 0) > 0).length;
    const attesa = S.rows.filter(r => !r.commessa && !isSospesa(r) && isActive(r)).length, sosp = S.rows.filter(isSospesa).length;
    return `<div class="pagehead"><h2>Situazione del piano definitivo</h2></div>
      <div class="stats">
        <div class="stat"><div class="l">Commesse in programma</div><div class="v num">${act.length}</div></div>
        <div class="stat ${verif.length ? "warn" : "good"}"><div class="l">Da verificare ${info("Commesse con le date calcolate dal sistema che non hai ancora approvato con «OK».")}</div><div class="v num">${verif.length}</div></div>
        <div class="stat"><div class="l">Fori in programma</div><div class="v num">${act.reduce((t, p) => t + (+p.input.fori || 0), 0)}</div></div>
        <div class="stat ${late ? "warn" : "good"}"><div class="l">Posa dopo la stima agente ${info("Commesse la cui posa definitiva è più avanti della settimana indicata dall'agente.")}</div><div class="v num">${late}</div></div>
        <div class="stat ${sov.length ? "bad" : "good"}"><div class="l">Settimane sovraccariche ${info("Settimane del piano definitivo in cui il lavoro assegnato supera la capacità, ad esempio dopo una riduzione di capacità.")}</div><div class="v num">${new Set(sov.map(x => x.w)).size}</div></div>
      </div>
      <div class="cols"><div>
        <div class="panel"><h3>Saturazione dei reparti</h3><div class="lines">${meters(PR)}</div></div>
      </div><aside>
        <div class="panel"><h3>Da verificare</h3>
          ${verif.length ? verif.slice(0, 10).map(p => `<div class="alert"><i></i><div><b>${esc(p.commessa)} · ${esc(p.cliente || "")}</b><span>Posa ${p.piano.posa || "—"} · <a href="#" data-goto="reale" data-open="${p.id}">apri</a></span></div></div>`).join("") : `<div class="empty" style="padding:18px"><b>Tutto approvato</b></div>`}</div>
        <div class="panel"><h3>Sovraccarichi</h3>
          ${sov.length ? sov.slice(0, 10).map(x => `<div class="alert bad"><i></i><div><b>${PR.cal[x.w].label} · ${x.l.name}</b><span>+${num(x.ex)} ${x.l.unit} oltre la capacità</span></div></div>`).join("") : `<div class="empty" style="padding:18px"><b>Nessuno</b></div>`}</div>
        <div class="panel"><h3>Offerte in attesa</h3><p class="sub" style="margin:0 0 8px">Offerte degli agenti senza commessa: <b>${attesa}</b> in corso, <b>${sosp}</b> sospese.</p>
          <button class="btn sm" data-goto="reale">Collega una commessa</button> <button class="btn sm" data-goto="offerte">Vedi le stime</button></div>
      </aside></div>`;
  }

  // ---- tutte le commesse confermate, con filtri combinabili
  const prDay = p => Date.now() - new Date(p.creata_il).getTime();
  function elencoRows() {
    const f = S.fl, q = f.q.trim().toLowerCase();
    let rows = S.piano.filter(p => {
      if (q && !`${p.commessa} ${p.offerta_num || ""} ${p.cliente || ""} ${p.agente_nome || ""}`.toLowerCase().includes(q)) return false;
      if (f.ag && p.agente_nome !== f.ag) return false;
      if (f.stato === "ok" && !p.approvata) return false;
      if (f.stato === "bozza" && p.approvata) return false;
      if (f.rilDa && p.rilievo < f.rilDa) return false;
      if (f.rilA && p.rilievo > f.rilA) return false;
      const po = p.piano.posa || "";
      if (f.posaDa && (!po || po < f.posaDa)) return false;
      if (f.posaA && (!po || po > f.posaA)) return false;
      if (f.comp === "std" && nFsd(p.input) > 0) return false;
      if (f.comp === "fsd" && nFsd(p.input) === 0) return false;
      const d = diffSett(p.piano.posa, p.posa_agente);
      if (f.conf === "ritardo" && !(d > 0)) return false;
      if (f.conf === "ok" && !(d != null && d <= 0)) return false;
      return true;
    });
    const key = { rilievo: p => p.rilievo + "|" + String(p.seq).padStart(6, "0"), posa: p => (p.piano.posa || "9999") + "|" + p.rilievo, commessa: p => String(p.commessa).toLowerCase() }[f.ord];
    return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  function elencoRes() {
    const rows = elencoRows(), tot = S.piano.length;
    if (!rows.length) return `<div class="panel empty"><b>${tot ? "Nessuna commessa con questi filtri" : "Nessuna commessa nel piano definitivo"}</b>${tot ? "Cambia o azzera i filtri." : ""}</div>`;
    return `<p class="sub" style="margin:0 0 8px"><b>${rows.length}</b> di ${tot} commesse · ${rows.reduce((t, p) => t + (+p.input.fori || 0), 0)} fori</p>
      <div class="panel scroll" style="padding:0"><table class="t rt"><thead><tr><th>Commessa</th><th>Cliente</th><th>Agente</th><th>Fori</th><th>Rilievo</th><th>Conferma ordine</th><th>Acquisti</th><th>Produzione</th><th>Posa definitiva</th><th>Posa agente</th><th>Differenza</th><th>Stato</th><th></th></tr></thead><tbody>
      ${rows.map(p => {
        const pi = p.piano, d = diffSett(pi.posa, p.posa_agente), fsd = nFsd(p.input);
        const dif = d == null ? "—" : d === 0 ? `<span class="badge ok">uguale</span>` : d > 0 ? `<span class="badge bad">+${d} sett.</span>` : `<span class="badge ok">${d} sett.</span>`;
        const man = k => ((p.manuali || {})[k] ? ' class="man"' : "");
        const prod = pi.pFirst != null ? (pi.pLast && pi.pLast !== pi.pFirst ? `${pi.pFirst} → ${pi.pLast}` : pi.pFirst) : pi.N;
        return `<tr class="${p.approvata ? "" : "bozza"}"><td><b>${esc(p.commessa)}</b><br><span class="muted small">offerta ${esc(p.offerta_num || "")}</span></td>
          <td>${esc(p.cliente || "")}<br><span class="muted small">${fsd ? fsd + " fuori std" : "tutto standard"}</span></td><td>${esc(p.agente_nome || "")}</td><td class="num">${p.input.fori}</td>
          <td class="num">${esc(p.rilievo)}</td><td class="num"${man("L")}>${pi.L || "—"}</td><td class="num"${man("M")}>${pi.M || "—"}</td><td class="num"${man("N")}>${esc(prod || "—")}</td>
          <td class="num posa"${man("posa")}>${pi.posa || "—"}</td><td class="num">${p.posa_agente || "—"}</td><td>${dif}</td>
          <td>${p.approvata ? `<span class="badge ok">OK</span>` : `<span class="badge warn">Da verificare</span>`}</td>
          <td><button class="btn sm" data-goto="reale" data-open="${p.id}">Apri</button></td></tr>`;
      }).join("")}</tbody></table></div>`;
  }
  function vElenco() {
    const f = S.fl, all = S.piano;
    const uniq = fn => [...new Set(all.map(fn).filter(Boolean))].sort();
    const opt = (list, cur, blank) => `<option value="">${blank}</option>` + list.map(x => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("");
    const ril = uniq(p => p.rilievo), pos = uniq(p => p.piano.posa), ags = uniq(p => p.agente_nome);
    const sel = (k, o) => `<select class="inp" data-fl="${k}">${o}</select>`;
    const so = (cur, arr) => arr.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
    return `<div class="pagehead"><h2>Tutte le commesse confermate</h2></div>
      <p class="sub">${info("Tutte le commesse del piano definitivo con le loro date. I filtri si possono combinare: ad esempio un agente, con posa tra due settimane e solo quelle con fuori standard. Per modificare una commessa premi «Apri».")} Rilievo, conferma ordine, acquisti, produzione e posa di ogni commessa. Combina i filtri per restringere l'elenco.</p>
      <div class="panel filt"><div class="addrow">
        <label class="field"><span>Cerca</span><input class="inp" data-fl="q" value="${esc(f.q)}" placeholder="commessa, offerta, cliente…" autocomplete="off"></label>
        <label class="field"><span>Agente</span>${sel("ag", opt(ags, f.ag, "Tutti"))}</label>
        <label class="field"><span>Stato</span>${sel("stato", so(f.stato, [["", "Tutti"], ["ok", "Con OK"], ["bozza", "Da verificare"]]))}</label>
        <label class="field"><span>Rilievo da</span>${sel("rilDa", opt(ril, f.rilDa, "—"))}</label>
        <label class="field"><span>Rilievo a</span>${sel("rilA", opt(ril, f.rilA, "—"))}</label>
        <label class="field"><span>Posa da</span>${sel("posaDa", opt(pos, f.posaDa, "—"))}</label>
        <label class="field"><span>Posa a</span>${sel("posaA", opt(pos, f.posaA, "—"))}</label>
        <label class="field"><span>Composizione</span>${sel("comp", so(f.comp, [["", "Tutte"], ["std", "Solo standard"], ["fsd", "Con fuori standard"]]))}</label>
        <label class="field"><span>Rispetto alla stima agente</span>${sel("conf", so(f.conf, [["", "Tutte"], ["ritardo", "Posa dopo la stima"], ["ok", "Entro la stima"]]))}</label>
        <label class="field"><span>Ordina per</span>${sel("ord", so(f.ord, [["rilievo", "Settimana di rilievo"], ["posa", "Posa definitiva"], ["commessa", "N° commessa"]]))}</label>
        <button class="btn" id="fl-reset" style="align-self:end;margin-bottom:14px">Azzera filtri</button>
      </div></div>
      <div id="el-res">${elencoRes()}</div>
      <div class="legend"><span><i class="man-i"></i>Data modificata a mano</span><span><i class="bz-i"></i>Da verificare</span></div>`;
  }
  function bindElenco() {
    const res = document.getElementById("el-res");
    const draw = () => { res.innerHTML = elencoRes(); res.querySelectorAll("[data-goto]").forEach(b => (b.onclick = e => doGoto(e, b))); };
    document.querySelectorAll("[data-fl]").forEach(i => { const ev = i.tagName === "INPUT" ? "oninput" : "onchange"; i[ev] = () => { S.fl[i.dataset.fl] = i.value; draw(); }; });
    document.getElementById("fl-reset").onclick = () => { S.fl = { q: "", ag: "", stato: "", rilDa: "", rilA: "", posaDa: "", posaA: "", comp: "", conf: "", ord: "rilievo" }; render(); };
    draw();
  }

  // ---- conferma con pulsante rosso
  function askConfirm({ title, body, ok }) {
    return new Promise(res => {
      const host = document.createElement("div");
      host.innerHTML = `<div class="scrim" data-x></div><div class="modal" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="mb">${body}</div>
        <div class="btns"><button class="btn" data-x type="button" id="cf-no">Annulla</button><button class="btn dangerfill" type="button" id="cf-ok">${esc(ok)}</button></div></div>`;
      document.body.appendChild(host);
      const done = v => { document.removeEventListener("keydown", key); host.remove(); res(v); };
      const key = e => { if (e.key === "Escape") done(false); };
      document.addEventListener("keydown", key);
      host.querySelectorAll("[data-x]").forEach(b => (b.onclick = () => done(false)));
      host.querySelector("#cf-ok").onclick = () => done(true);
      host.querySelector("#cf-no").focus();
    });
  }

  // ---- elenco commesse
  function vReale() {
    const rows = sortReale(S.piano).filter(p => prDay(p) <= 7 * E.DAY || S.pin[p.id]), PR = S.PR, sov = sovraccarichi(PR);
    const wk = []; for (let w = Math.max(1, S.cur); w <= Math.min(E.NW, S.cur + 60); w++) wk.push(S.P.cal[w].label);
    const defRil = S.prForm.ril && wk.includes(S.prForm.ril) ? S.prForm.ril : S.P.cal[Math.min(E.NW, S.cur + 1)].label;
    const late = S.piano.filter(p => (diffSett(p.piano.posa, p.posa_agente) || 0) > 0).length, verif = S.piano.filter(p => !p.approvata).length;
    const waiting = S.offerte.filter(o => !o.commessa && !S.piano.some(x => x.offerta_id === o.id)).sort((a, b) => a.seq - b.seq);
    const cell = (p, key, val) => {
      const man = key !== "rilievo" && (p.manuali || {})[key];
      return `<td class="${man ? "man" : ""}"><input class="inp wkc" data-pr="${p.id}" data-f="${key}" value="${esc(val || "")}" ${man ? 'title="Modificata a mano. Svuota il campo per tornare al calcolo automatico."' : ""} placeholder="${key === "rilievo" ? "" : "auto"}"></td>`;
    };
    const body = rows.map(p => {
      const pi = p.piano, d = diffSett(pi.posa, p.posa_agente), av = (pi.warnings || []).map(E.humanWarn), op = !!S.open[p.id];
      const dif = d == null ? "—" : d === 0 ? `<span class="badge ok">uguale</span>` : d > 0 ? `<span class="badge bad">+${d} sett.</span>` : `<span class="badge ok">${d} sett.</span>`;
      const fsd = nFsd(p.input);
      const main = `<tr class="${p.approvata ? "" : "bozza"}"><td class="nw"><button class="btn sm ghost" data-pr-open="${p.id}" aria-expanded="${op}" title="Composizione, tipologie e note">${op ? "▾" : "▸"}</button> ${p.approvata ? `<span class="badge ok">OK</span>` : `<span class="badge warn">Da verificare</span>`}</td>
        <td><b>${esc(p.commessa)}</b><br><span class="muted small">offerta ${esc(p.offerta_num || "")}</span></td>
        <td class="cl">${esc(p.cliente || "")}<br><span class="muted small">${esc(p.agente_nome || "")} · ${p.input.fori} fori · ${fsd ? fsd + " fuori std" : "tutto standard"}</span></td>
        <td class="num">${p.posa_agente || "—"}</td>${cell(p, "rilievo", p.rilievo)}${cell(p, "L", pi.L)}${cell(p, "M", pi.M)}${cell(p, "N", pi.pFirst != null ? pi.pFirst : pi.N)}
        ${cell(p, "posa", pi.posa)}<td>${dif}</td>
        <td class="nw">${av.length ? `<span class="badge warn" title="${esc(av.join(" · "))}">${av.length} avv.</span> ` : ""}${p.approvata ? "" : `<button class="btn sm pri" data-pr-ok="${p.id}">Dai l'OK</button>`}</td></tr>`;
      const det = op ? `<tr class="det"><td colspan="11"><div class="detbox">
          <div><h4>Composizione</h4><div class="chips">${chipsComp(p.input)}</div>${p.posa_rich ? `<p class="small muted" style="margin:8px 0 0">Posa richiesta dal cliente: <b>${esc(p.posa_rich)}</b></p>` : ""}</div>
          <div><h4>Tipologie</h4><div class="tipi">${chipsTipi(p.input)}</div></div>
          <div><h4>Note</h4><textarea class="inp" rows="4" data-note="${p.id}" placeholder="Note sulla commessa…">${esc(p.note || "")}</textarea><span class="small muted">Si salvano uscendo dal campo.</span></div>
          <div class="dact"><button class="btn sm" data-pr-edit="${p.id}">Modifica composizione</button>${p.approvata ? `<button class="btn sm" data-pr-unok="${p.id}">Togli l'OK</button>` : `<button class="btn sm pri" data-pr-ok="${p.id}">Dai l'OK</button>`}<button class="btn sm danger" data-pr-del="${p.id}" title="Toglie la commessa dal piano definitivo">Rimuovi</button></div>
        </div></td></tr>` : "";
      return main + det;
    }).join("");
    return `<div class="pagehead"><h2>Commesse del piano definitivo</h2><div class="sp"></div><button class="btn dangerfill" id="pr-all">Ricalcola tutto</button></div>
      <p class="sub">${info("Parte dalle offerte degli agenti: scegli la settimana di rilievo e le altre date si calcolano con gli stessi parametri delle impostazioni. Controlla le date, poi dai l'OK. Ogni data si può modificare a mano: le successive si ricalcolano. Il piano definitivo ha il suo carico e non cambia le stime degli agenti.")} Collega l'offerta, controlla la composizione, poi dai l'OK. Le date si possono modificare a mano.</p>
      <div class="stats">
        <div class="stat"><div class="l">Commesse nel piano</div><div class="v num">${S.piano.length}</div></div>
        <div class="stat ${verif ? "warn" : "good"}"><div class="l">Da verificare</div><div class="v num">${verif}</div></div>
        <div class="stat ${late ? "warn" : "good"}"><div class="l">Posa dopo la stima agente</div><div class="v num">${late}</div></div>
        <div class="stat ${sov.length ? "bad" : "good"}"><div class="l">Settimane sovraccariche</div><div class="v num">${new Set(sov.map(x => x.w)).size}</div></div>
      </div>
      <div class="panel" id="pr-add-panel"><h3>Collega un'offerta ${info("Scrivi il numero dell'offerta, il numero di commessa e la settimana in cui assegni il rilievo. La composizione e le tipologie dell'offerta si ricompongono qui, le puoi correggere subito, e il sistema calcola le date. L'offerta dell'agente risulterà «Confermata».")}</h3>
        <div class="addrow">
          <label class="field"><span>N° offerta</span><input class="inp" id="pr-off" value="${esc(S.prForm.off)}" autocomplete="off" placeholder="es. 2026-118"></label>
          <label class="field"><span>N° commessa</span><input class="inp" id="pr-comm" value="${esc(S.prForm.comm)}" autocomplete="off"></label>
          <label class="field"><span>Inizio rilievo</span><select class="inp" id="pr-ril">${wk.map(w => `<option ${w === defRil ? "selected" : ""}>${w}</option>`).join("")}</select></label>
          <button class="btn pri" id="pr-add" style="align-self:end;margin-bottom:14px">Aggiungi al piano</button>
        </div><div id="pr-look">${lookupHtml()}</div>
        ${waiting.length ? `<details class="wait"><summary>Offerte ancora senza commessa (${waiting.length})</summary><div class="scroll"><table class="t"><tbody>${waiting.map(o => `<tr><td><b>${esc(o.numero)}</b></td><td>${esc(o.cliente)}</td><td class="muted small">${esc(o.agente_nome)}</td><td class="num small">${o.piano.posa || "—"}</td><td>${isSospesa(o) ? '<span class="badge warn">sospesa</span>' : ""}</td><td><button class="btn sm" data-link="${esc(o.numero)}">Collega</button></td></tr>`).join("")}</tbody></table></div></details>` : ""}</div>
      <div class="panel scroll" style="padding:0">${rows.length ? `<table class="t rt"><thead><tr><th>Stato</th><th>Commessa</th><th>Cliente</th><th>Posa agente</th><th>Rilievo</th><th>Conferma ordine</th><th>Acquisti</th><th>Produzione</th><th>Posa definitiva</th><th>Differenza</th><th></th></tr></thead><tbody>${body}</tbody></table>`
        : `<div class="empty"><b>${S.piano.length ? "Nessuna commessa collegata negli ultimi 7 giorni" : "Nessuna commessa nel piano definitivo"}</b>${S.piano.length ? "Tutte le altre sono in «Tutte le commesse»." : "Collega la prima offerta qui sopra."}</div>`}</div>
      <p class="sub" style="margin:8px 0 0">Qui sono mostrate le commesse collegate negli ultimi 7 giorni (${rows.length} su ${S.piano.length}). Le altre le trovi in <a href="#" data-goto="elenco">Tutte le commesse</a>, con filtri e ricerca.</p>
      <div class="legend"><span><i class="man-i"></i>Data modificata a mano</span><span><i class="bz-i"></i>Da verificare</span><span>▸ apre composizione, tipologie e note. Cambiando una data, quelle successive si ricalcolano; svuota il campo per tornare all'automatico. Cambiando il rilievo si riparte da capo.</span></div>
      ${sov.length ? `<div class="panel"><h3>Sovraccarichi del piano definitivo</h3>${sov.slice(0, 12).map(x => `<div class="alert bad"><i></i><div><b>${PR.cal[x.w].label} · ${x.l.name}</b><span>+${num(x.ex)} ${x.l.unit} oltre la capacità</span></div></div>`).join("")}</div>` : ""}`;
  }
  async function salvaRiga(np, ok) {
    await busy(async () => { try { await Api.pianoSalva(np); await refresh(true); if (ok) toast(ok); } catch (e) { toast(e.message, true); } });
    render();
  }
  function bindReale() {
    const q = id => document.getElementById(id);
    const offSel = () => { const { list } = offertaPerNumero(S.prForm.off); return list.length === 1 && !S.piano.some(x => x.offerta_id === list[0].id) ? list[0] : null; };
    const upd = () => {
      const root = q("pr-cform"), o = offSel(); if (!root || !o) return;
      const form = S.prForm.form, v = checkForm(inputFromForm(o.input, form)); sumFill(root, v);
      const res = q("pr-res");
      if (v.errs.length) { res.innerHTML = `<div class="checks">${v.errs.map(t => `<div><span class="x">✗</span>${esc(t)}</div>`).join("")}</div>`; return; }
      const np = { input: v.i, rilievo: q("pr-ril").value, posa_rich: form.posaRich, manuali: {} }, pi = calcReale(np, S.realOcc);
      res.innerHTML = `<div class="res"><div><small class="muted">Posa definitiva calcolata</small><div class="posa">${pi.ok ? pi.posa : "non calcolabile"}</div></div><div class="small" style="flex:1">Posa indicata dall'agente: ${o.piano.posa || "—"}. Le altre date compaiono dopo l'inserimento e si possono modificare.</div></div>`;
    };
    const look = () => { q("pr-look").innerHTML = lookupHtml(); const root = q("pr-cform"); if (root) { bindCompForm(root, S.prForm.form, upd); upd(); } };
    q("pr-off").oninput = () => { S.prForm.off = q("pr-off").value; look(); };
    q("pr-comm").oninput = () => { S.prForm.comm = q("pr-comm").value; };
    q("pr-ril").onchange = () => { S.prForm.ril = q("pr-ril").value; upd(); };
    S.prForm.ril = q("pr-ril").value;
    { const root = q("pr-cform"); if (root) { bindCompForm(root, S.prForm.form, upd); upd(); } }
    document.querySelectorAll("[data-link]").forEach(b => (b.onclick = () => { S.prForm.off = b.dataset.link; render(); const el = document.getElementById("pr-comm"); if (el) { el.focus(); el.scrollIntoView({ block: "center" }); } }));
    q("pr-add").onclick = async () => {
      S.prForm.off = q("pr-off").value; S.prForm.comm = q("pr-comm").value; S.prForm.ril = q("pr-ril").value;
      const { list } = offertaPerNumero(S.prForm.off), comm = S.prForm.comm.trim(), ril = S.prForm.ril;
      if (list.length !== 1) return toast(list.length ? "Più offerte con questo numero." : "Offerta non trovata: controlla il numero.", true);
      const o = list[0];
      if (S.piano.some(x => x.offerta_id === o.id)) return toast("Questa offerta è già nel piano.", true);
      if (!comm) return toast("Inserisci il numero di commessa.", true);
      if (S.piano.some(x => String(x.commessa).trim().toLowerCase() === comm.toLowerCase())) return toast("Numero di commessa già presente nel piano.", true);
      if (!wkOk(ril)) return toast("Scegli la settimana di rilievo.", true);
      const form = S.prForm.form, v = checkForm(inputFromForm(o.input, form));
      if (v.errs.length) return toast(v.errs[0], true);
      const np = { offerta_id: o.id, offerta_num: o.numero, cliente: o.cliente, agente_nome: o.agente_nome, posa_agente: o.piano.posa || null, commessa: comm, input: v.i, rilievo: ril, posa_rich: form.posaRich || "", manuali: {}, note: "", approvata: false };
      np.piano = calcReale(np, S.realOcc);
      await busy(async () => {
        try { await Api.pianoSalva(np); await Api.impostaCommessa(o.id, comm); S.prForm = { off: "", comm: "", ril: "", oid: null, form: null }; await refresh(true); toast(`Commessa ${comm} aggiunta: controlla le date e dai l'OK.`); }
        catch (e) { toast(e.message, true); }
      });
      render();
    };
    q("pr-all").onclick = async () => {
      if (!S.piano.length) return;
      const okc = await askConfirm({ title: "Ricalcolare tutto il piano?", ok: "Sì, ricalcola tutto",
        body: `<p>Stai per ricalcolare <b>tutte le ${S.piano.length} commesse</b> del piano definitivo, in ordine di settimana di rilievo e poi di inserimento.</p>
          <ul><li>Le date <b>calcolate dal sistema</b> possono cambiare, anche per commesse già con l'OK.</li><li>Le date <b>modificate a mano</b> restano come sono.</li></ul><p>L'operazione non si può annullare.</p>` });
      if (!okc) return;
      await busy(async () => {
        try {
          const done = [];
          for (const p of sortReale(S.piano)) { const np = { ...p }; np.piano = calcReale(np, realOccOf(done)); done.push(np); await Api.pianoSalva(np); }
          await refresh(true); toast("Piano ricalcolato.");
        } catch (e) { toast(e.message, true); }
      });
      render();
    };
    document.querySelectorAll("input[data-pr]").forEach(i => (i.onchange = async () => {
      const p = S.piano.find(x => x.id === i.dataset.pr), key = i.dataset.f, v = i.value.trim().toUpperCase();
      if (v && !wkOk(v)) { toast("Settimana non valida (esempio 2026-W45).", true); return render(); }
      if (key === "rilievo" && !v) { toast("Il rilievo è obbligatorio.", true); return render(); }
      const np = JSON.parse(JSON.stringify(p)); np.manuali = np.manuali || {};
      if (key === "rilievo") { np.rilievo = v; np.manuali = {}; }
      else if (v) np.manuali[key] = v; else delete np.manuali[key];
      np.piano = calcReale(np, occMinus(S.realOcc, p.piano.foot));
      await salvaRiga(np);
    }));
    document.querySelectorAll("[data-pr-open]").forEach(b => (b.onclick = () => { S.open[b.dataset.prOpen] = !S.open[b.dataset.prOpen]; render(); }));
    document.querySelectorAll("[data-pr-ok]").forEach(b => (b.onclick = () => { const np = JSON.parse(JSON.stringify(S.piano.find(x => x.id === b.dataset.prOk))); np.approvata = true; salvaRiga(np, "Commessa approvata."); }));
    document.querySelectorAll("[data-pr-unok]").forEach(b => (b.onclick = () => { const np = JSON.parse(JSON.stringify(S.piano.find(x => x.id === b.dataset.prUnok))); np.approvata = false; salvaRiga(np); }));
    document.querySelectorAll("textarea[data-note]").forEach(t => (t.onchange = async () => {
      const p = S.piano.find(x => x.id === t.dataset.note), np = JSON.parse(JSON.stringify(p)); np.note = t.value;
      try { await Api.pianoSalva(np); p.note = t.value; toast("Nota salvata."); } catch (e) { toast(e.message, true); }
    }));
    document.querySelectorAll("[data-pr-edit]").forEach(b => (b.onclick = () => openReale(S.piano.find(x => x.id === b.dataset.prEdit))));
    document.querySelectorAll("[data-pr-del]").forEach(b => (b.onclick = async () => {
      const p = S.piano.find(x => x.id === b.dataset.prDel);
      if (!confirm(`Togliere la commessa ${p.commessa} dal piano definitivo?\nL'offerta ${p.offerta_num} tornerà senza commessa.`)) return;
      await busy(async () => {
        try { await Api.pianoElimina(p.id); if (p.offerta_id) await Api.impostaCommessa(p.offerta_id, ""); await refresh(true); toast("Commessa tolta dal piano."); }
        catch (e) { toast(e.message, true); }
      });
      render();
    }));
  }
  // composizione della commessa (copia modificabile: l'offerta dell'agente non cambia)
  function openReale(p) {
    const form = formOf(p.input, p.posa_rich);
    S.drawer = { real: true };
    const host = document.createElement("div"); host.id = "drawerhost";
    host.innerHTML = `<div class="scrim" data-x></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Composizione commessa">
      <header><div class="top2"><h2>Commessa ${esc(p.commessa)}</h2><button class="btn sm" data-x type="button">Chiudi</button></div>
        <div class="stamp">Offerta ${esc(p.offerta_num || "")} · ${esc(p.cliente || "")}<br>Le modifiche valgono solo per il piano definitivo: l'offerta dell'agente resta com'è.</div></header>
      <div class="body">${compFormHtml(form)}</div>
      <footer><div id="checks" class="checks"></div><div id="res"></div><div class="btns"><button class="btn" data-x type="button">Annulla</button><button class="btn pri" id="r-save" type="button">Salva e ricalcola</button></div></footer></aside>`;
    document.body.appendChild(host); document.body.style.overflow = "hidden";
    const q = s => host.querySelector(s), close = () => { host.remove(); document.body.style.overflow = ""; S.drawer = null; };
    host.querySelectorAll("[data-x]").forEach(b => (b.onclick = close));
    function update() {
      const v = checkForm(inputFromForm(p.input, form));
      sumFill(host, v);
      q("#checks").innerHTML = v.errs.map(t => `<div><span class="x">✗</span>${esc(t)}</div>`).join("");
      q("#r-save").disabled = v.errs.length > 0;
      if (v.errs.length) { q("#res").innerHTML = ""; return; }
      const np = { ...p, input: v.i, posa_rich: form.posaRich }, pi = calcReale(np, occMinus(S.realOcc, p.piano.foot));
      q("#res").innerHTML = `<div class="res"><div><small class="muted">Posa definitiva calcolata</small><div class="posa">${pi.ok ? pi.posa : "non calcolabile"}</div></div><div class="small" style="flex:1">Posa indicata dall'agente: ${p.posa_agente || "—"}.${Object.keys(p.manuali || {}).length ? " Le date modificate a mano restano." : ""}</div></div>`;
    }
    bindCompForm(host.querySelector(".body"), form, update); update();
    q("#r-save").onclick = async () => {
      const v = checkForm(inputFromForm(p.input, form)); if (v.errs.length) return toast(v.errs[0], true);
      const np = JSON.parse(JSON.stringify(p)); np.input = v.i; np.posa_rich = form.posaRich;
      np.piano = calcReale(np, occMinus(S.realOcc, p.piano.foot));
      await busy(async () => { try { await Api.pianoSalva(np); close(); await refresh(true); render(); toast("Commessa ricalcolata."); } catch (e) { toast(e.message, true); } });
    };
  }

  /* ---------- GESTORE: carico ---------- */
  function vCarico(real) {
    const L = E.LINES, P = real ? S.PR : S.P, wks = []; for (let w = S.cur; w <= Math.min(E.NW, S.cur + 51); w++) wks.push(w);
    const cells = wks.map(w => `<div class="wk ${w === S.cur ? "cur" : ""}">${P.cal[w].label}</div>` + L.map(l => {
      const cp = P.cap[l.key][w], ld = P.load[l.key][w];
      if (cp <= 0 && ld <= 0) return `<div class="cl">chiuso</div>`;
      const p = cp > 0 ? ld / cp : 9, over = ld > cp + 0.01;
      return `<div class="${over ? "over" : ""}"><span class="num"><b>${num(ld)}</b> / ${num(cp)} ${l.unit}</span><div class="meter"><i class="${p >= 1.0 ? "full" : p >= .75 ? "hi" : ""}" style="width:${Math.min(100, p * 100).toFixed(0)}%"></i></div></div>`;
    }).join("")).join("");
    return `<div class="pagehead"><h2>Carico per settimana${real ? " — piano definitivo" : " — stime degli agenti"}</h2></div><p class="sub">${real ? "Carico delle commesse del piano definitivo" : "Carico delle offerte di tutti gli agenti"} rispetto alla capacità. Sfondo rosso = oltre la capacità.</p>
      <div class="panel scroll" style="padding:0"><div class="cg"><div class="h">Settimana</div>${L.map(l => `<div class="h">${l.name}</div>`).join("")}${cells}</div></div>`;
  }

  /* ---------- GESTORE: impostazioni ---------- */
  function vImpostazioni() {
    const c = S.cfg, tipi = E.tipiOf(c), curLbl = wl(S.cur);
    const f = (k, l, u, step, tip) => `<label class="field"><span>${l}${tip ? " " + info(tip) : ""}</span><input class="inp" type="number" min="0" step="${step || 1}" data-k="${k}" value="${c[k]}"><span class="u">${u || ""}</span></label>`;
    const fc = (k, l, u) => `<label class="field"><span>${l}</span><input class="inp" type="number" min="0" step="1" data-c="${k}" value="${c.coda[k]}"><span class="u">${u}</span></label>`;
    return `<div class="settings"><div class="pagehead"><h2>Impostazioni</h2><div class="sp"></div><button class="btn pri" id="savecfg">Salva impostazioni</button></div>
      <div class="panel"><h3>Capacità settimanale</h3>
        <p class="sub">I nuovi valori valgono dalla settimana scelta in poi. Le offerte già confermate non vengono ricalcolate: se la nuova capacità è inferiore al carico già assegnato, la settimana compare tra i sovraccarichi.</p>
        <div class="setgrid"><label class="field"><span>Valide dalla settimana</span><input class="inp" id="validafrom" value="${curLbl}" placeholder="2026-W45"><span class="u">formato 2026-W45</span></label>
        ${f("tecnici", "Tecnici rilievo", "persone")}${f("foriTecnico", "Fori per tecnico", "fori / settimana", 0.5)}
        ${f("capPvc", "Ante PVC", "pezzi / settimana")}${f("capAlz", "Alzanti PVC", "pezzi / settimana")}${f("capPor", "Portoncini", "pezzi / settimana")}${f("capAlu", "Alluminio", "ore / settimana")}${f("capScu", "Reparto scuri (PVC e alluminio)", "ore / settimana", 1, "Ore di lavoro a settimana del reparto scuri, in comune tra scuri PVC e alluminio.")}</div></div>
      <div class="panel"><h3>Tempi e parametri</h3><p class="sub">Si applicano alle offerte nuove o modificate da ora in avanti.</p>
        <div class="setgrid">${f("tRil", "Rilievo → conferma ordine", "settimane", 1, "Tempo che passa tra il rilievo e la conferma d'ordine del cliente.")}${f("tCo", "Conferma → ordine materiali", "settimane", 1, "Tempo tra la conferma e l'invio dell'ordine ai fornitori.")}${f("buffer", "Cuscinetto prima della posa", "settimane", 1, "Settimane di margine tra la fine della produzione e la posa.")}${f("giorniSospesa", "Offerta sospesa dopo", "giorni", 1, "Se un'offerta non riceve il numero di commessa entro questi giorni dall'inserimento, passa tra le offerte sospese dell'agente.")}
        ${f("hAnteAlu", "Ore per anta alluminio", "ore / pezzo", 0.1)}${f("hAlzAlu", "Ore per alzante alluminio", "ore / pezzo", 0.1)}${f("hScuriPvc", "Ore per scuro PVC", "ore / pezzo", 0.1)}${f("hScuriAlu", "Ore per scuro alluminio", "ore / pezzo", 0.1)}</div>
        <h3 style="margin-top:18px">Coda iniziale (settimane già occupate) ${info("Settimane di lavoro già in coda in ogni reparto prima delle offerte inserite nel sistema.")}</h3>
        <div class="setgrid">${fc("ril", "Rilievo", "settimane")}${fc("pvc", "Ante PVC", "settimane")}${fc("alz", "Alzanti PVC", "settimane")}${fc("por", "Portoncini", "settimane")}${fc("alu", "Alluminio", "settimane")}${fc("scu", "Reparto scuri", "settimane")}</div></div>
      <div class="panel"><h3>Chiusure</h3><p class="sub">Percentuale di capacità disponibile: 0 = chiuso, 50 = mezza settimana.</p>
        <div id="cls">${c.closures.map(clRow).join("")}</div><button class="btn sm" id="addcl">+ Aggiungi chiusura</button></div>
      <div class="panel"><h3>Tempi materiali (settimane)</h3><p class="sub">«Prima del rilievo» = materiale da ordinare prima del rilievo (monoblocchi, cassonetti ALPAC, falsitelai).</p>
        <div class="tmt"><div class="hd">Tipologia</div><div class="hd">Standard</div><div class="hd">Fuori std</div><div class="hd">Prima rilievo</div>
        ${E.CATS.map((cat, ci) => `<div class="cat-h">${cat}</div>` + tipi.filter(t => t.cat === ci).map(t => `<div>${esc(t.name)}</div>
          <input class="inp" type="number" min="0" data-t="${esc(t.name)}" data-f="std" value="${t.std}"><input class="inp" type="number" min="0" data-t="${esc(t.name)}" data-f="fsd" value="${t.fsd}">
          <label class="chk"><input type="checkbox" data-t="${esc(t.name)}" data-f="early" ${t.early ? "checked" : ""}></label>`).join("")).join("")}</div></div>
      <div class="panel"><h3>Storico</h3><div class="scroll"><table class="t"><thead><tr><th>Salvato il</th><th>Capacità valide da</th><th>Rilievo</th><th>PVC</th><th>Alz.</th><th>Port.</th><th>Alu</th><th>Scuri</th></tr></thead><tbody>
      ${S.vlist.map((v, i) => { const b = E.baseOf(v.cfg), meta = S.versions[i]; return `<tr><td class="small">${meta ? new Date(meta.creato_il).toLocaleDateString("it-IT") : "predefinite"}</td><td class="num">${v.from === "2000-W01" ? "sempre" : v.from}</td><td class="num">${b.ril}</td><td class="num">${b.pvc}</td><td class="num">${b.alz}</td><td class="num">${b.por}</td><td class="num">${b.alu}</td><td class="num">${b.scu}</td></tr>`; }).reverse().join("")}</tbody></table></div></div></div>`;
  }
  const clRow = c => `<div class="clrow"><input class="inp" data-cl="from" value="${esc(c.from)}" placeholder="2026-W52"><input class="inp" data-cl="to" value="${esc(c.to || c.from)}" placeholder="2026-W52"><input class="inp" type="number" min="0" max="100" data-cl="pct" value="${Math.round((c.pct || 0) * 100)}"><button class="btn sm danger" data-rmcl type="button">✕</button></div>`;
  function bindSettings() {
    const cls = document.getElementById("cls");
    document.getElementById("addcl").onclick = () => { cls.insertAdjacentHTML("beforeend", clRow({ from: "", to: "", pct: 0 })); wireRm(); };
    const wireRm = () => cls.querySelectorAll("[data-rmcl]").forEach(b => (b.onclick = () => b.parentElement.remove())); wireRm();
    document.getElementById("savecfg").onclick = async () => {
      const c = JSON.parse(JSON.stringify(S.cfg)), q = s => document.querySelector(s);
      document.querySelectorAll("[data-k]").forEach(i => (c[i.dataset.k] = Number(i.value) || 0));
      document.querySelectorAll("[data-c]").forEach(i => (c.coda[i.dataset.c] = Number(i.value) || 0));
      c.closures = [...cls.querySelectorAll(".clrow")].map(r => ({ from: r.querySelector('[data-cl=from]').value.trim(), to: r.querySelector('[data-cl=to]').value.trim(), pct: (Number(r.querySelector('[data-cl=pct]').value) || 0) / 100 })).filter(x => x.from);
      c.tipi = {};
      document.querySelectorAll("[data-t]").forEach(i => { const o = (c.tipi[i.dataset.t] = c.tipi[i.dataset.t] || {}); o[i.dataset.f] = i.dataset.f === "early" ? i.checked : Number(i.value) || 0; });
      const vf = q("#validafrom").value.trim().toUpperCase();
      if (!/^\d{4}-W\d{2}$/.test(vf) || E.mondayOfLabel(vf) == null) return toast("Settimana di validità non valida (esempio 2026-W45).", true);
      for (const x of c.closures) if (E.mondayOfLabel(x.from) == null || (x.to && E.mondayOfLabel(x.to) == null)) return toast("Chiusura con settimana non valida: " + x.from, true);
      await busy(async () => { try { await Api.saveConfig({ valida_da: vf, cfg: c }); await refresh(true); toast("Impostazioni salvate."); } catch (e) { toast(e.message, true); } });
      render();
    };
  }

  /* ---------- GESTORE: utenti ---------- */
  function vUtenti() {
    return `<div class="pagehead"><h2>Utenti</h2></div>
      <p class="sub">${Api.mode === "demo" ? "In modalità demo gli utenti sono fissi." : "Per aggiungere un agente: Supabase → Authentication → Add user (email e password). Qui puoi poi cambiare nome, ruolo e attivare/disattivare."}</p>
      <div class="panel scroll" style="padding:0"><table class="t"><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Attivo</th><th></th></tr></thead><tbody>
      ${S.profili.map(p => `<tr data-u="${p.id}"><td><input class="inp" data-f="nome" value="${esc(p.nome)}"></td><td class="small">${esc(p.email || "")}</td>
        <td><select class="inp" data-f="ruolo"><option value="agente" ${p.ruolo === "agente" ? "selected" : ""}>Agente</option><option value="gestore" ${p.ruolo === "gestore" ? "selected" : ""}>Gestore</option></select></td>
        <td><input type="checkbox" data-f="attivo" ${p.attivo ? "checked" : ""} ${p.id === S.me.id ? "disabled" : ""}></td><td><button class="btn sm" data-saveu>Salva</button></td></tr>`).join("")}</tbody></table></div>`;
  }
  function bindUtenti() {
    document.querySelectorAll("[data-saveu]").forEach(b => (b.onclick = async () => {
      const tr = b.closest("tr"), id = tr.dataset.u;
      const f = { nome: tr.querySelector('[data-f=nome]').value.trim(), ruolo: tr.querySelector('[data-f=ruolo]').value, attivo: tr.querySelector('[data-f=attivo]').checked };
      if (id === S.me.id && f.ruolo !== "gestore" && !confirm("Stai togliendo a te stesso il ruolo di gestore. Continuare?")) return;
      await busy(async () => { try { await Api.setProfilo(id, f); await refresh(true); toast("Utente aggiornato."); } catch (e) { toast(e.message, true); } });
      render();
    }));
  }

  /* ---------- FORM OFFERTA (pannello laterale) ---------- */
  function openForm(row, opts) {
    const editing = !!row, repro = !!(opts && opts.repro), inp = row ? row.input : {};
    const form = {
      numero: row ? row.numero : "", cliente: row ? row.cliente : "",
      fori: inp.fori || "", antePvc: inp.antePvc || "", alzPvc: inp.alzPvc || "", port: inp.port || "", anteAlu: inp.anteAlu || "", alzAlu: inp.alzAlu || "", scuriPvc: inp.scuriPvc || "", scuriAlu: inp.scuriAlu || inp.scuri || "",
      tipi: Object.assign({}, inp.tipi || {}), posaRich: repro ? "" : (inp.posaRich || "")
    };
    S.drawer = { row, form, tried: false };
    const tipi = E.tipiOf(S.cfg);
    const weeks = []; for (let w = S.cur; w <= Math.min(E.NW, S.cur + 70); w++) weeks.push(S.P.cal[w].label);
    if (form.posaRich && !weeks.includes(form.posaRich)) weeks.unshift(form.posaRich);
    const nf = (k, l, ph, tip) => `<label class="field"><span>${l}${tip ? " " + info(tip) : ""}</span><input class="inp" type="number" inputmode="numeric" min="0" step="1" data-n="${k}" value="${form[k]}" placeholder="${ph || "0"}"></label>`;
    const html = `<div class="scrim" data-x></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Offerta">
      <header><div class="top2"><h2>${repro ? "Riprogramma offerta" : editing ? "Modifica offerta" : "Nuova offerta"}</h2><button class="btn sm" data-x type="button">Chiudi</button></div>
        <div class="f2"><label class="field req"><span>N° offerta ${info("Il numero dell'offerta come lo trovi sul preventivo.")}</span><input class="inp" id="f-num" value="${esc(form.numero)}" autocomplete="off"></label>
        <label class="field req"><span>Nome cliente</span><input class="inp" id="f-cli" value="${esc(form.cliente)}" autocomplete="off"></label></div>
        <div class="stamp">${repro ? "Nuova data di inserimento:" : editing ? "Inserita il" : "Verrà registrata il"} <b>${esc(fmtDay(row && !repro ? row.creata_il : new Date().toISOString()))}</b></div></header>
      <div class="body">
        ${repro ? `<div class="sumbox" style="display:block">L'offerta viene ricalcolata come se la inserissi <b>oggi</b>. I dati restano uguali: devi solo scegliere la nuova settimana di posa (in fondo).</div>` : ""}
        <h3>Fori e serramenti ${info("Il totale dei serramenti (ante, alzanti e portoncini, PVC e alluminio) deve essere esattamente uguale ai fori. Gli scuri non si contano.")}</h3>
        <div class="fgrid"><label class="field req"><span>Numero fori ${info("Il numero totale di aperture da sostituire in questa offerta. Deve essere uguale al totale dei serramenti qui sotto.")}</span><input class="inp" type="number" inputmode="numeric" min="0" step="1" data-n="fori" value="${form.fori}" placeholder="0"></label></div>
        <div class="fgrid">${nf("antePvc", "Ante PVC", "", "Quante ante in PVC ci sono nell'offerta.")}${nf("alzPvc", "Alzanti PVC", "", "Quanti alzanti scorrevoli in PVC.")}${nf("port", "Portoncini", "", "Quanti portoncini d'ingresso.")}${nf("anteAlu", "Ante alluminio", "", "Quante ante in alluminio.")}${nf("alzAlu", "Alzanti alluminio", "", "Quanti alzanti scorrevoli in alluminio.")}${nf("scuriPvc", "Scuri PVC", "", "Quanti scuri in PVC. Non si contano nel totale dei serramenti: hanno un reparto dedicato.")}${nf("scuriAlu", "Scuri alluminio", "", "Quanti scuri in alluminio. Non si contano nel totale dei serramenti: hanno un reparto dedicato.")}</div>
        <div class="sumbox" id="sum"></div>
        <h3>Tipologie ordinate ${info("Standard: misure e finiture di catalogo. Fuori standard: misure, forme o lavorazioni speciali, con tempi di consegna dei materiali più lunghi. Se una tipologia non è nell'offerta lascia «—».")}</h3><p class="sub">Per ogni tipologia presente indica se è <b>standard</b> o <b>fuori standard</b>. Lascia «—» se non c'è. Serve almeno una tipologia.</p>
        ${E.CATS.map((cat, ci) => `<div class="cat"><h4>${cat}</h4>${tipi.filter(t => t.cat === ci).map(t => `<div class="trow"><div class="n">${esc(t.name)}</div>
          <div class="seg" data-t="${esc(t.name)}"><button type="button" data-v="" aria-pressed="false">—</button><button type="button" data-v="std" aria-pressed="false">Standard</button><button type="button" class="fsd" data-v="fsd" aria-pressed="false">Fuori std</button></div></div>`).join("")}</div>`).join("")}
        <h3>Posa richiesta (facoltativa) ${info("Se il cliente vuole la posa in una settimana precisa, scegli qui. Le settimane troppo vicine sono grigie e non si possono scegliere. Se non c'è fretta lascia «Prima possibile».")}</h3>
        <label class="field"><span>Settimana desiderata</span><select class="inp" id="f-req"><option value="">Prima possibile</option>${weeks.map(w => `<option value="${w}" ${w === form.posaRich ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      </div>
      <footer><div id="checks" class="checks"></div><div id="res"></div>
        <div class="btns"><button class="btn" data-x type="button">Annulla</button><button class="btn pri" id="f-save" type="button">${repro ? "Riprogramma" : editing ? "Salva modifiche" : "Salva offerta"}</button></div></footer></aside>`;
    const host = document.createElement("div"); host.id = "drawerhost"; host.innerHTML = html; document.body.appendChild(host);
    document.body.style.overflow = "hidden";
    const q = s => host.querySelector(s);
    const close = () => { host.remove(); document.body.style.overflow = ""; S.drawer = null; };
    host.querySelectorAll("[data-x]").forEach(b => (b.onclick = close));
    document.addEventListener("keydown", function esck(e) { if (e.key === "Escape" && S.drawer) { close(); document.removeEventListener("keydown", esck); } });
    const syncSeg = () => host.querySelectorAll(".seg").forEach(sg => { const v = form.tipi[sg.dataset.t] || ""; sg.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === v))); });
    host.querySelectorAll(".seg button").forEach(b => (b.onclick = () => { const t = b.parentElement.dataset.t; if (b.dataset.v) form.tipi[t] = b.dataset.v; else delete form.tipi[t]; syncSeg(); update(); }));
    host.querySelectorAll("[data-n]").forEach(i => (i.oninput = () => { form[i.dataset.n] = i.value; update(); }));
    q("#f-num").oninput = e => { form.numero = e.target.value; update(); };
    q("#f-cli").oninput = e => { form.cliente = e.target.value; update(); };
    q("#f-req").onchange = e => { form.posaRich = e.target.value; update(); };

    function inputOf() {
      const n = k => Math.max(0, Math.floor(Number(form[k]) || 0));
      return { fori: n("fori"), antePvc: n("antePvc"), alzPvc: n("alzPvc"), port: n("port"), anteAlu: n("anteAlu"), alzAlu: n("alzAlu"), scuriPvc: n("scuriPvc"), scuriAlu: n("scuriAlu"), tipi: { ...form.tipi }, posaRich: form.posaRich || "" };
    }
    function validate() {
      const i = inputOf(), tot = sumSerr(i), errs = [], ok = [];
      const dati = form.numero.trim() && form.cliente.trim();
      (dati ? ok : errs).push(dati ? "Numero offerta e nome cliente inseriti" : "Inserire numero offerta e nome cliente");
      const hasF = i.fori > 0; (hasF ? ok : errs).push(hasF ? `Fori indicati: ${i.fori}` : "Indicare il numero di fori");
      const eq = hasF && tot === i.fori;
      (eq ? ok : errs).push(eq ? "Serramenti totali = fori" : hasF ? `I serramenti indicati (${tot}) devono essere esattamente ${i.fori}, come i fori` : "Indicare i serramenti: il totale deve essere uguale ai fori");
      const nt = Object.keys(i.tipi).length; (nt > 0 ? ok : errs).push(nt > 0 ? `Tipologie selezionate: ${nt}` : "Selezionare almeno una tipologia (standard o fuori standard)");
      return { i, tot, errs, ok };
    }
    let lastPlan = null, lastEarliest = "?";
    // prima settimana di posa possibile (senza data richiesta) e eventuale blocco se la richiesta non è disponibile
    function blockOf(i, occ) {
      const p0 = E.plan([commessaOf({ ...i, posaRich: "" }, form.cliente)], S.cfg, Date.now(), { occ, versions: S.vlist });
      const e = p0.res[0].ok ? p0.cal[p0.res[0].posa].label : null;
      let msg = "";
      if (i.posaRich) {
        const p1 = E.plan([commessaOf(i, form.cliente)], S.cfg, Date.now(), { occ, versions: S.vlist }).res[0];
        if (p1.ok && p1.late > 0) msg = `La posa in ${i.posaRich} non è disponibile${e ? ` (prima settimana possibile: ${e})` : ""}. Scegli una settimana più avanti oppure «Prima possibile».`;
      }
      return { earliest: e, msg };
    }
    function syncReq(earliest) {
      if (earliest === lastEarliest) return; lastEarliest = earliest;
      q("#f-req").innerHTML = `<option value="">Prima possibile</option>` + weeks.map(w => { const no = earliest && w < earliest; return `<option value="${w}" ${w === form.posaRich ? "selected" : ""} ${no ? "disabled" : ""}>${w}${no ? " — non disponibile" : ""}</option>`; }).join("");
    }
    function update() {
      const v = validate(), i = v.i;
      const sum = q("#sum"); const diff = v.tot - i.fori;
      sum.className = "sumbox " + (i.fori > 0 && diff === 0 ? "ok" : (S.drawer.tried || (i.fori > 0 && v.tot > 0)) && diff !== 0 ? "bad" : "");
      sum.innerHTML = `Serramenti totali <b class="num">${v.tot}</b> · Fori <b class="num">${i.fori}</b> ${i.fori > 0 && diff === 0 ? "✓ coincidono" : i.fori > 0 || v.tot > 0 ? `— ${diff > 0 ? "sovrabbondano " + diff : "mancano " + (-diff)}` : ""}`;
      q("#checks").innerHTML = v.errs.map(t => `<div><span class="x">✗</span>${esc(t)}</div>`).join("");
      const res = q("#res");
      if (v.errs.length) { res.innerHTML = ""; lastPlan = null; return; }
      const occ = row ? occMinus(S.occ.righe, row.piano.foot) : S.occ.righe;
      const pl = E.plan([commessaOf(i, form.cliente)], S.cfg, Date.now(), { occ, versions: S.vlist });
      lastPlan = pl; const r = pl.res[0];
      const bl = blockOf(i, occ), av = r.warnings.filter(a => !/oltre la data richiesta/.test(a)).map(E.humanWarn);
      syncReq(bl.earliest);
      q("#checks").innerHTML = bl.msg ? `<div><span class="x">✗</span>${esc(bl.msg)}</div>` : "";
      q("#f-save").disabled = !!bl.msg;
      res.innerHTML = `<div class="res"><div><small class="muted">Settimana indicativa di posa</small><div class="posa">${r.ok ? pl.cal[r.posa].label : "non calcolabile"}</div></div>
        <div class="small" style="flex:1;min-width:180px">Stima non vincolante: la data definitiva la conferma l'ufficio produzione.</div>
        ${av.length ? `<div class="warns" style="flex-basis:100%">${av.map(a => `<div>⚠ ${esc(a)}</div>`).join("")}</div>` : ""}</div>`;
    }
    syncSeg(); update();

    q("#f-save").onclick = async () => {
      S.drawer.tried = true; update();
      const v = validate();
      if (v.errs.length) { toast("Controlla i campi: " + v.errs[0], true); return; }
      await busy(async () => {
        try {
          for (let t = 0; t < 4; t++) {
            const snap = await Api.fetchAll(S.me);
            const occ = row ? occMinus(snap.occ.righe, row.piano.foot) : snap.occ.righe;
            const pl = E.plan([commessaOf(v.i, form.cliente)], S.cfg, Date.now(), { occ, versions: S.vlist });
            if (!pl.res[0].ok) { toast("Capacità esaurita entro il calendario: non è possibile calcolare la posa.", true); return; }
            const bl = blockOf(v.i, occ);
            if (bl.msg) { toast(bl.msg, true); update(); return; }
            try {
              if (repro) await Api.riprogramma({ id: row.id, input: v.i, piano: E.freeze(pl.res[0], pl.C), versione: snap.occ.versione });
              else await Api.salva({ id: row ? row.id : null, numero: form.numero.trim(), cliente: form.cliente.trim(), input: v.i, piano: E.freeze(pl.res[0], pl.C), versione: snap.occ.versione });
              close(); await refresh(true); render();
              toast(`${repro ? "Offerta riprogrammata" : "Offerta salvata"} — settimana indicativa di posa ${pl.cal[pl.res[0].posa].label}`); return;
            } catch (e) { if (!e.conflict) throw e; }
          }
          toast("Un altro agente ha appena occupato lo stesso slot. Riprova.", true);
        } catch (e) { toast("Salvataggio non riuscito: " + e.message, true); }
      });
    };
    setTimeout(() => q("#f-num").focus(), 50);
  }

  /* ---------- avvio ---------- */
  (async function boot() {
    try { S.me = await Api.init(); } catch (e) { S.loginErr = e.message; }
    if (S.me) await start(); else renderLogin();
  })();
})();
