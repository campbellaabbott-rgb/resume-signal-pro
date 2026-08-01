# Vendor recon — what real apply pages actually look like

Observed 2026-07-30 by loading live postings in a browser and reading the DOM.
No applications were submitted. Every finding below is from a real page, not
from documentation or inference.

This exists because the first driver was written from imagination and would have
failed on all three vendors examined — not because of CAPTCHAs, which were
absent exactly as measured, but because the forms are nothing like what a
generic driver assumes.

## Six vendors, six shapes

All six were CAPTCHA-free, exactly as the 674-page measurement said. Not one of
the problems below is a CAPTCHA.

| | SmartRecruiters | Breezy | Personio | Oracle | Pinpoint | Teamtailor |
|---|---|---|---|---|---|---|
| Apply control | `I'm interested` | `Apply To Position` | `Auf diese Stelle bewerben` | `Apply Now` | `Apply Now` | `Apply Here .xx` |
| Form URL rule | link href has `/oneclick-ui/` | `{url}/apply` | `{url}?apply` | in-page screen | `{url}/applications/new` | unknown |
| Shadow DOM | **1,806 roots** | none | 1 | none | none | none |
| Fields with `name` | **0 of 14** | **40 of 50** | **12 of 12** | 2 of 4 | **40 of 56** | not mapped |
| Fields with `label[for]` | **11 of 14** | **0 of 50** | 8 of 12 | 3 of 4 | — | — |
| `required` attribute | **none** | **30 of 50** | **none** | 1 (consent) | **9 of 56** | — |
| Match strategy | `label[for]` | `name` | `name` | `name` | `name` (nested) | — |
| CAPTCHA | none | none | none | none | none | none |
| Honeypot | no | no | no | **YES** | no | — |

## The two findings that change the design

**Oracle ships a honeypot.** `name="honey-pot"`, `aria-label="honeypot"` — a
field invisible to a person, so anything that fills it is provably not one.
This is the strongest possible argument against the fill-everything strategy the
original driver used: it would have announced itself on the first Oracle
application. The driver now fills ONLY fields an adapter has explicitly mapped,
and `isHoneypot()` exists so that rule is testable rather than merely implied.

**Personio's apply button is in German.** "Auf diese Stelle bewerben" — the
tenant's locale decides the text. Combined with Teamtailor's employer-authored
"Apply Here .xx", that closes the question: the apply control cannot be found by
its words, in any language. Its href, however, is `{jobUrl}?apply` on every
Personio tenant. Structure is stable; text is not.

## What this proves

**1. The apply control cannot be found by its text.** Three vendors, three
different labels, and Teamtailor's is written by the employer — "Apply Here .xx"
is one tenant's own wording. Any regex over button text will miss most of the
market. The form URL has to be derived per vendor, structurally.

**2. Field matching has no universal strategy.** SmartRecruiters has labels and
no names; Breezy has names and no labels. `getByLabel` works on one and fails on
the other; `input[name=...]` works on the other and fails on the first. The old
driver's four fallbacks happened to cover both, but only by accident, and it had
no way to know which had worked.

**3. Safety checks are vendor-dependent.** The pre-submit guard "refuse if any
required field is empty" reads the `required` attribute. Breezy sets it on 30
fields — the check works. SmartRecruiters sets it on none and enforces
requiredness in JavaScript, so the same check passes trivially and protects
nothing. A guard that silently does nothing on one vendor is worse than no guard,
because it is counted as protection.

**4. Multi-step forms are normal.** SmartRecruiters ends its first page with
`Next`, not a submit. A driver that looks only for a submit control sees a page
with no submit control and reports "no submit control found" — which reads like a
broken page rather than an unimplemented feature.

**5. Duplicate ids are real.** SmartRecruiters has two `input[type=file]` both
with `id="file-input"` — one for CV-autocomplete at the top, one for the Resume
section. `.first()` picks a plausible-looking wrong one.

## A methodology note

