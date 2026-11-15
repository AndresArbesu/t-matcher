-- Skill levels are 1..5 (was 1..10).
--
-- Forward-only and non-destructive: it never rewrites a player row. If any
-- player is still above 5 it aborts BEFORE touching the constraint, so the
-- existing 1..10 rule stays in force and nothing is lost. Fix those rows by
-- hand (decide what each player's 1..5 level should be), then re-run:
--
--   select id, owner_id, name, skill_level from public.players where skill_level > 5;
--   update public.players set skill_level = 5 where id = '...';  -- your decision
--
-- Safe to run more than once. Runs in one transaction in the SQL editor and in
-- `supabase db push`, so the drop and the add succeed or fail together.

do $$
declare
  v_count integer;
  v_con text;
begin
  select count(*) into v_count from public.players where skill_level > 5;
  if v_count > 0 then
    raise exception 'cannot limit skill_level to 1..5: % player(s) are above 5. No data was changed. Review them with: select id, owner_id, name, skill_level from public.players where skill_level > 5;', v_count;
  end if;

  -- The v0 migration left the check unnamed, so find it by what it constrains.
  for v_con in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.players'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%skill_level%'
  loop
    execute format('alter table public.players drop constraint %I', v_con);
  end loop;

  alter table public.players
    add constraint players_skill_level_1_5 check (skill_level between 1 and 5);
end $$;
