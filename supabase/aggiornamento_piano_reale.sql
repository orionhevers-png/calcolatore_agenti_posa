-- =====================================================================
--  Aggiornamento: PIANO REALE + OFFERTE SOSPESE
--  Da incollare UNA VOLTA in Supabase → SQL Editor → New query → Run.
--  È sicuro eseguirlo anche più volte. Non cancella nessun dato.
-- =====================================================================

-- 1) Numero di commessa sull'offerta (lo assegna il gestore dal Piano reale)
alter table public.offerte add column if not exists commessa text;

-- 2) Piano reale: una riga per ogni commessa confermata (visibile solo al gestore)
create table if not exists public.piano_reale (
  id            uuid primary key default gen_random_uuid(),
  offerta_id    uuid references public.offerte(id) on delete set null,
  offerta_num   text,                         -- copie, così la riga resta anche se l'offerta viene eliminata
  cliente       text,
  agente_nome   text,
  posa_agente   text,                         -- settimana di posa stimata dall'agente (solo confronto)
  commessa      text not null,
  input         jsonb not null,               -- composizione (modificabile dal gestore, l'offerta resta com'è)
  rilievo       text not null,                -- settimana assegnata al rilievo, es. 2026-W45
  posa_rich     text,                         -- posa desiderata dal cliente (se c'è)
  manuali       jsonb not null default '{}'::jsonb,   -- date modificate a mano dal gestore
  piano         jsonb not null,               -- risultato del calcolo
  creata_il     timestamptz not null default now(),
  aggiornata_il timestamptz not null default now(),
  seq           bigint generated always as identity
);
create unique index if not exists piano_reale_offerta_uq on public.piano_reale(offerta_id) where offerta_id is not null;

alter table public.piano_reale enable row level security;
drop policy if exists p_pr_all on public.piano_reale;
create policy p_pr_all on public.piano_reale for all to authenticated
  using (public.e_gestore()) with check (public.e_gestore());
grant select, insert, update, delete on public.piano_reale to authenticated;

-- 3) Il gestore assegna (o toglie) il numero di commessa a un'offerta
create or replace function public.imposta_commessa(p_id uuid, p_commessa text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.e_gestore() then raise exception 'non autorizzato'; end if;
  update offerte set commessa = nullif(trim(p_commessa), ''), aggiornata_il = now() where id = p_id;
end $$;

-- 4) Riprogramma un'offerta sospesa: stessi dati, la data di inserimento diventa oggi
create or replace function public.riprogramma_offerta(
  p_id uuid, p_input jsonb, p_piano jsonb, p_versione bigint
) returns void
language plpgsql security definer set search_path = public as $$
declare v bigint; ag uuid; com text;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  if not exists (select 1 from profili where id = auth.uid() and attivo) then raise exception 'account disattivato'; end if;
  select versione into v from registro where id = 1 for update;
  if v <> p_versione then raise exception 'CONFLITTO'; end if;
  select agente_id, commessa into ag, com from offerte where id = p_id;
  if ag is null then raise exception 'offerta inesistente'; end if;
  if ag <> auth.uid() and not public.e_gestore() then raise exception 'non autorizzato'; end if;
  if com is not null then raise exception 'offerta già confermata'; end if;
  update offerte set input = p_input, piano = p_piano, creata_il = now(), aggiornata_il = now() where id = p_id;
  delete from occupazione where offerta_id = p_id;
  insert into occupazione(offerta_id, risorsa, settimana, carico)
  select p_id, a.key, e.value->>0, (e.value->>1)::numeric
  from jsonb_each(coalesce(p_piano->'foot', '{}'::jsonb)) a,
       jsonb_array_elements(a.value) e;
  update registro set versione = versione + 1 where id = 1;
end $$;

-- 5) Un'offerta confermata (con commessa) non la modifica né la cancella più l'agente
create or replace function public.salva_offerta(
  p_id uuid, p_numero text, p_cliente text, p_input jsonb, p_piano jsonb, p_versione bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v bigint; oid uuid; ag uuid; com text;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  if not exists (select 1 from profili where id = auth.uid() and attivo) then raise exception 'account disattivato'; end if;
  select versione into v from registro where id = 1 for update;
  if v <> p_versione then raise exception 'CONFLITTO'; end if;

  if p_id is null then
    insert into offerte(agente_id, numero, cliente, input, piano)
    values (auth.uid(), p_numero, p_cliente, p_input, p_piano) returning id into oid;
  else
    select agente_id, commessa into ag, com from offerte where id = p_id;
    if ag is null then raise exception 'offerta inesistente'; end if;
    if ag <> auth.uid() and not public.e_gestore() then raise exception 'non autorizzato'; end if;
    if com is not null and not public.e_gestore() then raise exception 'offerta già confermata'; end if;
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

create or replace function public.elimina_offerta(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ag uuid; com text;
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  perform 1 from registro where id = 1 for update;
  select agente_id, commessa into ag, com from offerte where id = p_id;
  if ag is null then return; end if;
  if ag <> auth.uid() and not public.e_gestore() then raise exception 'non autorizzato'; end if;
  if com is not null and not public.e_gestore() then raise exception 'offerta già confermata'; end if;
  delete from offerte where id = p_id;
  update registro set versione = versione + 1 where id = 1;
end $$;

grant execute on function public.imposta_commessa(uuid, text) to authenticated;
grant execute on function public.riprogramma_offerta(uuid, jsonb, jsonb, bigint) to authenticated;
grant execute on function public.salva_offerta(uuid, text, text, jsonb, jsonb, bigint) to authenticated;
grant execute on function public.elimina_offerta(uuid) to authenticated;
