# Wave 3: scan + AI (deploy note)

Branch `wave3/scan-ai`, from main at 12a37285 (wave 2, PR #24). It works every item in the S8 debug sweep of 2026-10-08 with `fix_group: "scan-ai"` (30 items, in the private register `platform-debug-2026-10-08/register.json`). It also applies owner decision 1 of 2026-10-08 to the scan's own pages. The verifier is `scripts/verify-deploy.d/72-wave3-scan-ai.sh`.

None of the 30 items had been fixed by wave 2. Each one was checked against main at 12a37285 before work started.

## What changes for a customer

| Register | Commit | What changes |
| --- | --- | --- |
| **S8-004, S8-005** (high), S8-037, S8-038, S8-039, S8-040 | d6a1f1bc | Shortlist redaction now finds the candidate's name in the first six lines. That covers accented names, ALL-CAPS names, CJK names, names followed by credentials or a pipe, and names under a RESUME heading. It masks the name wherever it appears. Emails, profile URLs, personal domains, phone numbers (international, US and trunk-0), state+ZIP, and UK and Canadian postcodes are all stripped, so no contact detail reaches the model. Labelled personal fields keep their label and lose the value. Dates of birth, "N-year-old" and "graduated YYYY" are caught. Years are masked only on degree and school lines, and the Education section closes at any heading. Job evidence is no longer erased ("CPT coding", "Ministry of Finance", "Temple University", hotel accommodations, "opt-in"). Counts record only replacements that actually happened. |
| S8-013 | 04702d77 | A résumé restored after a reload enables the free-scan and $5 buttons. |
| S8-032 | 99f2ac53 | The grounding check now reads comma-grouped figures. An invented "10,000 users" is refused, and an honest "2,500" matched against a source "2500" passes. This applies to the cover letter, the Apply kit and the agent's cover note. |
| S8-033, S8-066 | d780281a | The Premium Package keeps the buyer's own phone, LinkedIn and GitHub when the model only reformats them. Auto-fix no longer rewrites "good fortune" or "DVD/CD". |
| Owner decision 1; commercial readiness items 6 and 7 | 94778203, 9b80ff43, ae644044 | **Offers.** The free report ends with one Next steps section and exactly two offers: the $5 Full Analysis and Pro. Removed: the invented "Premium Only" issues, the 48-hour countdown that reset on every visit, the "$25" button, and every other offer down to the hidden $3 fix. **Prices in copy.** The value table states the Full Analysis price that checkout charges. It used to say "$5 – $25", and "5 € – 25 €" in some locales. **Time to results.** The homepage gives one time to results everywhere: within 90 seconds (`SCAN_RESULTS_WITHIN_SECONDS`), the bound the code guarantees. **Repeatability.** "Same document, same score" now reads "a rescan of the same file within 7 days returns the same report", which is what the cache provides. The "Why not ChatGPT" card says the same. All nine locales are updated. |
| S8-064, S8-067, S8-068, S8-069, S8-070, S8-071, S8-072 | 872c3117 | **Rescans.** A rescan that hits the cache spends no daily slot and answers `cached: true`. **Cache key.** The key and the report's market use one country rule. The reportId covers the inputs and the score, and analysis runs at temperature 0. **Partial reports.** A model shape that would have thrown, or an analysis that is invalid or less than 70% complete, now produces a partial report: it is not cached and the credit is refunded. **Score audit.** "Every point, accounted for" now sums to the total. **Language field.** The stream fork and both paid streams accept only a real language name or a locale code. The stream fork is kept in step with all of this. |
| S8-011 | cb37c10a | Every "per day" allowance on `check_rate_limit` lasts a full day: the free scan's 7, a purchase's 10, and the 1,440-minute caps. Before this, a 60-minute caller's sweep emptied them after about an hour (migration 20261009110000). |
| S8-063, S8-065 | 6ebb2ab3 | ATS Defense and the Apply kit now count one purchase's daily allowance and answer 503 when the limiter is down. A paying Interview Coach buyer is counted in a bucket the size of the purchase, not the shared 20 per hour. |
| S8-116, S8-117, S8-118 | cd65a83c | **File choosers.** Every file chooser can be reached by keyboard and screen reader. **Crash screens.** They use theme colours. The report's crash notice now says "scan again", because a refresh discarded the report, and it resets with each new result. **Sticky bar.** The help button lifts above the homepage's sticky bar, so the bar's dismiss button can be tapped. |
| S8-075 | fd23eeed | "Get job-specific analysis" records the job as the scan's job description, in page state, the session and the stored résumé, before it scans. "Get full analysis" on that report now buys an analysis of that job. |
| S8-034, S8-073 | c9256067 | **Verdicts.** Paid generators translate free text only. JSON keys and fixed choices ("Strong", "High", "Ready to Apply") stay in English, so colours and gauges work in every language. A translated verdict is mapped back to its English value, and the page shows it in the reader's language (`careerReportEnum`, nine locales). **Report shape.** Career Snapshot and Game Plan ship only a reply with the whole shape. Otherwise they ask the next model, and if none completes it they answer a retryable 502. The pages and PDFs shape a stored report before reading it, and each section has its own error boundary. |
| S8-041, S8-042, S8-110, S8-111 | 5786c5df | **Evaluation record.** A Shortlist evaluation cannot be rewritten, and an employer cannot insert one: the service role writes it. A status changes only together with its logged decision, through `shortlist_decide`. An override is a decision and never rewrites the AI score. **JD.** The scored JD is the role's stored text, kept on the row. `jd_version` bumps on every edit. **Bias audit.** Selection rates leave pending candidates out. Demographics use EEO-1 categories, and free text is read into them. The audit adds a scoring-rate table (share above the median score). **Alternative review.** It hides a candidate's score and rank and is marked in exports. It can be requested before scoring, with no model call (migration 20261009111000). |

## Apply the migrations first, in this order

Both migrations check themselves with a DO block and are safe to re-run. Neither one adds a SECURITY DEFINER function, so nothing goes on the client-callable census allowlist.

1. `20261009110000_a_day_long_allowance_survives_an_hourly_callers_sweep.sql`
   - Re-creates `check_rate_limit` with one change: the sweep deletes only rows older than 1,440 minutes.
   - Grants are re-stated as service role only.
   - Depends on `rate_limits` (20251216002238).
   - Apply it before, or with, the functions. Without it they still work, but "per day" stays hourly.
2. `20261009111000_a_shortlist_evaluation_cannot_be_rewritten_and_a_status_changes_only_with_its_decision.sql`
   - Adds `shortlist_candidates.jd_text_scored`.
   - Revokes INSERT and table-wide UPDATE from authenticated and grants UPDATE (status) instead.
   - Adds the guard trigger and the `jd_version` trigger.
   - Adds `shortlist_decide(uuid, text, text)` (SECURITY INVOKER, authenticated only).
   - Restricts the decision insert policy to the caller's own candidates.
   - Depends on the Shortlist tables (20260703120000) and their grants (20260704160023).
   - **Deploy `shortlist-evaluate.2026-10-09.2` and the frontend right after this migration.** In the gap, the old function's insert runs on the employer's client, which is now refused, and the old page's status update has no decision in its transaction, so it is refused too. Shortlist is an employer beta, so keep the gap to minutes.

## Deploy these functions

| Function | Build | Why |
| --- | --- | --- |
| free-keyword-scan | `free-keyword-scan.2026-10-09.1` | Slot after the cache, `cached: true`, key country, reportId, temperature 0, shape guard, partial reports, the score audit (S8-067..072) |
| free-keyword-scan-stream | `free-keyword-scan-stream.2026-10-09.1` | Kept in step with the primary, plus the language bound (S8-064) |
| generate-cover-letter-stream | `generate-cover-letter-stream.2026-10-09.1` | Language bound (S8-064) |
| generate-premium-package-stream | `generate-premium-package-stream.2026-10-09.1` | Language bound (S8-064) |
| generate-premium-package | `generate-premium-package.2026-10-09.1` | Contact guard compares canonical forms; auto-fix (S8-033, S8-066) |
| generate-cover-letter | `generate-cover-letter.2026-10-09.1` | Grouped figures (S8-032); the purchase bucket (S8-065) |
| generate-apply-package | `generate-apply-package.2026-10-09.1` | Grouped figures; the per-purchase day; limiter 503 (S8-032, S8-063) |
| generate-application-answers | `generate-application-answers.2026-10-09.1` | Grouped figures in the cover note (S8-032); the instruction (S8-034) |
| generate-ats-defense | `generate-ats-defense.2026-10-09.1` | The per-purchase day; limiter 503 (S8-063); the instruction (S8-034) |
| generate-interview-coach | `generate-interview-coach.2026-10-09.1` | The purchase bucket (S8-065); the instruction |
| generate-career-path | `generate-career-path.2026-10-09.1` | The purchase bucket (S8-065); the instruction |
| generate-career-snapshot | `generate-career-snapshot.2026-10-09.1` | Whole shape or the next model; English verdicts (S8-073, S8-034) |
| generate-graduate-gameplan | `generate-graduate-gameplan.2026-10-09.1` | The same (S8-073, S8-034) |
| generate-keyword-fix | `generate-keyword-fix.2026-10-09.1` | The instruction (S8-034) |
| generate-product-preview | `generate-product-preview.2026-10-09.1` | The instruction (S8-034) |
| shortlist-evaluate | `shortlist-evaluate.2026-10-09.2` | Redaction (S8-004/005/037..040); the stored JD and `jd_text_scored`; service-role insert; `altReview` (S8-110, S8-111). Needs 20261009111000 first. |

The other functions that import `_shared/model-spend-gate.ts` get the same bundle on their next deploy, but they behave exactly as before. The change applies only to free generators that pass `products` (Interview Coach, Career Path, Cover Letter), so nothing else needs redeploying. job-board is untouched.

**Frontend (Lovable publish).** This covers the free report and homepage (index.html, `public/llms.txt`, `scripts/prerender-seo.mjs`), the uploader, the crash screens, the help button, the Career Snapshot and Game Plan pages and PDFs, the Shortlist page, and all nine locale files.

## Owner steps

None beyond the deploy order above. Existing Shortlist demographics entered as free text are read into EEO-1 categories. A value that matches none is counted as "unclassified" and left out; the page says how many.

## Rollback

- **Functions.** Redeploy the previous builds listed in the verifier's FAIL lines. The previous Career Snapshot and Game Plan builds accept any four-key reply again.
- **20261009111000.** Run:

  ```sql
  DROP TRIGGER shortlist_candidates_guard ON public.shortlist_candidates;
  DROP TRIGGER shortlist_roles_jd_version ON public.shortlist_roles;
  GRANT INSERT, UPDATE ON public.shortlist_candidates TO authenticated;
  CREATE POLICY "owners insert own candidates" ON public.shortlist_candidates
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
  ```

  Then redeploy the previous shortlist-evaluate and frontend. Leave `jd_text_scored` and `shortlist_decide` in place; they are harmless.
- **20261009110000.** Re-run the 20251219200654 body. This is not recommended: it brings back hourly "daily" allowances.

## What to measure

- `bash scripts/verify-deploy.sh` section 72. Before this deploy it FAILs on every build and claim. This was run against production on 2026-10-10: 29 FAIL and 1 INFO, no crash.
- Career Snapshot and Game Plan deliveries. Watch the "Reply refused" log lines and the share of 502s. A rise means a model now misses the shape, and those deliveries are retried by the sweeper instead of shipping broken.
- Free scan. Watch the share of responses with `cached: true`, and confirm that a rescan of the same file no longer moves `scansUsed`.
- Rate limits. A `rate_limits` row with a 1,440-minute window should now live a full day.
- Shortlist. `shortlist_decisions` rows per status change should be 1:1, and no `shortlist_candidates` row should have an UPDATE that touches AI columns.

## Tests added (each fails on the code before its change)

| Test | Proof it failed before |
| --- | --- |
| `shortlist-redaction-let-names-and-contact-lines-reach-the-model`, `shortlist-redaction-erased-job-evidence-and-passed-protected-fields` | 33 of their 49 cases fail on the old module |
| `a-restored-resume-left-the-scan-buttons-greyed-out` | 2 of 3 cases fail on the old component |
| `an-invented-comma-grouped-figure-passed-the-grounding-check` | 3 of 5 cases fail |
| `the-premium-contact-guard-deleted-the-buyers-own-phone-and-profiles`, `the-paid-autofix-turned-good-fortune-into-fortune-500` | 2 of 4 cases fail, and 6 of 6 |
| `the-free-report-sold-invented-issues-a-resetting-countdown-and-a-25-dollar-price` | 3 of 3 cases fail, plus the value-table case: "de: 5 € – 25 € einmalig" |
| `the-homepage-told-four-different-times-to-results` | 2 of 3 cases fail |
| `a-rescanned-score-repeats-only-within-the-report-cache` | Fails on the old card |
| `a-rescan-spent-a-slot-and-a-thin-report-shipped-whole`, `the-scan-fallback-put-any-language-in-its-prompt-and-charged-a-slot-for-a-replay` | 6 of 6 cases fail, and 4 of 4 |
| `a-day-allowance-the-limiter-sweeps-is-an-hour` (pglite) | The previous definition is the teeth; the live case fails without the migration |
| `one-purchase-ran-the-dearest-generators-without-limit-and-locked-out-a-coach-buyer` | 5 of 7 cases fail |
| `the-crash-screens-and-the-corner-controls-could-not-be-used` | 4 of 4 cases fail |
| `a-per-job-rescan-sold-an-analysis-of-the-previous-job` | The step did not exist before |
| `a-career-report-shipped-whole-when-a-section-was-missing-or-its-verdicts-were-translated` (harness) | 5 of 5 cases fail |
| `a-translated-verdict-drew-a-strong-career-as-risky-and-a-missing-list-crashed-the-page` | 12 of 14 cases fail |
| `a-shortlist-record-could-be-rewritten-and-scored-a-jd-it-never-kept` (pglite) | The teeth case shows each write landing without the migration |
| `the-bias-audit-counted-pending-candidates-and-split-one-group-into-three` | 5 of 5 cases fail ("expected 10 to be 5") |
| `shortlist-scored-the-jd-the-browser-sent-and-had-no-review-without-a-score` (harness) | 2 of 2 cases fail |
| `an-alternative-review-kept-its-ai-score-and-rank` | The module did not exist before |

## Handoffs

- **seo-content-i18n**
  - The homepage's "Why not ChatGPT" section and the whole Shortlist page are English-only. This was true before this branch; strings changed here follow their pages.
  - "24+ checks" (WhyNotChatGPT and the vendor landers in the prerender) and "in seconds" (four prerender CTAs) are numbers or durations that no code computes.
- **Integrator**
  - Locale files gain `homepage.reportCrash` and a top-level `careerReportEnum` block, appended at the end of each file. That is a likely textual conflict with other groups that append.
  - The function builds above may collide with other groups that bump the same functions (generate-apply-package, generate-ats-defense, free-keyword-scan). Take the later build and keep both changes.
  - The spend-gate harness fixture in `every-public-model-call-is-counted-before-it-is-made.test.ts` now gives its Shortlist role a `jd_text`.
- **Payments**
  - `FAQ.tsx` still replaces any "$25" in an answer with the local price. No locale answer contains "$25" any more, so the replacement is dead code.