The first probe of SmartRecruiters used `document.querySelectorAll` and reported
**zero** form fields, which looked like "this vendor has no usable form". That
was wrong: `querySelectorAll` does not descend into shadow roots, and the page
has 1,806 of them. Playwright's locators DO pierce open shadow roots, so the
fields are reachable.

Had the recon stopped at the first measurement, SmartRecruiters would have been
written off. Check whether the instrument can see the thing before concluding
the thing is absent.

## Dry run, 2026-07-31 — Breezy, nothing submitted

Ran the adapter's own steps against a live Breezy form and stopped before the
click. All six mapped fields matched exactly one element, visible and enabled;
`cResume` is required and accepts .pdf/.doc/.docx/.txt.

**Breezy is MULTI-STEP, and I had recorded it as a single page.** "Submit
Application" is in the DOM at zero size; "Continue" is the visible control. Every
step shares ONE `<form>`.

That corrected a real bug. `confirmed()` asserted "no" whenever the email field
was still PRESENT. In a wizard the field survives a successful submit, just
hidden — so a real send would have been read as "not submitted", which is
classified safely retryable, which is a SECOND application under a real person's
name. A false negative is the dangerous direction here, and presence was the
wrong test. All three name-matched adapters now require the field to be VISIBLE
before asserting failure, and fall back to "unknown" otherwise.

## Live adapter runs, 2026-07-31 — nothing submitted

`npx tsx src/dryrun.ts <postingUrl> <vendor>` drives a real posting with the real
adapter code and stops before the click. Results:

| vendor | resolve | fields | résumé attach | proceed() would |
|---|---|---|---|---|
| breezy | OK | 6/6 | OK (hidden input) | ADVANCE (multi-step) |
| personio | OK | 6/6 | OK (hidden input) | SUBMIT |
| pinpoint | OK | 7/7 | OK (visible) | SUBMIT |
| smartrecruiters | **403** | — | — | — |

**Hidden file inputs accept files.** Two of the three attach to an input the
vendor hides behind a styled drop zone. Playwright's setInputFiles does not
require visibility — but that is a claim about a library, and the résumé is the
one attachment an application cannot do without, so the dry run attaches a real
temp file and confirms it landed rather than trusting the documentation.

**SmartRecruiters blocks headless browsers.** Its apply URL returns 403 to
headless and 200 to headed, same URL and machine, seconds apart. There is no
CAPTCHA and no challenge page — just a 403 that reads like a broken link. It is
now listed as a refusal we respect rather than a gap to close: working around it
means spoofing the user agent or hiding behind a virtual display, which is the
same line as solving a CAPTCHA.

## The real ceiling is employer questions, not CAPTCHAs (2026-07-31)

Sampled eight live Breezy postings for required fields the agent has no answer
for:

| required | unanswerable | outcome |
|---|---|---|
| 5 | 1 | refuse |
| 9 | 1 | refuse |
| 16 | 11 | refuse |
| 2 | 0 | **could send** |
| 2 | 0 | **could send** |
| 2 | 0 | **could send** |
| 10 | 5 | refuse |
| 12 | 6 | refuse |

**3 of 8.** One vendor, eight postings — an order of magnitude, not a rate. But
it is the first number describing what a subscriber would actually get, and it is
nothing like the "68% of apply pages had no CAPTCHA" figure that has been standing
in for it.

The pattern is clean: a bare form goes through; a form with employer screening
questions does not. Radio groups, checkbox groups, extra file uploads, consent
boxes. That is `buildPacket` working as designed — it blocks rather than invents
an answer — but it means unattended applying works on the SIMPLEST postings, and
roles with real screening fall to the review queue.

`dryrun.ts` step 4b now answers this per posting, and refuses to `--submit` when
anything is unanswerable. On vendors that keep requiredness in the label text
rather than the attribute it reports CANNOT DETERMINE rather than zero, because
zero would read as a clean bill of health on precisely the question being asked.

**The ceiling is liftable.** Most of these questions are work authorisation,
notice period, salary, right to work — things the standing-answers profile
already captures. Matching common question PATTERNS rather than exact field names
is the highest-value work left on the agent.

