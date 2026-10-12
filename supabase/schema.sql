-- =====================================================================
--  Pianificatore Posa Longato — schema database (Supabase / PostgreSQL)
--  Da incollare UNA VOLTA in Supabase → SQL Editor → New query → Run.
-- =====================================================================

-- ---------- Utenti (profili) ----------
create table if not exists public.profili (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null default '',
  email      text,
  ruolo      text not null default 'agente' check (ruolo in ('agente','gestore')),
  attivo     boolean not null default true,
  creato_il  timestamptz not null default now()
);

-- Alla creazione di un utente (Authentication → Add user) nasce il profilo.
-- IL PRIMO utente creato diventa automaticamente GESTORE, gli altri AGENTI.
create or replace function public.nuovo_utente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profili(id, nome, email, ruolo)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'nome',''), split_part(new.email,'@',1)),
    new.email,
    case when exists (select 1 from public.profili where ruolo = 'gestore') then 'agente' else 'gestore' end
  );
  return new;
end $$;

drop trigger if exists su_nuovo_utente on auth.users;
create trigger su_nuovo_utente after insert on auth.users
  for each row execute function public.nuovo_utente();

create or replace function public.e_gestore() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profili where id = auth.uid() and ruolo = 'gestore' and attivo)
$$;

-- ---------- Offerte ----------
create table if not exists public.offerte (
  id             uuid primary key default gen_random_uuid(),
  agente_id      uuid not null references public.profili(id),
  numero         text not null,
  cliente        text not null,
  input          jsonb not null,           -- cosa ha inserito l'agente
  piano          jsonb not null,           -- risultato CONGELATO al salvataggio
  creata_il      timestamptz not null default now(),
  aggiornata_il  timestamptz not null default now(),
  seq            bigint generated always as identity   -- ordine di arrivo = priorità
);

-- Impronta anonima: quanta capacità occupa l'offerta, per risorsa e settimana.
create table if not exists public.occupazione (
  offerta_id uuid not null references public.offerte(id) on delete cascade,
  risorsa    text not null,
  settimana  text not null,               -- es. 2026-W45
  carico     numeric not null,
  primary key (offerta_id, risorsa, settimana)
);

-- Contatore usato per evitare che due agenti prenotino lo stesso slot nello stesso istante.
create table if not exists public.registro (
  id int primary key default 1 check (id = 1),
  versione bigint not null default 0
);
insert into public.registro(id) values (1) on conflict do nothing;

-- Impostazioni (storico versioni): ogni salvataggio crea una nuova riga.
create table if not exists public.config_versioni (
  id         bigint generated always as identity primary key,
  valida_da  text not null,                -- settimana da cui valgono le capacità, es. 2026-W48
  cfg        jsonb not null,
  creato_il  timestamptz not null default now(),
  creato_da  uuid default auth.uid()
);

-- ---------- Sicurezza (Row Level Security) ----------
alter table public.profili         enable row level security;
alter table public.offerte         enable row level security;
alter table public.occupazione     enable row level security;
alter table public.registro        enable row level security;
alter table public.config_versioni enable row level security;

drop policy if exists p_profili_sel on public.profili;
create policy p_profili_sel on public.profili for select to authenticated
  using (id = auth.uid() or public.e_gestore());
drop policy if exists p_profili_upd on public.profili;
create policy p_profili_upd on public.profili for update to authenticated
  using (public.e_gestore()) with check (public.e_gestore());

-- L'agente vede SOLO le proprie offerte; il gestore vede tutto.
-- Nessuna policy di scrittura: si scrive solo tramite le funzioni qui sotto.
drop policy if exists p_off_sel on public.offerte;
create policy p_off_sel on public.offerte for select to authenticated
  using (agente_id = auth.uid() or public.e_gestore());

drop policy if exists p_occ_sel on public.occupazione;
create policy p_occ_sel on public.occupazione for select to authenticated
  using (public.e_gestore());

drop policy if exists p_cfg_sel on public.config_versioni;
create policy p_cfg_sel on public.config_versioni for select to authenticated using (true);
drop policy if exists p_cfg_ins on public.config_versioni;
create policy p_cfg_ins on public.config_versioni for insert to authenticated
  with check (public.e_gestore());

-- ---------- Funzioni ----------
-- Occupazione totale ANONIMA (somma di tutti gli agenti, senza dire di chi sono gli slot).
create or replace function public.occupazione_totale() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  return jsonb_build_object(
    'versione', (select versione from registro where id = 1),
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object('r', risorsa, 's', settimana, 'c', tot))
      from (select risorsa, settimana, sum(carico) as tot from occupazione group by 1, 2) x
    ), '[]'::jsonb));
end $$;

-- Salva (crea o modifica) un'offerta. Il piano è congelato; fallisce con CONFLITTO se
-- nel frattempo qualcun altro ha salvato (il sito ricalcola e riprova da solo).
create or replace function public.salva_offerta(
  p_id uuid, p_numero text, p_cliente text, p_input jsonb, p_piano jsonb, p_versione bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v bigint; oid uuid; ag uuid;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  if not exists (select 1 from profili where id = auth.uid() and attivo) then raise exception 'account disattivato'; end if;
  select versione into v from registro where id = 1 for update;
  if v <> p_versione then raise exception 'CONFLITTO'; end if;

  if p_id is null then
    insert into offerte(agente_id, numero, cliente, input, piano)
    values (auth.uid(), p_numero, p_cliente, p_input, p_piano) returning id into oid;
  else
    select agente_id into ag from offerte where id = p_id;
    if ag is null then raise exception 'offerta inesistente'; end if;
    if ag <> auth.uid() and not public.e_gestore() then raise exception 'non autorizzato'; end if;
    update offerte set numero = p_numero, cliente = p_cliente, input = p_input, piano = p_piano,
                       aggiornata_il = now() where id = p_id;
    delete from occupazione where offerta_id = p_id;
    oid := p_id;
  end if;

  insert into occupazione(offerta_id, risorsa, settimana, carico)
  select oid, a.key, e.value->>0, (e.value->>1)::numeric
  from jsonb_each(coalesce(p_piano->'foot', '{}'::jsonb)) a,
       jsonb_array_elements(a.value) e;

  update registro set versione = versione + 1 where id = 1;
  return oid;
end $$;

-- Elimina un'offerta: lo slot si libera (le altre offerte confermate NON si spostano).
create or replace function public.elimina_offerta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ag uuid;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  perform 1 from registro where id = 1 for update;
  select agente_id into ag from offerte where id = p_id;
  if ag is null then return; end if;
  if ag <> auth.uid() and not public.e_gestore() then raise exception 'non autorizzato'; end if;
  delete from offerte where id = p_id;
  update registro set versione = versione + 1 where id = 1;
end $$;

grant execute on function public.occupazione_totale() to authenticated;
grant execute on function public.salva_offerta(uuid, text, text, jsonb, jsonb, bigint) to authenticated;
grant execute on function public.elimina_offerta(uuid) to authenticated;

-- Prima versione delle impostazioni (valori standard; il gestore le modifica dal sito).
-- Il sito scrive la configurazione completa al primo salvataggio; finché non c'è, usa i valori standard.
