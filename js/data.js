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
        let profili = [];
        if (me.ruolo === "gestore") {
          const p = await sb.from("profili").select("*").order("nome"); fail(p.error); profili = p.data;
        }
        return {
          versions: v.data.map(x => ({ id: x.id, valida_da: x.valida_da, cfg: x.cfg, creato_il: x.creato_il })),
          offerte: o.data.map(x => ({ ...x, agente_nome: x.profili ? x.profili.nome : "" })),
          occ: occ.data, profili
        };
      },
      async salva(p) {
        const { data, error } = await sb.rpc("salva_offerta", { p_id: p.id || null, p_numero: p.numero, p_cliente: p.cliente, p_input: p.input, p_piano: p.piano, p_versione: p.versione });
        fail(error); return data;
      },
      async elimina(id) { const { error } = await sb.rpc("elimina_offerta", { p_id: id }); fail(error); },
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
        offerte: []
      };
      store(mem);
    }
    const uid = () => sessionStorage.getItem(SES);
    const meOf = id => { const u = mem.users.find(x => x.id === id); return u ? { id: u.id, nome: u.nome, email: u.email, ruolo: u.ruolo } : null; };
    const occTot = () => {
      const m = {};
      for (const o of mem.offerte) for (const [k, arr] of Object.entries(o.piano.foot || {})) for (const [s, c] of arr) { const key = k + "|" + s; m[key] = (m[key] || 0) + c; }
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
          profili: me.ruolo === "gestore" ? JSON.parse(JSON.stringify(mem.users)) : []
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
          Object.assign(o, { numero: p.numero, cliente: p.cliente, input: p.input, piano: p.piano, aggiornata_il: now });
        } else {
          mem.offerte.push({ id: "o" + Date.now() + Math.random().toString(36).slice(2, 6), agente_id: me.id, numero: p.numero, cliente: p.cliente, input: p.input, piano: p.piano, creata_il: now, aggiornata_il: now, seq: mem.nextSeq++ });
        }
        mem.versione++; store(mem);
      },
      async elimina(id) {
        const me = meOf(uid()), o = mem.offerte.find(x => x.id === id);
        if (!o) return;
        if (o.agente_id !== me.id && me.ruolo !== "gestore") throw new Error("Non autorizzato.");
        mem.offerte = mem.offerte.filter(x => x.id !== id); mem.versione++; store(mem);
      },
      async saveConfig(v) { mem.versions.push({ id: mem.versions.length + 1, valida_da: v.valida_da, cfg: v.cfg, creato_il: new Date().toISOString() }); store(mem); },
      async setProfilo(id, f) { Object.assign(mem.users.find(u => u.id === id), f); store(mem); },
      reset() { localStorage.removeItem(KEY); sessionStorage.removeItem(SES); location.reload(); }
    };
  }

  window.Api = useSB ? makeSB() : makeDemo();
})();