## Status

**Adapters serving:** Breezy, Personio, Pinpoint — each verified against a live form.

**Written but not served:** SmartRecruiters — the adapter is correct; the vendor refuses headless.

**A truncation caught by navigating.** The first Pinpoint note recorded the form
URL as `{posting}/application`, because the href in the probe output was cut at
60 characters and I wrote down what I could see rather than what was there. The
real path is `/applications/new`. It surfaced only because navigating to the
guessed URL returned 404 — a probe that reads a value and a probe that USES it
are different tests, and only the second one failed.

**Reconnoitred, not yet servable** — each needs one more pass, and what is known
is recorded in `vendors/index.ts` so the next pass starts from evidence:
  - **Oracle** — email-first screen, no account needed, but a REQUIRED
    terms-and-conditions checkbox. Accepting an employer's terms on a
    candidate's behalf is a product decision, not a coding one.
  - **Teamtailor** — apply control is employer-authored, so the form URL rule is
    still unknown.

**Workday** needs a per-tenant candidate account — a credential problem rather
than a form problem, unsolved, and the largest vendor in the tier.

Nothing was submitted to any employer during this work.

## BambooHR — re-measured 2026-07-31. NO-BUILD, and now on solid evidence.

BambooHR is ~17% of what a real user sees on the board, and it had been ruled
out on an "87–100% CAPTCHA" sample. That number answered a weaker question than
the one that matters, so it was re-run properly (`src/probe-bamboohr.ts`).

**Method.** One posting per TENANT, 24 tenants drawn from 305 distinct ones —
sampling several jobs from one employer would measure that employer's
configuration repeatedly and report it as a vendor-wide fact. The probe clicks
through to the application form first: BambooHR's posting page carries **no
CAPTCHA at all**, and a probe that stops there measures the job description.

**The probe self-checks before it reports.** Its first run returned
`visible-challenge` for 24 of 24 — an answer indistinguishable from a stuck
classifier. It now runs against breezy and pinpoint first, which are known clean
and driven daily, and aborts if they do not come back `none`. They return
`frames=0 widgets=0 globals=[]`, so the classifier discriminates.

**Result, 24/24 tenants:**

| | |
|---|---|
| reCAPTCHA v2 anchor iframe, **304×78 and visible** | 24/24 |
| `g-recaptcha-response` present in the form | 24/24 |
| sitekey | `6LfZ4KEsAAAAAP7osErua7mOIzcdDjnUdaZfp0` — **one key, every tenant** |
| grecaptcha **Enterprise** (invisible scoring) | 0/24 |
| honeypot field (`nickname_hpcsaf`) | 24/24 |

The single shared sitekey is what closes this. It is BambooHR's **platform** key,
not a per-employer setting, so there is no subset of tenants with it switched
off — there is nothing to go looking for.

The irony: the form is otherwise the easiest of any vendor examined. ~18 fields,
0–3 required, honest `name` attributes. Only the checkbox stands in the way, and
clicking it is the line we do not cross.

**Small mercy:** it is v2, not Enterprise. A visible checkbox blocks us HONESTLY
— we can see we are stopped. Greenhouse's invisible Enterprise scoring is worse,
because it fails silently and the application never reaches a person.

**What was NOT measured.** Whether the server rejects a submission lacking the
token. Testing that means sending a real application to a stranger's job, which
is not a thing to do to find out. The claim here is that a visible v2 challenge
sits on every tenant's form, not that submission is provably rejected without it.

## Oracle — re-checked 2026-07-31. STILL NO, and my note was the problem.

`consent_to_processing` shipped that afternoon, which appeared to remove Oracle's
recorded blocker ("REQUIRED terms checkbox"). It did remove that one. The note
was incomplete.

**What the gate actually does**, read off three tenants with the idle-session
modal dismissed:

> "Get started right away by using your email or phone number. **Your profile
> will be created and kept up to date automatically** as you enter details for
> each of your job applications"

