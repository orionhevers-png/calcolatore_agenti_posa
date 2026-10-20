/* Esportazione Excel del gestore: stesse schermate e impostazioni del sito.
   Il file contiene i valori calcolati (non formule): è una fotografia della situazione. */
window.exportExcel = async function (S) {
  if (!window.ExcelJS) throw new Error("libreria Excel non caricata (controlla la connessione)");
  const E = window.Engine, P = S.P, cfg = S.cfg;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pianificatore Posa Longato"; wb.created = new Date();
  const TEAL = "FF013E51", BLUE = "FF0070C8", GREY = "FFE7EEF2";
  const wl = i => (i == null ? "" : E.labelOfIdx(S.C, i));
  const hdr = (ws, row) => { const r = ws.getRow(row); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }; c.alignment = { vertical: "middle", wrapText: true }; }); r.height = 22; };
  const title = (ws, text, sub) => { ws.getCell("A1").value = text; ws.getCell("A1").font = { size: 16, bold: true, color: { argb: TEAL } }; if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = { italic: true, color: { argb: "FF53697A" } }; } };
  const fillOf = hex => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex } });
  const PHC = { R: ["0070C8", "FFFFFF"], E: ["8DB8DD", "10242D"], O: ["BCD6EA", "10242D"], A: ["ECC761", "10242D"], Q: ["E8905A", "10242D"], L: ["2F8F5B", "FFFFFF"], S: ["A9B6BF", "10242D"], P: ["013E51", "FFFFFF"] };
  const GL = { R: "Rilievo", E: "Rilievo anticipato", O: "Ordine materiali", A: "Attesa materiali", Q: "Coda produzione", L: "Produzione", S: "Cuscinetto", P: "Posa" };
  const isActive = r => r.r.posa == null || r.r.posa >= S.cur;
  const rows = S.rows;
  const act = rows.filter(isActive);

  /* ---- Cruscotto ---- */
  let ws = wb.addWorksheet("Cruscotto", { views: [{ showGridLines: false }] });
  title(ws, "Cruscotto — situazione complessiva (stime indicative)", `Settimana corrente ${wl(S.cur)} · generato il ${new Date().toLocaleDateString("it-IT")}`);
  ws.addRow([]);
  ws.addRow(["Indicatore", "Valore"]); hdr(ws, 4);
  const conAv = act.filter(r => r.r.warnings.length || !r.r.ok);
  [["Offerte attive", act.length], ["Fori in lavorazione", act.reduce((s, r) => s + r.r.fori, 0)], ["Offerte con avvisi", conAv.length], ["Offerte totali (incluse concluse)", rows.length]].forEach(x => ws.addRow(x));
  ws.addRow([]);
  const h2 = ws.addRow(["Saturazione prossime 8 settimane", "Capacità", "Carico", "% saturazione"]); hdr(ws, h2.number);
  for (const l of E.LINES) {
    let c = 0, u = 0; for (let w = S.cur; w < S.cur + 8; w++) { c += P.cap[l.key][w]; u += P.load[l.key][w]; }
    const rr = ws.addRow([`${l.name} (${l.unit})`, Math.round(c * 10) / 10, Math.round(u * 10) / 10, c > 0 ? u / c : 0]); rr.getCell(4).numFmt = "0%";
  }
  ws.addRow([]);
  const h3 = ws.addRow(["Agente", "Offerte attive", "Fori", "Avvisi"]); hdr(ws, h3.number);
  for (const a of S.profili.filter(p => p.ruolo === "agente")) {
    const m = act.filter(r => r.agente_id === a.id), nx = m.filter(r => r.r.ok).sort((x, y) => x.r.posa - y.r.posa)[0];
    ws.addRow([a.nome, m.length, m.reduce((s, r) => s + r.r.fori, 0), m.filter(r => r.r.warnings.length).length]);
  }
  ws.columns = [{ width: 38 }, { width: 16 }, { width: 14 }, { width: 16 }, { width: 12 }];

  /* ---- Offerte ---- */
  ws = wb.addWorksheet("Offerte", { views: [{ state: "frozen", ySplit: 3, xSplit: 3 }] });
  title(ws, "Tutte le offerte", "STIMA INDICATIVA: le settimane non sono date confermate. Priorità = ordine di inserimento. Formato ISO (anno-Wnumero).");
  ws.addRow(["Agente", "N° offerta", "Cliente", "Inserita il", "Sett. inserimento", "Fori", "Ante PVC", "Alzanti PVC", "Portoncini", "Ante alu", "Alzanti alu", "Scuri PVC", "Scuri alu", "Posa richiesta", "Rilievo da", "Rilievo a", "Ordine materiali", "Produzione da", "Produzione a", "Posa indicativa", "Ritardo (sett.)", "Avvisi", "Stato"]);
  hdr(ws, 3);
  for (const o of rows) {
    const r = o.r, i = o.input;
    const d = new Date(o.creata_il);
    ws.addRow([o.agente_nome, o.numero, o.cliente, d, E.labelOfMs(E.mondayOfDate(d.getTime())), r.fori, i.antePvc || 0, i.alzPvc || 0, i.port || 0, i.anteAlu || 0, i.alzAlu || 0, i.scuriPvc || 0, i.scuriAlu != null ? i.scuriAlu : (i.scuri || 0),
      r.req != null ? wl(r.req) : "", wl(r.rilFirst), wl(r.rilLast), wl(r.M), wl(r.pFirst), wl(r.pLast), r.ok ? wl(r.posa) : "", r.late > 0 ? r.late : "", o.commessa ? "" : r.warnings.map(E.humanWarn).join(" | "),
      o.commessa ? "Confermata · commessa " + o.commessa : (!o.commessa && Math.floor((Date.now() - new Date(o.creata_il).getTime()) / 86400000) >= (S.sosp || 15)) ? "Sospesa" : "In attesa"]);
  }
  ws.getColumn(4).numFmt = "dd/mm/yyyy";
  ws.columns.forEach((c, k) => (c.width = [16, 12, 26, 12, 14, 7, 9, 11, 10, 9, 11, 9, 9, 14, 12, 12, 14, 13, 13, 13, 11, 60, 26][k]));
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 23 } };

  /* ---- Piano reale ---- */
  ws = wb.addWorksheet("Piano_reale", { views: [{ state: "frozen", ySplit: 3, xSplit: 3 }] });
  title(ws, "Piano definitivo — commesse", "Date definitive calcolate dal rilievo assegnato. Le celle azzurre sono state modificate a mano. Formato ISO (anno-Wnumero).");
  ws.addRow(["Offerta", "Commessa", "Cliente", "Agente", "Fori", "Posa agente (stima)", "Rilievo", "Conferma ordine", "Acquisti", "Produzione", "Posa definitiva", "Differenza (sett.)", "Stato", "Composizione", "Tipologie (std / fuori std)", "Note", "Avvisi"]); hdr(ws, 3);
  const dsett = (a, b) => (a && b ? Math.round((E.mondayOfLabel(a) - E.mondayOfLabel(b)) / (7 * E.DAY)) : "");
  for (const p of (S.piano || []).slice().sort((a, b) => (a.rilievo < b.rilievo ? -1 : a.rilievo > b.rilievo ? 1 : a.seq - b.seq))) {
    const pi = p.piano, mn = p.manuali || {};
    const i = p.input, comp = [["antePvc", "ante PVC"], ["alzPvc", "alzanti PVC"], ["port", "portoncini"], ["anteAlu", "ante alu"], ["alzAlu", "alzanti alu"], ["scuriPvc", "scuri PVC"], ["scuriAlu", "scuri alu"]].filter(([k]) => +i[k] > 0).map(([k, l]) => i[k] + " " + l).join(", ");
    const tip = Object.entries(i.tipi || {}).map(([n, v]) => n + (v === "fsd" ? " (fuori std)" : " (std)")).join("; ");
    const rr = ws.addRow([p.offerta_num, p.commessa, p.cliente, p.agente_nome, i.fori, p.posa_agente || "", p.rilievo, pi.L, pi.M, pi.pFirst != null ? pi.pFirst : pi.N, pi.posa || "", dsett(pi.posa, p.posa_agente), p.approvata ? "OK" : "Da verificare", comp, tip, p.note || "", (pi.warnings || []).map(E.humanWarn).join(" | ")]);
    [["L", 8], ["M", 9], ["N", 10], ["posa", 11]].forEach(([k, c]) => { if (mn[k]) rr.getCell(c).fill = fillOf("DCECF9"); });
  }
  ws.columns.forEach((c, k) => (c.width = [12, 12, 26, 16, 7, 16, 11, 14, 11, 12, 12, 14, 14, 40, 60, 40, 60][k]));
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 17 } };

  /* ---- Gantt ---- */
  ws = wb.addWorksheet("Gantt", { views: [{ state: "frozen", ySplit: 3, xSplit: 4 }] });
  title(ws, "Gantt — offerte attive", "R rilievo · E rilievo anticipato · O ordine · A attesa materiali · Q coda · L produzione · S cuscinetto · P posa");
  const gr = act.filter(o => o.r.ok);
  const last = Math.min(E.NW, Math.max(S.cur + 26, ...gr.map(o => o.r.posa + 2)));
  const ws0 = []; for (let w = Math.max(1, S.cur - 1); w <= last; w++) ws0.push(w);
  ws.addRow(["Agente", "N° offerta", "Cliente", "Posa", ...ws0.map(w => P.cal[w].label)]); hdr(ws, 3);
  ws.getRow(3).height = 62;
  for (let k = 5; k < 5 + ws0.length; k++) ws.getRow(3).getCell(k).alignment = { textRotation: 90, horizontal: "center" };
  for (const o of gr) {
    const row = ws.addRow([o.agente_nome, o.numero, o.cliente, wl(o.r.posa), ...ws0.map(w => E.phaseAt(o.r, w, cfg))]);
    ws0.forEach((w, k) => { const p = E.phaseAt(o.r, w, cfg), c = row.getCell(5 + k); c.alignment = { horizontal: "center" }; if (p) { c.fill = fillOf(PHC[p][0]); c.font = { bold: true, color: { argb: "FF" + PHC[p][1] } }; } });
  }
  ws.columns.forEach((c, k) => (c.width = k === 0 ? 16 : k === 1 ? 12 : k === 2 ? 26 : k === 3 ? 11 : 3.2));
  const lg = ws.addRow([]); ws.addRow(["Legenda"]).font = { bold: true };
  for (const [k, l] of Object.entries(GL)) { const r = ws.addRow([k, l]); r.getCell(1).fill = fillOf(PHC[k][0]); r.getCell(1).font = { bold: true, color: { argb: "FF" + PHC[k][1] } }; r.getCell(1).alignment = { horizontal: "center" }; }

  /* ---- Carico ---- */
  ws = wb.addWorksheet("Carico", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] });
  title(ws, "Carico per settimana", "Carico totale di tutti gli agenti / capacità. In rosso: oltre la capacità.");
  const hh = ["Settimana"]; for (const l of E.LINES) hh.push(`${l.name} carico (${l.unit})`, `${l.name} capacità`, `${l.name} %`);
  ws.addRow(hh); hdr(ws, 3);
  for (let w = S.cur; w <= Math.min(E.NW, S.cur + 51); w++) {
    const v = [P.cal[w].label];
    for (const l of E.LINES) { const c = P.cap[l.key][w], u = P.load[l.key][w]; v.push(Math.round(u * 10) / 10, Math.round(c * 10) / 10, c > 0 ? u / c : u > 0 ? 9.99 : 0); }
    const r = ws.addRow(v);
    E.LINES.forEach((l, k) => { const pc = r.getCell(4 + k * 3); pc.numFmt = "0%"; if (P.load[l.key][w] > P.cap[l.key][w] + 0.01) { pc.fill = fillOf("F9DAD7"); pc.font = { color: { argb: "FFB3261E" }, bold: true }; } else if (P.cap[l.key][w] <= 0) pc.fill = { type: "pattern", pattern: "lightUp", fgColor: { argb: "FFB0BEC5" } }; });
  }
  ws.columns.forEach((c, k) => (c.width = k === 0 ? 12 : 14));

  /* ---- Impostazioni ---- */
  ws = wb.addWorksheet("Impostazioni", { views: [{ showGridLines: false }] });
  title(ws, "Impostazioni in uso", "Parametri correnti. Le capacità hanno uno storico con settimana di validità (in fondo).");
  const kv = (k, v, u) => ws.addRow([k, v, u || ""]);
  ws.addRow([]); ws.addRow(["Capacità settimanale", "Valore", "Unità"]); hdr(ws, 4);
  kv("Tecnici rilievo", cfg.tecnici, "persone"); kv("Fori per tecnico", cfg.foriTecnico, "fori/sett."); kv("Capacità rilievo", cfg.tecnici * cfg.foriTecnico, "fori/sett.");
  kv("Ante PVC", cfg.capPvc, "pezzi/sett."); kv("Alzanti PVC", cfg.capAlz, "pezzi/sett."); kv("Portoncini", cfg.capPor, "pezzi/sett."); kv("Alluminio", cfg.capAlu, "ore/sett."); kv("Reparto scuri", cfg.capScu, "ore/sett.");
  ws.addRow([]); const p2 = ws.addRow(["Tempi e parametri", "Valore", "Unità"]); hdr(ws, p2.number);
  kv("Rilievo → conferma ordine", cfg.tRil, "settimane"); kv("Conferma → ordine materiali", cfg.tCo, "settimane"); kv("Cuscinetto prima della posa", cfg.buffer, "settimane"); kv("Offerta sospesa dopo", cfg.giorniSospesa, "giorni");
  kv("Ore per anta alluminio", cfg.hAnteAlu, "ore/pezzo"); kv("Ore per alzante alluminio", cfg.hAlzAlu, "ore/pezzo"); kv("Ore per scuro PVC", cfg.hScuriPvc, "ore/pezzo"); kv("Ore per scuro alluminio", cfg.hScuriAlu, "ore/pezzo");
  ws.addRow([]); const p3 = ws.addRow(["Coda iniziale", "Settimane", ""]); hdr(ws, p3.number);
  for (const l of E.LINES) kv(l.name, cfg.coda[l.key], "settimane");
  ws.addRow([]); const p4 = ws.addRow(["Chiusure — da", "a", "% capacità disponibile"]); hdr(ws, p4.number);
  for (const c of cfg.closures) { const r = ws.addRow([c.from, c.to || c.from, c.pct]); r.getCell(3).numFmt = "0%"; }
  ws.addRow([]); const p5 = ws.addRow(["Storico capacità — valide dalla settimana", "Rilievo", "Ante PVC", "Alzanti", "Portoncini", "Alluminio", "Reparto scuri"]); hdr(ws, p5.number);
  for (const v of S.vlist) { const b = E.baseOf(v.cfg); ws.addRow([v.from === "2000-W01" ? "sempre" : v.from, b.ril, b.pvc, b.alz, b.por, b.alu, b.scu]); }
  ws.columns = [{ width: 42 }, { width: 14 }, { width: 22 }, { width: 12 }, { width: 12 }, { width: 12 }];

  /* ---- Tempi materiali ---- */
  ws = wb.addWorksheet("Tempi_Materiali", { views: [{ state: "frozen", ySplit: 3 }] });
  title(ws, "Tempi materiali (settimane)", "Standard e fuori standard per tipologia. «Prima del rilievo» = materiale da ordinare prima del rilievo.");
  ws.addRow(["Categoria", "Tipologia", "Standard", "Fuori standard", "Ordine prima del rilievo"]); hdr(ws, 3);
  for (const t of E.tipiOf(cfg)) ws.addRow([E.CATS[t.cat], t.name, t.std, t.fsd, t.early ? "sì" : ""]);
  ws.columns = [{ width: 26 }, { width: 30 }, { width: 11 }, { width: 14 }, { width: 22 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Pianificatore_Posa_${wl(S.cur)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
