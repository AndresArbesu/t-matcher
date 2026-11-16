# Operations notes

Where the live app runs, where the data lives, how changes ship, and how to recover. No secrets here.

## Where things are

| Piece | Where |
| --- | --- |
| Live app | https://t-matcher.vercel.app |
| Code | https://github.com/AndresArbesu/t-matcher (`main` is production) |
| Hosting | Vercel project `t-matcher`, team `aarbesu-2275s-projects` (Hobby plan) |
| Data | A **private Vercel Blob store** connected to the Vercel project (see "Where the data lives") |
| Login | One shared passcode in the `APP_PASSCODE` environment variable on Vercel |
| Old v0 site | `v0-match-history-persistence.vercel.app` (still up, untouched, its data was abandoned on purpose) |
| Former Supabase project | `t-matcher`, ref `huaywnkxhcrlagdjpnzp`: **superseded and unused**. Nothing reads it any more. It can be deleted (see below) |

The Vercel CLI login is in the macOS keychain / CLI config. The old `~/.t-matcher-prod/` secrets (Supabase database password and anon key) are no longer needed.

## How a change ships

1. Branch, commit, open a pull request. GitHub runs typecheck, tests and build (`checks`); it needs no secrets.
2. Vercel builds a preview of the branch.
3. Merge once `checks` is green. `main` is protected: no direct pushes, also for the owner.
4. Merging to `main` deploys production automatically.

There are no database migrations. The data is one JSON document with a `version` field; a change that alters its shape has to bring a migration in code (read old version, write new) in the same pull request.

Note: preview deployments use the same Blob store and passcode as production unless the variables are scoped differently in Vercel. Treat a preview as live data.

## Where the data lives

- **Document:** Blob pathname `t-matcher/data.json` in the private store. It holds the roster, every session and match, and `meta.lastSnapshot`.
- **Snapshots:** `t-matcher/snapshots/YYYY-MM-DD.json`. The first write of each UTC day saves one; the newest 30 are kept, older ones are deleted automatically. This is the "undo" for a bad day: you can go back about a month.
- **Why it does not pause:** a Blob store is plain object storage with no activity requirement, unlike a free Supabase database that pauses after a week. Nothing needs to "keep it awake".
- **Store credential:** `BLOB_READ_WRITE_TOKEN` is created and set by Vercel when the Blob store is connected to the project. Never create or paste it by hand into the repo.
- **If the credential is missing on Vercel** the app answers every data call with a generic error (500) instead of using a temporary file. That means the store is not connected to this environment; connect it under the project's Storage tab.
- **Scoring and skill rules live in code**, not in the data: skill 1–3 with 1 the strongest (`lib/validation.ts`), scoring weights and repeat caps (`lib/match-analyzer.ts`; balance first, then not replaying the last session's match, then fresh partners and rivals; repeats are weighed by how many sessions ago they were, counted over the played dates before the session being planned, never in days), player and session rules (`lib/repo.ts`). Changing them is a pull request, and old data keeps working. Players saved earlier with a level above 3 stay in the document as they are; edit them to a level from 1 to 3, because the scoring still uses whatever number is stored.

## The passcode

- Stored as `APP_PASSCODE` (server only) in the Vercel project settings, for Production (and Preview if previews should be usable).
- **Required:** if it is unset on Vercel, login and every protected call fail with a 500 on purpose.
- It is the only protection, so keep it long and random (`openssl rand -base64 18`) and in a password manager. The app cannot rate-limit across serverless instances; it only waits one second after each wrong guess.
- **To change it:** update `APP_PASSCODE` in Vercel (Settings, then Environment Variables), then redeploy (an environment variable change only applies to new deployments). Everyone, on every device, is signed out and must enter the new one, because sessions are signed with the passcode.
- Locally, with no `APP_PASSCODE`, the passcode is `dev`. That fallback never applies on Vercel.

## Backups and recovery

- **Easiest backup:** sign in and press **Download backup** (it calls `GET /api/export`). Do it now and then, especially before changing anything big. Keep the file private; it contains the player names.
- **Automatic copies:** the daily snapshots above. They live in the same Blob store, so they protect against mistakes, not against deleting the whole store.
- **Restore from an export or snapshot:** the file is a complete document. Check it is valid JSON with `"version": 1`, then replace `t-matcher/data.json` with it. Two ways:
  - With the Vercel CLI's blob commands (`vercel blob get`, `vercel blob put`): fetch a snapshot with `get`, or upload your file with `put` to the pathname `t-matcher/data.json` with overwrite allowed and **private** access. Check `vercel blob put --help` for the exact flags on your CLI version; they were not verified for this document.
  - With the SDK the app itself uses: pull the project's variables (`vercel env pull .env.vercel`), then run once in the project folder:
    ```
    node --env-file=.env.vercel -e "import('@vercel/blob').then(async (b) => { await b.put('t-matcher/data.json', require('fs').readFileSync('backup.json', 'utf8'), { access: 'private', allowOverwrite: true, contentType: 'application/json' }); console.log('restored') })"
    ```
    Delete `.env.vercel` afterwards (it contains the store token and is git-ignored by the `.env*` rule).
- After a restore, reload the app; the next save continues from the restored document.

## Limits and things to know

- Vercel Hobby is for personal, non-commercial use only. Blob on Hobby has monthly usage allowances; this app stores a few kilobytes, so it is far below them. Check the Vercel Blob pricing page if the limits ever matter.
- Writes are conditional (ETag). If two devices save at the same moment, one retries automatically; the app retries up to six times with short pauses, and only then answers "conflict" so the user simply tries again.
- A snapshot or old-snapshot cleanup that fails is only logged (a class name, never a secret) and never blocks a save.
- Preview deployments use a **separate** Blob store (`t-matcher-preview`), so testing a pull request never touches real data. Its passcode is the same one.
- Verified against the real Blob service (the disposable preview store), not just fakes: login, create players, save a locked schedule, mark it played, history, export, the daily snapshot, and 24 simultaneous writes from three rounds of eight (all saved). Two service quirks found that way and fixed in `lib/blob-store.ts`: reads return a *weak* ETag (`W/"..."`) that conditional writes reject, so the prefix is stripped; and simultaneous writers get a generic "conflicting operation" error, which is treated as a retryable conflict.
- Not yet verified: the production store itself with the real passcode (first sign-in after the switch), and the restore commands below.
- Peek at a store without the app: `npx vercel blob list --rw-token "$BLOB_READ_WRITE_TOKEN"` (token from `vercel env pull`, delete the file afterwards).

## Retiring the Supabase project

The former Supabase project (`huaywnkxhcrlagdjpnzp`, region São Paulo, Free plan) holds the old roster and history and is no longer used. If anything in it is worth keeping, enter it into the new app first; there is no automatic import. Then delete the project in the Supabase dashboard (Project settings, then General, then Delete project), and remove the `NEXT_PUBLIC_SUPABASE_*` variables from the Vercel project. A paused or deleted Supabase project no longer affects the app.

## Changing the URL later

Rename the Vercel project, or add a domain in Vercel (a DNS record is needed for a custom domain). Nothing else needs updating: the login does not depend on the address, and the CSRF check compares the request's own host.

## Local development

```
npm install
npm run dev          # data in .data/store.json, passcode "dev" unless APP_PASSCODE is set
node scripts/smoke.mjs   # in another terminal: end-to-end check against the running app
npm test             # everything else; no network and no services needed
```
