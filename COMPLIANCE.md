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
| Human-in-the-loop gate: status changes only via logged human actions | `shortlist_decide()` writes the decision and the status in one transaction; the `shortlist_candidates_guard` trigger refuses any status change without its decision (the decision function 20261009111000; the guard trigger 20261009112000, applied 2026-10-12) | LL144 (human discretion), EU AI Act human oversight, GDPR Art. 22 (no solely automated decision), CA FEHA human-oversight expectation |
| Append-only decision/override log (actor, timestamp, old→new, reason), kept as long as its candidate is | `shortlist_decisions` table — INSERT+SELECT policies only, no update or delete of a decision on its own (a candidate's deletion takes its decisions, and `shortlist_deletions` records that it happened); the `shortlist_decisions_stamp` trigger sets the timestamp and actor from the server clock and the JWT (20261009112000), and an advance or reject is logged only by `shortlist_decide` with the status it sets (the function 20261009111000, the trigger that enforces it 20261009112000) | CA FEHA 4-year recordkeeping; EU AI Act logging; discovery-readiness |
| Immutable evaluation record (JD version and the JD text scored, redacted input, score, signals, flags, model/prompt version, reviewer decision) | `shortlist_candidates` table: written by the service role only and owners may update `status` alone (20261009112000 revokes the browser's insert and every other column); overrides are decisions, never a rewrite of the score; `jd_version` bumps on every JD edit (20261009111000) | CA FEHA recordkeeping (inputs/outputs); EU technical documentation; reproducibility |
| Proxy-variable exclusion before scoring, with a per-evaluation audit of what fired: the name (read from every line of the header block, or from the uploaded file's name when the text shows its words, and masked wherever it recurs, Chinese, Japanese and Korean names included), contact details, labelled personal fields in English, German, French, Spanish, Portuguese, Dutch, Chinese and Japanese (with a colon, a tab or a run of spaces), age, origin, disability, family, affinity and faith proxies, and English prose proxies (pronouns, gendered role nouns, Greek-letter societies, family and age phrasing, birthplace). The scored text carries one neutral `[REDACTED]` mark: the category hidden is named only in the audit, and a leave reads "Career break". The baseline is the same for every caller: no request field adds to it or shrinks it. Detection is pattern-based and can miss: a name the header does not show, another language, or a proxy in words the rules do not know can reach the model. Each evaluation records whether a name was found (`parsed_fields.redaction.nameDetected`) and the page warns when none was; the cases it is tested on are in `src/test/shortlist-redaction-*.test.ts` and the corpus `src/test/fixtures/shortlist-redaction-corpus.ts` | `_shared/redaction.ts`, applied in `shortlist-evaluate` | Title VII/ADEA/ADA disparate-impact risk reduction; CA FEHA anti-bias evidence |
| What the model saw, per candidate: the stored redacted text, the candidate's jurisdiction and any text addressed to the scorer, shown when a candidate is opened | `Shortlist.tsx` ("What the model saw") | Explainability; lets the employer check what the redaction let through |
| No demographic data is recorded (owner decision D14, 2026-10-12): the page offers no sex or race field and reads none. An impact-ratio audit joins the employer's own self-reported applicant data to the Audit CSV by candidate id, outside Shortlist. The four-fifths math in `src/lib/impact-ratio.ts` is held by tests only; no page computes it | `Shortlist.tsx` bias note; `src/lib/impact-ratio.ts` (tests) | NYC LL144 audit data preparation (independent auditor still required); EEOC Uniform Guidelines math |
| Audit exports (CSV/JSON by role), read by role in pages so a role of any size exports whole; a file with a part that could not be read is not downloaded. The JSON carries each candidate's scored text, jurisdiction and parsed fields, every decision and the logged notices; the CSV carries when the role's latest notice went out | `Shortlist.tsx` `exportAudit()`, `src/lib/shortlist-reads.ts` | LL144 auditor handoff; CRD investigation readiness; customer evidence trail |
| "Signals considered" explainability per candidate | evaluation `signals` + UI panel | EU transparency; LL144 assessed-qualifications disclosure; defensibility |
| Candidate-notice tooling (NYC ≥10-business-day advance, IL AI-use, EU disclosure). Copying a notice logs nothing; it is logged as sent only when the employer gives the date it went out (and, optionally, who it went to). The database stamps when it was logged from its own clock and refuses a send date after today (20261112210000); an NYC role warns before evaluating until a notice went out at least 10 business days earlier | `noticeTemplate()` + `shortlist_notices` | LL144 §(b) notice; IL HB 3773 notice; EU AI Act Art. 50/Annex III transparency |
| Jurisdiction routing per role (NYC/IL/CA/EU/OTHER) | `shortlist_roles.jurisdiction` | Applies correct notice + workflow automatically |
| ADA / alternative review path, before or after scoring (logged; the candidate is unranked, its score hidden and marked in exports) | `requestAltReview()`, `shortlist-evaluate` `altReview`, `src/lib/shortlist-review.ts` | ADA; LL144 alternative-process accommodation |
| Retention (owner decision S14X-073, rule A, 2026-11-15): records stay until the employer deletes the candidate, the role or the account, and anything still held four years after it was uploaded is deleted by a daily job. The employer deletes a candidate or a whole role on the page, after typing DELETE; a role takes its candidates, their decisions and its notices with it. Every deletion, by the employer or by the four-year job, is logged with its dates and ids and never the résumé; the employer may read that log and no client may write it | `shortlist_delete_candidate()`, `shortlist_delete_role()`, `shortlist_purge_expired()` (daily `shortlist-four-year-purge`), `shortlist_deletions` (20261112211000); `Shortlist.tsx` delete controls, shown once that migration has applied | CA FEHA 4-year recordkeeping (records stay at least as long as the employer keeps them, and no longer than four years after upload); GDPR storage limitation and erasure on request |
| Model prompt hard constraints: job-related only, every marker neutral and never guessed at, employment gaps and career breaks never penalized | `shortlist-evaluate` system prompt (prompt version `shortlist-v3`) | ADA screen-out prevention; disparate-impact hygiene |
| A candidate is kept only with its logged confirmation: when the uploader's confirmation (or an alternative-review request) cannot be logged, the evaluation just stored is removed again and the answer says whether that worked | `shortlist-evaluate` | Owner decision D14 (the uploader confirms first); no evaluation without its evidence |

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
the evaluator. `compliance-md-describes-the-shortlist-that-ships.test.ts` holds this
document to the code: no feature here that the code does not ship. CI-gated with
the rest of the suite.
