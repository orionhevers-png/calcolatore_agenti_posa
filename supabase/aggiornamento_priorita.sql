-- =====================================================================
--  Aggiornamento: PRIORITÀ ALLE COMMESSE CONFERMATE
--  Da incollare UNA VOLTA in Supabase → SQL Editor → New query → Run.
--  Prima esegui, se non l'hai già fatto, aggiornamento_piano_reale.sql.
--  È sicuro rieseguirlo. Non cancella nessun dato.
-- =====================================================================

-- 1) Data definitiva visibile all'agente (scritta dal gestore: data approvata, ultimo spostamento e motivo)
alter table public.offerte add column if not exists definitiva jsonb;

-- 2) L'occupazione anonima ora comprende anche le commesse confermate (hanno la precedenza)
create or replace function public.occupazione_totale() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'non autenticato'; end if;
  return jsonb_build_object(
    'versione', (select versione from registro where id = 1),
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object('r', r, 's', s, 'c', tot))
      from (
        select r, s, sum(c) as tot from (
          select risorsa as r, settimana as s, carico as c from occupazione
          union all
          select a.key, e.value->>0, (e.value->>1)::numeric
          from piano_reale p, jsonb_each(coalesce(p.piano->'foot', '{}'::jsonb)) a, jsonb_array_elements(a.value) e
        ) u group by r, s
      ) x
    ), '[]'::jsonb));
end $$;

-- 3) Il gestore scrive la data definitiva mostrata all'agente
create or replace function public.imposta_definitiva(p_id uuid, p_def jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.e_gestore() then raise exception 'non autorizzato'; end if;
  update offerte set definitiva = p_def where id = p_id;
end $$;

-- 4) Il gestore ricalcola le stime provvisorie (arancioni) attorno alle commesse confermate (blu)
create or replace function public.ricalcola_stime(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb; oid uuid;
begin
  if not public.e_gestore() then raise exception 'non autorizzato'; end if;
  perform 1 from registro where id = 1 for update;
  -- un'offerta con commessa non occupa più come stima provvisoria
  delete from occupazione where offerta_id in (select id from offerte where commessa is not null);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    oid := (it->>'id')::uuid;
    update offerte set piano = it->'piano' where id = oid and commessa is null;
    if found then
      delete from occupazione where offerta_id = oid;
      insert into occupazione(offerta_id, risorsa, settimana, carico)
      select oid, a.key, e.value->>0, (e.value->>1)::numeric
      from jsonb_each(coalesce(it->'piano'->'foot', '{}'::jsonb)) a, jsonb_array_elements(a.value) e;
    end if;
  end loop;
  update registro set versione = versione + 1 where id = 1;
end $$;

grant execute on function public.occupazione_totale() to authenticated;
grant execute on function public.imposta_definitiva(uuid, jsonb) to authenticated;
grant execute on function public.ricalcola_stime(jsonb) to authenticated;