`/apply/email` carries `primary-email`, a `honey-pot`, and an "I agree with the
terms and conditions" checkbox. **No guest path** — searched for one on all
three, found none.

So applying via Oracle means creating a persistent candidate profile on each
employer's tenant, in the candidate's name, described by Oracle as an ongoing
record rather than a one-off submission. That is the same class of obstacle as
Workday's per-tenant candidate account, which is already ruled out — a
credential and consent problem, not a form problem. 14,277 postings stay shut.

**Two mistakes of mine, one shape.** The recorded reason listed only the terms
checkbox, so months later it read as fully addressed the moment consent shipped.
And the first probe's detector asked for /create an account|sign up|register/
and returned `createsAccount: false` on a page whose own text says "Your profile
will be created" — matching the words I expected instead of the words the page
used. The reason in `vendors/index.ts` now states the whole obstacle, because a
partial reason is worse than none: it expires into a false green light.

## Teamtailor — 2026-07-31. Buildable. Both recorded blockers were wrong.

10,144 postings. The note said "apply control text is employer-authored; form
URL rule unknown". There is no form URL rule to find: **the form is inline on
the posting page**. Clicking whatever the employer calls the apply control
reveals it in place.

**Field names are Rails-nested and stable across tenants** (7 of 10):

    candidate[first_name]  candidate[last_name]  candidate[email]  candidate[phone]
    candidate[job_applications_attributes][0][cover_letter]
    candidate[consent_given]                     <- the consent opt-in already handles this
    candidate[answers_attributes][N][text|choice|boolean|choices]   <- screening questions

**THE CV QUESTION, and how I got it wrong first.** The initial probe reported
0/10 file inputs and no mention of a résumé anywhere — which would have made
Teamtailor worthless, since an application with no CV is not an application.
That probe never dismissed the cookie banner. With "decline all non-necessary"
clicked first, 4 of 6 tenants show a real upload:

| | |
|---|---|
| label | "Upload resume*", "Upload CV", "Lebenslauf hochladen*" |
| accept | `.doc,.docx,.pptx,.pdf,.pages,.txt,.rtf` |
| name | **empty** — locate by the accept list, never by name |

The other 2 of 6 showed no form at all and are likely external-apply redirects;
those must resolve to "no form, refuse" rather than a half-filled submit.

**Third time today the probe measured my own setup instead of the vendor.**
BambooHR: stopped at the posting page and missed that the CAPTCHA is on the
form. Oracle: read the idle-session modal instead of the page. Teamtailor: a
cookie overlay suppressed the form and "no file input" was a fact about the
banner. Every one of them would have gone into the record as a fact about the
vendor. The fix is the same each time — dismiss the chrome, then look.

**Still to establish before shipping an adapter:** whether the screening
questions carry readable labels (the enumerator needs them, and
`answers_attributes[N]` names carry no meaning), and what a submitted
confirmation says.

## Pinpoint — résumé attach WORKS. My check was case-sensitive.

I wrote this section earlier today claiming Pinpoint's `setInputFiles` resolved
without landing a file, and blamed the vendor. That was wrong, and the wrong
version sat in the record for about twenty minutes.

The network trace settles it:

    POST https://trilongroup.pinpointhq.com/rails/active_storage/direct_uploads
    PUT  https://pinpoint-production.s3.eu-west-2.amazonaws.com/...

A real ActiveStorage direct upload to S3, completing normally. The page then
displays the filename — **in capitals**: `PROBE-CV-MARKER.PDF`. My verification
asked `document.body.innerText.includes("probe-cv-marker")`, case-sensitively,
and got false. Both sides are lowercased now.

**Two true things came out of the false alarm**, which is the only reason it was
worth the detour. The worker was setting `resumeAttached = true` from `setFile`
merely not throwing — a question about the CALL, not about the page — so a
vendor that genuinely failed to attach would have had a CV-less application
submitted under a real person's name. That guard is real and stays. And the
attach is now proven from two independent signals, because Breezy holds the file
on the input while Teamtailor and Pinpoint both clear it after uploading.

