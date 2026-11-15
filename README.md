# t-matcher

A Next.js tennis doubles scheduler imported from the v0 `match-history-persistence.zip` export. This replaces the old Java prototype on `main` while preserving its commits in Git history.

## Current behavior

- Add players with skill ratings (1–10), select who is playing, and generate match suggestions.
- For a multiple of four selected players, offer up to three complete arrangements and allow individual matches to be locked before regenerating the others. For other counts, offer individual match suggestions, not a complete day plan.
- Score matches from team skill difference and historical repetition; see `lib/match-analyzer.ts` for the hard-coded weights. Record and browse completed matches.
- Players and match history use Supabase. Suggested arrangements, selections, and locks exist only in browser memory and disappear on refresh.

## Run locally

Install Node.js, then:

```sh
npm ci
cp .env.example .env.local
# Supply your own Supabase URL and public/anon key in .env.local
# Apply the reviewed database schema to your own Supabase project; do not use the legacy SQL policies in production.
npm run dev
```

The app can render without a Supabase connection, but player/history API calls will fail. Run `npx tsc --noEmit` and `npm run build` for basic checks.

## Not production-ready

The included `scripts/001_create_match_history.sql` is the **original v0 schema, not a deployable production migration**: its RLS policies grant public access to all player and history rows. There is no user authentication, authorization, backups, or environment configuration in this repository. Do not connect a production Supabase project to this version. The generation code currently makes greedy, random-assisted choices; it does not score a broad random sample of complete day arrangements. The lock flow, candidate diversity, and match-history scoring need further verification. A player deletion cascades to historical matches in the current schema.

Production proposal: private Postgres (Supabase is fine) with authenticated admin access and least-privilege RLS, versioned migrations, persistent players and dated sessions with their finalized matches, automated database backups, bounded candidate sampling and scoring, and an authenticated Next.js deployment. Rebuild/test the database write/read path and lock/regenerate behavior before production publication.
