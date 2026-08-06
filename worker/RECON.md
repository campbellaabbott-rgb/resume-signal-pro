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

### RE-MEASURED 2026-08-04: that work is done, and the lever is spent

Same eight Breezy forms, same fixture, run through `src/coverage.ts` (which
derives mapped fields from each adapter's own map, so the hand-list error below
cannot recur):

    8 forms, 22 required questions beyond the adapter's own fields
    16 answered · 5 refused on purpose · 1 distinct unrecognised
    7/8 forms completable end to end     (was 3/8)

The 3/8 above is now historical. What still blocks the eighth form is
identity-document, nationality, demographic, extra-document and salary-current —
every one a refusal of PRINCIPLE that must stay refused. After the learned-answer
pass it is still 7/8, and the two questions a candidate would have to answer once
are the same principled ones.

**One genuine gap remains, across all eight forms:** "Are you an Internal
Applicant?". Answering it needs a stated current employer, which the standing
profile does not hold — inferring "No" from the fact that someone applied through
a public board is a claim about their employment, not a fact we have.

So question coverage is no longer the ceiling. The ceiling is vendor reach:
30,345 drivable postings of ~570k, bounded by bot walls that are closed on
evidence, not on effort. Do not spend another pass widening label patterns
against this fixture — measure a NEW vendor's forms first, or the work is
optimising something already at 7/8.

CAUTION, and it has now cost two people (both me). Writing a fresh harness that
calls `matchQuestion` directly, without the adapter's `mappedNames`, reports
0/8 and blames cName/cEmail/cResume — Breezy's own unlabelled standard fields,
which the adapter fills. That is the identical mistake recorded below as "the
first run reported Full Name as 16 of 40". Use `src/coverage.ts`, and pass
`vendor:path`.

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

---

## Question harvesting for Breezy and Pinpoint, 2026-08-01

Closes the inversion recorded above: `realQuestions` was true for teamtailor,
ashby and greenhouse, and Ashby and Greenhouse are both NO-BUILD on CAPTCHA. We
were reading the real form for two vendors we cannot drive and none for three of
the four we can.

Both remaining vendors turn out to SERVER-RENDER their apply route:

| | where | shape |
|---|---|---|
| Breezy | `{posting}/apply` | HTML-escaped JSON — `"questions":[{text,required,type:{id}}]` |
| Pinpoint | `{posting}/applications/new` | one react-on-rails `<script>` per question, `questionDetails{title,questionType,required}` |

**Measured across 20 live boards:**

| vendor | harvested | questions | required |
|---|---|---|---|
| Breezy | 8/10 | 46 | 43 |
| Pinpoint | 10/10 | 296 | 228 |

The two Breezy zeros are boards with no questionnaire at all, which is a real
state and not a parse failure.

Personio is deliberately excluded. Its apply route is served but contains no
`<label>` elements, and the same dry run measured ZERO required questions beyond
the adapter's own fields — nothing to harvest, so no parser to maintain.

### Two measurement errors on the way, both the same shape

**1. Probing the wrong URL.** Pinpoint's POSTING page carries none of the
question text, and I nearly recorded it as JS-only and unharvestable. The
questions are on the APPLY route — the one the adapter already navigates to.

**2. Composing a URL from an id.** The first parser took `(token, externalId)`
and built the path. It worked on Breezy and **404'd on 8 of 8 live Pinpoint
boards**: Pinpoint's `id` is a numeric key (`505393`) and its apply path is an
unrelated UUID (`ac538c02-…`). Nothing about the id announces this. Both
functions now take the posting's OWN `apply_url` — the same value the worker's
adapter navigates to — so harvesting one form and filling another is impossible
by construction rather than merely unlikely.

A 404 harvests nothing while looking exactly like "this form has no questions".
The unit test asserting the URL strings existed did not catch it; ten live
fetches did.

### What this changes about where refusals happen

Before: the packet carried four generic questions (name, email, phone, résumé),
looked ready, and the WORKER refused at the form after launching a browser.