**Fifth time in one day** that a probe measured my own setup and I nearly filed
it as a fact about a vendor: BambooHR (stopped at the posting page), Oracle (read
the idle modal, then matched the words I expected), Teamtailor (cookie overlay
suppressed the form), the `required`-attribute verdict (`req > 0` is not a test
of trustworthiness), and this. Every one was caught by asking what CHANGED
rather than what a call returned.

question about the CALL, not about the page. The same shape as counting a
`required` attribute a vendor never sets, or reading a cookie banner and
concluding a form has no file input. A probe has to ask the page what changed.

## SmartRecruiters — re-measured 2026-08-01. Closed, and not on a judgement call.

45,380 postings, the largest single unlock left, with an adapter already written.
It was recorded as "403s headless browsers on the apply URL (headed gets 200) —
respecting the refusal", which framed it as an ethical decision: run headed and
it works, so should we?

**That framing was wrong, and the measurement settles it without needing the
decision.** Four tenants, headed, 20-second waits, no user-agent spoofing and no
stealth of any kind:

| mode | page | form |
|---|---|---|
| headless | 403 on /oneclick-ui/, body empty | 0 inputs |
| **headed** | renders, job title visible | **0 inputs** |

Headed 403s too — just one layer in, on `/oneclick-ui/api/company/...`, and on
Securitas also on the `js-www.smartrecruiters.com` bundle. The old note was true
of the PAGE and false of the FORM, which is the only part that matters.

So there is no version of this that works by running a browser differently.
Reaching the form would mean defeating the protection itself — user-agent
spoofing, stealth plugins, fingerprint patching — which is a different act from
being a real browser on a real screen, and is the line this project does not
cross. The adapter stays written and unused.

**Worth noting what nearly happened.** The half-true note had already produced a
plan ("run headed, gain 45,380 postings, 5.2% -> 13%") and an ethical debate
about whether to. Both were built on a fact nobody had re-checked. Sixth time in
two days that a recorded observation turned out to be an artifact — and the only
reason this one cost nothing is that the measurement came before the build.

## Ashby, Lever, Rippling, Workable — 2026-08-01. NO-BUILD, all four.

These were the four vendors never assessed for apply, and together they are
17.9% of what a searcher sees — nearly eight times the 2.33% currently
drivable. So this was the highest-value question open, and the answer is no.

**All four run bot detection on the apply form. None of the three vendors in
production do.**

| | product | on the network | visible challenge | share |
|---|---|---|---|---|
| Ashby | reCAPTCHA v3 | yes, 10/10 | none — v3 badge present | 8.25% |
| Rippling | Turnstile + CF challenge-platform | yes, 10/10 | none | 5.54% |
| Lever | hCaptcha + CF challenge-platform | yes, 10/10 | none | 2.43% |
| Workable | Turnstile + CF challenge-platform | yes, 6/6 | none | 1.69% |
| — Breezy | — | **NONE** | — | 1.32% |
| — Pinpoint | — | **NONE** | — | — |
| — Teamtailor | — | **NONE** | — | 0.71% |

**The first probe was worthless and the control group is what said so.** The
original check was `/recaptcha|hcaptcha|turnstile/.test(page.content())`, and it
flagged 40 of 40 pages — the shape of a probe that cannot fail. Running the same
probe against Breezy and Teamtailor, which I have driven end to end, returned
"no wall". So the signal did discriminate, and the string really was there. The
crude probe was right by accident; it took the control to know that.

It still could not answer the question that decides the build, so
`probe-captcha.ts` asks a sharper one: which product, is the script actually
FETCHED (a tag in the markup can be dead, a network request cannot), is a widget
rendered, is it visible, and is the v3 badge present. Three different worlds hide
behind one word:

  1. Referenced but never instantiated — a privacy-policy mention. No obstacle.
  2. Invisible scoring — no challenge, the submit succeeds, and a score decides
     silently whether a human ever sees the application.
  3. An interactive challenge — a hard, honest stop.

