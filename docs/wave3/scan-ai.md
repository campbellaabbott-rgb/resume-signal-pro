# Wave 3: scan + AI (deploy note)

Branch `wave3/scan-ai`, from main at 12a37285 (wave 2, PR #24), with origin/main 31647d4c (PR #25, the deploy ledger) merged in at 0db147e7. It works every item in the S8 debug sweep of 2026-10-08 with `fix_group: "scan-ai"` (30 items, in the private register `platform-debug-2026-10-08/register.json`). It also applies owner decision 1 of 2026-10-08 to the scan's own pages. The verifier is `scripts/verify-deploy.d/72-wave3-scan-ai.sh`.

None of the 30 items had been fixed by wave 2. Each one was checked against main at 12a37285 before work started.

## What changes for a customer

| Register | Commit | What changes |
| --- | --- | --- |
| **S8-004, S8-005** (high), S8-037, S8-038, S8-039, S8-040 | d6a1f1bc, a9cc9def | Shortlist redaction now finds the candidate's name in the first six lines. That covers accented names, ALL-CAPS names, CJK names, names followed by credentials or a pipe, and names under a RESUME heading. It masks the name wherever it appears. Emails, profile URLs, personal domains, phone numbers (international, US and trunk-0), state+ZIP, and UK and Canadian postcodes are all stripped. Detection is heuristic: the shapes it handles are the ones its tests list (see the review round for the shapes added there). Labelled personal fields keep their label and lose the value. Dates of birth, "N-year-old" and "graduated YYYY" are caught. Years are masked only on degree and school lines, and the Education section closes at any heading. Job evidence is no longer erased ("CPT coding", "Ministry of Finance", "Temple University", hotel accommodations, "opt-in"). Counts record only replacements that actually happened. |
| S8-013 | 04702d77 | A résumé restored after a reload enables the free-scan and $5 buttons. |
| S8-032 | 99f2ac53 | The grounding check now reads comma-grouped figures. An invented "10,000 users" is refused, and an honest "2,500" matched against a source "2500" passes. This applies to the cover letter, the Apply kit and the agent's cover note. |
| S8-033, S8-066 | d780281a | The Premium Package keeps the buyer's own phone, LinkedIn and GitHub when the model only reformats them. Auto-fix no longer rewrites "good fortune" or "DVD/CD". |
| Owner decision 1; commercial readiness items 6 and 7 | 94778203, 9b80ff43, ae644044; review round 2: 86a7de05, f83220ea, 83984dee, 0980afb9 | **Offers.** The free report ends with one Next steps section and exactly two offers: the $5 Full Analysis and Pro. Removed: the invented "Premium Only" issues, the 48-hour countdown that reset on every visit, the "$25" button, the "auto-rejected" Premium card the homepage rendered under the report (86a7de05), and every other offer down to the hidden $3 fix. The homepage's sticky bar names the Full Analysis and its price, not "premium packages from $3" (f83220ea). **Prices in copy.** The value table states the Full Analysis price that checkout charges. It used to say "$5 – $25", and "5 € – 25 €" in some locales. **Time to results.** The homepage, the tool landings and every industry page (83984dee) give one time to results: within 90 seconds (`SCAN_RESULTS_WITHIN_SECONDS`), the bound the code guarantees. **Repeatability.** "Same document, same score" now reads "rescan the same file against the same posting within 7 days and you get the same report (Re-analyze builds a fresh one)", which is what the cache provides (0980afb9). The "Why not ChatGPT" card, the FAQ, the privacy page, the tool landings, a competitor page, a guide and llms.txt say the same. All nine locales are updated. |
| S8-064, S8-067, S8-068, S8-069, S8-070, S8-071, S8-072 | 872c3117 | **Rescans.** A rescan that hits the cache spends no daily slot and answers `cached: true`. **Cache key.** The key and the report's market use one country rule. The reportId covers the inputs and the score, and analysis runs at temperature 0. **Partial reports.** A model shape that would have thrown, or an analysis that is invalid or less than 70% complete, now produces a partial report: it is not cached and the credit is refunded. **Score audit.** "Every point, accounted for" now sums to the total. **Language field.** The stream fork and both paid streams accept only a real language name or a locale code. The stream fork has the same slot-after-cache, cache-key country, temperature 0, shape guard and thin-reply rule (cfb98f5b, after review); it has no reportId or score audit. |
| S8-011 | cb37c10a | Every "per day" allowance on `check_rate_limit` lasts a full day: the free scan's 7, a purchase's 10, and the 1,440-minute caps. Before this, a 60-minute caller's sweep emptied them after about an hour (migration 20261009110000). |
| S8-063, S8-065 | 6ebb2ab3, 53283c74 | ATS Defense and the Apply kit now count one purchase's daily allowance and answer 503 when the limiter is down. A paying Interview Coach buyer past the shared 20 an hour goes on while the purchase's 30 a day last (one address bucket; see the review round). |
| S8-116, S8-117, S8-118 | cd65a83c | **File choosers.** Every file chooser can be reached by keyboard and screen reader. **Crash screens.** They use theme colours. The report's crash notice now says "scan again", because a refresh discarded the report, and it resets with each new result. **Sticky bar.** The help button lifts above the homepage's sticky bar, so the bar's dismiss button can be tapped. |
| S8-075 | fd23eeed | "Get job-specific analysis" records the job as the scan's job description, in page state, the session and the stored résumé, before it scans. "Get full analysis" on that report now buys an analysis of that job. |
| S8-034, S8-073 | c9256067 | **Verdicts.** Paid generators translate free text only. JSON keys and fixed choices ("Strong", "High", "Ready to Apply") stay in English, so colours and gauges work in every language. A translated verdict is mapped back to its English value, and the page shows it in the reader's language (`careerReportEnum`, nine locales). **Report shape.** Career Snapshot and Game Plan ship only a reply with the whole shape. Otherwise they ask the next model, and if none completes it they answer a retryable 502. The pages and PDFs shape a stored report before reading it, and each section has its own error boundary. |
| S8-041, S8-042, S8-110, S8-111 | 5786c5df | **Evaluation record.** A Shortlist evaluation cannot be rewritten, and an employer cannot insert one: the service role writes it. A status changes only together with its logged decision, through `shortlist_decide`. An override is a decision and never rewrites the AI score. **JD.** The scored JD is the role's stored text, kept on the row. `jd_version` bumps on every edit. **Bias audit.** Selection rates leave pending candidates out. Demographics use EEO-1 categories, and free text is read into them. The audit adds a scoring-rate table (share above the median score). **Alternative review.** It hides a candidate's score and rank and is marked in exports. It can be requested before scoring, with no model call (migration 20261009111000). |

## Review round (2026-10-10)

A reviewer read the branch and reported 14 findings. Each was reproduced (deno runs of the shared modules, the edge harness, pglite) before it was fixed, and each fix has a behaviour test that fails on the code before it.

| Finding | Commit | What changed |
| --- | --- | --- |
| Blocker: S8-004 not met | a9cc9def | **Names.** "Jack Ma", "Yo-Yo Ma" and "Anh Do" were read as a name plus a degree. Now a title-case two-letter trailing token is a surname, and in an ALL-CAPS line one is stripped only while two name words remain. "Jane Doe, MD" and "Priya Sharma, MS" were read as places. MD/MS/MA/PA/DC/PE after a comma now count as a place only with a ZIP or a town word ("Silver Spring"). A city heading the page ("New York, NY \| phone \| email", "Rio de Janeiro, Brazil") was taken for the name, while the real name went through and was still logged. A segment before a region code, a country or a known multi-word city is now a place on every line. "GONZALEZ, Maria" and "J. R. Smith" are now found. **Dates.** A month-name given name ("June Lee") is not masked before a year or a month range. **COMPLIANCE.md** now says detection is heuristic and points to the tests that list its shapes. |
| Major: S8-005 incomplete | a9cc9def | Header lines now lose 10- to 15-digit runs ("9876543210", "98765 43210", "555.0100.199"), @handles and hosting subdomains ("x.vercel.app"). The labels Ph, M, T, P, H and Contact (No.) are read. A ZIP after a full state name and an ordinal street ("45 W 34th St") are caught. Handles built from the name ("@mariagonzalez", "maria_gonzalez.dev", "mgonzalez") are masked anywhere. A header line of years is kept. |
| Major: S8-033 regression | 1ddd8a98 | The Premium guard removed the buyer's own phone whenever the source had a ZIP, a unit number or a year beside it. A greedy source digit run merged them into one number. A phone the source contains literally is always kept, and the source's phones are read with the output's bounded pattern. |
| S8-041 incomplete | a72e997a | The `shortlist_decisions_stamp` trigger (in 20261009111000) sets `created_at` from the server clock and `actor_email` from the JWT. A direct advance or reject is refused; only `shortlist_decide` logs one, with the status it sets. |
| S8-068 half-fixed | 58ae9246 | The primary honours `skipCache` (Re-analyze): it skips the cache read, counts the scan like a miss, and its report replaces the saved one. |
| Stream fork not in step | cfb98f5b | The fork shapes the model's arrays and objects before its filters run (`keywords: [null]` threw after the slot was counted). A thin reply is served as partial (`partialReason: "thin"`) and is not cached. |
| S8-032 comma-only | 97c4ac9a | Dot- and space-grouped figures ("10.000", "1.000.000", "10 000", and NBSP or narrow-NBSP groups) are read whole. An invented "10.000" is refused, and an honest "2.500" or "2 500" checked against "2,500" passes. |
| Apply kit capped Pro at 40 a day | 8e8b430c | A Pro account's standing is decided first, and its kits are never counted in the address's day. Purchase and unentitled callers are still counted, at 40 per address per day. |
| Purchase gave a second hourly allowance | 53283c74 | The address is counted in one bucket. A spent address goes on only while the named purchase's day lasts, and each call draws on it. Before, one address could make 20 + 30 calls an hour, every hour. |
| Coach/Path labels stayed English | ed29955a | Interview Coach (difficulty, category) and Career Path (level, risk) show those values in the reader's language. Colours still key on the English value. 9 new `careerReportEnum` keys in nine locales. |
| Landing copy | ad11e2e1 | /resume-checker, /resume-score and /es/revisar-curriculum interpolate `SCAN_RESULTS_WITHIN_SECONDS` and `REPORT_CACHE_DAYS`. They say "within 90 seconds" and "the same report ID on a rescan of the same file within 7 days". The prerendered CTA uses the same constant. |
| Partial banner blamed an outage | 58ae9246 | `partialReason` is `rule_based` or `thin`, and the banner (`PartialResultsNotice`, nine locales) words each one. A thin reply is judged only on the sections a reply owes: no red flags, no missing keywords and no peer data are not gaps. |
| Month-name given names erased dates | a9cc9def | See the first row. |
| Crash notice replayed the crash | 58ae9246 | The crash notice offers Re-analyze, which skips the cache, and no longer promises the saved report. |

## Review round 2 (2026-10-10)

A second review reported 8 findings. Each was reproduced before it was fixed (a PDF through pdf.js and `parse-pdf/page-text.ts`, tsx probes of the redaction module, the edge harness, a full homepage mount, a production OPTIONS preflight). All 8 were confirmed; none was refuted.

| Finding | Commit | What changed |
| --- | --- | --- |
| Blocker: S8-004 still open for common header shapes | 8c9756e8 | A header line is read twice: as laid out (a column gap still ends the name), then with whitespace runs read as one space and cut at the first title word. So the pdf.js line "CARLOS   MENDES" (a letter-spaced ALL-CAPS header), "Maria\tGonzalez" and "Jane  Doe \| phone" are names. A "(Liz)" or '"Bob"' nickname is lifted out and masked as a name token. A title-case "Doe, Jane" is read on the first two lines (never a list such as "Python, Java, SQL"), and "DOE, JANE" is read too. "Senior Software Engineer \| Jane Doe" is read only when no line led with a name, and never with an employer word ("Acme Labs"). "Sydney NSW 2000" is a place. |
| Major: S8-005 missed the site's own locales | 8c9756e8 | Above the first section heading only: 9-digit mobiles in 3-3-3 or 3-2-2-2 groups; Germanic streets ("Hauptstraße 12", "Keizersgracht 123"), Romance streets ("12 rue de Rivoli", "Calle Gran Vía 28"), "Flat 4B" and a bare "MG Road" segment; AU "NSW 2000", NL "1015 CJ", a 6-digit PIN after its city, five digits beside a city and four (never a year) before one. Anywhere: the JP postcode mark, a platform-labelled handle ("GitHub: jdoe-dev", but not "GitHub: Actions"), and phone labels in es, pt, fr, de and nl. The same shapes below the header (metrics, employers) are kept. |
| Major: the Pro path had no limiter | 60c1adf8 | Every signed-in account has its own hourly bucket (`user:<id>`, 60 an hour), counted after getUser and before the plan is read. Pro accounts together share one ceiling (`pro`, 600 an hour). A Pro day stays unlimited and is never counted in the address's 40. A limiter that cannot answer is a 503 on every path. Only a token whose claims say `role: authenticated` is looked up, so the publishable key goes straight to the address bucket. |
| Major: the result screen kept a third offer | 86a7de05 | `ScoreBasedPackageRecommendation` (the "auto-rejected" banner, the $12 Premium Package "Strongly Recommended", "Estimated gain: 30-40 points") is removed from Index. The component and its `scorePackage` strings (nine locales) had no other user and are deleted. |
| Minor: sticky bar "$3" | f83220ea | The bar says "Full Analysis · $5" and what it does. `stickyCta.premiumFrom` and `stickyCta.from` are gone, and `features` and `featuresMobile` are rewritten, in nine locales. |
| Minor: industry FAQ "about 20 seconds" | 83984dee | `buildIndustryFaqs` interpolates `SCAN_RESULTS_WITHIN_SECONDS`. That covers every /industries/<x> page and its FAQPage JSON-LD. |
| Minor: "same file, same report" overclaimed | 0980afb9 | Every such sentence names the posting. The cache is keyed on the file, the posting, the context answers and the market, and Re-analyze skips it. The hero adds "(Re-analyze builds a fresh one)". The key itself is unchanged: the report depends on all of those inputs. |
| Minor: build-stamp collision guidance | 19a6132a, 0db147e7 | The five functions main stamped 2026-10-10.1 (shortlist-evaluate, generate-career-snapshot, generate-graduate-gameplan, generate-application-answers, generate-product-preview) are stamped 2026-10-10.2, later than both. origin/main is merged in, so the integration has no stamp conflict. The verifier pins every function to its own day and number, or later. |

`node scripts/deploy-ledger.mjs` (main's ledger, run 2026-10-10 on this branch) lists every function above as DEPLOY with the stamps in the table below. It shows no MUST BUMP. Its CHECK list names three functions:

- analyze-linkedin-profile, generate-resume-roast and parse-resume-structured import `_shared/model-spend-gate.ts`. This branch's change to that file reaches only callers that pass `products`, and none of the three does, so they get no bump.
- generate-resume-roast and parse-resume-structured also import `ai-fallback.ts`, which this branch does not touch.

## Apply the migrations first, in this order

Both migrations check themselves with a DO block and are safe to re-run. Neither one adds a SECURITY DEFINER function, so nothing goes on the client-callable census allowlist.

1. `20261009110000_a_day_long_allowance_survives_an_hourly_callers_sweep.sql`
   - Re-creates `check_rate_limit` with one change: the sweep deletes only rows older than 1,440 minutes.
   - Grants are re-stated as service role only.
   - Depends on `rate_limits` (20251216002238).
   - Apply it before, or with, the functions. Without it they still work, but "per day" stays hourly.
   - **Allowances that become a real day:**
     - the free scan's 7;
     - a purchase's 10 (purchaseSpendGate);
     - parse-resume-structured's 15 and import-freelance-profile's 10 per address;
     - the Apply kit's 40 per address, for purchase and unentitled callers only (a Pro account is not counted there from `generate-apply-package.2026-10-09.2`; from `.2026-10-09.3` it has its own hour, 60 per account and 600 for all Pro accounts);
     - application-fit's 60 per address;
     - job-board-fit's daily allowance;
     - the daily caps of send-scan-report and company-claim.
2. `20261009111000_a_shortlist_evaluation_cannot_be_rewritten_and_a_status_changes_only_with_its_decision.sql`
   - Adds `shortlist_candidates.jd_text_scored`.
   - Revokes INSERT and table-wide UPDATE from authenticated and grants UPDATE (status) instead.
   - Adds the guard trigger and the `jd_version` trigger.
   - Adds `shortlist_decide(uuid, text, text)` (SECURITY INVOKER, authenticated only).
   - Restricts the decision insert policy to the caller's own candidates.
   - Adds the `shortlist_decisions_stamp` BEFORE INSERT trigger (for authenticated and anon):
     - `created_at` comes from the server clock and `actor_email` from the JWT;
     - an advance or reject is refused unless `shortlist_decide` set the transaction-local `shortlist.deciding` switch for that candidate. The switch is cleared right after its own insert.
   - Depends on the Shortlist tables (20260703120000) and their grants (20260704160023).
   - **Deploy `shortlist-evaluate.2026-10-10.2` and the frontend right after this migration.** In the gap, the old function's insert runs on the employer's client, which is now refused, and the old page's status update has no decision in its transaction, so it is refused too. Shortlist is an employer beta, so keep the gap to minutes.

## Deploy these functions

| Function | Build | Why |
| --- | --- | --- |
| free-keyword-scan | `free-keyword-scan.2026-10-09.2` | Slot after the cache, `cached: true`, key country, reportId, temperature 0, shape guard, partial reports, the score audit (S8-067..072); `skipCache` honoured and `partialReason` (review) |
| free-keyword-scan-stream | `free-keyword-scan-stream.2026-10-09.2` | Slot after the cache, key country, the language bound (S8-064); shape guard and thin-reply rule (review) |
| generate-cover-letter-stream | `generate-cover-letter-stream.2026-10-09.1` | Language bound (S8-064) |
| generate-premium-package-stream | `generate-premium-package-stream.2026-10-09.1` | Language bound (S8-064) |
| generate-premium-package | `generate-premium-package.2026-10-09.2` | Contact guard compares canonical forms and keeps a literal copy; auto-fix (S8-033, S8-066) |
| generate-cover-letter | `generate-cover-letter.2026-10-09.2` | Comma-, dot- and space-grouped figures (S8-032); one address bucket with the purchase's day (S8-065) |
| generate-apply-package | `generate-apply-package.2026-10-09.3` | Grouped figures; the per-purchase day; limiter 503 (S8-032, S8-063); a Pro account is not counted in the address's day (review); a per-account hour and a Pro ceiling, and the publishable key is never looked up (review round 2) |
| generate-application-answers | `generate-application-answers.2026-10-10.2` | Grouped figures in the cover note (S8-032); the instruction (S8-034) |
| generate-ats-defense | `generate-ats-defense.2026-10-09.1` | The per-purchase day; limiter 503 (S8-063); the instruction (S8-034) |
| generate-interview-coach | `generate-interview-coach.2026-10-09.2` | One address bucket with the purchase's day (S8-065); the instruction |
| generate-career-path | `generate-career-path.2026-10-09.2` | One address bucket with the purchase's day (S8-065); the instruction |
| generate-career-snapshot | `generate-career-snapshot.2026-10-10.2` | Whole shape or the next model; English verdicts (S8-073, S8-034) |
| generate-graduate-gameplan | `generate-graduate-gameplan.2026-10-10.2` | The same (S8-073, S8-034) |
| generate-keyword-fix | `generate-keyword-fix.2026-10-09.1` | The instruction (S8-034) |
| generate-product-preview | `generate-product-preview.2026-10-10.2` | The instruction (S8-034) |
| shortlist-evaluate | `shortlist-evaluate.2026-10-10.2` | Redaction (S8-004/005/037..040, and both reviews' shapes); the stored JD and `jd_text_scored`; service-role insert; `altReview` (S8-110, S8-111). Needs 20261009111000 first. |

The other functions that import `_shared/model-spend-gate.ts` get the same bundle on their next deploy, but they behave exactly as before. The address is still counted in its one bucket and refused when spent, and step 4a is unchanged. The change applies only to free generators that pass `products` (Interview Coach, Career Path, Cover Letter), so nothing else needs redeploying. All 26 importers pass `deno check`. job-board is untouched.

The five `2026-10-10.2` stamps sit on the day the ledger repair (PR #25, merged) used, because each has to be later than main's `2026-10-10.1`. Every other stamp here stays in wave 3's reserved `2026-10-09`.

**Frontend (Lovable publish).** This covers the free report and homepage (index.html, `public/llms.txt`, `scripts/prerender-seo.mjs`), the results view (no third offer card), the sticky bar, the industry pages, the privacy page, the uploader, the crash screens, the help button, the Career Snapshot and Game Plan pages and PDFs, the Interview Coach and Career Path labels, the partial-results banner, the tool landings, the Shortlist page, and all nine locale files.

## Owner steps

None beyond the deploy order above. Existing Shortlist demographics entered as free text are read into EEO-1 categories. A value that matches none is counted as "unclassified" and left out; the page says how many.

## Rollback

- **Functions.** Redeploy the previous builds listed in the verifier's FAIL lines. The previous Career Snapshot and Game Plan builds accept any four-key reply again.
- **20261009111000.** Run:

  ```sql
  DROP TRIGGER shortlist_candidates_guard ON public.shortlist_candidates;
  DROP TRIGGER shortlist_decisions_stamp ON public.shortlist_decisions;
  DROP TRIGGER shortlist_roles_jd_version ON public.shortlist_roles;
  GRANT INSERT, UPDATE ON public.shortlist_candidates TO authenticated;
  CREATE POLICY "owners insert own candidates" ON public.shortlist_candidates
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
  ```

  Then redeploy the previous shortlist-evaluate and frontend. Leave `jd_text_scored` and `shortlist_decide` in place; they are harmless.
- **20261009110000.** Re-run the 20251219200654 body. This is not recommended: it brings back hourly "daily" allowances.

## What to measure

- `bash scripts/verify-deploy.sh` section 72. Before this deploy it FAILs on every build and claim. It was run against production on 2026-10-10 after review round 2: 36 FAIL and 4 INFO, no PASS and no crash.
- Career Snapshot and Game Plan deliveries. Watch the "Reply refused" log lines and the share of 502s. A rise means a model now misses the shape, and those deliveries are retried by the sweeper instead of shipping broken.
- Free scan. Watch the share of responses with `cached: true`, and confirm that a rescan of the same file no longer moves `scansUsed`.
- Rate limits. A `rate_limits` row with a 1,440-minute window should now live a full day.
- Shortlist. `shortlist_decisions` rows per status change should be 1:1, and no `shortlist_candidates` row should have an UPDATE that touches AI columns. No advance or reject row should have an `actor_email` different from its owner's sign-in address.
- Partial reports. Watch the share of `partialReason: "thin"` against `"rule_based"`. A high thin share means the model is leaving owed sections empty. Thin reports are not cached and their credit is refunded.
- Re-analyze. A `skipCache: true` scan should move `scansUsed` by one and replace the `scan_report_cache` row.
- Apply kit. A Pro account gets a 429 only past 60 kits in an hour (`code: rate_limited_function`, limit 60) or when all Pro accounts pass 600 in an hour (`rate_limited_global`). It is never refused by the address's day. Purchase and unentitled callers still get a 429 at 41 a day per address. Watch the `user:` and `pro` rows for `generate-apply-package` in `rate_limits`. A `pro` count near 600 means the ceiling is close to binding.
- Shortlist redaction. `exclusionsApplied` should carry `candidate_name` on nearly every evaluation. A rise in evaluations without it means a header shape the module does not read.

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
| `shortlist-redaction-read-a-surname-as-a-degree-a-city-as-the-name-and-a-month-name-as-the-candidate` (review) | 22 of its 24 cases fail on the previous module. The other 2 are guards: a hospital line under a doctor's name, and a header line of years. |
| `the-premium-contact-guard-deleted-the-buyers-own-phone-and-profiles` (review: 4 adjacent-number cases) | 4 of 8 fail on the previous guard |
| `the-scan-fallback-threw-on-a-null-keyword-and-cached-a-thin-reply` (harness, review) | 2 of 3 fail on the previous fork |
| `the-re-analyze-button-replayed-the-saved-report-and-a-thin-reply-was-called-an-outage` (harness, review) | 3 of 5 fail on the previous primary |
| `the-partial-banner-called-a-thin-reply-an-outage-and-the-crash-notice-replayed-the-crash` (review) | 2 of 2 fail |
| `a-dot-or-space-grouped-figure-was-split-by-the-grounding-check` (review) | 2 of 3 fail |
| `the-apply-kits-address-day-capped-a-pro-account-at-forty` (harness, review) | The Pro case fails (a 429 at 41) |
| `a-named-purchase-gave-an-address-a-second-hourly-allowance` (review) | The hour-boundary case fails (50 in the second hour, not 20) |
| `a-shortlist-record-could-be-rewritten-and-scored-a-jd-it-never-kept` (pglite; review: decision-log cases) | The new "with it" case fails on the previous migration. The teeth case shows the backdated reject landing. |
| `the-tool-landings-still-promised-twenty-seconds-and-an-id-with-no-window` (review) | 5 of 8 fail |
| `the-coach-and-the-career-path-showed-english-labels-in-a-translated-product` (review) | 2 of 2 fail |
| `shortlist-redaction-passed-letter-spaced-nicknamed-and-surname-first-names-and-european-addresses` (review 2; a generated PDF through pdf.js and `pageTextFromItems`) | 20 of 24 fail on the previous module. The other 4 are keep-the-evidence guards. |
| `a-pro-accounts-apply-kits-had-no-bound-at-all` (harness, review 2) | 5 of 6 fail on the previous handler. The sixth, a second account still served, holds on both. |
| `the-result-screen-still-sold-a-premium-package-under-an-auto-rejected-banner` (full homepage mount, review 2) | Fails on "auto-rejected". The results section also priced $12 and a second $5. |
| `the-sticky-bar-priced-premium-packages-at-a-hidden-3-dollar-product` (review 2) | Fails: the bar priced 3, not 5 |
| `the-tool-landings-still-promised-twenty-seconds-and-an-id-with-no-window` (review 2: the industry FAQ case) | The new case fails on the previous builder |
| `the-same-file-gets-the-same-report-named-one-of-the-things-the-cache-keys-on` (harness and copy, review 2) | 11 of 14 fail on the previous copy. The other 3 measure the cache on the shipped handler and hold on both. |

Two earlier tests now send JWT-shaped access tokens to generate-apply-package (`the-apply-kits-address-day-capped-a-pro-account-at-forty`, `pro-was-five-rules-read-by-address-and-a-trial-minted-the-catalogue`), because the handler looks up only a token whose claims say `role: authenticated`. Their assertions are unchanged.

Three earlier tests on this branch were changed to match the review's design, not loosened:

- `the-spend-gate-fails-closed-and-keys-on-the-platforms-address` and `one-purchase-ran-the-dearest-generators-without-limit-and-locked-out-a-coach-buyer` now pin the one address bucket, as main did.
- `a-paid-delivery-never-queues-behind-strangers` now spends the purchase's day before it expects the publishable-key replay to be refused. A body naming the purchase, sent under the publishable key, looks to the gate exactly like the buyer's own browser.

## Handoffs

- **seo-content-i18n**
  - The homepage's "Why not ChatGPT" section and the whole Shortlist page are English-only. This was true before this branch; strings changed here follow their pages.
  - "24+ checks" (WhyNotChatGPT and the vendor landers in the prerender) and "in seconds" (four prerender CTAs) are numbers or durations that no code computes.
- **Integrator**
  - Locale files gain `homepage.reportCrash`, `homepage.partialResults` and a top-level `careerReportEnum` block (with nine coach and path keys). They sit at the end of each file or of `homepage`, which is a likely textual conflict with other groups that append. Review round 2 deletes the top-level `scorePackage` block and `stickyCta.premiumFrom` and `stickyCta.from`, and rewrites `hero.socialFirst.subheading`, `faq.questions.dataStorage.answer`, `stickyCta.features` and `stickyCta.featuresMobile`.
  - `_shared/model-spend-gate.ts` counts the address in one bucket again (the `${fn}:purchase` bucket is gone). Another group that edits the gate should keep this rule: a spent address goes on only while the named purchase's day lasts.
  - The decision-log trigger lives in this branch's own migration, 20261009111000, which has not been applied anywhere, so it was amended in place.
  - The function builds above may collide with other groups that bump the same functions (generate-apply-package, generate-ats-defense, free-keyword-scan). Keep both changes and give the function a new stamp **later than both** (docs/DEPLOY-LEDGER.md §3). Do not just keep the later of the two existing stamps: that stamp names a build without the other side's change, and the verifier's "or later" check would pass on it. The five that main's PR #25 stamped `2026-10-10.1` are already `2026-10-10.2` here.
  - The spend-gate harness fixture in `every-public-model-call-is-counted-before-it-is-made.test.ts` now gives its Shortlist role a `jd_text`.
- **Payments**
  - `FAQ.tsx` still replaces any "$25" in an answer with the local price. No locale answer contains "$25" any more, so the replacement is dead code.
