# Apply worker

Drives real application forms for packets the agent has released.

## Why this is a separate service

Two measured facts, not preferences:

1. **No ATS accepts a server-side submission.** Greenhouse returns 401, Lever
   404, Ashby 401 — all gate submission behind the *employer's* credentials.
2. **The forms don't exist until a browser runs the page.** Across 674 apply
   pages (2026-07-30), every zero-CAPTCHA vendor shipped **0% postable forms** —
   no `<input name=...>` in the HTML at all, because the form is built by
   JavaScript.

So submission needs Chromium. Supabase edge functions are Deno with no browser
binary, which is why this lives outside `supabase/functions`.

## Scope

Only the measured zero-CAPTCHA vendors — **68% of the board**:

| | |
|---|---|
| workday | 0/60 captcha (needs a per-tenant candidate account) |
| smartrecruiters | 0/60 |
| breezy | 0/54 |
| oracle | 0/39 |
| teamtailor | 0/12 |
| personio, pinpoint | thin samples |

The list is duplicated in `src/index.ts` on purpose. The worker is the last gate
before a real submission and must not depend on a database row being right about
what it's allowed to touch.

**Excluded:** ashby, bamboohr, workable, lever, rippling, recruitee, icims (87–100%
CAPTCHA) and **greenhouse** — 94% load reCAPTCHA *Enterprise* with no widget and
no sitekey, meaning invisible score-based detection. A human sees nothing; a
headless browser is exactly what it scores, and a low score is rejected
**silently**. That's the worst failure mode available, so Greenhouse stays out
until measured with real submissions.

## The rule this is built around

**An ambiguous outcome is never a retry.** If a submit times out we do not know
whether the application landed. Retrying "to be safe" is how one application
becomes two, under a real person's name, with no way to withdraw either.

Three outcomes, and only one of them stamps a send:

- `submitted` — a confirmation was recognised on the page → `submitted_at` set
- `not-submitted` — we never pressed submit → safely retryable
- `uncertain` — we pressed submit and couldn't confirm → parked for a human via
  `agent_mark_uncertain`, which also pushes `attempts` past the ceiling so
  nothing picks it up again

It also refuses to submit a form it mostly failed to fill (<60% of expected
fields), refuses when required DOM fields are still empty, and stops if a CAPTCHA
appears on a vendor measured clean — vendors change their protection, and a
measurement is a snapshot, not a guarantee.

## Concurrency

`agent_claim_submission` is an atomic `UPDATE ... WHERE claimed_at IS NULL` with
`FOR UPDATE SKIP LOCKED`. Two workers polling the same queue would otherwise both
read the same ready row and both submit it. Leases expire after 10 minutes so a
crashed worker doesn't strand a packet; the expiry is deliberately generous
because a slow form is not a dead worker.

## Run

```bash
cp .env.example .env   # add SUPABASE_SERVICE_ROLE_KEY
npm install && npx playwright install chromium
npm run dev
```

## Run it locally — no hosting, no card

For the first watched submission this is BETTER than deploying. You can see the
browser fill the form, and it costs nothing.

```bash
cd worker
npm install
npx playwright install chromium          # one-off, ~150MB

# HEADED so you can watch, slowed so you can follow.
HEADLESS=false SLOW_MO=400 \
SUPABASE_URL="https://bwhdazbotpblihdxcmho.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service_role key from Supabase → Settings → API>" \
npm run dev
```

A window opens and the worker starts polling. Ctrl-C stops it after the current
packet — never mid-application.

`HEADLESS` and `SLOW_MO` change VISIBILITY only. Same adapters, same guards, same
refusals as production: a test that takes a different code path than production
is not a test of production.

The service-role key bypasses RLS and can read any candidate's résumé. Passing it
inline like this leaves it in your shell history — `export` it from a file you do
not commit, or prefix the command with a space if your shell is set to skip
those.

## Deploy

`fly.toml` is checked in. The Dockerfile uses Playwright's own image, so Chromium
and its system libraries are already present.

```bash
cd worker
fly launch --no-deploy --copy-config --name resumebooster-apply-worker
fly secrets set SUPABASE_URL="https://bwhdazbotpblihdxcmho.supabase.co"
fly secrets set SUPABASE_SERVICE_ROLE_KEY="<service role key>"
fly deploy
```

Deliberately **not** a web service — no ports, no `[[services]]`. Nothing should
reach this process from the internet; it reaches out, claims work, reports back.
It holds the service-role key and reads candidates' résumés, so an open port
would be a real attack surface.

One machine only. The work is rate-limited by `APPLY_GAP_MS` by design, so a
second worker wouldn't go faster — it would only add ways for a deploy to
overlap.

Confirm it is alive:

```sql
SELECT worker_id, last_seen, claimed_total, version FROM agent_worker_heartbeat;
```

Until a row there is under 15 minutes old, `apply-agent` refuses to release
anything and records `sender-offline` — so a queue can never silently sit
waiting for a sender that isn't there.

## Not done yet

- Workday's per-tenant account creation is not handled. Those packets reach the
  signup wall and come back `not-submitted`.
- **Nothing here has run against a real posting.** Confirmation-phrase matching
  in particular is guesswork until it meets real vendor pages. If the phrases
  don't match, sends land as `uncertain` and go to a human — the safe failure,
  but it means the unattended path does nothing. Watch one real submission end
  to end before trusting a batch.