Now: apply-agent sees the real questions, drafts what the résumé supports, and
anything unsupported becomes a blocker at PREP time with a reason attached.
Some packets that used to look ready will now be blocked — that is the same
refusal surfacing earlier and legibly, not a regression.

---

## Pinpoint custom domains: the channel is real, enumeration is not solved

**Measured 2026-08-01.** The earlier Pinpoint census (`scripts/census-pinpoint.mjs`)
put the population near **340 boards against the 109 we carry**, closed
certificate transparency and the customer-list route as dead ends, and named one
untried channel: employers serving Pinpoint on their OWN hostname, invisible to
any `*.pinpointhq.com` query.

**The channel exists.** `careers.riverisland.com/postings.json` returns **60
Pinpoint postings** with the identical schema, apply URLs on the custom domain.
That is one board worth more than the 44/board Pinpoint average, which no
subdomain census could ever have found.

**Two fingerprints, both cheap:**

| signal | value |
|---|---|
| `_pinpoint_session` cookie on any response | definitive — vendor-named, unambiguous |
| CNAME | `d3p6l7ched4xva.cloudfront.net` (also `x-powered-by: cloud66`) |

Note the CNAME is confirmed on ONE example only. Whether every tenant shares
that distribution is unverified, and it matters: if they do, discovery is a DNS
query instead of an HTTPS fetch.

**WHAT DOES NOT WORK: guessing the domain.** 30 plausible UK employers × 2
prefixes (`careers.`, `jobs.`) = 60 hostnames probed. **One hit — River Island,
the example already known.** Pinpoint is UK-founded and the guesses were
size- and sector-matched, so this is not a bad guess list; enumeration by
inspiration simply does not work at any useful rate. Do not repeat it.

**So the lever is real and currently unreachable.** ~230 undiscovered boards at
~44 postings each is roughly **10,000 applyable postings** — a third again on
top of the entire 29,871 drivable set, on the vendor with the best yield per
board and no bot wall. It is blocked on ONE thing: a source of candidate
hostnames. Not on verification, which is a single request.

**Also required before any of this can land:** the ingester hardcodes
`https://{token}.pinpointhq.com/postings.json` (index.ts:422). A custom-domain
board is not expressible in sources.ts at all — no entry carries a `host` field
today. Personio already solves the same problem by carrying the winning host, so
the shape is known; it is ~5 call sites. Deliberately NOT built yet: a host
override that serves one board is not worth the surface until enumeration works.

---

## Custom-domain census: the channel pays, for a different vendor

**Measured 2026-08-01.** Built to solve Pinpoint enumeration, which the earlier
census left as the one untried route. It did not solve that. It found something
else worth more.

**4,000 .co.uk domains from Tranco, DNS-first:**

| | |
|---|---|
| have a `careers.*` CNAME at all | 236 / 4,000 |
| point at `ext.teamtailor.com` | 27 |
| serve a real feed | 20 |
| **not in our catalog** | **17 → 282 postings** |
| point at Pinpoint | **0** |

`ext.teamtailor.com` was the single most common careers-CNAME target in the
sample, ahead of every other ATS. InPost UK (64), Yopa (55), Pennon Group (28),
Motorpoint (25), Blue Light Card (23), Crystal Palace F.C. (19), Cazoo,
On the Beach, The Independent.

**Pinpoint custom domains are rare, not absent.** careers.riverisland.com is one
and serves 60 postings. Zero in 4,000 UK domains means the yield per domain is
low, not that the route is closed.

**The corpus should follow the vendor.** This pilot ran `.co.uk` because it was
hunting Pinpoint, which is British. **Teamtailor is Swedish** — `.se/.no/.dk/.fi`
should out-yield `.co.uk` for it, and that is untested.

### Two things to settle before any of this is ingested

**1. Is there an underlying `{token}.teamtailor.com` behind each custom domain?**
If yes, nothing new is needed. If no, the ingester needs a host override,
because it builds feed URLs from the token alone. **Unresolved** — the feeds do
not name their tenant, and it has to be answered rather than assumed.

