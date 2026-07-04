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
| Human-in-the-loop gate: status changes only via logged human actions | `Shortlist.tsx` `decide()` + `shortlist_decisions` | LL144 (human discretion), EU AI Act human oversight, GDPR Art. 22 (no solely automated decision), CA FEHA human-oversight expectation |
| Append-only decision/override log (actor, timestamp, old→new, reason) | `shortlist_decisions` table — INSERT+SELECT policies only, no update/delete | CA FEHA 4-year recordkeeping; EU AI Act logging; discovery-readiness |
| Immutable evaluation record (JD version, redacted input, score, signals, flags, model/prompt version, reviewer decision) | `shortlist_candidates` table | CA FEHA recordkeeping (inputs/outputs); EU technical documentation; reproducibility |
| Proxy-variable exclusion before scoring, with per-evaluation audit of what fired | `_shared/redaction.ts`, applied in `shortlist-evaluate` | Title VII/ADEA/ADA disparate-impact risk reduction; CA FEHA anti-bias evidence |
| Employer-configurable allow/blocklists (baseline blocklist cannot shrink) | `redactionConfig.extraBlocklist` param | Documented, configurable feature governance |
| Bias-audit pipeline: separate demographic capture, never passed to model; selection rate + impact ratio (4/5ths) per sex, race/ethnicity, intersectional | `shortlist_demographics` table + `_shared/impact-ratio.ts` + bias view | NYC LL144 audit data preparation (independent auditor still required); EEOC Uniform Guidelines math |
| Audit exports (CSV/JSON by role) | `Shortlist.tsx` `exportAudit()` | LL144 auditor handoff; CRD investigation readiness; customer evidence trail |
| "Signals considered" explainability per candidate | evaluation `signals` + UI panel | EU transparency; LL144 assessed-qualifications disclosure; defensibility |
| Candidate-notice tooling (NYC ≥10-business-day advance, IL AI-use, EU disclosure), logged when sent | `noticeTemplate()` + `shortlist_notices` | LL144 §(b) notice; IL HB 3773 notice; EU AI Act Art. 50/Annex III transparency |
| Jurisdiction routing per role (NYC/IL/CA/EU/OTHER) | `shortlist_roles.jurisdiction` | Applies correct notice + workflow automatically |
| ADA / alternative review path (logged; instructs score non-use) | `requestAltReview()` | ADA; LL144 alternative-process accommodation |
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

`src/test/shortlist-compliance.test.ts` pins the two legal-exposure components:
proxy redaction (name/age/address/ADA/affinity/family/gender stripping, with
employment tenure preserved) and the four-fifths impact-ratio math (including
low-sample handling and intersectionality). CI-gated with the rest of the suite.
