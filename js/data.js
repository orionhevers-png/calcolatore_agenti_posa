/* Livello dati: Supabase (produzione) oppure demo locale (localStorage).
   Entrambi espongono la stessa interfaccia, così l'interfaccia utente non cambia. */
(function () {
  const cfgApp = window.APP_CONFIG || {};
  const useSB = !!(cfgApp.SUPABASE_URL && cfgApp.SUPABASE_ANON_KEY && window.supabase);

  /* ================= SUPABASE ================= */
  function makeSB() {
    const sb = window.supabase.createClient(cfgApp.SUPABASE_URL, cfgApp.SUPABASE_ANON_KEY);
    const fail = e => { if (e) { const err = new Error(e.message || String(e)); err.conflict = /CONFLITTO/.test(e.message || ""); throw err; } };
    async function profilo() {
      const { data: s } = await sb.auth.getSession();
      if (!s.session) return null;
      const { data, error } = await sb.from("profili").select("*").eq("id", s.session.user.id).maybeSingle();
      fail(error);
      if (!data) return null;
      if (!data.attivo) { await sb.auth.signOut(); throw new Error("Account disattivato. Contatta il gestore."); }
      return { id: data.id, nome: data.nome || data.email, email: data.email, ruolo: data.ruolo };
    }
    return {
      mode: "supabase",
      init: profilo,
      async login(email, pw) {
        const { error } = await sb.auth.signInWithPassword({ email, password: pw });
        if (error) throw new Error("Email o password non corrette.");
        return profilo();
      },
      logout: async () => { await sb.auth.signOut(); },
      async fetchAll(me) {
        const [v, o, occ] = await Promise.all([
          sb.from("config_versioni").select("*").order("id"),
          sb.from("offerte").select("*, profili(nome)").order("seq"),
          sb.rpc("occupazione_totale")
        ]);
        fail(v.error); fail(o.error); fail(occ.error);
        let profili = [], piano = [];
        if (me.ruolo === "gestore") {
          const p = await sb.from("profili").select("*").order("nome"); fail(p.error); profili = p.data;
          const pr = await sb.from("piano_reale").select("*").order("seq");   // se lo script SQL non è ancora stato eseguito: lista vuota
          piano = pr.error ? [] : pr.data;
        }
        return {
          versions: v.data.map(x => ({ id: x.id, valida_da: x.valida_da, cfg: x.cfg, creato_il: x.creato_il })),
          offerte: o.data.map(x => ({ ...x, agente_nome: x.profili ? x.profili.nome : "" })),
          occ: occ.data, profili, piano
        };
      },
      async salva(p) {
        const { data, error } = await sb.rpc("salva_offerta", { p_id: p.id || null, p_numero: p.numero, p_cliente: p.cliente, p_input: p.input, p_piano: p.piano, p_versione: p.versione });
        fail(error); return data;
      },
      async elimina(id) { const { error } = await sb.rpc("elimina_offerta", { p_id: id }); fail(error); },
      async riprogramma(p) {
        const { error } = await sb.rpc("riprogramma_offerta", { p_id: p.id, p_input: p.input, p_piano: p.piano, p_versione: p.versione });
        if (error && /riprogramma_offerta|schema cache/.test(error.message)) error.message = "Manca l'aggiornamento del database: il gestore deve eseguire lo script «aggiornamento_piano_reale.sql» in Supabase.";
        fail(error);
      },
      async impostaCommessa(id, commessa) { const { error } = await sb.rpc("imposta_commessa", { p_id: id, p_commessa: commessa || "" }); fail(error); },
      async impostaDefinitiva(id, def) {
        const { error } = await sb.rpc("imposta_definitiva", { p_id: id, p_def: def });
        if (error && /imposta_definitiva|schema cache/.test(error.message)) error.message = "Manca l'aggiornamento del database: esegui lo script «aggiornamento_priorita.sql» in Supabase → SQL Editor.";
        fail(error);
      },
      async ricalcolaStime(items) {
        const { error } = await sb.rpc("ricalcola_stime", { p_items: items });
        if (error && /ricalcola_stime|schema cache/.test(error.message)) error.message = "Manca l'aggiornamento del database: esegui lo script «aggiornamento_priorita.sql» in Supabase → SQL Editor.";
        fail(error);
      },
      async pianoSalva(r) {
        const row = { offerta_id: r.offerta_id || null, offerta_num: r.offerta_num, cliente: r.cliente, agente_nome: r.agente_nome, posa_agente: r.posa_agente || null, commessa: r.commessa, input: r.input, rilievo: r.rilievo, posa_rich: r.posa_rich || null, manuali: r.manuali || {}, note: r.note || null, approvata: !!r.approvata, piano: r.piano, aggiornata_il: new Date().toISOString() };
        const q = r.id ? sb.from("piano_reale").update(row).eq("id", r.id) : sb.from("piano_reale").insert(row);
        const { error } = await q;
        if (error && /piano_reale|schema cache/.test(error.message)) error.message = "Manca l'aggiornamento del database: esegui di nuovo lo script «aggiornamento_piano_reale.sql» in Supabase → SQL Editor.";
        fail(error);
      },
      async pianoElimina(id) { const { error } = await sb.from("piano_reale").delete().eq("id", id); fail(error); },
      async saveConfig(v) { const { error } = await sb.from("config_versioni").insert({ valida_da: v.valida_da, cfg: v.cfg }); fail(error); },
      async setProfilo(id, f) { const { error } = await sb.from("profili").update(f).eq("id", id); fail(error); }
    };
  }

  /* ================= DEMO LOCALE ================= */
  function makeDemo() {
    const KEY = "posa_demo_v1", SES = "posa_demo_ses";
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
    const store = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } };
    let mem = load();
    if (!mem) {
      mem = {
        versione: 0, nextSeq: 1,
        users: [
          { id: "u0", email: "gestore@demo", nome: "Giulia (gestore)", ruolo: "gestore", attivo: true },
          { id: "u1", email: "rossi@demo", nome: "Mario Rossi", ruolo: "agente", attivo: true },
          { id: "u2", email: "bianchi@demo", nome: "Anna Bianchi", ruolo: "agente", attivo: true }
        ],
        versions: [{ id: 1, valida_da: "2000-W01", cfg: window.Engine.defaultCfg(), creato_il: new Date().toISOString() }],
        offerte: [], piano: [], nextPr: 1
      };
      store(mem);
    }
    if (!mem.piano) { mem.piano = []; mem.nextPr = 1; }
    const uid = () => sessionStorage.getItem(SES);
    const meOf = id => { const u = mem.users.find(x => x.id === id); return u ? { id: u.id, nome: u.nome, email: u.email, ruolo: u.ruolo } : null; };
    const occTot = () => {
      const m = {};
      for (const o of mem.offerte) if (!o.commessa) for (const [k, arr] of Object.entries(o.piano.foot || {})) for (const [s, c] of arr) { const key = k + "|" + s; m[key] = (m[key] || 0) + c; }
      for (const p of mem.piano) for (const [k, arr] of Object.entries((p.piano && p.piano.foot) || {})) for (const [s, c] of arr) { const key = k + "|" + s; m[key] = (m[key] || 0) + c; }   // commesse confermate: precedenza
      return { versione: mem.versione, righe: Object.entries(m).map(([key, c]) => { const [r, s] = key.split("|"); return { r, s, c }; }) };
    };
    return {
      mode: "demo",
      demoUsers: () => mem.users,
      empty: () => mem.offerte.length === 0,
      init: async () => (uid() ? meOf(uid()) : null),
      async login(email) {
        const u = mem.users.find(x => x.email === String(email).trim().toLowerCase());
        if (!u) throw new Error("Utente demo non trovato.");
        sessionStorage.setItem(SES, u.id); return meOf(u.id);
      },
      logout: async () => sessionStorage.removeItem(SES),
      async fetchAll(me) {
        const mine = o => me.ruolo === "gestore" || o.agente_id === me.id;
        return {
          versions: JSON.parse(JSON.stringify(mem.versions)),
          offerte: JSON.parse(JSON.stringify(mem.offerte.filter(mine))).map(o => ({ ...o, agente_nome: (mem.users.find(u => u.id === o.agente_id) || {}).nome || "" })),
          occ: occTot(),
          profili: me.ruolo === "gestore" ? JSON.parse(JSON.stringify(mem.users)) : [],
          piano: me.ruolo === "gestore" ? JSON.parse(JSON.stringify(mem.piano)) : []
        };
      },
      async salva(p) {
        const me = meOf(uid());
        if (p.versione !== mem.versione) { const e = new Error("CONFLITTO"); e.conflict = true; throw e; }
        const now = new Date().toISOString();
        if (p.id) {
          const o = mem.offerte.find(x => x.id === p.id);
          if (!o) throw new Error("Offerta inesistente.");
          if (o.agente_id !== me.id && me.ruolo !== "gestore") throw new Error("Non autorizzato.");
          if (o.commessa && me.ruolo !== "gestore") throw new Error("offerta già confermata");
          Object.assign(o, { numero: p.numero, cliente: p.cliente, input: p.input, piano: p.piano, aggiornata_il: now });
        } else {
          mem.offerte.push({ id: "o" + Date.now() + Math.random().toString(36).slice(2, 6), agente_id: me.id, numero: p.numero, cliente: p.cliente, input: p.input, piano: p.piano, creata_il: p.creata_il || now, aggiornata_il: now, seq: mem.nextSeq++ });
        }
        mem.versione++; store(mem);
      },
      async elimina(id) {
        const me = meOf(uid()), o = mem.offerte.find(x => x.id === id);
        if (!o) return;
        if (o.agente_id !== me.id && me.ruolo !== "gestore") throw new Error("Non autorizzato.");
        if (o.commessa && me.ruolo !== "gestore") throw new Error("offerta già confermata");
        mem.piano.forEach(x => { if (x.offerta_id === id) x.offerta_id = null; });
        mem.offerte = mem.offerte.filter(x => x.id !== id); mem.versione++; store(mem);
      },
      async riprogramma(p) {
        const me = meOf(uid()), o = mem.offerte.find(x => x.id === p.id);
        if (p.versione !== mem.versione) { const e = new Error("CONFLITTO"); e.conflict = true; throw e; }
        if (!o) throw new Error("Offerta inesistente.");
        if (o.agente_id !== me.id && me.ruolo !== "gestore") throw new Error("Non autorizzato.");
        if (o.commessa) throw new Error("offerta già confermata");
        const now = new Date().toISOString();
        Object.assign(o, { input: p.input, piano: p.piano, creata_il: now, aggiornata_il: now });
        mem.versione++; store(mem);
      },
      async impostaCommessa(id, commessa) {
        const o = mem.offerte.find(x => x.id === id); if (!o) return;
        o.commessa = String(commessa || "").trim() || null; store(mem);
      },
      async impostaDefinitiva(id, def) { const o = mem.offerte.find(x => x.id === id); if (o) { o.definitiva = def; store(mem); } },
      async ricalcolaStime(items) {
        for (const it of items) { const o = mem.offerte.find(x => x.id === it.id); if (o && !o.commessa) o.piano = it.piano; }
        mem.versione++; store(mem);
      },
      async pianoSalva(r) {
        const now = new Date().toISOString();
        const row = { offerta_id: r.offerta_id || null, offerta_num: r.offerta_num, cliente: r.cliente, agente_nome: r.agente_nome, posa_agente: r.posa_agente || null, commessa: r.commessa, input: r.input, rilievo: r.rilievo, posa_rich: r.posa_rich || null, manuali: r.manuali || {}, note: r.note || null, approvata: !!r.approvata, piano: r.piano, aggiornata_il: now };
        if (r.id) Object.assign(mem.piano.find(x => x.id === r.id), row);
        else mem.piano.push({ id: "p" + Date.now() + Math.random().toString(36).slice(2, 6), ...row, creata_il: now, seq: mem.nextPr++ });
        store(mem);
      },
      async pianoElimina(id) { mem.piano = mem.piano.filter(x => x.id !== id); store(mem); },
      async saveConfig(v) { mem.versions.push({ id: mem.versions.length + 1, valida_da: v.valida_da, cfg: v.cfg, creato_il: new Date().toISOString() }); store(mem); },
      async setProfilo(id, f) { Object.assign(mem.users.find(u => u.id === id), f); store(mem); },
      reset() { localStorage.removeItem(KEY); sessionStorage.removeItem(SES); location.reload(); }
    };
  }

  window.Api = useSB ? makeSB() : makeDemo();
})();
