# t-matcher: technical notes

Details moved out of the README. For what the app is and how the score works in plain terms, see [`README.md`](../README.md); for hosting and restore steps, see [`OPERATIONS.md`](OPERATIONS.md).

## What it does

- One shared **passcode** protects the app. There are no accounts and no email.
- A persistent **roster** of players (stable IDs, skill 1–3 where 1 is the strongest and 3 the lowest, soft "inactive" instead of deletion).
- A **dated session** per day: choose participants, generate arrangements (multiples of four players), lock matches, regenerate the unlocked ones, **save**, and reload later with participants, match order and lock states intact.
- **Record** saved matches as played; played matches become the history that scores later suggestions (weights below). Un-recording removes a match from history but keeps it on its session.
- **Download backup** (next to "Sign out") saves the whole data file to the device.

## How arrangements are generated and scored

**Generation** (`lib/match-analyzer.ts`): for a roster that is a multiple of four, the analyzer draws up to `DEFAULT_SAMPLING.maxSamples` (2000) random *complete* schedules (shuffle, cut into foursomes, random team split each), scores every schedule as a whole (sum of its match scores), deduplicates them by canonical form (players sorted inside teams, teams and matches sorted), ranks best-first, and returns up to 3 that differ from each other in at least 2 matches (when fewer qualify it falls back to the next best unique ones). Four players are enumerated outright: there are exactly 3 team splits. Match evaluations are bounded by `maxSamples × matches per schedule`. "Regenerate" refills only unlocked slots from the same ranked remainders and skips the schedule currently shown; locked matches are returned untouched. This is a sample, not a proof of optimality; for 8 players the 315 possible schedules are covered almost completely, for 12 players (155,925 schedules) 2000 draws reach perfect balance reliably, for 20 players only a tiny fraction is covered. On a laptop, generating for 12 players with a 150-match history takes about 10-15 ms.

**Skill levels** run 1 to 3, and lower is better (1 is the strongest). The maths only uses the gap between the two teams' summed levels, so the direction of the scale does not change any score.

**Scoring** (lower is better), all weights in `DEFAULT_RULES`. In order of priority:

1. **Balance first.** Repeated partners and rivals, at their capped worst and however recent, always cost less than one level of gap, so a perfectly balanced match beats a match one level apart.
2. **Do not replay the match of the last session**, unless that would leave the courts uneven by more than 1 level. One such rematch costs more than one level of gap and less than two: the app accepts a gap of 1 to avoid it, never a gap of 2 or more.
3. **Then avoid repeated partners and rivals.** The last two sessions weigh more; older history still counts, but less.

| Rule | Default | Meaning |
| --- | --- | --- |
| `skillDifferenceWeight` | 1000 | per level of difference between the teams' summed levels |
| `rivalPairPenalty` | 200 | per earlier time exactly the same two teams played each other |
| `individualRivalPenalty` | 25 | per opposing player pair (four per match), per earlier time the two were on opposite sides |
| `ownPairPenalty` | 20 | per current team (two per match), per earlier time its two players were partners |
| `recentSessions` | 1 | a repeat is "recent" when it last happened in the last session |
| `nearSessions` | 2 | a repeat is "near" when it last happened 2 sessions ago |
| `recentMultiplier` | 3 | multiplies each repeat item whose own latest occurrence is recent |
| `nearMultiplier` | 2 | the same for a near item; anything older counts ×1 |
| `recentPlayPenalty` | 100 | flat extra, once per match, when any repeat item is recent (half of it, 50, when the closest is only near) |
| `maxCountedRematches` | 2 | most earlier rematches that are charged |
| `maxCountedRivalMeetings` | 2 | most earlier meetings of one opposing pair that are charged |
| `maxCountedPartnerships` | 2 | most earlier partnerships of one pair that are charged |

How a match is scored: `skill gap × 1000`, plus the rematch item, plus each of the four opposing pairs, plus each of the two partnerships. Every item is `weight × min(times seen, cap) × multiplier`, where the multiplier comes from **that item's own** latest occurrence (×3 last session, ×2 two sessions ago, ×1 older), so one recent repeat never inflates an old one. The flat penalty is added once: 100 if any item is recent, else 50 if any is near. History never expires: older repeats keep counting at ×1, and the caps keep the total bounded however long the history gets. An exact rematch is charged for everything it contains (the rematch, the four opposing pairs and both partnerships), so it always costs more than the sum of its parts: 340 once and old, 680 + 50 = 730 two sessions ago, 3 × 340 + 100 = 1120 in the last session.

The two bounds above are checked against `DEFAULT_RULES` in `tests/match-analyzer.test.ts`: the worst non-rematch (all four opposing pairs and both partnerships at their caps, all in the last session) is 3 × (4 × 25 × 2 + 2 × 20 × 2) + 100 = 940, under 1000; a rematch of the last session seen once is 1120, between 1000 and 2000. Change a weight and those tests say whether the priorities still hold.

The history is indexed once per analyzer (maps keyed by player pair and by pair of teams), so scoring a candidate is a few lookups however long the history is.

**Recency is counted in sessions (played dates), never in days.** The group plays when it plays, so the weekday and the number of days between dates do not matter. The sessions are the distinct `played_at` dates (first 10 characters) strictly before the session being planned (`referenceDate`, the date selected on screen), newest first: the newest is "1 session ago", the next "2 sessions ago", and so on. A gap of 40 days between two sessions still makes the earlier one "1 session ago"; three dates inside one week are three sessions. A row dated on the planned session itself counts as 1 session ago; rows dated after it are ignored. Without a `referenceDate` the analyzer uses the UTC date of the clock. The UI shows it per match as "Last repeat: last session / 2 sessions ago / Never".

**Why these numbers:** the counts are capped (2 each), so repeat penalties can never grow without bound as history accumulates (the old design let them swamp skill after a few weeks). In a simulation of 13 sessions (12 players, levels 1/1/1/1/2/2/2/2/3/3/3/3, best arrangement each session, `tests/scoring-simulation.test.ts`) with weekly dates and with irregular dates (gaps of 2 to 20 days), over 30 seeds each: every match was perfectly balanced, no exact match came back within 2 sessions, no foursome played together in consecutive sessions, and at most one exact rematch (of any age) occurred per 39-match season. Weekly and irregular dates produce identical schedules for the same seed, because only the order of the dates counts.

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
- **Production storage is a private [Vercel Blob](https://vercel.com/docs/vercel-blob/private-storage)** at `t-matcher/data.json` (`lib/blob-store.ts`). Reads bypass the CDN cache (`useCache: false`), so you always see the latest save. Writes are conditional on the version that was read (`ifMatch` ETag); if two requests collide the loser re-reads and retries (up to 6 times, with a short pause between tries, then `409 conflict`). Private Blob needs `@vercel/blob` 2.3 or newer.
- **Local storage is a file** (`lib/file-store.ts`, `.data/store.json`) with the same ETag rule. It is used only when `BLOB_READ_WRITE_TOKEN` is absent **and** the app is not on Vercel. On Vercel without the token the app fails loudly (500) rather than writing to an ephemeral disk.
- **Daily snapshot:** the first write of each UTC day also saves a copy to `t-matcher/snapshots/YYYY-MM-DD.json`; the newest 30 are kept. A snapshot problem never fails the user's request.
- **Business rules live in `lib/repo.ts`** (the old SQL schema is gone): player names unique ignoring case, skill 1–3 (1 is the strongest), players are never deleted (only deactivated), played matches are history and survive a draft save, a participant of a played match cannot be removed (`409 in_use`), every new match has four distinct participants.
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