All four are (2), which is the worst of the three, because **it looks exactly
like success**. A visible challenge stops the agent and the candidate is told.
An invisible score lets the submit through, we report "applied", and the
application may already have been binned. That is the wrong "yes" — and the
whole reason this codebase refuses rather than guesses is that a wrong yes is
silent.

**Why this is not a coding problem.** The two ways past are a solving service
and fingerprint evasion. Both are ruled out — the first by an explicit product
decision, the second self-imposed, and neither is the kind of thing to quietly
reverse because the number is disappointing.

**Workable, separately, is otherwise the cleanest vendor seen.** Its form is at
`{posting}/apply` — not the posting page, which is why the first pass read
"0 fields, 0 required" on all ten and looked like SmartRecruiters. Field names
are the best of any vendor: `firstname, lastname, email, phone, address, city,
postcode, country, cover_letter`, with custom questions as `QA_*`/`CA_*`. The
résumé input is unnamed and found by accept list, and some tenants carry a
SECOND document input accepting `.ppt`/images — so "first file input" would
attach the CV to a portfolio slot, the Personio trap exactly. If Turnstile ever
comes off, this is a two-hour adapter. That is recorded so the next pass starts
from evidence rather than repeating the recon.

**What this means for the product ceiling.** Question coverage is a multiplier
on 2.33%, not a path past it. Perfect question coverage caps the auto-apply
product at 2.33% of search results. Growing the base needs a vendor with no
bot detection on the form, and the four candidates are now measured and closed.

## Corrections, 2026-08-01 — two of them, both mine

### 1. The vendor shares I published this morning were wrong

They came from paging the board's list endpoint and counting sources in the
sample. That sample is ordered, and the ordering correlates with vendor: big
boards that post often are over-represented near the front. Every share derived
from it was distorted, some by two orders of magnitude.

Recomputed exactly, by joining `sources.ts` (16,301 configured boards) to the
live `companiesFacet` counts:

| vendor | sampled (wrong) | **exact** | postings |
|---|---|---|---|
| workday | 34.65% | **52.53%** | 300,376 |
| bamboohr | 18.02% | **3.31%** | 18,935 |
| workable | 1.69% | **3.06%** | 17,479 |
| icims | 2.57% | **2.58%** | 14,730 |
| breezy | 1.32% | **1.97%** | 11,287 |
| teamtailor | 0.71% | **1.71%** | 9,767 |
| rippling | 5.54% | **1.52%** | 8,706 |
| recruitee | — | **1.40%** | 7,979 |
| greenhouse | 12.61% | **0.90%** | 5,132 |
| personio | — | **0.83%** | 4,752 |
| pinpoint | — | **0.65%** | 3,716 |
| lever | 2.43% | **0.44%** | 2,507 |
| ashby | 8.25% | **0.10%** | 560 |

**Drivable is 5.16% (29,522 postings), not the 2.33% I reported.** And the four
vendors I closed as "17.9% of the board" are really **5.12%** — Ashby, which I
called the single biggest prize at 8.25%, is 0.10% and one of the smallest
things on here. The NO-BUILD verdicts stand; the sizes attached to them did not.

The lesson is the same one as the count-capped board totals: a sample drawn
from an ordered list is not a random sample, and nothing downstream of it is
trustworthy just because the arithmetic was done correctly.

### 2. My CAPTCHA probe had a false-negative shape, and Recruitee caught it

`probe-captcha.ts` matched known vendor HOSTS — `google.com/recaptcha`,
`hcaptcha.com`, `challenges.cloudflare.com`. It reported Recruitee as clean on
all ten tenants: nothing in markup, nothing on the network. Recruitee serves
hCaptcha from its own CDN:

    https://captcha-base.recruiteecdn.com/1/secure-api.js?render=explicit&onload=hca…

A first-party proxy defeats a host allow-list completely, and the failure is
silent and confident — the probe does not error, it says "clean". That is the
worst shape a measurement can have, and it came within one commit of putting a
bot-walled vendor into production as a build target.

