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

## Screening questions — the actual binding constraint

Not CAPTCHAs. Measured across 8 live Breezy postings (2026-07-31), only **3 of
8** could be completed from the adapter's identity fields alone. The rest asked
the employer's own questions.

`src/questions/match.ts` answers those from the candidate's standing answers in
`agent_mandates`, taking it to **7 of 8**. Every answer is something the person
supplied; there is no branch that invents one. What it refuses, and why:

| refuses | because |
|---|---|
| current salary | we hold an *expectation*; the two appeared on one form |
| ID / passport / SSN | identity documents are never auto-filled |
| nationality | not collected, and not the same question as work authorisation |
| race / gender with no "prefer not to say" | we store neither, so declining is the only honest answer |
| privacy notices, truthfulness declarations | need `consent_to_processing`, an explicit opt-in |
| any question whose label cannot be read | there is no safe default for a question you cannot see |
| anything unrecognised and required | guessing is the one thing this must never do |

Trinary booleans matter here. `work_authorized` NULL means "never stated", and
defaulting it to false would tell an employer a candidate is not allowed to work
in a country when they simply had not answered.

Two bugs found building this, both mine, both flattering:

- The first measurement used a **hand-typed** list of already-mapped fields that
  did not match the adapter's. It reported "Full Name" as the top blocker on
  forms where the adapter had been filling it all along. `mappedNames` is now
  derived from each adapter's own map.
- The DOM enumerator let a label leak to any control sharing a container, so
  marex's email, phone and address all read as "Full Name". That would have
  typed the candidate's name into their phone box. A label shared by several
  controls now identifies none of them.

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

## On a Mac

`mac/applyd` is the whole interface.

```bash
cp .env.example .env      # then put your service_role key in it
./mac/applyd check        # what the queue says, without starting a browser
./mac/applyd once         # send what is waiting, then exit
./mac/applyd watch        # headed + slowed, to WATCH a submission happen
./mac/applyd install      # run every 5 minutes via launchd
./mac/applyd status       # scheduled? last exit? last log lines?
./mac/applyd uninstall    # stop
```

The 5-minute schedule is cheap because the worker asks the database whether
there is anything to do **before** it starts Chromium, and exits in about a
second when there is not. `install` writes a launchd agent with `StartInterval`
and deliberately **not** `KeepAlive` — this is a job that finishes, and KeepAlive
would restart it the instant it exited, defeating the point.

Two things about a laptop specifically:

- **It only works while the Mac is awake.** A shut lid means the run is skipped,
  the heartbeat goes stale, and `apply-agent` stops releasing. That is correct
  behaviour rather than a failure — packets wait and drain on the next run.
- **The service-role key sits in `worker/.env`** (gitignored). It bypasses RLS
  and can read any candidate's résumé, which is why it belongs in a file rather
  than in a shell command that lands in your history.

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

## Nothing has been bought yet — so nothing needs to run

With zero subscribers the correct amount of worker to run is **none**, and that
is what happens today. Nothing is lost by it:

| | |
|---|---|
| Morning Queue still fills nightly | `agent-runner` never consults the worker |
| Packets are still prepared | `apply-agent` prepares, then declines to release |
| Sends are gated, with a reason | `sender-offline`, not a silent no-op |
| Hourly cron fires nothing | guarded on a vault key that does not exist |

Packets sit as `ready` and drain whenever a sender next appears, so a worker
that is off is a pause, never a loss.

### Starting one the moment somebody buys

Two halves, and neither is useful alone — waking a worker with no work burns
money, and a worker that exits with no way to be woken makes the product
silently stop.

**Wake.** `apply-agent` runs hourly. When it finds packets ready and no sender
online it calls `agent_work_pending()` — true only when somebody is PAYING *and*
there are unclaimed packets — and POSTs to `WORKER_START_URL`:

```bash
supabase secrets set WORKER_START_URL="<your host's start endpoint>"
supabase secrets set WORKER_START_TOKEN="<bearer token, if it needs one>"
```

Host-agnostic on purpose: a Fly Machines start call, a GitHub Actions
`workflow_dispatch`, a Cloud Run job, a webhook on a machine at home. **Unset, it
is a no-op** — which is the state now, and why none of this changes anything
until you pick a host. A failed wake is logged and ignored; it must never stop
packets being prepared.

Worst-case latency is one cron tick (~1 hour). Fine for job applications, and it
can be made instant later by calling the same endpoint from the purchase path.

**Sleep.** The worker exits once it has been idle a while:

```bash
WORKER_IDLE_EXIT_MS=600000   # leave after 10 minutes with nothing to do
```

Opt-in. Unset means run forever, which is what somebody watching a browser on
their own laptop expects. It only ever exits at the top of an idle pass with
nothing claimed — never mid-application, and never between a submit and its
confirmation check.

Together: `$0` while nobody has bought, a machine that starts when the first
person does, and one that leaves when the queue is empty.

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
- **No submit has run against a real posting.** Dry runs now drive live forms
  end to end — a marex posting with 5 required screening questions reports
  DRY RUN CLEAN with every one answered — but nothing has been clicked.
  Confirmation-phrase matching
  in particular is guesswork until it meets real vendor pages. If the phrases
  don't match, sends land as `uncertain` and go to a human — the safe failure,
  but it means the unattended path does nothing. Watch one real submission end
  to end before trusting a batch.