**2. The "17 not in catalog" is NAME-matched** against the companies facet,
which is fuzzy. "Pennon Group" serving `careers.southwestwater.co.uk` is exactly
the shape that defeats it. Treat 17 as an UPPER BOUND until each is checked
token-first.

### Three parse errors on the way to this number, all mine, all the same shape

- `/jobs.json` returning HTTP 200 with the word "teamtailor" in the headers was
  read as "serves a feed". 23 of 27 "had feeds"; parsed properly, several had
  none.
- The feed is **JSON Feed** (`items[]`), not the `data[]` shape every other
  vendor uses. Parsing for `data` returned **0 jobs from a 73KB feed of real
  jobs**, twice, and I nearly recorded Teamtailor custom domains as empty.
- A regex requiring `token:` and `source:` adjacent reported **0 teamtailor
  tokens in sources.ts**, where there are 1,535. That one would have turned
  "already covered" into "all new".

Checking reachability instead of behaviour, three times in one investigation,
after a whole session of finding exactly that. The fix each time was to parse
the payload and assert a known-present value before believing a count.

### Nordic run, 2026-08-01

Teamtailor is Swedish, so the corpus followed the vendor. All four Nordic TLDs
in Tranco's top 1M, run exhaustively rather than sampled:

| TLD | domains | boards found | not in catalog | new postings | hit rate |
|---|---|---|---|---|---|
| .co.uk | 4,000 | 20 | 17 | 282 | 0.50% |
| **.se** | 3,529 | **21** | 17 | 175 | **0.60%** |
| .fi | 2,221 | 12 | 10 | 71 | 0.54% |
| .dk | 2,327 | 7 | 7 | 52 | 0.30% |
| .no | 1,779 | 4 | 3 | 94 | 0.22% |
| **total** | **13,856** | **64** | **54** | **674** | |

Sweden did out-yield the UK per domain, as predicted, but not dramatically —
0.60% against 0.50%. **The vendor-home-market effect is real and small.** The
interesting number is that all five TLDs land in the same 0.2–0.6% band: this
is a broad seam, not a Nordic one, and the ~880k domains in Tranco outside
these five TLDs have never been looked at.

Every board found across all five runs was Teamtailor. Not one Pinpoint.

Named employers include Telenor (Sweden and Norway), KICKS (Sweden, Norway,
Finland), Hedin Automotive, Grand Hôtel Stockholm, Mandatum, Granlund,
3 Danmark, Dr.Dropin, First Camp (77 postings, the largest single find).

**A dedupe hazard the merge must handle:** `3 Danmark` serves TWO boards under
different brands — `careers.3.dk` (20) and `careers.oister.dk` (2). Name-keyed
clustering would merge them; token-keyed would not. KICKS runs three separate
country boards which are genuinely distinct employers-in-market and should
stay separate. The two cases look identical from a name alone.

**54 is still an upper bound.** It is name-matched against a fuzzy facet, and
"Pennon Group" serving `careers.southwestwater.co.uk` is exactly the shape that
defeats it. Token-first verification is the merge protocol's job, not the
census's.

### The tenant-token question, resolved

**The token exists. No host override is needed.** `careers.telenor.se` is
`telenorsweden.teamtailor.com`, serving the same 26 jobs. These are ordinary
`{source:"teamtailor", token}` entries, so this is a merge and not a build —
which is exactly why it was worth answering before writing either.

**How a match is proven:** a SHARED NUMERIC JOB ID between the custom domain's
feed and the candidate tenant's. Not a 200 — Teamtailor serves a valid empty
feed for tenants that exist but are not hiring, so status alone would have
"confirmed" nonsense. Two hosts advertising the same posting are the same
tenant; nothing weaker establishes it.

**39 of 54 resolved** by a name- and domain-derived guess list
(`firstcamp`, `inpost`, `victorianplumbing`, `telenorsweden`, `kicksnorge`).
Then checked against sources.ts token-first, which is the check the fuzzy
name-match could not do:

| | |
|---|---|
| resolved to a tenant | 39 |
| **already carried** (yopa, getagent, cofoco) | **3** |
| **genuinely new tokens** | **36** |
| **postings behind them** | **479** |

So the earlier "54 new / 674 postings" was indeed an upper bound, as flagged.
The token-verified figure is **36 boards / 479 postings**, and that one is
solid because it compares tokens rather than company names.

**The 15 unresolved are not dead** — their tokens exist, the guess list missed
them. It fails on renames and holding companies: Pennon Group serving
`careers.southwestwater.co.uk`, and KICKS Sverige where `kicksnorge` worked.

**A dead end, recorded so it is not retried:** scraping the custom domain's HTML
for a `*.teamtailor.com` reference. It works only on pages that link SIBLING
tenants — `careers.telenor.se` names `telenorlinx` and `telenorsharedservices`,
never its own token. Three unresolved boards were checked directly: zero
teamtailor subdomains in the markup.

### Full-corpus sweep, all 1,000,000 Tranco domains, 2026-08-01

~2M DNS queries, ~110 minutes wall clock. The pilots suggested a broad seam;
this measured it.

| | |
|---|---|
| domains swept | 1,000,000 |
| on a known ATS CNAME | 1,187 |
| **serving real jobs** | **806** |
| by vendor | teamtailor **801**, breezy 4, pinpoint **1** |
| postings (see cap below) | **11,250** |

Top TLDs: `.com` 535, `.uk` 46, `.org` 21, `.se` 21, `.io` 19, `.co` 17,
`.fr` 15, `.fi` 12. **This was never a Nordic seam.** The Nordic pilot found 44
boards; over half the true population sits on `.com`.

**Pinpoint: 1 board in a million domains.** The channel this whole tool was
built for is, on this evidence, essentially closed. Teamtailor is 801 of 806.

#### 11,250 is a FLOOR, not a count

Ten boards report exactly 100 jobs, none report 99 or 101. That flat wall is a
page cap, and `?page=2` on `careers.lovisa.com` returns another 100. Those ten
are censored; the true total is higher by an unknown amount. Anyone quoting
11,250 should say "at least".

#### After token-first dedupe — the number that actually holds

| | boards | postings |
|---|---|---|
| teamtailor boards found | 801 | |
| resolved to a tenant token | 437 | |
| — already in sources.ts | 43 | 834 |
| — **genuinely new** | **394** | **5,359** |
| unresolved (token exists, guess list missed it) | 364 | 4,969 |

**394 new boards / 5,359 postings, token-verified.** Named: Savills (82),
Holcim (77), InPost UK (64), Easyfairs (63), BoyleSports (60), Thérapie Clinic
(59), Qureos, Aroma-Zone, ALE-HOP, Synergym.

Only 43 of 437 resolved boards were already carried — **90% of what a
subdomain census can see on custom domains, it cannot see.** That is the
finding: the two channels barely overlap.

The 364 unresolved are not dead. Their tokens exist; the name/domain guess list
misses renames and holding companies. At the resolved set's average they
represent roughly 4,900 more postings, and closing that gap is worth more than
sweeping another corpus.

---

## Ranking discovery by DRIVABLE yield — 2026-08-05

`scripts/census-drivable-yield.mjs`. Two phases: `rank` joins sources.ts to the
live `companiesFacet` and prints postings per producing board for the four
drivable vendors; `sweep` runs the custom-domain discovery over a Tranco corpus
and reports what that corpus actually surfaces.

**The live yield table reproduces the one the Pinpoint census was built on**,
which is the control that says the method still measures what it did:

| vendor | carried | producing | postings | per producing board |
|---|---|---|---|---|
| pinpoint | 257 | 104 | 4,583 | **44.1** |
| breezy | 1,005 | 832 | 11,522 | 13.8 |
| teamtailor | 1,535 | 1,063 | 10,043 | 9.4 |
| personio | 2,368 | 1,310 | 4,696 | 3.6 |