`probe-botwall.ts` replaces it: match on the PATH and query of every request the
page makes, whatever the host, across captcha / turnstile / challenge-platform /
datadome / perimeterx / imperva / akamai / fingerprintjs / arkose.

**Re-checked under the stricter probe, the production vendors survive:**

| | tenants | bot wall |
|---|---|---|
| Breezy | 3 | 0 |
| Pinpoint | 5 | 0 |
| Teamtailor | 6 | 0 |
| Personio | 6 | 0 — never probed until now |
| **total** | **20** | **0** |

**Recruitee: NO-BUILD.** 10/10 tenants load hCaptcha via `recruiteecdn.com`.
Its form is otherwise the best-shaped of any vendor seen — the résumé input is
NAMED (`candidate.cv`), with `candidate.photo` and `candidate.coverLetterFile`
as separate named inputs, so the "which file input is the CV" ambiguity that
nearly cost Personio an empty résumé slot does not even arise. Custom questions
are `candidate.openQuestionAnswers.{id}.content` and `.flag`. If the wall ever
comes off it is an afternoon's work; recorded so nobody repeats the recon.

---

## The 1,073 silent Personio boards are stale tenants, not an ingestion bug

**Measured 2026-08-01. Recorded so nobody re-runs it.**

Of 2,368 configured Personio boards, **1,073 produce no postings at all**. That
looked like the highest-value thing open: Personio yields 3.7 postings per live
board against Teamtailor's 9.1, and if a third of the silent ones were broken
rather than dead it would have added thousands of postings on a vendor the agent
can actually drive.

The first two probes both pointed at a bug:

- **40 of 40** sampled silent boards return live XML with real `<position>`
  blocks — a mean of ~7 each. Not one is a dead tenant.
- Personio does **not** rate-limit: 60 feeds at concurrency 12 returned 60×200
  in five seconds. No 429, no backoff.

Neither of those was the answer. The dates were:

| | postings | median age | within the 30-day window |
|---|---|---|---|
| silent boards (30 sampled) | 219 | **416 days** | 2 (**0.9%**) |
| producing boards (30 sampled) | 983 | 161 days | 191 (19.4%) |

**The board is behaving correctly.** These tenants leave roles open for years;
`FRESH_WINDOW_DAYS` excludes them, which is the same 30-day guarantee the trust
framing is built on. The boards are silent because they have nothing recent,
not because anything is broken.

**The real prize is ~70 postings, not the ~7,300 the first probe implied** —
0.9% of them, and they arrive on their own as tenants post something new.

Two hypotheses died cleanly on the way and are worth not re-testing: the `.de`
vs `.com` host fallback is correct (`fetchPersonio` tries both and requires
`<position>` before accepting either), and token collision is not a factor —
**0** of the 1,073 silent tokens is claimed by another vendor.

### The measurement mistake worth keeping

"Not in `companiesFacet`" was the definition of silent, and the first version of
the check that followed it passed `companyToken` — a parameter `serveList` does
not read. It returned the board-wide 571,703 for every token, including ones
that genuinely had nothing, so **the probe returned the same answer for two
different states** and would have "confirmed" any hypothesis put to it. The real
key is `companies: [token]`, and the control that should have been there from
the start — Personio boards known to be live — returns 49, 61, 7, 6, 38 while
the silent ones return 0.

Same failure as the CAPTCHA host allow-list above, in different clothes: the
probe did not error, it answered confidently, and it was not measuring anything.

---

## The cover-note gate was English-only, and only production noticed

**Measured 2026-08-01, against the live function.**

`validateCoverNote` flags any capitalised word that does not appear in the
résumé, the posting or the candidate's own note. That catches the fabrication
numeric grounding is blind to — "my time at Google", "my MIT coursework". It
rests on an assumption nobody wrote down: **that a capital letter mid-sentence
marks a name.** That is a property of the LANGUAGE, not of the checker.

