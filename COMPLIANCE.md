# Shortlist — Compliance Feature Map

Engineering documentation, not legal advice. Have counsel review before selling
into any regulated jurisdiction. Prepared July 2026; employment-AI law moves
fast — re-verify statutes before launch.

## Legal frame

Shortlist is legally an AEDT (NYC LL144), an ADS (California FEHA regs), an AI
system used in employment decisions (Illinois HB 3773), and a high-risk AI
system (EU AI Act, Annex III). In all of these, the EMPLOYER (deployer)
carries liability, and the newest laws (California most explicitly) reject
the third-party-vendor defense. Therefore this product's job is to generate
the customer's compliance evidence trail. The tool recommends and ranks only —
it never decides.

## Feature → obligation map

| Feature | Where | Satisfies |
|---|---|---|
| Human-in-the-loop gate: status changes only via logged human actions | `shortlist_decide()` writes the decision and the status in one transaction; the `shortlist_candidates_guard` trigger refuses any status change without its decision (20261009111000) | LL144 (human discretion), EU AI Act human oversight, GDPR Art. 22 (no solely automated decision), CA FEHA human-oversight expectation |
| Append-only decision/override log (actor, timestamp, old→new, reason) | `shortlist_decisions` table — INSERT+SELECT policies only, no update/delete | CA FEHA 4-year recordkeeping; EU AI Act logging; discovery-readiness |
| Immutable evaluation record (JD version and the JD text scored, redacted input, score, signals, flags, model/prompt version, reviewer decision) | `shortlist_candidates` table: written by the service role only; owners may update `status` alone; overrides are decisions, never a rewrite of the score; `jd_version` bumps on every JD edit (20261009111000) | CA FEHA recordkeeping (inputs/outputs); EU technical documentation; reproducibility |
| Proxy-variable exclusion before scoring (the name as read from the header and masked wherever it recurs, contact details, labelled personal fields, age, origin, disability, family, affinity and faith proxies), with per-evaluation audit of what fired. Name and contact detection are heuristic: the header shapes it is tested on are listed in `src/test/shortlist-redaction-*.test.ts`, and a shape outside them can pass | `_shared/redaction.ts`, applied in `shortlist-evaluate` | Title VII/ADEA/ADA disparate-impact risk reduction; CA FEHA anti-bias evidence |
| Employer-configurable allow/blocklists (baseline blocklist cannot shrink) | `redactionConfig.extraBlocklist` param | Documented, configurable feature governance |
| Bias-audit pipeline: separate demographic capture in EEO-1 categories, never passed to model; selection rate over human decisions (pending left out) and scoring rate (share above the median score), each with impact ratio (4/5ths), per sex, race/ethnicity, intersectional | `shortlist_demographics` table + `_shared/impact-ratio.ts` + bias view | NYC LL144 audit data preparation (independent auditor still required); EEOC Uniform Guidelines math |
| Audit exports (CSV/JSON by role) | `Shortlist.tsx` `exportAudit()` | LL144 auditor handoff; CRD investigation readiness; customer evidence trail |
| "Signals considered" explainability per candidate | evaluation `signals` + UI panel | EU transparency; LL144 assessed-qualifications disclosure; defensibility |
| Candidate-notice tooling (NYC ≥10-business-day advance, IL AI-use, EU disclosure), logged when sent | `noticeTemplate()` + `shortlist_notices` | LL144 §(b) notice; IL HB 3773 notice; EU AI Act Art. 50/Annex III transparency |
| Jurisdiction routing per role (NYC/IL/CA/EU/OTHER) | `shortlist_roles.jurisdiction` | Applies correct notice + workflow automatically |
| ADA / alternative review path, before or after scoring (logged; the candidate is unranked, its score hidden and marked in exports) | `requestAltReview()`, `shortlist-evaluate` `altReview`, `src/lib/shortlist-review.ts` | ADA; LL144 alternative-process accommodation |
| Retention default 4 years, no delete policies inside window | migration comments + RLS design | CA FEHA 4-year rule (also covers EU ≥6-month log minimum) |
| Model prompt hard constraints: job-related only, redaction markers neutral, gaps/ADA content never penalized | `shortlist-evaluate` system prompt | ADA screen-out prevention; disparate-impact hygiene |

## Deliberately NOT built (per spec)

- Colorado SB 24-205 architecture — repealed/replaced by SB 26-189 (eff. Jan 1
  2027, lighter obligations). Revisit late 2026.
- Auto-rejection or auto-advance of any kind — permanently out of scope by design.
- The independent LL144 bias audit itself — the product produces the dataset;
  an auditor with no financial interest must run it.

## Hand to a lawyer (not code)

- ToS / indemnification posture (customers cannot offload liability; expect pressure)
- EU "provider" classification, conformity assessment, EU-database registration
- Final jurisdiction-specific notice wording (templates here are drafts)
- DPAs (GDPR/CCPA) with customers
- EU timeline watch: Annex III high-risk obligations deferred to Dec 2 2027
  (Digital Omnibus); Art. 50 transparency ~Dec 2 2026

## Tests

`src/test/shortlist-compliance.test.ts`, `shortlist-redaction-let-names-and-contact-lines-reach-the-model.test.ts`
and `shortlist-redaction-erased-job-evidence-and-passed-protected-fields.test.ts` pin the two legal-exposure components:
proxy redaction (name/age/address/ADA/affinity/family/gender stripping, with
employment tenure preserved) and the four-fifths impact-ratio math (including
low-sample handling and intersectionality).
`the-bias-audit-counted-pending-candidates-and-split-one-group-into-three.test.ts`
holds the selection and scoring tables, `a-shortlist-record-could-be-rewritten-and-scored-a-jd-it-never-kept.test.ts`
the database enforcement (pglite), and
`shortlist-scored-the-jd-the-browser-sent-and-had-no-review-without-a-score.test.ts`
the evaluator. CI-gated with the rest of the suite.