(77 Pinpoint tokens are claimed by another vendor too — Accenture, Next and
their kind, admitted deliberately by the merge guard's collision rule. The facet
counts by token, so those cannot be attributed to one vendor and are excluded
from both sides.)

### Yield per board was half a ranking, and it is the wrong half

    drivable postings per 1,000 domains = (boards per 1,000 domains) x (postings per board)

The left factor had never been measured. Four corpora, 15,000 domains, this run:

| TLD | domains | careers CNAMEs | on a drivable ATS | boards/1k | postings/1k |
|---|---|---|---|---|---|
| .co.uk | 4,000 | 384 | 27 | **5.00** | **84.0** |
| .com | 4,000 | 1,045 | 22 | 4.25 | 70.5 |
| .nl | 4,000 | 247 | 4 | 1.00 | 37.3 |
| .de | 3,000 | 418 | 2 | 0.67 | 5.3 |

**.co.uk returns 5.00 boards/1k — the 0.50% hit rate recorded for the same TLD
in the pilot above, to the digit.** That is the control, and it passed.

**Every board found across all 15,000 domains was Teamtailor.** Not one Breezy,
Personio or Pinpoint. So on the product that actually ranks a sweep, Teamtailor
at 9.4 x ~4.5 beats Pinpoint at 44.1 x ~0.001 by four orders of magnitude. The
vendor that wins the yield table is the one this channel cannot find, and
picking a target on yield alone is what sent 2M DNS queries after a single
Pinpoint board.

### The .de run measured our own vendor table, not the German market

418 careers CNAMEs resolved and 2 matched. Read as a result that says German
employers do not use drivable ATSs. It says nothing of the kind — the other 416
point at platforms this table has no fingerprint for. The sweep now reports them:

| .de | .com | .co.uk / .nl |
|---|---|---|
| b-ite (25), jobware (15), umantis (4), beesite (4), talention (4) | jibeapply (11), career.page (10), happydance (11), findly (7), recruitology (20) | volcanic.cloud (10), postingpanda (10), talosats (7), homerun.co (5) |

Sixth time a probe in this file measured our own setup and nearly filed it as a
fact about the world. The fix is the same one every time: ask what the
instrument can see before concluding the thing is absent.

**None of those platforms has been assessed for a bot wall or an adapter.** They
are the concrete next question, and they are a better one than another corpus:
`.com` is roughly half of Tranco and already swept exhaustively, so more domains
buys little, while a fingerprint for one mid-sized ATS opens a channel.
`secure.recruitee.com` shows up on both .de and .nl and stays NO-BUILD —
hCaptcha from `recruiteecdn.com`, measured 2026-08-01.

Nothing here is catalog-ready. Token-first dedupe, the corporate-only rule and
the merge guard's collision rule still decide what may enter sources.ts.

### The feed names its own tenant — a resolution channel that was sitting unread

**Measured 2026-08-05.** RECON above records 364 custom-domain Teamtailor boards
(~4,900 postings) as unresolved, with "closing that gap is worth more than
sweeping another corpus", and names the failure: a name- and domain-derived
guess list misses renames and holding companies.

Every Teamtailor custom-domain feed carries JSON-LD per item, and it declares
the employer's account name IN Teamtailor:

    _jobposting.identifier         { name: "Telenor Sweden", value: 8174332 }
    _jobposting.hiringOrganization { name: "Telenor Sweden" }

That name is what the token derives from — `telenorsweden`. The HOSTNAME is not:
it is whatever the employer pointed at the board. 14 of 14 feeds declared it.

`resolve-teamtailor-tokens.mjs` now derives candidates from it, ahead of the
hostname. Verified the same way as before — a SHARED NUMERIC JOB ID, never a
200. Across the 43 boards reachable from this session's sweeps:

| | |
|---|---|
| resolved | 21 / 43 |
| of those, only the org channel could produce | **3** |
| unresolved | 22 |

The three are exactly the documented failure shape, and no hostname could have
produced any of them:

    careers.desprint.nl     -> globalautomotivegroup   holding company
    careers.lutontown.co.uk -> lutontownfootballclub   expanded name
    careers.mdpi.com        -> mdpispain               per-market tenant

