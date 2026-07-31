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
| Form URL rule | link href has `/oneclick-ui/` | `{url}/apply` | `{url}?apply` | in-page screen | `{url}/application` | unknown |
| Shadow DOM | **1,806 roots** | none | 1 | none | none | none |
| Fields with `name` | **0 of 14** | **40 of 50** | **12 of 12** | 2 of 4 | not mapped | not mapped |
| Fields with `label[for]` | **11 of 14** | **0 of 50** | 8 of 12 | 3 of 4 | — | — |
| `required` attribute | **none** | **30 of 50** | **none** | 1 (consent) | — | — |
| Match strategy | `label[for]` | `name` | `name` | `name` | — | — |
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

## Status

**Adapters written from observation:** Breezy, SmartRecruiters, Personio.

**Reconnoitred, not yet servable** — each needs one more pass, and what is known
is recorded in `vendors/index.ts` so the next pass starts from evidence:
  - **Pinpoint** — form URL rule known (`{posting}/application`); fields unmapped.
  - **Oracle** — email-first screen, no account needed, but a REQUIRED
    terms-and-conditions checkbox. Accepting an employer's terms on a
    candidate's behalf is a product decision, not a coding one.
  - **Teamtailor** — apply control is employer-authored, so the form URL rule is
    still unknown.

**Workday** needs a per-tenant candidate account — a credential problem rather
than a form problem, unsolved, and the largest vendor in the tier.

Nothing was submitted to any employer during this work.
