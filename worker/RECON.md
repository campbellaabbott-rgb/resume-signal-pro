# Vendor recon — what real apply pages actually look like

Observed 2026-07-30 by loading live postings in a browser and reading the DOM.
No applications were submitted. Every finding below is from a real page, not
from documentation or inference.

This exists because the first driver was written from imagination and would have
failed on all three vendors examined — not because of CAPTCHAs, which were
absent exactly as measured, but because the forms are nothing like what a
generic driver assumes.

## The three shapes

| | SmartRecruiters | Breezy | Teamtailor |
|---|---|---|---|
| Apply control text | `I'm interested` | `Apply To Position` | `Apply Here .xx` |
| Control type | link → other URL | button → `{jd}/apply` | employer-customised |
| Form location | separate `oneclick-ui` URL | `{jdUrl}/apply` | not yet reached |
| Shadow DOM | **1,806 open roots** | none | none |
| Fields with `name` | **0 of 14** | **40 of 50** | — |
| Fields with `label[for]` | **11 of 14** | **0 of 50** | — |
| `required` attribute | **absent on all** | **30 of 50** | — |
| File inputs | 2, both `id="file-input"` | 3, `cResume` required | — |
| Submit control | `Next` (multi-step) | `Submit Application` | — |
| CAPTCHA | none | none | none |

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

## Still to do

Oracle, Personio and Pinpoint have had no recon. They are marked `needsRecon` in
`vendors/index.ts` and the worker refuses them, because shipping an adapter
written from imagination is exactly what this document exists to prevent.

Workday needs a per-tenant candidate account — a credential problem, not a form
problem, and unsolved.