Asked for a German note, the live function returned:

    "Liefergeschwindigkeit" appears in neither the résumé, the posting, nor
    the candidate's own note
    "Beitrag" appears in neither ...
    "Ihrem" appears in neither ...

A compound noun, a common noun, and a possessive pronoun. German capitalises
every noun, so **every German note would be rejected forever.** Spanish passed
in the same run, which is what makes it a language property rather than a bug
in the note.

Hindi fails the opposite way: Devanagari has no case, nothing matches `/^[A-Z]/`,
and an invented employer written in Devanagari would pass unseen. Over-rejection
in one language, a silently disabled guard in another.

**Why the tests missed it.** The file opens by arguing that the ACCEPTANCE tests
matter more than the rejection tests, because a gate that rejects everything
sends the generic note forever and the only symptom is an absence. Nine of them
were written. All nine were in English. The blind spot was not a missing test —
it was that every test shared one unstated assumption with the code.

**The fix is a refusal, not a workaround.** `gateCanCheck(language)` returns
false for `de` and `hi`; the function returns `note: null` before spending a
single model call, and the candidate's own note goes out. Shipping the prose
with a guard we know does not work — or quietly weakening the guard for those
languages — would be worse than not offering the feature there.

Note that `apply-agent` does not pass `language` at all today, so every
tailored note is English regardless of the candidate's locale. That is now a
deliberate, recorded limit: wiring language through requires the gate to
support that language first.

---

## The browser half works. Three live dry runs, 2026-08-01.

First time the real adapters have been driven against live employer forms since
the broker rewrite. `dryrun.ts` imports the same adapter code the worker uses
and calls it in the same order; it needs no database, no service key and no
broker, and it stops before the click. Nothing was submitted.

| vendor | form | CAPTCHA | fields | résumé | verdict |
|---|---|---|---|---|---|
| **Personio** | resolved | none | 5/5 | attached | **DRY RUN CLEAN — would have submitted** |
| **Pinpoint** | resolved | none | 7/7 | attached | 1 blocker (with a complete profile) |
| **Breezy** | resolved | none | 4/4 | attached | 4 blockers |

Personio completed end to end on a real posting. That is the first evidence the
browser half is not theoretical.

### The blockers are all ONE class, and it is not the class we built for

Pinpoint with the dry run's default (empty) standing answers reported five
blockers: city, postcode, salary, an open question, and consent. With a
COMPLETE profile it drops to **one**, and seven questions get answered —
preferred name, city, postcode, notice period, salary, work authorisation
(chosen "Yes" from the trinary), consent (ticked). Measuring against an empty
profile overstates the problem by 4x, which is worth remembering before anyone
quotes a completion rate.

What survives a complete profile is **employer-specific open prose**:

    Breezy    "Walk me through your last role where you were directly responsible…"
              "What was your average close rate across your team…"
              "Have you managed a warm-lead, appointment-driven sales model…"
    Pinpoint  "Please tell us what adjustments or support would help you…"

Pinpoint's is a disability-adjustments question and the agent SHOULD refuse it —
that is the safeguard working. Breezy's three are ordinary experience questions
that a résumé can answer, and they are the reason a Breezy packet refuses.

### Why they are never drafted: we harvest questions for the wrong vendors

`realQuestions` is true for exactly three vendors — **teamtailor, ashby,
greenhouse**. Ashby is 60/60 CAPTCHA and Greenhouse is invisible reCAPTCHA
Enterprise: both NO-BUILD. So the agent harvests real questions for two vendors
it cannot drive, and harvests none for **breezy, personio and pinpoint** —
three of the four it can.

With `realQuestions: false`, apply-agent falls back to four generic questions
(name, email, phone, résumé), never sees the employer's actual form, never
drafts anything, and the worker meets the questions cold and refuses.

Everything needed to close this already exists: `generate-application-answers`
drafts grounded answers with a `supported` flag, `buildPacket` consumes them via
`drafted`, and the worker reads `packet.fields`. The missing piece is harvesting
breezy/personio/pinpoint questions at prep time — the same shape as the
teamtailor harvester that already works.