`careers.formelskin.de` declares "Voy" — a rebrand invisible from the domain.

### And the limit, calibrated rather than assumed

The remaining 22 are NOT "the guess list missed it", which is what the earlier
note assumed and what this script used to print. Probing the derived tokens
directly:

    telenorsweden.teamtailor.com/jobs.json    200, 25 jobs     (known good)
    inpost.teamtailor.com/jobs.json           200, 61 jobs     (known good)
    zzqqxxnotatenant.teamtailor.com           HTTP 404         (fabricated)
    pennongroup / southwestwater / pennon     HTTP 404
    crystalpalacefc / cpfc / motorpoint       HTTP 404

Every unresolved candidate answers identically to a name that was invented. So
for those boards the derived token genuinely does not exist — the tenant is
called something neither the hostname nor the declared org name predicts. More
guessing will not close them; a different channel is needed, and there is no
point spending another pass on slug variants.

Note also that Pennon Group was the case the earlier note singled out, and the
org channel gets the NAME right ("Pennon Group") while the token still 404s —
so even a correct employer name is not sufficient. Two separate facts that the
old "the guess list missed it" wording merged into one.

### The unassessed platforms behind the careers CNAMEs — 2026-08-05

The .de sweep above resolved 418 careers CNAMEs and matched two, and the point
made there was that the miss list is a fact about our four-entry pattern table,
not about the market. This is that miss list turned into candidates.

**14,000 .com/.de/.co.uk domains, DNS-first, counting tenants per platform:**

| platform | tenants | example tenants |
|---|---|---|
| recruitology | 68 | USA Today, LA Times, Chicago Tribune |
| jibeapply | 20 | Medallia, SiriusXM, Discovery |
| happydance | 19 | Criteo, Box, Uber |
| career.page | 18 | Booking.com, McAfee, Costco |
| findly | 16 | Home Depot, Realtor.com, Vanguard |
| b-ite | 6 | Uni Kiel, Ruhr-Uni Bochum, Uni Kaiserslautern |
| umantis | 4 | Deutsche Welle, NDR, BR |
| beesite | 3 | Porsche, KfW, GIZ |
| homerun / jobware / volcanic | 1–2 each | |

**TWO OF THE FOUR BIGGEST ARE ALREADY-CLOSED VENDORS WEARING A NEW HOSTNAME.**
Following the careers host and looking for a known ATS underneath:

    career.page   -> iCIMS 4/4
    jibeapply     -> iCIMS 3/4, Phenom 1/4
    volcanic      -> Phenom

iCIMS is recorded above as 17/60 CAPTCHA, "mixed, treat as blocked". So
Booking.com, McAfee, Costco, Medallia, SiriusXM and Discovery are not 38 new
drivable tenants — they are iCIMS, and they stay shut. Worth knowing before
anyone counts hostnames as reach.

**Genuinely unassessed, and in this order:** recruitology, happydance, findly,
umantis, beesite, b-ite, jobware.

### What this measurement does NOT establish

It followed the CAREERS LANDING PAGE, not a posting's apply URL. A platform
that hosts the job list can still hand the APPLICATION to something else, and
that handoff is invisible here — so "stays on platform" means "no known ATS
signature on the landing page", not "the apply form belongs to this platform".
Resolving that needs a real posting's apply URL per tenant, which is the next
pass and the one that decides whether any of these is buildable.

One prior judgement to carry into it: **recruitology is 68 tenants and they are
newspapers.** Newspaper job boards carry OTHER companies' listings, which is the
aggregator shape the catalog rules already exclude — so its size is likely to
evaporate on the corporate-only rule rather than on a bot wall. Check that
before spending a browser pass on it.

### The measurement error, for the sixth time in this file

The first run of this sweep returned ZERO tenants for every platform and would
have been recorded as "these platforms have no tenants in the top 14,000". The
Tranco CSV has CRLF line endings, so `d.endsWith(".de")` was false for every
`"example.de\r"`. `census-drivable-yield.mjs` trims and was unaffected; the
one-off script written beside it did not.

