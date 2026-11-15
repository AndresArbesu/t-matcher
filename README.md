# t-matcher

A Next.js tennis/padel doubles scheduler imported from the v0 `match-history-persistence.zip` export. This replaces the old Java prototype on `main` while preserving its commits in Git history.

It is built for one organizer who uses it now and then from one or two devices: no database to pause, no email to send, almost nothing to maintain.

## What it does

- One shared **passcode** protects the app. There are no accounts and no email.
- A persistent **roster** of players (stable IDs, skill 1–5, soft "inactive" instead of deletion).
- A **dated session** per day: choose participants, generate arrangements (multiples of four players), lock matches, regenerate the unlocked ones, **save**, and reload later with participants, match order and lock states intact.
- **Record** saved matches as played; played matches become the history that scores later suggestions (weights below). Un-recording removes a match from history but keeps it on its session.
- **Download backup** (next to "Sign out") saves the whole data file to the device.

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

## Setup (local)

```sh
npm install
echo 'APP_PASSCODE=pick-something' > .env.local   # optional
npm run dev
```

Open http://localhost:3000. If `APP_PASSCODE` is not set, **the passcode is `dev`** (local development only; on Vercel a missing `APP_PASSCODE` makes the app refuse every request). Locally the data is a plain JSON file, `.data/store.json` (git-ignored); delete it to start over.

Copy `.env.example` for the list of variables. Neither is a `NEXT_PUBLIC_` variable: both stay on the server.

## Architecture

- **One private JSON document** holds everything (`lib/store.ts`): `{ version: 1, players, sessions: { "YYYY-MM-DD": { participants, matches, updated_at } }, meta }`. The `version` field lets later changes migrate it.
- **Production storage is a private [Vercel Blob](https://vercel.com/docs/vercel-blob/private-storage)** at `t-matcher/data.json` (`lib/blob-store.ts`). Reads bypass the CDN cache (`useCache: false`), so you always see the latest save. Writes are conditional on the version that was read (`ifMatch` ETag); if two requests collide the loser re-reads and retries (up to 4 times, then `409 conflict`). Private Blob needs `@vercel/blob` 2.3 or newer.
- **Local storage is a file** (`lib/file-store.ts`, `.data/store.json`) with the same ETag rule. It is used only when `BLOB_READ_WRITE_TOKEN` is absent **and** the app is not on Vercel. On Vercel without the token the app fails loudly (500) rather than writing to an ephemeral disk.
- **Daily snapshot:** the first write of each UTC day also saves a copy to `t-matcher/snapshots/YYYY-MM-DD.json`; the newest 30 are kept. A snapshot problem never fails the user's request.
- **Business rules live in `lib/repo.ts`** (the old SQL schema is gone): player names unique ignoring case, skill 1–5, players are never deleted (only deactivated), played matches are history and survive a draft save, a participant of a played match cannot be removed (`409 in_use`), every new match has four distinct participants.
- **Passcode login** (`lib/auth.ts`): `POST /api/login` compares in constant time and, after a wrong passcode, waits one second and answers 401. A correct one sets the `tm_session` cookie: an expiry time plus an HMAC-SHA256 signature keyed with the passcode; `httpOnly`, `SameSite=Lax`, `Secure` in production. The browser keeps it 400 days (the most browsers allow) and the signature is valid for 10 years from its last renewal; every authenticated call, including opening the app, issues a fresh cookie, so regular use never logs anyone out. Changing `APP_PASSCODE` signs every device out. Every `/api` route checks the cookie before touching data; state-changing routes also refuse a foreign `Origin`.
- **Export:** `GET /api/export` (signed in) downloads the whole document as `t-matcher-backup-YYYY-MM-DD.json`.
- All API responses are `Cache-Control: no-store`, and errors are fixed codes only (storage error text is never returned or logged beyond a class name).

### The passcode must be strong

A serverless function cannot rate-limit across requests, so the one-second delay only slows each guess. Anyone who can reach the site can try guesses in parallel. Use a long random passcode (for example `openssl rand -base64 18`), not a word or a date, and keep it in a password manager.

## Tests and checks

```sh
npm test            # vitest: stores, business rules, auth, routes, UI, smoke script
npx tsc --noEmit
npm run build
```

With the app running (`npm run dev`), an end-to-end check over real HTTP against the local file store:

```sh
node scripts/smoke.mjs                    # passcode from APP_PASSCODE, else "dev"
BASE_URL=http://127.0.0.1:3000 APP_PASSCODE=... node scripts/smoke.mjs
```

It creates players named "Smoke …" in `.data/store.json`, saves and records a match, checks the history and the export, and prints `PASS`. It refuses a non-local `BASE_URL` unless `ALLOW_REMOTE=1`.

What the tests do and do not prove: the unit tests run against fakes of the four `@vercel/blob` functions (the fake mimics the real service's weak-ETag reads). `scripts/smoke.mjs` run against a local server wired to a real Blob store was used to confirm the real behaviour, including simultaneous writers (see `docs/OPERATIONS.md`). The production store itself is only proven by the first sign-in after a deploy.

## Known gaps

- Schedules are for multiples of four players only; one saved schedule per date (candidates other than the saved one are not kept).
- Scoring rules are typed constants, not yet user-editable. Regeneration may alternate between two good schedules when the candidate pool is small.
- One shared passcode: everyone who knows it sees and edits the same data. There is no per-user history.
- Two people saving at the same instant is handled by retry, but the last save wins for the same field.
