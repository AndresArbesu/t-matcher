# Operations notes

Where the live app runs, how changes ship, and the known problems. No secrets here.

## Where things are

| Piece | Where |
| --- | --- |
| Live app | https://t-matcher.vercel.app |
| Code | https://github.com/AndresArbesu/t-matcher (`main` is production) |
| Hosting | Vercel project `t-matcher`, team `aarbesu-2275s-projects` (Hobby plan) |
| Database and login | Supabase project `t-matcher`, ref `huaywnkxhcrlagdjpnzp`, org `felvaxgklqzqzjlmwryh`, region São Paulo, Free plan |
| Old v0 site | `v0-match-history-persistence.vercel.app` (still up, untouched, its data was abandoned on purpose) |

Secrets live only on the owner's Mac, outside the repo: `~/.t-matcher-prod/db-password` and `~/.t-matcher-prod/anon-key` (mode 600). The Supabase and Vercel CLI logins are in the macOS keychain / CLI config. The two `NEXT_PUBLIC_SUPABASE_*` values are set in Vercel for Production and Preview.

## How a change ships

1. Branch, commit, open a pull request. GitHub runs typecheck, tests and build (`checks`).
2. Vercel builds a preview of the branch.
3. Merge once `checks` is green. `main` is protected: no direct pushes, also for the owner.
4. Merging to `main` deploys production automatically.

Database migrations are **not** automatic. After merging a change that adds a file under `supabase/migrations/`, apply it by hand:

```
npx supabase link --project-ref huaywnkxhcrlagdjpnzp
npx supabase db push --remote -p "$(cat ~/.t-matcher-prod/db-password)" --output-format text --agent no
```

Run `npx supabase db push --remote --dry-run ...` first and read what it will apply. Supabase CLI note: in this setup it needs `--output-format text --agent no` or it refuses to prompt.

## Known problems

### 1. Sign-in email is limited (open)

Supabase's built-in email sender is for testing only: about **2 emails per hour for the whole project**, and it only delivers to members of the Supabase organization (currently only the owner). Symptoms: "couldn't send" on the sign-in page, or `429 over_email_send_rate_limit` from the auth API.

Workaround: wait for the hourly limit to reset, request one email, and type the **code** into the same page (a link only works in the browser that asked for it).

Fix: configure a custom SMTP sender in Supabase (Authentication, then Emails, then SMTP settings) with a real provider such as Resend, or a Gmail app password for personal use. After that, raise the rate limit under Authentication, then Rate Limits. The app code does not need to change. Until then, nobody except the owner can sign in.

### 2. Free Supabase projects pause after a week of inactivity (open)

A Free project with too little activity for 7 days is paused (Supabase emails a warning about a week before). The app is down until someone resumes it: Supabase dashboard, select the project, **Resume project**. Data and settings come back. Paused projects can be resumed for up to a year (older notes say 90 days, so do not rely on the longer number). The Free plan also has **no automatic backups**.

Options when we pick this up: upgrade to Pro (never pauses, daily backups), keep it free and accept resuming by hand, or add a scheduled request that keeps it active (a few real requests a day count; not built, and not guaranteed by Supabase).

Manual backup, verified to work against the live project:

```
npx supabase db dump --remote -p "$(cat ~/.t-matcher-prod/db-password)" --data-only -f ~/.t-matcher-prod/backup-$(date +%F).sql --output-format text --agent no
```

It needs Docker running. Keep the file private; it contains player data.

### 3. Smaller limits

- Preview deployments use the **production** database (there is no staging database). Test with fake players. Sign-in redirects are only allowed for the production URL, so on a preview type the emailed code instead of clicking the link.
- Vercel Hobby is for personal, non-commercial use only.
- Not yet verified: a complete signed-in session on production (add players, generate, lock, regenerate, save, record a played match). Local checks cover it, production sign-in was blocked by problem 1.
- An independent code review was started and interrupted; it never produced findings. Run one before real users depend on it.

## Changing the URL later

Rename the Vercel project, or add a domain in Vercel (a DNS record is needed for a custom domain). Then update Supabase's site URL and redirect allow-list to the new address, or email sign-in breaks. Use a throwaway folder with a `supabase/config.toml` that only sets `[auth] site_url` and `additional_redirect_urls`, then `npx supabase config diff --remote=huaywnkxhcrlagdjpnzp` and `config push`. A diff that lists only those two keys is safe to push.

## Local development

```
npx supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

Copy the local API URL and anon key from `npx supabase status` into `.env.local`, then `npm run dev`. Sign-in emails go to the local inbox at http://127.0.0.1:54324. `node --env-file=.env.local scripts/local-smoke.mjs` checks login, account isolation and persistence against that stack. `npm test` runs all other tests and needs no Docker.