Same shape as every other entry here: the probe did not error, it answered
confidently, and it was measuring nothing. It was caught only by asking why a
sweep that had previously found 25 b-ite hosts now found none.

## Public application APIs — probed 2026-08-06. Two closed, one is a policy question.

The 5.4% drivable ceiling is the binding constraint on the whole apply agent, and
the note above says every route past it is closed on evidence. This tests a
route that note did NOT separate out: not "can a browser reach the form", but
"does the vendor publish an API that accepts an application".

The distinction matters, because they are not the same act. A documented public
application endpoint is the vendor's own supported path and using it is
ordinary integration. An undocumented endpoint that happens to skip a protection
the vendor deployed is evasion wearing a different verb.

All probes below are READ-ONLY or empty-body. An empty POST carries no name, no
email and no résumé, so it cannot create a candidate; it only separates 401/403
(auth required) from 400/500 (reachable). Same probe RECON already ran against
Greenhouse, Lever and Ashby. Nothing was submitted to any employer.

### SmartRecruiters — CLOSED, and now for a second, independent reason

45,380 postings, the largest single unlock, adapter already written.

    GET  /v1/companies/{co}/postings/{id}              200   public, unauthenticated
    GET  /v1/companies/{co}/postings?limit=1           200   totalFound 4,753 for Bosch alone
    OPTIONS /v1/.../candidates                         204   allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
    POST /v1/.../candidates                            404   "Cannot POST /public-posting-api/api-v1/..."
    POST /spi/v1/.../candidates                        404   nginx

The posting API is genuinely public and genuinely READ-ONLY. The permissive
OPTIONS is a blanket CORS default, not a contract — it lists every verb
including DELETE, and POST 404s from the Express service behind it, which names
its own internal path in the error. So SmartRecruiters is closed twice over: the
web form 403s headless, and there is no API to apply through.

### Workable — CLOSED, needs an employer token

    GET  apply.workable.com/api/v1/widget/accounts/{t}   200   public read
    GET  {t}.workable.com/spi/v3/jobs                    401   invalid_token

Consistent with the note above that no vendor exposes a public submit endpoint.

### Recruitee — REACHABLE, AND THAT IS THE PROBLEM

7,979 postings. Recorded above as NO-BUILD because 10/10 tenants load hCaptcha
on the application form, served first-party from recruiteecdn.com.

    GET  {t}.recruitee.com/api/offers/                   200   public read
    POST {t}.recruitee.com/api/offers/{id}/candidates/   500   on an EMPTY body

A 500 rather than a 401 means the request got past authentication and fell over
on missing fields — so the route is reachable without credentials. It is the
endpoint Recruitee's own careers widget posts to.

**NOT A GREEN LIGHT, and it should not be read as one.** Recruitee put hCaptcha
on the application path deliberately. Submitting through a sibling endpoint that
does not ask for the token is bot-detection evasion by another name, whatever
the HTTP status says — and this project's boundary does not bend because the
number on the other side is 7,979.

**Also NOT PROVEN.** A 500 on an empty body says the route is reachable. It does
NOT say a complete application would be accepted without a CAPTCHA token —
Recruitee may well validate it server-side. Establishing that either way means
sending a real application to a real employer under a real name, which is not a
thing to do to satisfy curiosity.

So it stays NO-BUILD, now for a stated reason rather than an assumed one, and
the question is a product decision rather than an open engineering task.

### The in-bounds way to grow reach, and it is cheap

Every vendor above is closed by a CHOICE the vendor made, and choices change.
Workable is recorded here as "otherwise the cleanest vendor seen... if Turnstile
ever comes off, this is a two-hour adapter". Nothing currently re-checks that.

`probe-botwall.ts` already exists and already discriminates. Running it on a
schedule over the closed vendors turns "closed on evidence from 2026-08-01" into
"closed as of this week", and would catch a vendor dropping its wall within days
instead of never. That is the highest-value reach work left that does not
involve crossing a line.
