-- Persistent, owner-scoped storage for the tennis scheduler.
--
-- One organizer per Supabase Auth account. Every row carries owner_id and is
-- visible/writable only to that user (RLS, authenticated role only). There are
-- no PUBLIC or anon policies. History is never cascaded away by player or
-- participant removal: players are soft-deactivated, and foreign keys to players
-- use NO ACTION so a player or participant that appears in a match cannot be
-- deleted. Only deleting the whole auth user cascades (account removal).
--
-- Apply to a NEW Supabase project (SQL editor or `supabase db push`). It
-- intentionally refuses to run over the legacy v0 schema (match_history).

do $$
begin
  if to_regclass('public.match_history') is not null then
    raise exception 'legacy v0 schema detected (public.match_history). Use a fresh Supabase project; the legacy tables have public RLS policies and cascading deletes.';
  end if;
end $$;

-- ---------------------------------------------------------------- players
create table public.players (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  skill_level integer not null check (skill_level between 1 and 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_id, id)
);
create unique index players_owner_name_key on public.players (owner_id, lower(name));

-- --------------------------------------------------------------- sessions
-- One dated session per owner per day.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, session_date)
);

-- Players selected for a session. Composite FKs make cross-owner references
-- impossible even when a foreign ID is known. The history-protecting FKs are
-- NO ACTION and DEFERRED: a standalone delete of a referenced row still fails at
-- commit, but deleting a whole account can cascade through every table first.
create table public.session_players (
  session_id uuid not null,
  player_id uuid not null,
  owner_id uuid not null default auth.uid(),
  primary key (session_id, player_id),
  foreign key (owner_id, session_id) references public.sessions (owner_id, id) on delete cascade,
  foreign key (owner_id, player_id) references public.players (owner_id, id) deferrable initially deferred
);

-- Ordered matches of a session. `played` marks a match as part of history.
create table public.session_matches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  session_id uuid not null,
  position integer not null check (position >= 0),
  team1_player1_id uuid not null,
  team1_player2_id uuid not null,
  team2_player1_id uuid not null,
  team2_player2_id uuid not null,
  locked boolean not null default false,
  played boolean not null default false,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (session_id, position),
  foreign key (owner_id, session_id) references public.sessions (owner_id, id) on delete cascade,
  -- every player must be a participant of this very session
  foreign key (session_id, team1_player1_id) references public.session_players (session_id, player_id) deferrable initially deferred,
  foreign key (session_id, team1_player2_id) references public.session_players (session_id, player_id) deferrable initially deferred,
  foreign key (session_id, team2_player1_id) references public.session_players (session_id, player_id) deferrable initially deferred,
  foreign key (session_id, team2_player2_id) references public.session_players (session_id, player_id) deferrable initially deferred,
  constraint four_distinct_players check (
    team1_player1_id <> team1_player2_id
    and team1_player1_id <> team2_player1_id
    and team1_player1_id <> team2_player2_id
    and team1_player2_id <> team2_player1_id
    and team1_player2_id <> team2_player2_id
    and team2_player1_id <> team2_player2_id
  )
);
create index session_matches_session_idx on public.session_matches (session_id, position);
create index session_matches_played_idx on public.session_matches (owner_id) where played;

-- ------------------------------------------------------------------ grants
-- Supabase grants new tables to anon/authenticated by default; start from nothing.
revoke all on public.players, public.sessions, public.session_players, public.session_matches
  from public, anon, authenticated;

grant select, insert on public.players to authenticated;
grant update (name, skill_level, active) on public.players to authenticated;  -- no delete: soft inactive only

grant select, insert on public.sessions to authenticated;
grant update (updated_at) on public.sessions to authenticated;                -- no delete

grant select, insert, delete on public.session_players to authenticated;

grant select, insert, delete on public.session_matches to authenticated;
grant update (played, notes, locked) on public.session_matches to authenticated;

-- --------------------------------------------------------------------- RLS
alter table public.players enable row level security;
alter table public.sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.session_matches enable row level security;
alter table public.players force row level security;
alter table public.sessions force row level security;
alter table public.session_players force row level security;
alter table public.session_matches force row level security;

create policy players_select on public.players for select to authenticated
  using (owner_id = (select auth.uid()));
create policy players_insert on public.players for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy players_update on public.players for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy sessions_select on public.sessions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy sessions_update on public.sessions for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy session_players_select on public.session_players for select to authenticated
  using (owner_id = (select auth.uid()));
create policy session_players_insert on public.session_players for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy session_players_delete on public.session_players for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy session_matches_select on public.session_matches for select to authenticated
  using (owner_id = (select auth.uid()));
create policy session_matches_insert on public.session_matches for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy session_matches_update on public.session_matches for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Played matches are history and cannot be deleted; un-record them first.
create policy session_matches_delete on public.session_matches for delete to authenticated
  using (owner_id = (select auth.uid()) and not played);

-- ---------------------------------------------------------------- function
-- Atomically saves a session draft: upserts the dated session, replaces the
-- participant list and the unplayed matches. Played matches are history and are
-- kept; new matches are appended after them. SECURITY INVOKER: RLS and the
-- composite FKs apply, so foreign player IDs fail rather than being accepted.
create function public.save_session_draft(p_date date, p_participants uuid[], p_matches jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_session uuid;
  v_base integer;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_date is null or p_participants is null or jsonb_typeof(p_matches) is distinct from 'array' then
    raise exception 'invalid draft' using errcode = '23514';
  end if;

  insert into sessions (owner_id, session_date) values (v_owner, p_date)
  on conflict (owner_id, session_date) do update set updated_at = now()
  returning id into v_session;

  delete from session_matches where session_id = v_session and not played;

  -- Fails with a foreign-key error if a played match still uses the participant.
  delete from session_players where session_id = v_session and player_id <> all (p_participants);

  insert into session_players (session_id, player_id, owner_id)
  select v_session, p, v_owner from unnest(p_participants) as p
  on conflict do nothing;

  select coalesce(max(position) + 1, 0) into v_base from session_matches where session_id = v_session;

  insert into session_matches (owner_id, session_id, position, team1_player1_id, team1_player2_id,
                               team2_player1_id, team2_player2_id, locked)
  select v_owner, v_session, v_base + (t.ord - 1)::integer,
         (t.m -> 'team1' ->> 0)::uuid, (t.m -> 'team1' ->> 1)::uuid,
         (t.m -> 'team2' ->> 0)::uuid, (t.m -> 'team2' ->> 1)::uuid,
         coalesce((t.m ->> 'locked')::boolean, false)
  from jsonb_array_elements(p_matches) with ordinality as t(m, ord);

  return v_session;
end;
$$;

revoke all on function public.save_session_draft(date, uuid[], jsonb) from public, anon;
grant execute on function public.save_session_draft(date, uuid[], jsonb) to authenticated;
