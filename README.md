# t-matcher

A doubles scheduler for a recurring padel group. Each session it splits the players into courts of four, two against two, so that matches are **balanced** and **don't repeat** partners, opponents or whole matches, using the history of everything played before.

Live: https://t-matcher.vercel.app (single shared passcode, no accounts)

Stack: Next.js 16 (App Router), TypeScript, Vitest, private Vercel Blob as storage.

## The problem

A weekly group has to be re-split into foursomes every session. Doing it by hand fails in two ways:

1. **Unbalanced matches.** If the two strongest players land on the same side, the result is known in advance.
2. **Repetition.** The same partners, the same opponents, sometimes the exact match of the previous session. Avoiding that requires remembering the whole history, which nobody does.

This is a small combinatorial optimisation problem with memory: choose a partition of N players into N/4 matches, each with a team split, minimising a cost that depends on the skill gap and on how often each pairing has already occurred.

## How it works

1. Keep a **roster** with a skill level per player (1 to 3, lower is better).
2. Pick a **session date** and who plays (a multiple of four).
3. The app generates ranked **complete schedules**. Matches can be **locked**; regenerating reshuffles only the unlocked ones.
4. **Save** the session. Mark matches as **played**: played matches become the history that scores later sessions.

## Generation

The search space is large. For 12 players there are 12! / (4!³ · 3!) = 5,775 ways to form the foursomes and 3 team splits per foursome, i.e. **155,925 distinct schedules**; at 20 players exhaustive search is out of the question. So the generator **samples** instead:

1. Draw up to 2,000 random complete schedules (shuffle, cut into foursomes, pick a random team split for each).
2. Score each schedule **as a whole** (the sum of its match scores). Ranking whole schedules, not independent matches, stops one good court from being paid for with a terrible one elsewhere.
3. Deduplicate by canonical form (players sorted inside teams, teams and matches sorted), so the same schedule drawn twice counts once.
4. Return the best 3 that differ from each other in at least 2 matches, so the alternatives are real alternatives and not cosmetic permutations.
5. **Regenerate with locks:** locked matches are returned untouched, and the remaining players are re-drawn into the free slots from the same ranked candidates, skipping the schedule currently on screen.

This is a sample, not a proof of optimality. At 8 players (315 schedules) coverage is nearly complete; at 12 players 2,000 draws reach a perfectly balanced schedule reliably (see the simulation below); beyond that, coverage drops and quality degrades gracefully. The history is indexed once per analyzer (maps keyed by player pair and by pair of teams), so scoring a candidate is a handful of lookups. Generating for 12 players against a 150-match history takes roughly 10 to 15 ms on a laptop.

## Scoring

Lower is better. For a match of team A against team B:

```
score = 1000 · |Σlevel(A) − Σlevel(B)|
      + 200 · min(rematches, 2)                    same two teams met before
      +  25 · min(meetings, 2)      per opposing pair (4 per match)
      +  20 · min(partnerships, 2)  per team (2 per match)
```

Each repeat term is multiplied by how recently **that item** last occurred, measured in **sessions, not days** (a group that plays on irregular dates cares about the previous session, not the calendar):

| Last occurred | Multiplier | Flat extra, once per match |
| --- | --- | --- |
| previous session | ×3 | +100 |
| 2 sessions ago | ×2 | +50 |
| 3 or more | ×1 | none |

History never expires; older repeats keep counting at ×1. Counts are capped at 2, so repeat penalties stay bounded however long the history grows. Without the cap, accumulated repeats eventually drown out the balance term, which was a real flaw in the first version of this scoring.

### Priorities as invariants

The weights are not arbitrary. They encode an ordering, and the test suite asserts it by computing the bounds from `DEFAULT_RULES`, so changing a weight tells you whether the ordering still holds.

1. **Balance beats repetition.** The worst possible non-rematch (all four opposing pairs and both partnerships at their caps, all in the previous session) costs 3 · (4·25·2 + 2·20·2) + 100 = **940 < 1000**. A perfectly balanced match always beats one with a gap of 1.
2. **Replaying the previous session's match is avoided unless it costs balance.** One such rematch costs 3 · 340 + 100 = **1120**, between one and two levels of gap. The app accepts a gap of 1 to avoid it, never a gap of 2 or more.
3. **An exact rematch is charged for everything it contains** (the rematch, four opposing pairs, two partnerships), so it always costs more than the sum of its parts. An earlier version under-priced rematches and the search found them as cheap loopholes.
4. Among equally balanced schedules, fewer and older repeats win. The last two sessions weigh most, so matches don't come back every session or every other session.

### Does it work?

`tests/scoring-simulation.test.ts` replays 13 sessions with 12 players (levels 1/1/1/1/2/2/2/2/3/3/3/3), taking the best schedule each time and feeding it back as history, on weekly dates and on irregular ones (gaps of 2 to 20 days). Over 30 seeds: every match was perfectly balanced, no exact match returned within 2 sessions, no foursome played together in consecutive sessions, and at most one exact rematch of any age occurred per 39-match season. Weekly and irregular dates give identical schedules for the same seed, because only the order of the dates matters.

## Storage and access

- **State is one private JSON document** in Vercel Blob (`t-matcher/data.json`): no database to pause, no queries, nothing to migrate for a few kilobytes of data.
- **Concurrency is optimistic.** Every write is conditional on the ETag that was read (`ifMatch`). On a collision the loser re-reads and retries, up to 6 times with a short backoff, then it surfaces as `409`. Testing against the real service exposed two behaviours that fakes hide: reads return a *weak* ETag that conditional writes reject, and simultaneous writers get a generic "conflicting operation" error instead of a precondition failure. Both are handled and covered by tests; 24 concurrent writes against the real store all landed.
- **Durability:** one snapshot per day (last 30 kept) and a *Download backup* button.
- **Access:** one shared passcode. The session cookie is an HMAC-signed expiry, `httpOnly`, renewed on every authenticated request, so regular use never logs anyone out.
- Business rules (unique names, no deleting players, played matches survive a draft save) live in `lib/repo.ts`, not in the storage layer.

## Run it locally

```sh
npm install
npm run dev        # http://localhost:3000, passcode "dev", data in .data/store.json
npm test           # 366 tests
npx tsc --noEmit
```

## More

- [`docs/TECHNICAL.md`](docs/TECHNICAL.md): architecture, API rules, auth details, tests and known gaps.
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): where things live, shipping process, backups and restore.
