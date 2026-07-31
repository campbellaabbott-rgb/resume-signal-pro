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

**Measured CAPTCHA-free is necessary and NOT sufficient.** A vendor is served
only when someone has loaded a real posting and written an adapter from what the
form actually does (see RECON.md). Six were examined; all six were CAPTCHA-free
exactly as measured, and every one of them would have defeated a generic driver
for a different reason.

**Served** — adapter written from observation:

| | |
|---|---|
| breezy | multi-step; `name` attrs; honest `required` |
| smartrecruiters | 1,806 shadow roots; labels only; no `name`, no `required` |
| personio | German labels, English `name` attrs; form at `{url}?apply` |
| pinpoint | Rails-nested names; a draft-saving decoy beside submit |

**Refused, with the reason in `src/vendors/index.ts`:**

- **oracle** — reachable, but ships a `honey-pot` field and requires accepting
  the employer's terms on the candidate's behalf. That last part is a product
  decision, not a coding one.
- **teamtailor** — the apply control text is written by the employer, so the form
  URL rule is still unknown.
- **workday** — needs a per-tenant candidate account. A credential problem, not a
  form problem, and the largest vendor in the tier. This is the single biggest
  limit on coverage.

**Never** — ashby, bamboohr, workable, lever, rippling, recruitee, icims (87–100%
CAPTCHA) and **greenhouse**, where 94% load reCAPTCHA *Enterprise*: no widget, no
sitekey, invisible score-based detection. A human sees nothing; a headless
browser is exactly what it scores, and a low score is rejected **silently**.
That is the worst failure mode available.

There is deliberately **no "% of the board" figure** here. I tried to measure it
and could not — sampling at different offsets answered 79%, 100% and 0.6% to the
same question, because postings cluster by vendor. The "68%" that used to sit in
this section was the share of sampled APPLY PAGES with no CAPTCHA, which is a
different quantity that reads like this one.

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

The service-role key bypasses RLS and can read any candidate's résumé. The inline
form above leaves it in your shell history, so prefer the file:

```bash
cp .env.example .env      # .env is gitignored; put the key there
set -a && source .env && set +a
HEADLESS=false SLOW_MO=400 npm run dev
```

## The one live submission, when you have a posting to test on

`src/dryrun.ts` drives a real posting with the real adapter code. Without
`--submit` it stops before the click and is free to run against anything:

```bash
npx tsx src/dryrun.ts "<postingUrl>" breezy            # checks, sends nothing
```

With `--submit` it presses the button and **a real employer receives a real
application that cannot be withdrawn**:

```bash
cp applicant.example.json applicant.json    # gitignored; fill in real details
npx tsx src/dryrun.ts "<postingUrl>" breezy --submit --profile applicant.json --headed
```

Before anything is sent it requires a profile with real name, email and a résumé
that exists; refuses any value still reading like an example; prints the posting,
name, email and résumé path; and waits for the word `SUBMIT` to be typed. It also
refuses if any earlier check failed — a partial application burns the posting for
that person, and the duplicate guard then blocks them applying properly later.

**Use a posting you own.** A Breezy or Personio free trial with a throwaway job
gives a genuine end-to-end test — real vendor, real form, real confirmation page
— and the application lands in your own inbox instead of a stranger's.

WHAT IT ANSWERS. The confirmation phrases in each adapter's `confirmed()` were
written from what vendors typically say, never from what one actually says. This
is the only way to find out. On `unknown` it prints the page's real wording so
the phrase can be added, and saves a screenshot either way.

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
