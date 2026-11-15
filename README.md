# t-matcher

A Next.js tennis/padel doubles scheduler imported from the v0 `match-history-persistence.zip` export. This replaces the old Java prototype on `main` while preserving its commits in Git history.

Hosting is intentionally undecided. The code is compatible with a Next.js host and Supabase, but nothing here deploys or configures a hosted service.

### Deployment decision (deferred)

Vercel Hobby + Supabase Free is the lowest-friction **personal, non-commercial** trial path. [Vercel restricts Hobby to non-commercial use](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage); use a paid plan or another host if this becomes a commercial product. [Supabase Free](https://supabase.com/pricing) has a 500 MB database, pauses after a week of inactivity, and offers no automatic backups. Before publishing: identify whether the former Vercel/Supabase projects still exist and export their data if possible; create/verify a durable hosted database and backup/restore procedure; apply and review the migration; set the hosted URL/anon key and auth redirect allowlist; then deploy a reviewed commit and test sign-in, session reload, lock/regeneration and cross-account isolation on the actual production URL. Do not put service-role keys in the browser or treat the disposable local stack as production data.

## What it does

- One organizer per account signs in with Supabase Auth (email code or magic link). Everything is private to that account.
- A persistent **roster** of players (stable IDs, skill, soft "inactive" instead of deletion).
- A **dated session** per day: choose participants, generate arrangements (multiples of four players), lock matches, regenerate the unlocked ones, **save**, and reload later with participants, match order and lock states intact.
- **Record** saved matches as played; played matches become the history that scores later suggestions (weights below). Un-recording removes a match from history but keeps it on its session.

## How arrangements are generated and scored

**Generation** (`lib/match-analyzer.ts`): for a roster that is a multiple of four, the analyzer draws up to `DEFAULT_SAMPLING.maxSamples` (400) random *complete* schedules (shuffle, cut into foursomes, random team split each), scores every schedule as a whole (sum of its match scores), deduplicates them by canonical form (players sorted inside teams, teams and matches sorted), ranks best-first, and returns up to 3 that differ from each other in at least 2 matches (when fewer qualify it falls back to the next best unique ones). Four players are enumerated outright: there are exactly 3 team splits. Match evaluations are bounded by `maxSamples × matches per schedule`. "Regenerate" refills only unlocked slots from the same ranked remainders and skips the schedule currently shown; locked matches are returned untouched. This is a sample, not a proof of optimality; for 8 players the 315 possible schedules are covered almost completely, for 20 players only a tiny fraction is.

**Scoring** (lower is better), all weights in `DEFAULT_RULES`:

| Rule | Default | Meaning |
| --- | --- | --- |
| `skillDifferenceWeight` | 10 | per point of difference between the teams' summed skill |
| `rivalPairPenalty` | 1000 | per earlier match with exactly the same two teams |
| `individualRivalPenalty` | 500 | per opposing player pair that was also on opposite sides in an earlier match |
| `ownPairPenalty` | 300 | per earlier match in which either current team was already a team |
| `recentWindowDays` | 7 | a repeat within this many days is "recent" |
| `recentMultiplier` | 3 | multiplies the three repeat penalties when recent |
| `recentPlayPenalty` | 2000 | flat extra when recent |

Individual rivals are counted per opposing *pair*, so facing someone you met before counts even if the other players differ. Players who were partners before are not counted as rivals, and an exact rematch is counted once, as a rival pair, not again as four individual rivals. An exact rematch still also triggers the own-pair penalty for both teams (unchanged from before).

## Setup

1. Create a **new** Supabase project (the migration refuses to run over the legacy v0 schema).
2. Apply `supabase/migrations/20261115000000_persistent_scheduler.sql`: paste it into the SQL editor, or `supabase link` + `supabase db push` if you use the CLI. Read it first; it creates four tables with RLS enabled and forced, revokes default grants, and adds the `save_session_draft` function.
   Then apply `supabase/migrations/20261116000000_skill_levels_1_to_5.sql` (limits skill to 1–5). On a database that already holds players it first counts any player above 5 and, if there are any, aborts with a message **without changing data or the old constraint**; review them with `select id, name, skill_level from public.players where skill_level > 5;`, choose their new 1–5 level yourself, then re-run it.
3. In Auth settings: enable the Email provider; add `http://localhost:3000/auth/callback` (and your own deployed URL later) to the redirect URLs. For the emailed **code** option, include `{{ .Token }}` in the Magic Link email template; the link works without it. After you have signed in once, consider turning off "Allow new users to sign up" so nobody else can create an account on your project.
4. Configure and run:

```sh
npm ci
cp .env.example .env.local   # fill in URL + anon key only
npm run dev
```

No service-role key is used or needed. Without the two env vars the page shows a "not configured" message instead of crashing.

For an isolated local integration test, run `npx supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`, copy the local API URL and **anon** key from `npx supabase status` into `.env.local`, then start `npm run dev -- -H 127.0.0.1 -p 3000`. `node --env-file=.env.local scripts/local-smoke.mjs` creates two synthetic accounts via the local Mailpit service and checks real HTTP API/RLS behavior. It refuses nonlocal URLs. `npx supabase stop` shuts down the containers afterward. Local test data is disposable; the real hosted project is a separate step.

## Data model and safety

| Table | Purpose |
| --- | --- |
| `players` | `owner_id`, name (unique per owner, case-insensitive), skill 1–5, `active` |
| `sessions` | one per owner per `session_date` |
| `session_players` | participants of a session |
| `session_matches` | ordered (`position`) matches, four distinct players, `locked`, `played`, `notes` |

- RLS: `authenticated` only, owner-scoped (`owner_id = auth.uid()`) on every command. No `PUBLIC`/`anon` policies, no `using (true)`.
- Composite foreign keys include `owner_id`, so a row can never reference another account's player or session even if its ID is known. Match players must be participants of that same session.
- History is preserved: players cannot be deleted (no `DELETE` grant; "Remove" deactivates), a participant used in a match cannot be removed, played matches cannot be deleted. Those foreign keys are `NO ACTION` and deferred, so only deleting the whole auth user cascades everything.
- Saving a session draft goes through `save_session_draft` (`SECURITY INVOKER`, so RLS applies): it replaces participants and *unplayed* matches atomically and keeps played ones.
- The old `match_history` table/API, its public policies and cascading deletes were removed. This version has no migration path for data in the legacy schema.

API routes (`app/api`) return 401 without a valid user (checked with `auth.getUser()`), 400 for invalid payloads, 422 when a referenced player is not yours, 404/409 as appropriate, and only fixed error codes — provider messages are logged as a type at most and never returned.

## Tests and checks

```sh
npm test            # vitest: validation, API routes, UI, and the SQL migration on real Postgres (PGlite)
npx tsc --noEmit
npm run build
```

What the tests do and do not prove:

- The migration is executed against an in-process Postgres (PGlite) with stand-ins for Supabase's `anon`/`authenticated` roles, `auth.users` and `auth.uid()`. RLS, constraints, grants, FK behavior and the draft function are genuinely exercised there.
- The local smoke script has also run against a real Supabase CLI stack (GoTrue, PostgREST, Postgres, Mailpit) and a real Next server. It checked two-account isolation, player writes, draft save/reload, cross-account write rejection and played history. The local browser was used to sign in via a synthetic magic link, generate an eight-player schedule, lock/regenerate a match and reopen that schedule by date after refresh.
- **Still unverified against a hosted project:** email delivery, the hosted redirect configuration, production build serving, and backup/restore. API-route and component unit tests use mocked Supabase clients; local stack and browser checks are separate evidence.

## Known gaps

- Schedules are for multiples of four players only; one saved schedule per date (candidates other than the saved one are not kept).
- Scoring rules are typed constants, not yet user-editable. Regeneration may alternate between two good schedules when the candidate pool is small.
- No automated off-site backups or CI configured; no deployment has been done. A free Supabase project has no automatic backups and pauses after a week of inactivity; arrange a periodic external export before trusting it as the only copy of the roster/history.
