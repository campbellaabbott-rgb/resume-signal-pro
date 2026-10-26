# Wave 4: connect your own AI, search, and apply yourself

Wave 4 merges five builder branches onto `origin/main` at `e75945fe` (PR #32,
the post-wave-3 tooling). The integration branch is `wave4/integration`,
built 2026-10-12, then reviewed (review of `9fe3bc0d`, 30 findings in four
lenses) and fixed on the same branch. It implements the two specs of
2026-10-11, with the owner decisions appended to each (those supersede the
options above them):

- `reports/connect-search-apply-spec-2026-10-11.md` (the build spec);
- `reports/mcp-economics-2026-10-11.md` (the allowance and the money).

The branches, merged `--no-ff` in this order:

| branch | head | what it built |
|---|---|---|
| `w4/mcp` | `8a698af1` | the keyless connector, the split allowance, `apply_myself`, the apply agent's tools retired |
| `w4/api` | `410bb073` | `GET /v1/jobs/{id}/application`, the free fit allowance on `POST /v1/fit`, the Builder pointers |
| `w4/jobboard` | `a553492d` | job-board `.93`: the pass-end hops, the no-log flag, a place or an employer name read as a filter |
| `w4/retire` | `b980e73f` | the apply agent switched off behind one switch, the Agent plan and Agent Pass checkouts refusing |
| `w4/frontend` | `00559019` | the site says the pivot: `/agents`, the pass retirement page, pricing, the Builder card, the Privacy draft |

The job-board group's notes are in
[job-board-deploy-notes.md](../job-board-deploy-notes.md) under `## 2026-09-09.93`.
The other groups' notes are their commit messages; this file is the summary.

## Descope 2026-10-25

Four fix rounds went around three heuristics, and the final recheck of round 4
(`~/.config/resumebooster/wave4-fix3-results-2026-10-25.json`, "final") still
found two of them worse than origin/main on inputs no corpus held. The owner's
policy is that a heuristic is never worse than main on any case, and that after
repeated failed rechecks we stop patching spellings. So two rules left wave 4
and one stayed with its claims made true. Branch `wave4-descope`, pushed to
`wave4/integration`. The descope's first form (27e54375) kept rounds 3 and 4's
search split; a recheck of it (2026-10-25, findings in this section) found
that mix worse than main too, so the whole search exclusion went back to
main's and the question copy was weakened once more (823cdc1f, f805722c). A
second recheck (2026-10-25) found nine more defects, three of them blockers;
all nine are fixed under "The second recheck of the descope" at the end of
this section (21c849c6, f46d1fbe, ad3752a7 and the verifier commit). A recheck of
the merge of main (883ecd0a) found eleven more, none lost by the merge; all
eleven are fixed under "The recheck of the merge (2026-10-25)", after "Merged
main 899be058".

**What left, and why.**

- **The salary miner (S12-019).** The recheck found round 4's miner returning
  null where main stores the stated pay for zone phrasing ("$210,000 -
  $250,000 in high cost of labor markets", "in Tier 1 cost markets", "in
  Investment Banking") and the v11 re-sweep able to overwrite a stored zone pay
  with a benefit, an overtime rate or an award. `_shared/salary-extract.ts` is
  byte-identical to origin/main's, `SALARY_PARSE_VERSION` stays at main's 10
  (main's own line), so no v11 re-sweep ever runs, and backfill-salary
  re-parses stored text exactly as main does: `minedSalaryRefused`, the re-mine
  branch and its notes section are gone. S12-019's own Airbus row stays as main
  serves it.
- **The search exclusion, whole (S12-017).** Round 4's `titleExcluded`
  folded an excluded word to its plural, so "account" struck "Accounts
  Payable Manager" and "contract" struck "Contracts Administrator", which main
  never does. The descope's first form put main's `titleExcluded` back and
  kept rounds 3 and 4's `splitExclusions` and `cleanTerms`; its recheck found
  that mix worse than main on realistic queries: a slash pair of single
  letters ("clerk not a/p", "cashier not p/t") excluded nothing, so the
  search pulled in the titles the person excluded (production, on main,
  answers "clerk not a/p" with `excludedTerms` ["ap"]); a slash pair that
  names one thing was split into common words ("technician not med/surg"
  struck "Certified Med Tech", "engineer not tcp/ip" struck "IP Engineer");
  and a pinned compound typed with a space or as a plural ("cashier not part
  time", "nurse not night shifts") struck only that spelling, keeping
  "Cashier (Part-Time)" and "Night Shift RN", which main strikes through its
  one-word exclusion. A case-level corpus score could not see the last class,
  because main's split is wrong on those queries while its title strikes are
  right. So the whole exclusion path is origin/main's again: in
  `job-board/search-routing.ts`, `splitExclusions`, its cleaning and
  `titleExcluded` are main's text byte for byte, from the "engineer not
  manager" note to the end of the file, the `query-place` import only the
  pinned-place rule read is gone, and job-board's handler calls them exactly
  as main does.

**S12-019 is now its own salary project.** Its method is a whole-population
diff, not a corpus of chosen cases: re-parse every stored salary string the
board serves with main and with the candidate, plus a sampled re-read of
descriptions; hand-review every changed row; and allow zero value-to-NULL.
What it inherits: the 941-case corpus (`src/test/fixtures/w4b-fix3-salary/corpus.json`,
each case with the reading's answer and main's), kept as a benchmark test,
`src/test/salary-benchmark-a-salary-change-is-measured-against-mains-answers.test.ts`,
which runs the shipped extractor and pins main's answer on every case (844
right by reading) and fails, naming that method, on any change that moves one;
the round-4 self-break set at
`~/.config/resumebooster/wave4-fix3-corpora/salary/round4/selfbreak/`; and the
recheck's 60-case corpus and probes in `~/.config/resumebooster/wave4-fix3-recheck4/`.
The round tests that pinned round behaviour are deleted (the first-money-range
test and the fix1, fix2 and fix3 salary files), and sections 92 job-board,
fixer2 and fixer3 read no salary. Under main's miner a pay line read from a
description can be a business figure (S12-019's own Airbus placement serves
"£350K to £800K annually" in the GB pay sort, read live 2026-10-25), so the
project must also correct the sentences that call the served figure stated
pay, which are main's and which wave 4 did not touch: the board's "Stated pay
only" and "ordered by stated pay" labels and the changelog's "real published
pay only, never estimates". The two AI-host lines wave 4 rewrote now say what
is true: agent-mcp's job-card `salary` is "the posting's pay as text: the
employer's pay field, as the vendor gives it or written out by the board from
its figures, or a pay line the board read from the description, which on rare
postings is a business figure" (the second recheck dropped "verbatim": for a
vendor's structured pay the board writes the string itself), and
`hasStatedPay` says the same.

**S12-017 is now its own search project.** Its method has to measure titles,
not only splits: a candidate is never worse than main at the query level and,
for every title main's split and match strike, the candidate strikes it too
(and keeps what main keeps unless the label says otherwise), checked on a
corpus and on live titles. What it inherits: the 1,191-query corpus
(`src/test/fixtures/w4b-fix3-search/negated-phrases.json`, now with the
recheck's 22 `dsc-` cases), the 75 self-break queries, origin/main's exclusion
frozen at ef4fb53e (`src/test/fixtures/w4b-fix3-search/origin-main-exclusion.ts`),
round 4's pinned compound and place lists (kept as data in the generated
test), and the recheck's live-title reads and query sets. Main's open defects
it starts from, all on the record: "not" takes one word, so "not night
shift" searches "shift" and "not part time" searches "time"; a typed hyphen
or slash is folded away, so "part-time" becomes "parttime" and "a/p" becomes
"ap", which strike only a title spelled that way; and a plural typed word
strikes only itself.

**The search after the descope.** The exclusion is main's, proved three ways.
`src/test/w4b-descope-the-search-exclusion-is-origin-mains.test.ts` checks
that the shipped section is main's text, that nothing before it reads an
exclusion, that job-board's handler calls it on main's lines, and that every
case the recheck named (the slash pairs, med/surg and tcp/ip, the spaced and
plural compounds against hyphenated titles, "news" and "parts" and "account"
against New Grad, Part-Time and Accounts Payable titles) answers as main
does. The corpus test asserts that the shipped split equals main's on all
1,191 queries and the 75 self-break queries and that the shipped title match
strikes exactly what main's strikes over every title each case names; it
asks for no improvement, and keeps main's own score as the record (765 of
the 1,191 right by label, 22 of the 75). The generated test walks round 4's
compounds and places, slash pairs, hyphens, plurals, quotes, "not A or B"
and random queries against main. All three fail at 27e54375 (518 tests) and
pass now. The phrase test (`an-excluded-phrase-is-excluded-whole`) is
deleted, the two place tests pin main's split, and the scorer test is main's
again. Sections 92 fixer and fixer3 want main's `excludedTerms` (fixer3 reads
eight negations, among them "clerk not a/p" ["ap"] and "cashier not part
time" ["part"]), and section 92 job-board reads no negated search. The board's
banner (`jobsPage.excludedTerms`, nine locales) says it hides results whose
title contains the excluded words, which is all main's rule does: it reads
only the title, word by word as typed, so a posting located in an excluded
place, or titled with a plural of the word, stays. Not part of the exclusion,
and kept: the place lift's guard that drops a negated place it knows
("nurse jobs not in Texas" searches no Texas and names `placeExclusion`,
S12-172), and the stemmer and employer-key routes (S12-014, S12-018); each
has its own tests and section 92 job-board lines, and the recheck named no
case where they are worse than main.

**What stayed: the question rule, with every claim made true.** No rule
change. It ships because it is strictly safer than main in the direction that
matters: on the recheck's 24 fresh questions about the person, round 4 drafts
17 and main's classifier 22, and the questions it gets wrong the other way
are work questions sent to the person, the declared safe side. Every sentence
a seeker, a crawler or an AI host reads about who answers a question now says
what the marking does: a question that looks like it is about the person goes
to the person, an open question about their work can be drafted from their
CV, the marking reads words and can miss a question about the person, even a
plainly worded one, and some work questions go to the person, so the person
reads every answer before sending. (The first rewrite said it can miss only
an unusually worded question; the recheck of the descope found plainly
worded ones missed: apply_myself marks "How many years of accident-free
driving experience do you have?" for a draft, and the answers panel drafts
"Are you legally permitted to work in Germany?". main's classifier misses the
same, so this is not worse than main; the copy now says so.) Changed: in all nine locales the `/agents` apply
lines (`agentConnect.selfApplyFree`, `applyStep3`), the answers panel
(`applyAnswers.yoursBody`) and the `/agent` profile panel (`applyProfile.legalIntro`,
`intro`, `demographics`); the applyAgent changelog entry in all nine; the
retired products' refusal line in every language (`_shared/apply-agent-retired.ts`);
`public/llms.txt`; the apply guide (and so llms-full.txt, which bakes the
guides); the apply_myself tool and prompt cards in `src/config/mcp-tools.ts`
(and so the `/agents` bake); agent-mcp's apply_myself description, its
call-order resource and its apply_myself prompt (which now tells the AI to ask
the person about any marked question that asks about them); the markdown
packet's note under its drafting heading; the `/v1` application description
and `answeredByMeans`; and the rules list on `/agents`, which now says rule 3
as the server says it ("draft only the questions marked for drafting").
Emails, generate-apply-package and generate-application-answers carry no
such claim. The guard
`src/test/the-copy-about-who-answers-a-question-promises-nothing-the-marking-cannot-keep.test.ts`
reads every one of those surfaces (all locale, changelog and auth shards
included) for the removed phrasings in each language, the old "worded
unusually" qualifier among them, checks the read-every-answer line and the
plainly-worded hedge in each language, and is shown catching each removed
sentence as it stood. The same recheck found three more absolutes the
marking cannot keep, now true, weaker sentences in all nine languages: the
`/agent` panel's work-authorisation hints (`applyProfile.otherCountriesHint`,
`authorizedHint`) say the agent stops, or does not assume, on a country
question it recognises; the `setupIsOneStep` changelog entry says the agent
does not guess work authorisation, salary or start date on a question it
recognises as asking for one; and the answers panel's all-clear
(`applyAnswers.allGrounded`) says our check found no credential, degree,
figure, employer or job title the résumé does not show, which is what
`validateCandidateClaims` reads.

**Builds.** agent-mcp and public-api `2026-10-11.36`; create-agent-checkout
and create-pass-checkout `2026-10-11.17`; create-product-checkout
`2026-10-11.26` (their only change is the refusal line). Each moved three
times in the descope (`.34`, `.15` and `.24` were its first form and `.35`,
`.16` and `.25` its recheck, never deployed; the second recheck's are the
ones above).
generate-application-answers, generate-apply-package and apply-agent stay
`2026-10-11.33` (unchanged). job-board keeps its reserved `2026-09-09.93`,
now with main's salary miner and main's search exclusion.

**Left for other owners by the descope.** `src/pages/Jobs.tsx` (profiles and
design; wave 4 may not touch it) still carries the old English fallback for
`jobsPage.excludedTerms` ("Hiding results that mention ..."). It renders only
when the key is missing, and all nine locales now hold the true sentence;
whoever next edits that line should copy en.json's. The S12-019 and S12-017
projects inherit the sentences and corpora named above.

**Checks run** (at the head after the recheck's fixes). Each through
`~/.config/resumebooster/heavy.sh`: `npm run typecheck` exits 0; the worker's
`tsc --noEmit` exits 0; `scripts/check-functions.sh` is clean (every edge
function and the Deno tests; deno.lock restored); the pre-commit typecheck
passed on both commits. The new and rewritten search tests (518 failing at
27e54375) and the claims tests (31 failing on 27e54375's copy) pass, and the
213 test files that read the changed copy, locales, guides, MCP cards and
functions pass (3,584 tests). The upload-tally guard passes: job-board's
upload, tallied the deploy's way from git's sizes (its folder plus all of
_shared, comments included, plus main's two profiles _shared files at 72,818
bytes), is 4,430,397 bytes, 69,603 under the 4.5 MB line and 19,603 inside the
agreed 50,000 of room, 6,379 smaller than the descope's first form
(search-routing.ts went back to main's). `deploy-ledger --against 27e54375`
finds 6 functions moved (agent-mcp, public-api, the three checkouts and
job-board) and one violation, job-board `.93`, by reservation, as in every
round; the other five carry the builds above. `--against origin/main`
(ef4fb53e) finds one violation, process-email-queue `.2026-10-14.1` sorting
before main's `.2026-10-14.2`: main moved it after this branch was cut (27e54375
shows the same against today's main), and merging main, the first step under
"Deploy order", clears it. `--overlap HEAD origin/design/integration
origin/r1/integration` finds no undeclared overlap; against r1/hotfix-s13,
seo/integration and hp/integration it lists the same six undeclared files
27e54375 does, and `git merge-tree` finds the same conflicted files as
27e54375 against each of those branches and main (27, 27, 31 and 22). The full
suite runs in the push's pre-push hook; its count is in the PR #39 body. Main
is not merged in this step.

### The second recheck of the descope (2026-10-25)

A recheck of b76e460d (`~/.config/resumebooster/wave4-descope-hp-results-2026-10-25.json`,
"w4found") confirmed nine findings: three blockers, three majors and three
minors. Each was reproduced first, each fix has a test that failed on
b76e460d, and each takes main's behaviour or a true, weaker sentence; none
adds a heuristic.

- **Blocker: the connector turned an excluded remote into a remote filter.**
  `agent-mcp/query-place.ts` readQuery moved a trailing "remote" or "anywhere"
  into `remote: true` with no negation check, and its leading class took a
  minus, so "nurse -remote", "nurse not remote", "engineer non-remote" and
  "analyst except remote" asked the board for remote postings only (live,
  read-only: main's `{q:"nurse -remote"}` served 0 of 40 remote; wave 4's
  `{q:"nurse", remote:true}` 40 of 40, total 656). Both MCP search tools reach
  it. The lift now refuses a minus on the word and a negating word before it
  (the place words plus "no" and "non", with or without "a"); a refused lift
  leaves the query as typed, which is what origin/main's connector sends and
  what job-board's own split and negated-remote rule read. 17 negated forms
  and a server round trip (`the-first-search-answers-the-question-as-asked`)
  failed first; the positives ("react developer remote", "nurse (remote)",
  "engineer fully remote", "Notary remote") still lift.
- **Blocker: the signed-in /agent page described the switched-off agent as
  running.** The Settings tab showed AgentReachNote ("It submits
  automatically to 37,909 of the 1,012,399 postings ... Auto-submits on: ..."),
  AgentControlsPanel ("Never apply to these employers", "Pause, with a date it
  comes back") and ApplyProfilePanel's readiness block ("Nothing in your
  profile is holding applications back ... the agent still stops rather than
  guessing", or "Nothing can be sent yet" and "the agent refuses rather than
  guessing, so those postings are skipped") beside the notice that says we
  send nothing; the Today tab told a past subscriber with an active mandate
  "your first queue arrives after tonight's run". Agent.tsx now renders the
  controls and the reach note only when `APPLY_AGENT_ON`, as it already did
  for the setup checklist and the pending questions; ApplyProfilePanel keeps
  the person's stored answers but shows its intro and readiness block only
  when the agent is on; MorningQueuePanel's empty line needs the agent on.
  `w4b-descope-the-agent-console-describes-no-running-agent.test.tsx` mounts
  the page signed in with production's live `sendable` answer in all nine
  locales (27 cases failed first) and switches the agent on as its positive
  control.
- **Blocker: crawlers and AI hosts were still sold the cut products.**
  llms.txt said "Paid tools are one-time purchases: resume rewrites, cover
  letters, interview coaching, Freelance Boost", listed "Freelance Boost ...
  $29 one-time" and called /pricing "One-time tools and the all-access plan";
  the /freelance-boost bake sold the product ("in about 15 seconds") from a
  sitemap entry at 0.8. Wave 4 is what makes them false, so wave 4 carries
  them: llms.txt says "One paid report (the $5 Full Analysis) and one optional
  monthly plan, Pro (the writing tools, the Full Analysis and no daily scan
  cap)", the Freelance Boost line is gone and /pricing is "The free tools,
  the $5 Full Analysis and Pro"; the bake's /freelance-boost is noindex and
  says, from the page's own `freelanceBoost.noLongerSold*` strings, that it is
  no longer sold, and STATIC_ROUTES no longer lists it. The guard in
  `w4b-the-cut-products-are-sold-nowhere.test.ts` refuses any llms.txt line
  that names a cut product beside a price or an offer, pins the figure to the
  catalogue's, and reads the bake's block and sitemap list (4 cases failed
  first; its teeth catch the old lines).
- **Major: what ChatGPT reads.** The retired products' refusal line (nine
  languages) and llms.txt's apply-yourself line named all five form vendors
  for Claude and ChatGPT alike; inside ChatGPT the server reads only
  Greenhouse and Recruitee. Both now carry the /agents page's own sentence
  (`agentConnect.selfApplyChatgpt`) in each language. The refusal line's names
  come from `RETIRED_FORM_VENDORS` and `RETIRED_FORM_VENDORS_ON_CHATGPT` in
  `apply-agent-retired.ts`, held equal to application-form.ts's
  `FORM_READER_VENDORS` and `PUBLIC_API_FORM_VENDORS` and to the page's
  mirrors, so no sentence types a vendor (11 cases failed first).
- **Major: the applyAgentCountries changelog line.** "anything asking about a
  country you haven't listed stops and waits for you instead of guessing"
  (all nine shards) is untrue: "Can you lawfully take up employment in
  Ireland?" is classified draftable, on main too. It now says "a question it
  recognises as asking about a country you haven't listed stops and waits for
  you", the hedge setupIsOneStep carries, in each language; the copy guard
  lists the old sentence as removed in every language, with teeth.
- **Major: the merge of main would break SEO's /affiliates bake.** SEO's bake
  re-exports `AFFILIATE_COMMISSION_CENTS`, which wave 4 removed; esbuild
  bundles the missing name as undefined and the bake throws on its first
  read, inside the never-block-a-publish handler. The per-tool-sale keys
  (`affiliates.commission` tagline, headline, detail, banner, linkHint,
  howItWorks and excluded) are deleted in all nine locales (bannerTitle stays;
  the page reads it), and `the-bake-re-exports-only-names-its-modules-export.test.ts`
  imports every module the bake's data entry names and fails on any name it
  does not export: it passes here and fails on SEO's bake against wave 4's
  module. The merge step is under "Merging main" below.
- **Minor: a cover-letter text box.** apply_myself and /v1 sent it to a
  draft while the classifier files it and the answers panel (and origin/main)
  leave it with the person. whoAnswers now answers `you` with `cvMayHelp`;
  the question corpus marks its four cover-letter rows as over-routes (cap
  194) and the round-4 self-break set names q4sb-39 beside q4sb-42.
- **Minor: "jobs not in London".** negatedTrailingPlace kept a head of only
  filler, so the board searched the word "jobs". It reads `QUERY_FILLER` as
  liftTrailingPlace does: the request browses and names `placeExclusion`.
- **Minor: the job card's salary field** no longer says "verbatim" (above).

**Builds** (the second recheck): agent-mcp and public-api `2026-10-11.36`;
create-agent-checkout and create-pass-checkout `2026-10-11.17`;
create-product-checkout `2026-10-11.26`; job-board keeps `2026-09-09.93`. No
migration. Nine locale files lose seven keys each; no key is added.

**Shared files this round touches.** `public/llms.txt` (seo-round on main,
company-profiles in this branch's ledger): wave 4's own lines only, the paid
line, the Freelance Boost line, the apply-yourself line and the Pricing line.
`scripts/prerender-seo.mjs` (seo-round): one hunk, the /freelance-boost
write() block and its STATIC_ROUTES line, on text main's bake still has
unchanged; `git merge-tree` against origin/main 899be058 merges the file
without a conflict. The nine changelog shards (critical-path) and the nine
locales (company-profiles): wave 4's own lines and keys.

**Merging main** (the first deploy step; main now holds R1, the profiles
and design deploy and the SEO round, 899be058). Done in `9a47faf6`: see
"Merged main 899be058" below for every conflict and its resolution. `git merge-tree` finds the
same 31 conflicted files as b76e460d did. Two need this round's care:

- `public/llms.txt` gains a fourth conflict hunk. Keep main's figures, its
  vs line and its "Claude, ChatGPT or Claude Code"; take wave 4's paid line,
  its deletion of the Freelance Boost line, the ChatGPT sentence in the
  apply-yourself line and its Pricing line.
- `scripts/prerender-seo.mjs` merges as text, but SEO's /affiliates bake
  still reads `AFFILIATE_COMMISSION_CENTS` and `affiliates.commission`. In the
  merge, re-export `AFFILIATE_PRO_FIRST_MONTH_CENTS` in its place, read
  `D.EN_LOCALE.affiliates.proCommission`, fill `{{amount}}` with
  `formatUsd(AFFILIATE_PRO_FIRST_MONTH_CENTS)`, and drop the per-tool-sale
  fallbacks (title, description, tagline, headline, howItWorks). The
  re-export test fails until it is done.

**Verifier.** `scripts/verify-deploy.d/92-w4b-descope-recheck.sh` (read-only:
five OPTIONS and three GETs): the five builds above, the crawler's
/freelance-boost noindex and no longer sold, sitemap.xml without it, llms.txt
selling no cut product and saying what ChatGPT reads.
`w4b-descope-recheck-the-section-fails-what-it-claims.test.ts` runs it
against a fake curl: a healthy deploy prints no FAIL and only reads; an older
build, the old bake, a sitemap that lists the page and the old llms.txt each
print FAIL. readQuery and whoAnswers are proved by their tests, not live: no
read-only route runs them on input we choose without spending the keyless
allowance.

**Checks** (at the round's head, each through
`~/.config/resumebooster/heavy.sh`): the pre-commit typecheck passed on all
four commits; the worker `tsc --noEmit` exits 0; `scripts/check-functions.sh`
is clean (deno.lock restored); the upload-tally guard passes, and job-board's
upload, tallied from git's sizes with main's two profiles files, is 4,432,403
bytes, 67,597 under the 4.5 MB line and 17,597 inside the 50,000 of room
(2,006 more than b76e460d: the cover-letter and filler lines and comments).
The targeted runs: the 34 files that mount or read the /agent console (679
tests), the 125 that read the locales (2,363), the 81 that load or read
agent-mcp, public-api, self-apply or job-board's query-place (4,584), the 61
that read llms.txt, the bake, the retired lines, the affiliate copy or the
cuts (1,566), the 10 that read the changelog (601) and the 25 that read the
verifier sections (269), all passing. `deploy-ledger --against b76e460d`
finds 6 functions moved and the one reserved violation (job-board `.93`);
`--against origin/main` finds the one process-email-queue violation the
merge clears; `--overlap HEAD origin/design/integration origin/r1/integration`
and `--overlap HEAD origin/hp/integration` report no undeclared overlap. The
full suite runs in the push's pre-push hook; its count is in the PR #39 body.

**Left.** The bake's /affiliates block is merged as above (`9a47faf6`).
oh/integration (PR #46) and the hp branches merged b76e460d; they take this
round when they next merge wave4/integration. The /freelance-boost committed
`public/sitemap.xml` entry stays until the next bake rewrites the file (the
bake writes both public/ and dist/ from STATIC_ROUTES).

### Merged main 899be058 (2026-10-25)

Merge commit `9a47faf6` brings origin/main `899be058` into wave4/integration
at `8874bd13`, in the wave4-descope worktree. Main then held R1 (#40), the
verified profiles and design deploy and its hotfix (#44, #41), the changelog
for 17 to 25 October (#45) and the SEO round (#42). The rules were "Merging
main" above, Deploy order step 3, and main's sharedFiles owners: the owner's
version wins, and the other side re-applies only its own hunks. The hp base
(`2fbb3cd8`, settled in `89036c95`) had already merged an older main into an
older wave 4. Where neither side has touched a file since, its resolution is
taken as it stands. Where one side has, the later changes were replayed onto
it and the result checked against these rules. Five commits follow the merge
(`6939f22a`, `38290564`, `5455ccfa`, `b9135282`, `416f74ea`). Nothing is
merged to main.

**The 31 conflicted files, each resolution.**

| file | resolution |
|---|---|
| nine locales (de, en, en-GB, es, fr, hi, nl, pt, tl) | Merged key by key, with no key lost. Main's values and removals stand. Wave 4's keys are re-applied, and so are its removals: the stale `affiliates.commission` keys apart from bannerTitle, `accountPrivacy.deletedList` and `agentPass.retiredBuyers`. Six keys were changed by both sides; each takes wave 4's sentence, which is true once the agent is off: `faq.questions.subscription.answer`, `faq.questions.dataStorage.answer`, `trustPage.security.neverSold.description`, `trustPage.retention.rows.agent.howLong`, `homeHero.sub2` and `homeAgent.passLine`. es, fr and pt also carry `accountPage.versionInterviews_many` and `versionOffers_many`, which main's plural guard requires for wave 4's two new plural keys. |
| `public/llms.txt` (4 hunks) | Keeps main's figures (950,000+ from 29,000+ boards, as of 2026-10-18), its accuracy sentences, its API and MCP server addresses, its vs line with ChatGPT & Claude, its renamed Companies and Pay Transparency lines, and "Claude, ChatGPT or Claude Code". Takes wave 4's paid line ("One paid report (the $5 Full Analysis) and one optional monthly plan, Pro ..."), its Pricing line ("The free tools, the $5 Full Analysis and Pro") and its deletion of the Freelance Boost line. The apply-yourself line is wave 4's, with the ChatGPT sentence and main's three apps, and ends with main's how-it-works link. The connector line takes wave 4's free-tools sentence inside main's text. The connect sentence keeps wave 4's "Resume Booster never submits an application for anyone". |
| `docs/deploy-ledger.json` (5 hunks) | `appliedOutsideDrizzle` is `["20261014100000"]`: R1's entry from #37 is kept, and 20261008125000 and 20261008128000 stay out because appliedByBehaviour proves them. Main's verifiedDeploys (four entries) are kept. Wave 4's hold 20261011103000 is the only hold left; main released 20261012111000. Both notes are kept, with a new paragraph for this merge. sharedFiles is the union of both sides. Where both name an owner, main's wins: llms.txt, sections 65 and 74 and src/main.tsx go to seo-round. |
| `scripts/verify-deploy.sh` (7d), sections 65, 74 and 76 | Main's crawler lines, ungated. Wave 4 keeps its English-strings swaps (65's "we will honour what you bought", 74's "there is one optional monthly plan") and its "turns into the paid plan" FAIL on the strings. |
| `src/components/AtsCoverage.tsx` | Wave 4's removal of the strip legend, with main's `text-xs text-subtle-foreground` on the as-of line. |
| `src/components/HomeHero.tsx` | Wave 4's `homeHero.sub2` default, with "We never submit anything for you." Main cut that sentence only while the agent was live. |
| `src/config/mcp-tools.ts` | Keeps main's reworded zero-tools row ("Another app: server listed, zero tools", which names no IDE). Drops the ChatGPT search-only row, which is false since wave 4: ChatGPT gets every keyless tool except those not on ChatGPT. Adds wave 4's ChatGPT authentication row. |
| `src/data/guides.ts` (7 hunks) | The freelance and fractional guides keep main's text, and wave 4's Freelance Boost removals are re-applied to both. Both are dated 2026-10-25 because their text differs from main's. The apply guide is wave 4's, as main's own comment on it asks. Two later commits (below) changed it. |
| `src/pages/AgentConnect.tsx` | Main's `MCP_PAGE_HOSTS` for the developer disclosure, without `pickedName`, which wave 4's page no longer reads. |
| `src/pages/DataApi.tsx` | Both sides' imports: wave 4's `Blocks` icon and builder-plan constants, and main's `publicApiBase`. |
| `src/pages/FreelanceBoost.tsx` (2 hunks) | Main's stash still forgets a delivered purchase, while a Pro grant stays. Main's "Start a new purchase" button and its stash-and-address reset are dropped, because the product is no longer sold. The comment says so. |
| `src/pages/Index.tsx` (3 hunks) | Wave 4's strip: its imports, its comment and `AgentOfferStrip({ addToClaude })`. Main's other hunks stay, among them "re-read through the day". |
| `src/pages/PayTransparencyIndex.tsx` | Main's `useCompanyBoardHref` and wave 4's `foldToBoardCategories`. |
| `src/pages/Pricing.tsx` (2 hunks) | Wave 4's rewrite, with main's `link` class. |
| six tests: a-pass-number-on-a-page-is-a-placeholder, a-pass-paid-for-forms-the-agent-could-only-prepare, agent-hallmark, apply-agent-guide, pricing-truth, the-board-hands-a-job-and-a-search-to-the-agent | As the hp base resolved them (`2fbb3cd8` with `89036c95`). None of their inputs has changed on either side since. |

**Auto-merged, but the two sides met.**

- **SEO's /affiliates bake** (`scripts/prerender-seo.mjs`): it now
  re-exports `AFFILIATE_PRO_FIRST_MONTH_CENTS` and reads
  `affiliates.proCommission`, filling `{{amount}}`, with no per-tool-sale
  fallback. A missing key throws inside the bake. The title is "Affiliate
  Program — $10 per Referred First Month of Pro". Main's
  `seo-bake-crawler-output` /affiliates case asserts that figure and no
  per-tool-sale wording, and the bake re-export test passes.
- **The crawler's /privacy had lost its full text** (found by the guarded
  bake: "legal text NOT baked (headings only): /privacy: no value for
  {openConsentChoice}"). Main's converter (`scripts/prerender-legal.mjs`,
  SEO-029) could not read wave 4's Privacy.tsx: the analytics-choice button
  and the AI table rendered from `MCP_PRIVACY_ROWS.map`. The converter now
  expands a row list passed in `vars` row by row, writes table tags, drops an
  attribute's expression along with the attribute, and leaves a `<button>`
  out. The bake passes `MCP_PRIVACY_ROWS`. `seo-bake-helpers` checks that
  every row is baked, that the button is not, and that a missing list or
  field throws (`5455ccfa`).
- **The apply guide named the retired products** (`b9135282`). Main's
  section 76 L9-11 FAILs a /llms-full.txt that names the pass, and llms-full
  bakes the guides. Wave 4's tldr, "What changed" paragraph and past-buyer
  question named the Agent plan, the Agent Pass and the Apply Assistant. They
  now say "the products built around it" and "one of the apply agent's
  products". `416f74ea` gives the guide main's three apps ("Claude, ChatGPT
  or Claude Code") and main's "Which AI can I use?" answer. Each change
  records the guide's hash again.
- **Builds** (`6939f22a`): main's R1 hotfix changed `_shared/send-mail.ts`,
  which mail-watch and stripe-webhook bundle. They now serve
  `mail-watch.2026-10-11.30` and `stripe-webhook.2026-10-11.31`.
  process-email-queue is main's `2026-10-14.2`, and employer-profiles is
  main's.
- **Tests that hold both sides.** `89036c95`'s settles are re-applied:
  Account.tsx's `verdictChurnFloor` default is main's sentence; the
  verifier-line, old-sections and upload-tally tests; and the crawler-copy
  test, which lets /agents list wave 4's apply_to_my_shortlist. The guide
  hashes are recorded at 2026-10-25. R1's Freelance Boost test (S13-082)
  keeps every case about honouring a purchase until it is delivered; its
  cases that sold a second Boost now assert that no page offers a new
  purchase.
- **Ledger** (`38290564`): the hp ownership round's entries for the owners
  this ledger reserves are copied from hp/honesty's ledger: 51 wave4, 3
  seo-round and 2 wave3. pd-bake-the-crawler-copy-sells-nothing-retired goes
  to wave4, because this merge lands the fix that hp's note said home-pricing
  should yield to.

**Intentional drops.** `git diff origin/main...HEAD` and
`git diff 8874bd13...HEAD`, read line by line, lose no main hunk and no wave
4 hunk except the ones below.

- Main's hunks:
  - the six locale sentences above, in nine locales;
  - in llms.txt, the "Paid tools are one-time purchases ... Freelance Boost
    ... One optional all-access subscription (Pro)" line, the "One-time tools
    and the all-access plan" Pricing line, the connector line's "No key
    needed to start ... a paid key opens résumé fit scoring", and the
    apply-yourself line's shorter body;
  - the /affiliates per-tool-sale block;
  - Index.tsx's strip comment about the interpolated allowance;
  - the apply guide's own text, except its three apps and "Which AI can I
    use?";
  - FreelanceBoost's "Start a new purchase";
  - the test assertions that pinned those: pricing-truth's "Pricing page
    lists every monthly plan on sale", apply-agent-guide's "holds the
    retirement sentences", a-pass-number's strip cases,
    a-pass-paid-for-forms' llms paid-key line, the-board-hands'
    agentReadyOnly line (now a stricter "no agentReadyOnly and no
    sendableOnly"), R1's sell-again Boost cases, and seo-bake's
    per-tool-sale figures.
- Wave 4's hunks:
  - the agent-mcp-gated crawler branches of 7d, 65, 74 and 76 (and 76's
    VD76 read), with their cases in old-sections and verifier-line;
  - the deletion of the zero-tools troubleshooting row;
  - the guide sentences naming the Agent plan, the Agent Pass and the Apply
    Assistant;
  - "Claude or ChatGPT" where main says three apps;
  - the upload-tally pending-files assertion;
  - the builds mail-watch .29 and stripe-webhook .30.

**Gate** (each heavy command through `~/.config/resumebooster/heavy.sh`):

- **Typecheck:** `npm run typecheck` exits 0, and the pre-commit typecheck
  passed on every commit that touches src.
- **Worker:** `tsc --noEmit` exits 0.
- **Edge functions:** `scripts/check-functions.sh` is clean, with deno.lock
  restored.
- **Full suite**, run in two shards: 1,262 files passed and 1 skipped;
  19,678 tests passed and 32 skipped.
- **Upload tally:** job-board's upload is 4,433,518 bytes over 166 files,
  from disk, the deploy's way, and git's sizes agree. That is 66,482 under
  the 4.5 MB line and 16,482 inside the 50,000 of room. The guard passes.
  The 1,115 bytes over 8874bd13's estimate are main's send-mail.ts.
- **Guarded bake of `416f74ea`:** git archive export, vite build, read-only
  safe-fetch. It made 1,105 requests and 0 were refused. It wrote 3,635
  pages and a 1,370-URL sitemap with no /freelance-boost, and the full text
  of /terms and /privacy. Its own retired-claim, source-sentence and
  job-markup checks are clean. The 7 built-output suites pass on this dist
  (89 tests).
- **Sections against the bake**, served Lovable-style with J, R and MC
  stubbed and curl writes refused:

  | section | PASS | INFO | FAIL |
  |---|---|---|---|
  | 50 | 12 | 1 | 0 |
  | 52 | 12 | 0 | 0 |
  | 76 | 30 | 2 | 0 |
  | 98 (seo-round 32, speed 13) | 45 | 0 | 0 |

  Wave 4's 92-* sections pass every line that reads the bake, among them the
  descope recheck's /freelance-boost, sitemap, llms.txt and ChatGPT lines.
  Every 92-* FAIL is a wave 4 build or migration not yet live, or a stubbed
  read. The shim refused 38 writes and none was sent.
- **Ledger:**
  - `--draft` exits 0 with no MUST BUMP: 70 functions to deploy and the one
    HOLD.
  - `--against origin/main` finds 69 functions moved and 0 violations; the
    process-email-queue sort violation is gone.
  - `--against 8874bd13` finds 4 moved and 0 violations.
- **Overlap:** `--overlap HEAD origin/oh/integration origin/hp/honesty
  origin/hp/scanner` exits 4 with this branch's copy of the tool: 642
  undeclared. 636 are wave 4 files that all three stacked branches contain,
  4 are wave 4's recheck files that oh/integration contains, and 2 are
  between the hp branches. hp/honesty's stack-aware copy of the tool
  (`087252b7`) leaves 2 undeclared: sales-gate.ts and the sale-switches test,
  between hp/honesty and hp/scanner, which their own ledger gives to
  home-pricing.

**Left.**

- oh/integration (PR #46), trust/pages and the hp branches take this merge
  the next time they merge wave4/integration.
- They will meet `prerender-legal.mjs`, the guide hashes and the ledger
  entries above.

### The recheck of the merge (2026-10-25)

A recheck of the merged branch at `883ecd0a` found eleven defects: two
blockers, five majors and four minors. None was lost by the merge. Five come
from main's own files (the /pricing template, section 83, the footer), and
wave 4 made them false or carried them over. Six are wave 4's own: the
fit-is-paid copy, the experience rule, the name resolver, the senior-community
rung and the Oracle id. Each was reproduced first. Each fix has a test that
failed on `883ecd0a`. Each takes main's behaviour or a true, weaker sentence.
The experience rule was measured on a live corpus first, by the corpus-first
policy.

- **Blocker: the crawler's /pricing promised bundle discounts.** The bake
  wrote "Current bundle discounts are shown live on this page in the app".
  No tree shows a bundle or a discount: the Premium package's checkout
  answers 410, and the React page renders neither. The line is gone. "bundle
  discounts" is now a retired claim in `scripts/prerender-retired.mjs`, so
  the bake's own check and section 83 C1 fail it on any page.
- **Blocker: six surfaces called fit scoring paid.** These were the React
  /data-api row ("POST /v1/fit — Paid."), the React /agents badge for
  fit_resume ("paid key"), the crawler /data-api ("(paid)"), the crawler
  /agents ("fit_resume needs a paid key"), llms-full.txt and llms.txt.
  Wave 4 makes scoring free: `_shared/fit-gate.ts` opens a free basis for a
  confirmed key. Every one of them now reads one sentence from the mirror,
  `MCP_FIT_ALLOWANCE` in `src/config/mcp-tools.ts`: "25 scorings a day on a
  confirmed free key, 1,000 on an account with a paid plan". The badge is
  `MCP_TIER_BADGE`, which the page and the bake both read. The guard
  (`w4b-merge-recheck-fit-scoring-is-free-on-a-confirmed-key-on-every-page`)
  checks that fitGate opens a free basis. It then fails any clause, in the
  page sources, the servers, the bake's output or either llms file, that
  pairs /v1/fit or fit_resume with "paid" without the free allowance. It
  also pins llms.txt's typed figure to the constant.
- **Major (twice): the /pricing head and lead were a list's sentences over
  one product.** The bake read "One-Time Tools from $5", "One-time tools
  $5–$5", "Paid tools are one-time purchases" and a plural heading, all over
  the Full Analysis alone. With one one-time product, the title now names it
  ("Pricing — Free Scan, $5 Full Resume Analysis or Pro $45/month"). The
  description and the lead are React's own `pricingPage.metaDescriptionFa`
  and `oneTimeAndProLineFa`, filled from the catalogue with no English
  fallback. The heading is "One paid report", and Pro is `PRO_SUMMARY`, the
  line the page and Stripe read. A list keeps its range. A range whose two
  ends are one price is now a sales-page claim the bake's check fails
  (`SALES_PAGE_CLAIMS`).
- **Major: section 83 C7 failed a correct deploy.** The changelog's lazy
  bundle is built as `en-*.js` beside the locale chunks. Main's 18 October
  entry quotes the old hero sentence, which put it in main's bake, in the
  merged bake and on production. C7 now cuts the changelog's entries from
  each chunk before matching (`withoutChangelogEntries`). It cuts them
  whichever way the build spells them, and returns a chunk whole when it
  cannot find the object's end or when the object holds the hero's keys.
  `w4b-merge-recheck-section-83-c7-reads-no-changelog-quote` runs section 83
  in bash against a local site. The changelog chunk alone PASSes, a hero
  that still says the sentence FAILs, and a chunk carrying both is judged
  on its hero. On the real chunks of the merge's bake it cuts both changelog
  chunks to 78 bytes and leaves every other chunk unchanged. **Main's own
  verification of 899be058 still runs main's copy of section 83 and prints
  this false FAIL;** read it as this defect, or run section 83 from this
  branch.
- **Major: a wish that names something else dropped a required minimum.**
  Tapestry's 874 sales associate postings say "Required Qualifications 1+
  years of sales experience (luxury retail preferred)". Main reads entry/1;
  wave 4 read nothing. The re-derive (EXPERIENCE_VERSION 2) would have
  overwritten the stored rows, and a maxYears or entry filter drops such a
  row. Under the corpus-first policy the rule was measured on 1,354 live
  descriptions against main and the round before
  (`~/.config/resumebooster/wave4-merge-recheck-2026-10-25/experience/`).
  That run found five more classes where the round before was worse than
  main:
  - a "Preferred Experience" heading read across a line break ("strongly
    preferred\nExperience as part of");
  - an "or equivalent" alternative read across a line break ("or
    equivalent\n8+ years");
  - "3 to 7 or more years" read as 7;
  - a standalone "Requirements" or "Required:" line not read as a heading;
  - "preferably in the hospitality industry" taken as a wish on the years.

  The rule now works as follows. A wish word drops the years only when it is
  on the years themselves: right after them or their noun phrase,
  "(preferred)" alone, "ideally" or "preferably" before them, or a
  "Preferred" label opening the clause. A required heading binds, and so
  does a line opening "Required" or "Minimum" under no wish heading. A
  heading's two words sit on one line, and standalone "Requirements",
  "Required", "Qualifications" and "Preferred" lines are headings. An "or"
  alternative never reaches across a line break. "N to M or more years" and
  "substitute for N years" state no floor. Of the 1,354 descriptions, 1,280
  read the same under main, the round before and this rule. This rule
  differs from main on 60, each read by hand:
  - 58 are corrections: wish headings, alternatives, "N or more", wishes on
    the years, and senior living titles;
  - 2 state no figure where main stated one, a weaker claim. At Wells Fargo,
    the required 10+ years sit beyond the reader's 30-character gap, and
    main's 10 came from a Desired Qualifications line. Winland Foods says
    "Minimum 5 Years manufacturing experience preferred".

  Every disagreeing description is in
  `src/test/fixtures/experience-merge-recheck-corpus-2026-10-25.json` with
  its hand-read value, and the experience test requires this rule to give
  it. EXPERIENCE_VERSION stays 2, because .93 has never deployed.
- **Major: "Meta" resolved to a four-role staffing board.** company-suggest's
  only exact "Meta" is SmartRecruiters' Meta1. Its own posting says "My
  Company support several nationally-known clients", and the AI was handed
  its mailroom and reception roles as Meta's, with agency false. Live main
  answers that the board does not carry Meta. Now `resolveCompanyNames` does
  not search a lone exact match whose boards are all an agency's, or that
  has fewer than `FEW_OPEN` (10) open roles. It returns that match in
  companiesUnresolved, with `held` and the candidate's open count, vendor
  and agency flag. An agency's hold is named in unknownCompanies, as main
  does; a small board's is not, since we do carry it. The catalogue labels
  Meta1 an agency: it was split out of its packed line in
  `job-board/sources.ts` and the byte-identical layoff-filings copy, and
  added to `scripts/tag-agencies.mjs`'s ledger. agent-mcp's
  companiesUnresolved description and its guide line say what a held name
  is. A test pins the threshold they type to `FEW_OPEN`. The famous names
  the recheck tried still resolve (Uber 437, Oracle 1,126, Intel 522, Nike
  396, Target 1,870, HP 1,005, Disney 464, Stripe 201, OpenAI 206, Anthropic
  189, Spotify 39 open, read live).
- **Minor: a Senior Community Manager with a prefix lost its rung.** "TOPS -
  Senior Community Manager Specialist", "Roving Senior Community Manager"
  and "Part-Time Senior Community Support Worker" are senior again.
  "senior community" is clientele only when it is not followed by manager,
  support worker or associate. Over 7,130 live titles, this differs from the
  round before on exactly those four.
- **Minor: the README's owner step 1, "What a person can do" and "Left for
  other owners"** still described the /jobs apply-agent pitch and the bake's
  $99 plan and $29 pass. Main's profiles, design and SEO rounds removed both.
  All three are rewritten to the state after this round.
- **Minor: the footer linked Freelance Boost on every page.** The entry is
  removed. It is the exact hunk hp/honesty carries (the design owners'
  switch-over), so the two merge as one change. The cut-products guard reads
  the footer.
- **Minor: an Oracle requisition id with letters was refused unread.** The
  plan accepts `[A-Za-z0-9_-]{1,40}`, quoted in the finder as before. A
  read-only GET of `REQ_820519` on ebwh's CX_1002 through the new plan
  returned "Sales Commission Stylist, Full Time - Tysons Corner" (3,375
  characters).

**Builds:**
- agent-mcp `2026-10-11.37`: companiesUnresolved names a held name.
- fetch-job-posting `2026-10-11.27`: the Oracle id.
- layoff-filings `2026-10-11.1`: the catalogue copy labels Meta1. Its hash
  is pinned in `a-copy-of-the-catalogue-drifts`.
- job-board keeps its reserved `2026-09-09.93`.
- public-api stays `2026-10-11.36`.

There is no migration. No locale key is added or removed.

**Shared files this round touches.** Each is wave 4's own hunk on a line
wave 4 makes false:
- `scripts/prerender-seo.mjs`, `public/llms.txt`, `src/config/mcp-tools.ts`
  and `src/pages/AgentConnect.tsx` (seo-round);
- `src/pages/DataApi.tsx` (critical-path);
- `src/components/Footer.tsx` (design: hp/honesty's identical hunk);
- `scripts/prerender-retired.mjs` and section 83 (profiles+design; they
  have no sharedFiles owner, and no in-flight branch but the hp ones changes
  them);
- `supabase/functions/layoff-filings/` (oracle-regionless changes it too;
  wave 4 ships first and owns it in the ledger).

**When oh/integration and trust/pages next merge this branch,** two lines
will conflict:
- layoff-filings' `BUILD_VERSION`: keep theirs (`2026-10-15.x`, later than
  this round's);
- the catalogue copy's `PINNED` hash: recompute it over the merged copies.

`job-board/sources.ts` merges as text: Meta1 sits on line 205, and their
lines are 85, 887, 1,022 and 1,241. Job-board's upload grows by this round's
job-board bytes. Their size notes must count them: trust/pages measured
7,539 bytes of room under the guard.

**Before wave 4's frontend publishes,** section 83 C1, run from this branch,
reads FAIL on production's /pricing: main's bake still promises bundle
discounts. It turns PASS with this branch's bake.

**Verifier.** `scripts/verify-deploy.d/92-w4b-merge-recheck.sh` is
read-only: one OPTIONS, five GETs, and two job-board list reads on the probe
budget. It checks:
- the layoff-filings build;
- the crawler /pricing (no One-Time Tools title, no one-price range, no
  bundle discount, the "One paid report" heading);
- /data-api, /agents, llms.txt and llms-full.txt (never fit paired with
  paid, and each states the free allowance);
- companies:["Meta"] held as an agency's candidate;
- Tapestry's sales associate rows keeping minYears 1.

Against production on 2026-10-25, before the deploy, it printed FAIL on
every line but Tapestry's, which main's stored rows pass.
`w4b-merge-recheck-the-section-fails-what-it-claims` runs it against a fake
curl. A healthy site, served from this checkout's own offline bake, prints
eight PASS. The old build, the old /pricing, each old fit page, the old Meta
answer and dropped Tapestry years each print FAIL. Every call is a read.

**Checks.** Every heavy command ran through
`~/.config/resumebooster/heavy.sh`.
- **Typecheck:** the pre-commit typecheck passed on all four code commits.
- **Worker:** `tsc --noEmit` exits 0.
- **Edge functions:** `scripts/check-functions.sh` is clean (deno.lock
  restored).
- **Targeted runs:**
  - The 245 test files that read the changed areas ran with 4,311 tests.
    Three failed first: the two catalogue pins in build-version-guard, moved
    for the one agency flag, and a-dollar-figure's description-slot reader,
    which now reads both of the /pricing description's branches.
  - The 87 files that read the catalogue, the experience rule or the upload
    size pass, with 2,459 tests.
- **Upload:** job-board's folder plus `_shared` is 4,435,671 bytes on disk,
  2,153 more than `883ecd0a` (the experience rule, the held names, the Meta1
  line). That leaves 14,329 bytes under the upload-tally guard's 4,450,000,
  and the guard passes.
- **Guarded bake of `bef1bc7d`** (git archive export, vite build, read-only
  safe-fetch):
  - 1,105 requests, 0 refused;
  - 3,635 pages and a 1,370-URL sitemap;
  - the full text of /terms and /privacy;
  - its retired-claim, source-sentence and job-markup checks are clean.

  /pricing reads "Pricing — Free Scan, $5 Full Resume Analysis or Pro
  $45/month" and React's description. No clause in the 7,271 written files
  pairs fit scoring with "paid". The 7 built-output suites pass on this dist
  (89 tests).
- **Sections against the bake,** served Lovable-style with the writes
  refused:

  | section | PASS | INFO | FAIL |
  |---|---|---|---|
  | 50 | 12 | 1 | 0 |
  | 52 | 12 | 0 | 0 |
  | 76 | 30 | 2 | 0 |
  | 83 | 10 | 0 | 0 |
  | 98 (seo-round 32, speed 13) | 45 | 0 | 0 |

  C7 PASSes on the real merged chunks. Every 92-* section prints the same
  counts as the merge's run. The new section passes its five bake lines; its
  FAILs are the undeployed layoff-filings build and the stubbed job-board
  reads. The shim refused 40 writes, and none was sent.
- **Ledger:**
  - `--draft` exits 0: 71 functions to deploy (layoff-filings joins), no
    MUST BUMP, and the one HOLD.
  - `--against 883ecd0a` finds 4 functions moved and the one reserved
    violation (job-board `.93`).
  - `--against origin/main` finds 70 moved and 0 violations.
- **Overlap:** `--overlap HEAD origin/oh/integration origin/trust/pages
  origin/hp/honesty origin/hp/scanner`, with hp/honesty's stack-aware tool,
  leaves 5 undeclared, and this branch changes none of them.
- **Full suite:** runs in the push's pre-push hook; its count is in the PR
  #39 body.

**Left.**
- oh/integration, trust/pages and the hp branches take this round when they
  next merge wave4/integration, with the two catalogue lines above.
- Main stays frozen until 899be058 verifies, and its section 83 C7 FAIL is
  the false one described above.

## What a person can do after this deploy

- **Connect** Claude or ChatGPT with no key and no account. Every read tool
  answers keyless: `board_stats`, `search_jobs`, `search`, `fetch`, `get_job`,
  `get_jobs`, `check_jobs_open`, `employer_hiring_record`, `employer_growth`,
  and `apply_myself`. `tools/list` shows a caller only what it can call (21 KB
  with no key, under 25,000 bytes with one), with no oauth2 schemes while
  sign-in is off.
- **Search the way they speak.** "nurse jobs in Texas" searches Texas, an
  employer named in `companies` resolves by name (five names a call), and
  "City, ST" searches that city in that state.
- **Apply themselves.** When the employer uses Greenhouse, Ashby, Recruitee,
  Breezy or Pinpoint (only Greenhouse and Recruitee inside ChatGPT, which
  `/agents` now says too), the AI reads the real application form. The
  marking rule is default-deny: a question is marked for the AI to draft only
  when it reads as an open question about work done or one of a short list of
  motivation questions, each a single ask; every other question, including a
  fact riding inside a work-done or motivation question, is marked for the
  person. It reads words, so it can still mark a factual or protected
  question for a draft, even a plainly worded one (the final recheck saw 17
  of 24 fresh ones; main's classifier drafts 22), and it sends some ordinary
  work questions to the person. Every page and AI-host text says so and tells the person to read
  every answer before sending (see "Descope 2026-10-25"). We never submit
  anything.
- **Developers** get the same from `/v1`, fit scoring free at 25 a key a day
  across `fit_resume` and `/v1/fit` together on a confirmed key, and a
  "Builder API (planned)" card at $49 a month whose only action is an email
  request.
- **Nothing retired is sold by the server.** The Agent plan, the Agent Pass
  and the $7 Apply Assistant answer a purchase with 410, each behind its own
  switch. The server-side apply agent is switched off; its code is kept,
  dormant, behind `supabase/functions/_shared/apply-agent-switch.ts`. Every
  page says so: `/agents`, the pass page, pricing, the Trust page, the
  apply-agent guide, the `/jobs` board, the signed-in console (`/account`,
  `/agent`), the crawler bake and both llms files; the recheck of the merge
  took the Freelance Boost link out of the footer.

## The owner's figures, as built

- **Keyless allowance:** 20,000 a day: Claude 10,000, ChatGPT 6,000 (200 for
  each person when ChatGPT's call names them, 2,000 for calls with no id),
  other callers 4,000 (100 for each IPv4 address or IPv6 /64). Per minute: 60
  overall, Claude 30, ChatGPT 20, other 15. A share is chosen only by the
  verified address, never by the path, user agent or `_meta`. Timeouts are
  never refunded; refunds are capped at 5 a day per bucket. `board_stats` is
  served from a five-minute cache, never counted, and callers that miss the
  cache together share one board read. The SQL is `mcp_anon_check_v2` and
  `mcp_anon_refund` (20261011102000); the constant is `ANON_ALLOWANCE` in
  `agent-mcp/allowance.ts`, mirrored in `src/config/mcp-tools.ts` and pinned
  to it.
- **Application forms** have their own pool: 5,000 a day at 20 a minute,
  split by platform like the lookups (review fix): Claude 2,000 a day at 10 a
  minute, ChatGPT 2,000 at 6, everyone else 1,000 at 4. A forms call counts
  on its platform's part (`global:forms:<platform>`) and on the pool's own day
  and minute (`global:forms`, never the lookups' rows), so a scraper outside
  both platforms spends only its own part. **The split figures are the
  integration's, inside the owner's 5,000 and 20; owner step 2 confirms
  them.**
- **Concurrency.** The per-minute caps bound a minute's total, not how many
  searches hit the board at once: the economics' "at most 0.3-1.35 database
  cores" is an average over the minute. At most six keyless calls now run at
  once in one isolate; the rest wait their turn for up to 8 s, and a call that
  gets none is turned away before it is counted. Isolates multiply this, so it
  bounds a burst, not the service.
- **Fit scoring:** 25 a day per key in all, across `fit_resume` and
  `/v1/fit` (review fix: the reader counted each door, 50 in all), on a key
  whose email was confirmed or whose account proved its mailbox, and 1,000
  with a paid tier, a pass, the plan or Pro. It is never offered inside
  ChatGPT. Both doors read one decision (`_shared/fit-gate.ts`) over one SQL
  reader (`api_key_fit_allowance`, 20261011110000). **Owner step 2 confirms
  this reading of "free 25/day".**
- **Privacy:** ChatGPT searches are not logged: job-board honours `noLog`
  only with the reader proof, and agent-mcp sets it only for a call from
  OpenAI's published egress (review fix: it followed the user agent, so any
  script could opt out of the log). Connector searches from everywhere else
  keep their words and no shown ids; the 30-day prune (20261011103000) is
  held for the second message, and the Privacy page says 180 days until the
  owner switches `MCP_SEARCH_PRUNE_LIVE` on with its release (a test fails if
  the switch is on while the ledger still holds the migration).
  `find_roles_for_my_cv` takes no CV. The Privacy page carries the draft MCP
  table, marked for counsel.

## What the integration itself fixed

The five branches were built in parallel, and these are the places where
their combination, or a file no group owned, needed work:

1. **The frontend mirror** (`src/config/mcp-tools.ts`) registers what the
   wave-4 server registers: the ten keyless tools with `apply_myself`, none of
   the retired apply tools, the five prompts, and the owner's allowance
   figures.
2. **One fit rule on both doors** (`_shared/fit-gate.ts`).
3. **The Apply Assistant is no longer sold** (`create-product-checkout`), and
   is in `HIDDEN_PRODUCT_IDS`.
4. **The signed-in console sells nothing retired** (the Morning Queue panel,
   `/agent`, the application kit, the OAuth consent page).
5. **The 30-day retention** (20261011103000), held.
6. **Stamps** for every function the integration changed.
7. **The verifier**, the live contract probe, `llms.txt`, and the ledger.

## What the review of 9fe3bc0d fixed

Each with a behaviour test that fails on the file as reviewed and passes now.

**Apply safety**
- The console (`/account`, `/agent`) no longer describes a running agent:
  the status band, the Morning Queue bridge card, the agent's profile and
  stopped questions on `/account`, the setup checklist and the tracker's
  "The agent can apply to this one for you" link render nothing while the
  agent is off; the prepared-applications panel offers no Approve or Try
  again, answers a stale 409 `agent_switched_off` with the retirement
  sentence, and renders nothing for a person with no packet
  (`the-retired-agent-is-sold-nowhere-in-the-console`).
- The public guide `/guides/how-the-apply-agent-works` says the agent is
  switched off, nothing is sent, and how to apply with Claude or ChatGPT
  under the default-deny rule (`apply-agent-guide`).
- The default-deny rule had three holes: a work-done prompt carrying a second
  ask ("..., including your reasons for leaving each role"), a later
  sentence read only for the protected list ("Describe your experience; why
  did you leave your last job?"), and a motivation opening carrying a second
  question ("When could you start?", "Have you previously applied to us?",
  "interested in leaving"). The work-done exemption now covers only the
  clause that names the work, every later sentence is read against every
  factual list, the factual list learns when-could-you-start, current
  earnings and a previous application, and a motivation question must be one
  ask with no word about leaving. The worker mirrors the person's own history
  and the clause rule, and its parity check covers them
  (`a-question-about-your-history-is-never-drafted-from-a-cv`, and the
  worker parity in
  `the-model-drafted-criminal-age-citizenship-pay-and-health-answers-and-the-worker-sent-them`).
- An attestation offered as a choice ("I affirm that my application, resume
  ... are accurate": I agree) is the person's, not "a document you attach";
  the three live Greenhouse labels are in the consent corpus, read verbatim.
- A Breezy or Pinpoint apply page that answered with no questions says it was
  read and names the CV, instead of "does not publish its form" (MCP and
  `/v1`, which adds `reason: no-questions-found`); the cache keeps the
  distinction.
- The Privacy draft claims 30 days only once the prune runs (above).
- `/agents` says that inside ChatGPT only Greenhouse and Recruitee forms are
  read (nine locales, from the mirror).
- The Trust page says the apply agent is switched off and sends nothing to
  employers (nine locales).

**Abuse, allowance, security**
- job-board looks up five employer names a call and folds the employer list
  once (a 500-name body cost 11 s of CPU; it now costs five lookups), and
  agent-mcp refuses a search naming more than 50 employers before counting
  it.
- The forms pool is split by platform; `board_stats` misses share one read;
  six keyless calls run at once per isolate; only OpenAI's egress sets the
  no-log flag (above).
- The free fit allowance is one 25 across both doors (above).

**Money and retirement**
- The Apply Assistant's refusal reads its own switch
  (`APPLY_ASSISTANT_ON_SALE`), so putting the Pass or plan back on sale
  cannot reopen it.
- Section 93's Stripe step lists Agent plan subscriptions that are active,
  `trialing` and `past_due` (the plan was sold with a 7-day first-time trial,
  which Stripe's active filter leaves out).

**Deploy and tests**
- Sections 65, 74, 76 (L1-08) and 7d judge the retired products as retired
  once a wave-4 build serves: the wave-4 FAQ and the retirement notice are
  required where the trial and pass copy was, and a bake still selling the
  $99 plan or the $29 pass is INFO naming its owner, PASS once it is gone
  (`the-old-sections-judge-the-retired-products-as-retired`, and L1-08 in
  `a-verifier-line-that-could-not-fail-now-can`).
- Section 86's no-log lines say what they check; the owner's SQL is the proof.
  From agent-mcp 2026-10-11.27 the owner's count on the ChatGPT nonce is 0,
  in section 86 and in section 92 (a caller that says it is ChatGPT is never
  logged, S12-085); an agent-mcp between .3 and .26 is still asked for 1.
- Section 85 names the tests that exist.
- The ledger exits 7 for a late-stamped migration that would revert a later
  one (naming both files; the message is refused) and 8 when a function's
  live build is later than main's; section 49 FAILs both
  (`a-migration-stamped-earlier-touches-nothing-a-later-stamp-defined`). Run
  over profiles' six 20261012* migrations as applied and wave 4's seven
  20261011* as pending, it finds no overlap.
- The design branches' shared hand-off test has an owner in `sharedFiles`.
- The job-board `.93` note gives the integrated graph's growth.

**Refuted or only partly taken:** none refuted. Two figures are new and wait
for the owner (the forms split, and fit read as 25 a key across both doors).
The `/jobs` board and the crawler bake are other owners' files (below); wave 4
did not rewrite the board's `jobsPage` locale values, because the pitch's
link goes to `/agent` (sign-in only) and four guards pin the priced pitch
with it: the Jobs.tsx owner removes the block, its keys and those guards
together.

## Deploy

Generate the message at the merge commit on main with
`node scripts/deploy-ledger.mjs --message` (docs/DEPLOY-LEDGER.md). It
refuses on this branch (exit 5); `--draft` prints the draft below.

Main has moved since this branch forked: `e372e512` ("Applied 3
migrations") records wave 3's three held migrations (20261009100300,
20261009112000, 20261009160100) as applied, so the message generated on
main will not list them; on this branch's draft they still appear.

**1. Migrations before the functions**, in this order:

1. `20261011100000` the application-form cache: before agent-mcp and public-api
2. `20261011101000` the call counter and the 50% alerts: before agent-mcp
3. `20261011102000` the split allowance and the forms pool's split (`mcp_anon_check_v2`, `mcp_anon_refund`): before agent-mcp
4. `20261011102100` the adoption reader counts address rows only: before agent-mcp
5. `20261011110000` the fit-allowance reader (both doors counted together): before public-api and agent-mcp
6. `20261011130000` the apply agent's two schedules removed by name

If agent-mcp lands before 102000, every keyless call fails closed; if public-api
or agent-mcp lands before 110000, fit refuses (503 on /v1) rather than scoring
for free. 102000 drops the first, never-released shape of the two meter
functions before creating the new one, so a re-run leaves one of each.

**2. Fourteen functions:** agent-access, agent-pass-status, agent-runner,
apply-broker, create-agent-checkout and create-pass-checkout at
`2026-10-11.14`; apply-agent `2026-10-11.15`; agent-mcp and public-api
`2026-10-11.3`; create-product-checkout, generate-application-answers and
generate-apply-package `2026-10-11.2`; api-key-request `2026-10-11.1`;
job-board `2026-09-09.93`.

**3. Publish the frontend** with the functions (owner step 1: nothing waits on
another owner).

**Second message, after wave 4 verifies.** `20261011103000` is in
`holdUntilVerified`. It schedules the nightly 30-day prune of the connector's
searches, an irreversible delete of raw rows. Release it once sections 82 and
86 pass, then empty its hold, record the deploy in `verifiedDeploys`, set
`MCP_SEARCH_PRUNE_LIVE = true` in `src/config/mcp-privacy.ts`, and publish
the frontend with the changelog.

The old `mcp_anon_check` stays until the live agent-mcp has moved off it. A
later migration drops it.

## Verify

`bash scripts/verify-deploy.sh` runs these wave-4 sections. Each checks the
wave-4 builds with `build_ge` and can fail. A test runs each one against a
fake curl whose free connector answers come from the real agent-mcp handler
(`src/test/the-wave-four-sections-fail-what-they-claim.test.ts`).

- **82, keyless surface:** agent-mcp `2026-10-11.3` or later, the
  instructions (search first, the six rules, no price, 2,048 characters or
  fewer), the keyless tool list (the ten, no oauth2, 25,000 bytes or fewer,
  titles and hints), the ChatGPT edition (no price, plan, checkout or tag;
  forms for Greenhouse and Recruitee only), the four keyless prompts (no CV
  argument), and each read tool answering with no key. A malformed id costs
  nothing.
- **84, applying yourself:** public-api `.3` and the two generators `.2`, a
  live Greenhouse posting's real form, who answers each question, no choice
  question drafted, the person submitting, the forms pool spent rather than a
  lookup, the markdown packet's five headings, Workday not-published,
  SmartRecruiters restricted, the `/v1` twin (200 and 451, with
  `RB_API_KEY`), and the cache closed to anon.
- **85, allowance and protocol:** the api-key-request build, the counted
  search's share (other, connection, 100 / 4,000 / 20,000), the guide's
  figures including the per-minute caps and the forms pool's split, the
  counters and readers refusing anon, a null body answering -32600, CORS, and
  the protected-resource document's 404 while sign-in is off. The per-minute
  refusal and the forms split are proved in pglite and end to end
  (`a-scraper-cannot-spend-claude-users-share`,
  `every-claude-and-chatgpt-user-shared-one-addresss-unkeyed-allowance`).
- **86, job-board .93:** the build, the latest pass-end receipt finished step
  by step (INFO while in flight), the no-log lines (a browser-style noLog list
  still answers; a ChatGPT-agent search answers in the ChatGPT edition) with
  the owner's SQL for this run's nonce, which must now find the search
  logged (it came from outside OpenAI's egress), "nurse jobs in Texas" and
  "software engineer jobs in new york" returning at least 90% of their
  location form, and "Humana" resolving by name.
- **93, retire:** the seven builds, create-product-checkout `.2` (the Apply
  Assistant on its own switch), the three retired checkouts' 410 refusals,
  the agent's schedules gone, the worker workflow started only by hand, and
  the Stripe step (active, trialing and past_due).

Sections 73 and 73w, the 5n block in `verify-deploy.sh`, and now 65, 74, 76
(L1-08) and 7d were written for the wave-3 agent and its products. With a
wave-4 build serving, they check what replaced them instead of failing a
correct deploy; 65's `/agent`, 76's L1-08 and 7d's $99/$29 lines are INFO
while the bake still sells the retired products and PASS once it does not.
Section 49 also FAILs a late stamp and a function live ahead of main.

A full run spends nine keyless lookups (82: six, 86: one, 73: two) and four
form reads.

## Owner steps

1. **The frontend publishes with this deploy; nothing waits on another
   owner.** This step used to name two gaps wave 4 could not close: the
   `/jobs` board's apply-agent pitch and the crawler bake's $99 plan and $29
   pass. Both are gone. Main's profiles, design and SEO rounds, merged in
   `9a47faf6`, removed `jobsPage.agentPitchCounted`, `agentPitchCta`,
   `savedMilestoneDesc`, `queueBridge`, `agentAppliesTip2`, `agentOnlyTip`
   and the "Agent can apply" chips, and the bake's plan and pass. The recheck's
   scan of all 3,635 baked pages and both llms files finds no $99, $29, Agent plan,
   Agent Pass or Apply Assistant outside the dated 2026-10-18 changelog
   entry. The recheck of the merge (below) fixed what was left: the /pricing
   bake's list sentences and bundle line, the fit-is-paid copy and the
   footer's Freelance Boost link. "Left for other owners" lists what remains;
   none of it sells anything.
2. **Confirm two figures the review introduced** (each one constant if you
   choose otherwise): the forms pool's split (Claude 2,000 a day at 10 a
   minute, ChatGPT 2,000 at 6, everyone else 1,000 at 4, inside 5,000 at 20;
   `ANON_ALLOWANCE.forms` in `agent-mcp/allowance.ts` and its mirror), and the
   free fit allowance read as 25 a key a day across both doors (the reader in
   20261011110000; per door would be 50 in all).
3. **Deploy:** run the Lovable message generated at the merge commit on main,
   then `bash scripts/verify-deploy.sh`; run the owner SQL that sections 85
   and 86 print (86's nonce must be logged once).
4. **Stripe** (section 93 prints the list):
   - list the Agent plan subscriptions in all three billable states:
     `--status=active`, `--status=trialing` and `--status=past_due` (Stripe's
     active filter leaves out the other two);
   - cancel each trialing one now, which charges nothing; decide each
     past_due one before Stripe's next retry charges it; honour or refund
     each active one;
   - honour or refund every paid session whose `product_type` is
     `agent_pass` or `apply_assistant`;
   - expire any checkout session still open for the three products (a
     session lives 24 hours, and paying one still grants);
   - there is no dashboard Price to archive, because all three bill inline
     `price_data`; archive only a Product the catalogue lists under those
     names.
5. **Add to Claude** (spec owner actions 1-3): check on signed-in Claude
   accounts that the install link opens prefilled and that "Sign in when
   needed" connects and searches. Then set `MCP_ADD_TO_CLAUDE_LIVE = true` in
   `src/config/mcp-tools.ts` and publish the frontend.
6. **Counsel:** review the Privacy page's MCP section
   (`src/config/mcp-privacy.ts`; the body is English only, like the rest of
   the policy) and the old apply-agent sentences in `src/pages/Privacy.tsx`
   (Account Content still says the agent sends the CV to employers), then
   bump `PRIVACY_LAST_UPDATED`. The Terms clause that replaces the bots ban is
   owner action 9.
7. **After wave 4 verifies:** record `verifiedDeploys`; release
   20261011103000 (empty its hold, send the second message); set
   `MCP_SEARCH_PRUNE_LIVE = true` in `src/config/mcp-privacy.ts`; publish the
   frontend with the changelog in nine locales, each entry checked against
   production; thaw main only when section 49 shows no gap.

## Before this branch merges

The S12 sweep fixes and the SEO fix round run on this branch, before it
merges to main.

## Shared files

`node scripts/deploy-ledger.mjs --overlap origin/wave4/integration
origin/profiles/integration` lists twelve files both change, every one
declared, and no function both change:

- `docs/deploy-ledger.json` and `docs/DEPLOY-LEDGER.md` were already owned by
  wave3. profiles/integration predates main's ledger and conflicts with main
  there whether or not wave 4 merges; wave 4's own entries are its migration
  order rules, its hold, `w4/` in its reservation, the shared hand-off test's
  owner, and the exit 7/8 paragraph.
- `public/llms.txt` and the nine locale files are owned by company-profiles,
  which deploys first (deployOrder 2), so its version is the base.

Wave 4 owns its own keys and lines in those ten files, and re-applies only
those when it rebases:

- the en keys it added or changed (under agentConnect, agentPass, homeAgent,
  homeHero, pricingPage, dataApiPage, faq, agentMatches, atsCoverage,
  jobsPage, privacy and, since the review, `agentConnect.selfApplyChatgpt`
  and the Trust page's `trustPage.security.neverSold.description` and
  `trustPage.retention.rows.agent.howLong`), the same in every locale;
- the llms.txt lines on connecting, applying yourself, paid tools and the
  Builder API.

The local `design/*` branches are built on profiles (design/integration
contains its tip) and deploy after it as a frontend publish. Against
`origin/design/integration`, `--overlap` lists the same declared files plus
`src/test/the-board-hands-a-job-and-a-search-to-the-agent.test.tsx`, which
both change (design the header-link assertions, wave 4 the hand-off
assertions; `git merge-file` merges them cleanly). It is now declared,
owned by company-profiles, and wave 4 re-applies its hunks on rebase.

## Left for other owners (files wave 4 may not touch)

Rewritten at the recheck of the merge (2026-10-25). The `/jobs` apply-agent
pitch and the bake's $99 plan and $29 pass that this list used to carry are
gone: main's profiles, design and SEO rounds removed them. The recheck
removed the /pricing bake's list sentences and bundle line, the fit-is-paid
copy and the footer link. None of what remains sells a product.

- **`scripts/prerender-seo.mjs`** (seo-round): the bake and llms-full's MCP
  line read `MCP_ANON_CAPS.perAddressPerDay`, `hostPoolPerDay` and
  `globalPerDay`, the keyless tier's old names. The mirror keeps those three
  with the nearest true figure (100, 10,000, 20,000) until the bake moves to
  `otherPerConnection`, `shares.claude` and `overallPerDay`. Then delete them
  (the first-call guard pins them).
- **`src/pages/Jobs.tsx`** (profiles and design) still carries the old
  English fallback for `jobsPage.excludedTerms` ("Hiding results that
  mention ..."). It renders only when the key is missing, and all nine
  locales hold the true sentence. Whoever next edits that line should copy
  en.json's.
- **`public/sitemap.xml`** still lists `/guides/how-the-apply-agent-works`.
  The guide at that address says the agent is switched off, so the entry can
  stay. Drop it only if the owner wants the page out of the index.
- **The company lander's "Ask your AI" block** (spec P1, profiles).
- **Section 83 on main** (profiles+design): main's copy of C7 still reads
  the changelog's quote of the old hero sentence and FAILs. This branch's
  copy cuts the changelog first (see "The recheck of the merge").

## Deferred, with the reason

- **"City, ST" sent as the city alone** when 90% or more of that city's
  postings sit in one state needs per-city state shares, which come from live
  data. The fallback ships: job-board searches the city in that state under
  three spellings.
- **The Claude sub-share** for other Anthropic-range traffic (1,000 a day at
  10 a minute) waits on seven days of the user-agent logging that now ships.
- **The Origin allow-list and malformed-version 400** are spec D4, after
  seven days of logs.
- **The "200 per ChatGPT person" seeker copy** (`homeAgent.connectLine2`
  edition A or B) waits on a week of logs of how many OpenAI-range calls
  carry `openai/subject`. The developer disclosure on /agents states the rule
  as the server applies it.
- **Pro's model-backed tools** come after sign-in, which stays off in this
  wave. Nothing built here blocks them.
- **`employer_profile`** depends on the unmerged profiles branch (R7).
- **The job-board graph's size.** It is 29,898 bytes over main, over the
  spec's 20 KB budget, and about 20 KB under the conservative 4.5 MB line
  (docs/job-board-deploy-notes.md, `.93`). The next job-board change moves
  index.ts comments into docs/job-board-index-notes.md before it adds code.

## Checks run on this branch

After the review fixes, at `83f28eac` (2026-10-12):

- `npm run typecheck`: clean (it also runs on every commit).
- The worker's `tsc --noEmit`: clean.
- `bash scripts/check-functions.sh`: every edge function typechecks, and the
  Deno tests beside them pass (`supabase/functions/deno.lock` restored
  afterwards).
- The full vitest suite, once (16:56Z-17:09Z, 777 s, load average 7-11 from
  other workflows): 949 files passed and 1 skipped; 12,099 tests passed and
  23 skipped; no fork failed to start.
- `node scripts/deploy-ledger.mjs --against origin/main --against w4/mcp
  --against w4/api --against w4/jobboard --against w4/retire --against
  w4/frontend --against origin/wave4/integration`: 0 violations (job-board
  `.93` is the one string the wave shares, as its reservation allows).
- `--overlap origin/wave4/integration origin/profiles/integration` and
  `--overlap HEAD origin/design/integration`: exit 0, every shared file
  declared, no shared function.
- `--message` refuses on this branch (exit 5: HEAD is not origin/main, which
  is 6 commits ahead with Lovable's record of wave 3's three migrations);
  `--draft` prints the 14 functions and 8 migrations above, the held
  20261011103000, and no late stamp or live-ahead function.
- Each review fix was proved by restoring the file as reviewed: its new test
  fails there and passes on the fix.

## Second round

The owner asked to "ship fixes for the rest of the bugs". Of the S12 sweep's
188 defects (2026-10-12, register
`~/.config/resumebooster/platform-debug-2026-10-12-s12/register.json`), R1
and the profiles+design round own 38. This round fixes the rest that wave 4
can own, together with the critical-path plan's rounds R2 to R4 (CP-C, CP-D,
CP-E, CP-F, CP-G, CP-H, CP-I, CP-J) and the product cuts. It ships third,
after R1 and after profiles+design.

The owner's decisions of 2026-10-17 replace the earlier ones wherever they
differ:

1. **Pro ($45 a month)** is the writing tools (5 packages a day, 60 a
   month), the $5 Full Analysis included, and no daily cap on scans (never
   "unlimited"). Freelance Boost and Transition Pro are not part of it. One
   list, `supabase/functions/_shared/pro-perks.ts` (`PRO_PERK_ITEMS`,
   `PRO_SUMMARY`, `PRO_INCLUDED_PRODUCT_IDS = ['fullAnalysis']`), is read by
   every page that lists Pro's perks and by the description
   create-subscription-checkout gives Stripe.
2. **Freelance Boost and Transition Pro are removed** like the other cut
   products: off pricing, the free report and Pro; their checkouts answer
   410; `/freelance-boost` says they are no longer sold and is noindex; a past
   buyer's link still generates.
3. **No buy button until the seller is named.** The Full Analysis and Pro
   buttons render only once `src/config/seller.ts` carries the seller's legal
   name and postal address (California B&P 17538(d)); until then the pages
   say purchases open soon, and create-checkout, create-subscription-checkout
   and create-product-checkout refuse with 409 `seller_identity_missing`.
   Both stay on sale otherwise.
4. **India** is refused at checkout with the EU, the EEA and the UK until an
   accountant rules on GST.
5. **Pro needs its own unticked, required renewal box** (California ARL as
   amended by AB 2863); create-subscription-checkout refuses without it and
   records the wording version, the Terms version and the time.
6. **The territory refusal names the check that placed the buyer there**
   (currency, time zone or IP lookup), never "billing address".

Decisions not reopened: no refunds (disputes still revoke entitlements); the
writing tools gated by account on the server (signed out 401
`sign_in_required`; free 1 of each a day on Flash; Pro 5 packages a day and
60 a month on the quality chain; 429 `daily_limit`/`monthly_limit` with
`resetsAt`); saved searches, alerts and the tracker free; affiliates a flat
$10 on a referred customer's first paid Pro month; marketing mail paused
until the seller is named (`paused_no_seller_identity`); our own analytics
only after consent; the server-side Apply Agent, the $29 pass and the $7 Apply
Assistant retired; critical-path D8 (no signed-out Pro lookup by a typed
address), D9 (payment records only are kept) and D14 (no shortlist
demographics, an uploader's attestation).

### The cuts

Stopped selling now (code deletion waits for the simplify wave): the Premium
Package, ATS Defense, Career Snapshot, Graduate Game Plan, Career Path (paid
and free), Keyword Fix, Cover Letter and Interview Coach as one-offs, Scan
Packs, Freelance Boost, Transition Pro, and the free report extras (Resume
Roast, Recruiter View, Elevator Pitch, AI Summary, LinkedIn insights and
scrape-linkedin). Each is hidden everywhere it was offered; its checkout
answers 410 retired with a sentence in the buyer's language
(`_shared/product-cuts.ts`); scrape-linkedin answers 410. Past buyers keep
what they bought for 90 days; Career Path pages keep regenerating for past
buyers only. Kept: the free tier, the $5 Full Analysis (the only one-off),
Pro, and the Builder API card. Bugs inside a cut product's generator are
fixed only where a past buyer still receives them; the rest are marked
removed-by-cut below.

### What it fixes, by group

The builders' branches, merged `--no-ff` onto `w4b/base` (wave4/integration
plus r1/integration), then r1/integration again:

| branch | head | stamp N |
|---|---|---|
| `w4b/base` | `04fa6a71` | none |
| `w4b/payments-delivery` | `385ef655` | 22 |
| `w4b/checkout-catalogue` | `db74b6c8` | 23 |
| `w4b/generators` | `49c35d81` | 24 |
| `w4b/account-compliance` | `e544d664` | 25 |
| `w4b/job-board` | `93babe55` | 26 (job-board stays `2026-09-09.93`) |
| `w4b/agents-api` | `06e52ab2` | 27 |
| `w4b/ops-email-tests` | `19747444` | 28 |
| integration | this branch | 29 |

The first pass merged earlier heads of five builders (17-18 October); the
second took their final heads. Conflicts, each kept with both intents:
generators (free-keyword-scan: payments-delivery's credit change and
generators' scanner changes under one later build; the wave-four section
test's regex); account-compliance (get-account-data, stripe-webhook and
shortlist-evaluate under integration builds; the sign-in copy guard drops
both KNOWN lines the two groups fixed; the pass-buyer test takes
account-compliance's card; the model-call census keeps both auth headers);
job-board (the wave-four section test's comment); r1/integration again (the
ledger's shared-files note, use-pro-subscription's two imports, AgentPass
stays wave 4's retirement page, the payment-pages prefill test); then
checkout-catalogue's final head (FreelanceBoost.tsx keeps R1's stashed
session id and drops the buy flow; the slow-check Go Pro test ticks the new
renewal box; deno.lock stays the base's) and account-compliance's final head
(get-account-data keeps the integration build `.2026-10-14.29`).

- **payments-delivery**: S12-054, S12-061, S12-079, S12-100, S12-103,
  S12-104, S12-114, S12-154 (server half; R1 did the browser half), S12-169;
  CP-C items 1-4 and 7-10 (CP-019 the delivery lease, CP-021 made-but-unmailed
  orders, CP-030/CP-031 mail the saved copy, CP-032 a dead end is spent and
  asked for, CP-029 async payments, CP-027 owner alerts from our domain,
  CP-033 test mode recognised and left out of health, CP-036); CP-I mail-watch
  (rules R1-R9, the dead-man pair's mail half) and the money-path E2E
  (`src/test/e2e/money-path`, run with `npx vitest run -c
  vitest.e2e.config.ts`); the affiliate amount a checkout names; Success.tsx
  claims no mail to someone holding a share link.
- **checkout-catalogue**: S12-008, S12-024, S12-044, S12-045, S12-059,
  S12-067, S12-070, S12-076, S12-098, S12-099, S12-108, S12-134, S12-139,
  S12-168, S12-170; CP-022 and CP-012 (a checkout names its buyer, the
  verified address wins), D7/CP-025 (Pro grants capped, never a Stripe url on
  a failed grant), D8, S9-001/CP-D (a connected app's token never buys or
  opens billing), CP-033 in part (create-test-checkout 410); the owner's
  items 1 to 6 above; the affiliate re-base.
- **generators**: the account gating of the writing tools; S12-003, S12-006,
  S12-009, S12-026 (kept tools), S12-029 (kept interview prep), S12-030,
  S12-039, S12-047, S12-051, S12-055, S12-062, S12-066, S12-068, S12-071,
  S12-105, S12-107, S12-111, S12-112, S12-136, S12-140, S12-141, S12-142 (code
  half), S12-143, S12-144, S12-145, S12-146, S12-147, S12-148, S12-152;
  CP-018 for past Premium buyers; CP-030's generator half; the free report's
  share of the cuts.
- **account-compliance**: S12-002, S12-010, S12-011, S12-025 (account half),
  S12-049, S12-053, S12-060, S12-097, S12-102, S12-115, S12-137, S12-151,
  S12-153, S12-155, S12-171 (console half); CP-005/CP-047, CP-007/CP-012,
  CP-016, CP-022/CP-050, CP-038/CP-039/CP-041, CP-048/D9, CP-049, CP-H
  (connected AIs, email preferences, how and when the address was proven,
  the writing allowance's refusals), CP-G (the en-GB trader name), CP-J (the
  account functions take a website session only), D14.
- **job-board**: S12-013, S12-014 (board, MCP and /v1 routing), S12-015,
  S12-018, S12-020 (S12-017 and S12-019 left in the descope of 2026-10-25),
  S12-027, S12-028, S12-035, S12-036,
  S12-037, S12-038, S12-083, S12-084, S12-122, S12-123, S12-124, S12-125 (no
  change needed, pinned), S12-126, S12-128, S12-172.
- **agents-api**: S12-040, S12-041, S12-080, S12-081, S12-082, S12-085,
  S12-121, S12-173, S12-174, S12-175, S12-176.
- **ops-email-tests**: S12-032, S12-046, S12-065, S12-069, S12-138, S12-157,
  S12-158, S12-159, S12-160, S12-161, S12-162, S12-163, S12-164, S12-165,
  S12-166, S12-167; CP-052's heartbeat half.
- **integration** (the builders' handoffs to each other and to the
  integrator, applied here because every builder had finished):
  - no button that prices the Full Analysis until the seller is named: the
    free report's offer, the uploader's $5 link and fallback button, and the
    homepage comparison's call to action (owner decision 3);
  - the free report's platform-profile note sells no Freelance Boost and its
    Pro row reads `PRO_SUMMARY`; both scanners' daily refusals say Pro has no
    daily cap on scans instead of promising unlimited scans (owner decisions
    1 and 2);
  - mail-watch's R9 reads `cron_http_answers` and judges refusals and
    repeated 5xx only, so it no longer rings on every run's pg_net timeouts;
  - the heartbeat reads the apply worker's state only while the agent is
    switched on (S12-171's second half: no "worker offline" mail every six
    hours for a retired agent);
  - a Full Analysis session records the page's language, so its purchase
    mail is written in it (S12-114 for the one one-off still sold);
  - agent-mcp refuses a place typed after "not" as job-board does (S12-172
    parity);
  - stripe-webhook and verify-product-purchase compute the affiliate
    commission with one rule, `commissionCentsFor`;
  - the money path runs create-product-checkout and proves a cut product's
    checkout takes no money (CP-I scenarios 2 and 6, corrected, as 2c);
  - the FAQ names the trader through `TRADING_NAME` and its ChatGPT answer
    promises no LinkedIn analysis and no untested training claim (CP-G,
    S12-049);
  - section 92 asks for the integration builds of the functions two groups
    changed;
  - the translation pass (349 keys in nine locales) and the job-board trim
    below.

**Removed by cut** (not fixed, by decision): CP-C item 6 K2 (no product made
from the résumé is still sold; such an order is spent and the buyer asked);
CP-024 for Interview Coach and Career Path; CP-C item 5 and CP-018's delivery
half (only the Premium Package's figure check produced a retryable 422);
CP-C item 7 K4 / CP-028 (scan packs); CP-I scenarios 2, 6 and 10 as written
(2c replaces 2 and 6); S12-026's cut part (Resume Roast, Summary, Elevator
Pitch, Recruiter View); S12-029's cut part (`src/lib/pdf-export.ts` serves
only Career Snapshot and Graduate Game Plan); CP-020; CP-042; the Freelance
generators' bugs beyond what a past buyer receives.

**Not built, with the reason**: CP-C item 7 K3 (refunds are never automatic;
the territory is refused at checkout instead); CP-023 (a résumé copy per
session needs the delivery side to read and delete it); CP-033's admin test
mode on the real checkouts (needs the webhook's test secret first); CP-026
(Stripe's receipt setting, an owner step); CP-040 (no change needed: the
relay prints sealed sentences only); CP-046 `/billing` (dropped by the plan;
`STRIPE_PORTAL_LOGIN_URL` is an owner step); a second "address you buy with"
(R1's proof row is keyed to the account's current address); email
preferences for the digests and the fix-plan drip (the card shows the market
pulse and says where the others are switched); S12-014's layoff-mirror part
(the mirror's matching is strict on purpose); S12-009's other option
(analyze-resume still does not receive the free report's fixes; the copy was
reworded instead); leaving test-mode rows out of revenue readers (no revenue
reader is in wave 4's files).

### Gating and the money rules, as built

- **Purchases** open only when both `src/config/seller.ts` and
  `supabase/functions/_shared/seller-identity.ts` carry the legal name and
  postal address (a test holds the two equal). Until then: no Full Analysis
  or Pro button anywhere, the checkouts answer 409, and `GET create-checkout`
  reports `purchasesOpen: false`.
- **Territory**: while `EU_UK_SALES` is off, create-checkout and
  create-subscription-checkout answer 451 to a buyer placed in the EU-27, the
  EEA, the UK or India by currency, time zone, the cf-ipcountry header or an
  ipinfo lookup, and say which.
- **Pro**: grants capped at 10 a day and 60 a month (trigger in
  20261011150000); the renewal consent recorded in `pro_auto_renew_consents`
  (20261011151000) or the session is expired and the answer is 503; a trial
  writes on the free allowance until its first paid invoice.
- **Writing tools**: counted per account in `writing_tool_uses`
  (20261011160000); a failed call gives its use back.
- **Marketing mail** skips and logs `paused_no_seller_identity`; fix-plan
  mails queued before the pause are archived (20261011172000). Transactional
  mail continues.

### New migrations, in order

All in wave 4's range, each safe twice and ending with a self-check, every
new table revoked from PUBLIC, anon and authenticated, every definer with a
fixed search_path and service_role only (one stays anon-callable on purpose:
`get_scan_health_status`, aggregates only, read by ScanMetrics and the smoke
script with the publishable key). The ledger applies all of them before the
functions:

1. `20261011140000` a closed paid order stays closed
2. `20261011141000` a claimed credit purchase is spent only by the account that claimed it (before scan-credits, free-keyword-scan, get-account-data)
3. `20261011142000` the mail-watch cron, every 15 minutes
4. `20261011143000` the sweep picks up made-but-unmailed orders (before retry-failed-deliveries)
5. `20261011143500` product_delivery_health counts unmailed orders as stuck, leaves test mode out
6. `20261011144000` the delivery lease (before stripe-webhook, verify-product-purchase, retry-failed-deliveries)
7. `20261011150000` the Pro grant cap, checkout_buyers, cancel_at_period_end (before the checkouts and check-subscription)
8. `20261011151000` pro_auto_renew_consents (before create-subscription-checkout, or every Pro checkout answers 503)
9. `20261011160000` writing_tool_uses and its two definers (before the writing tools)
10. `20261011170000` account_erase_personal_data and account_mailbox_proven (before delete-account, get-account-data)
11. `20261011171000` shortlist records no candidate sex or race
12. `20261011172000` fix-plan mails queued before the pause are archived
13. `20261011200000` cron_http_answers and the visitors-only scan health reader (before scan-heartbeat, mail-watch, check-alerts)
14. `20261011210000` a deleted account takes the documents made for it and its Pro grants (the fixes; replaces account_erase_personal_data, same signature, so no function waits on it)
15. `20261011211000` an affiliate is paid once per customer and never for themselves, and a refunded or disputed payment takes the commission back (the fixes; replaces record_affiliate_conversion, same single signature, plus a trigger on payment_revocations)
16. `20261011212000` a deleted account takes its Full Analysis (resume_analyses, through each purchased_content pointer), not only the pointer (the recheck; replaces account_erase_personal_data again, same signature, so no function waits on it)
17. `20261011213000` career_path_past_buyers, a confirmed past Career Path buyer remembered until their 90 days end (the recheck; before generate-career-path 2026-10-11.31, which reads it best-effort: without it a buyer is asked about again behind the buckets, as before)

Round 1's six (20261011100000 to 20261011130000) come first, as in "Deploy"
above; R1's two (20261014100000, 20261014110000) are on main already once
main is merged. `20261011103000` stays held.

### Functions and their builds

69 functions deploy (`node scripts/deploy-ledger.mjs --draft`; every one
answers its build in `x-fn-build`). The ones round 2 changed:

- **.2026-10-11.22** retry-failed-deliveries, send-product-email,
  reconcile-stripe; **.2026-10-14.22** scan-credits.
- **.2026-10-11.23** create-product-checkout, create-subscription-checkout,
  create-scan-pack-checkout, create-test-checkout, check-subscription;
  **.2026-10-14.23** create-portal-session.
- **.2026-10-11.24** generate-cover-letter, generate-tailored-resume,
  generate-interview-coach, generate-freelance-boost, generate-premium-package
  (and -stream), generate-ats-defense, generate-career-path,
  generate-cover-letter-stream, scrape-linkedin, and the spend gate's
  importers (analyze-linkedin-profile, application-fit,
  generate-career-snapshot, generate-elevator-pitch, generate-graduate-gameplan,
  generate-keyword-fix, generate-product-preview, generate-recruiter-view,
  generate-resume-roast, generate-summary, import-freelance-profile, job-fit,
  nl-search, parse-resume-structured, test-ai-fallback).
- **.2026-10-11.25** send-agent-digest, send-market-pulse, send-scan-report,
  send-search-digest, withdraw-subscription; **.2026-10-14.25** delete-account,
  account-order (new), account-settings (new).
- **.2026-10-11.26** parse-pdf, parse-docx, fetch-job-posting; job-board
  stays **2026-09-09.93**.
- **.2026-10-11.27** public-api, apply-agent (switched off; restamped for its
  bundled classifier).
- **.2026-10-11.28** check-alerts.
- **.2026-10-11.29** (the integration build, where two groups' changes or the
  integration's own meet in one bundle): stripe-webhook, shortlist-evaluate,
  generate-application-answers, generate-apply-package, create-checkout,
  free-keyword-scan-stream, mail-watch (new), scan-heartbeat, agent-mcp;
  **.2026-10-14.29** free-keyword-scan, get-account-data,
  verify-product-purchase.
- **.2026-10-11.30** (the fixes after the review, below): generate-career-path,
  generate-application-answers, generate-apply-package,
  free-keyword-scan-stream, stripe-webhook, check-subscription, agent-mcp,
  public-api, apply-agent (switched off; its bundled classifier), scan-heartbeat;
  **.2026-10-14.30** get-account-data, free-keyword-scan, account-order.
  job-board stays `2026-09-09.93` and carries the board fixes.
- **.2026-10-11.31** (the fixes after the recheck, below):
  generate-career-path, and the five that bundle the widened classifier:
  agent-mcp, public-api, generate-application-answers,
  generate-apply-package, apply-agent (switched off). job-board stays
  `2026-09-09.93` and carried the negation fixes (they and its salary rule
  left in the descope of 2026-10-25; the exclusion is main's).
- **.2026-10-11.32** (fix round 3, below): the five that bundle round 3's
  question rule: agent-mcp, public-api, generate-application-answers,
  generate-apply-package, apply-agent (switched off). job-board stays
  `2026-09-09.93` and carried round 3's negation rule (it and its salary rule
  left in the descope of 2026-10-25; the exclusion is main's).

`--against origin/main` reports 0 violations. Against each w4b branch the only
"same build string on different code" lines are job-board `.93` (shared by
reservation) and R1's three functions (below, under the owner's steps).
After the fixes, `--against origin/wave4/integration` (the branch before
them) finds 14 functions whose code moved and one violation, job-board `.93`
by reservation: every other one carries a `.30` build. After the recheck's
fixes, `--against` the branch before them (fa66a031) finds 7 functions moved
and one violation, job-board `.93` by reservation; the other six carry `.31`.
After fix round 3, `--against` 9af3c783 finds 6 functions moved and one
violation, job-board `.93` by reservation; the other five carry `.32`.

The job-board upload, tallied the deploy's way (its folder plus all of
_shared, comments included) with the profiles round's two _shared files at
their size on design/integration (72,818 bytes), is 4,443,315 bytes after
the fixes: 56,685 under the 4.5 MB line (4,434,303 and 65,697 before them),
and 4,447,626 after the recheck's fixes: 52,374 under the line, 2,374 inside
the agreed 50,000 of room (the classifier's shared TOPICS moved into
_shared/application-questions.ts and the salary rule grew; their comments
were cut to keep the room). Re-tallied at 2709842c from git's own sizes of
the tracked files (the same folders, plus main's two profiles _shared files,
which are the same 72,818 bytes on main): 4,447,181 bytes, 52,819 under the
line and 2,819 inside the room. It was 4,466,852 (33,148 under) before the
integration moved the long comment runs of four more job-board files into
`docs/job-board-index-notes.md`. After fix round 3, from git's sizes at the
round's integration commit: 4,447,116 bytes, 52,884 under the line and 2,884
inside the room (65 bytes smaller than round 2: the salary module shrank 461
bytes and _shared's question modules 360, search-routing.ts grew 761).

### Verify

One read-only section per group: `scripts/verify-deploy.d/92-w4b-payments-delivery.sh`,
`92-w4b-checkout-catalogue.sh`, `92-w4b-generators.sh`,
`92-w4b-account-compliance.sh`, `92-w4b-job-board.sh`,
`92-w4b-agents-api.sh`, `92-w4b-ops-email-tests.sh`, and for the fixes after
the review `92-w4b-fixer.sh` (every `.30` build, a signed-out cover note
refused 401, and three board behaviours), and for the fixes after the recheck
`92-w4b-fixer2.sh` (six `.31` builds, career_path_past_buyers closed to the
anon key, "warehouse not forklift Dallas" excluding only forklift), and for
fix rounds 3 and 4 `92-w4b-fixer3.sh` (the five question builds at `.33` or
later, and, since the descope, eight negations that must answer as main's
rule does; its salary re-sweep lines left in the descope). `verify-deploy.sh` runs
them with the rest, behind section 0's positive control and the tally that
fails a section which prints no verdict. Expected FAILs while the seller is
unnamed: section 92 account-compliance FAILs the three marketing senders on
purpose, and checkout-catalogue reports `purchasesOpen` false as a PASS plus
an owner step. From agent-mcp 2026-10-11.27 on, the owner's count on the
ChatGPT nonce is 0 in both section 86 and section 92, and from the fixes on
section 92 agents-api spends one more keyless search, a plain one with its
own nonce, whose count must be 1: the positive control for that 0.

### Deploy order

1. R1 (deployed 2026-10-17). Its verified deploy is recorded on main (PR #37,
   `verifiedDeploys` 9c991052, with 20261014100000 in
   `appliedOutsideDrizzle`). This branch does not have it until main is
   merged, so its ledger still reports MUST BUMP for auth-email-hook,
   auth-signed-in and process-email-queue, R1's functions; the merge clears
   it.
2. Company profiles 0-2 and the design upgrade (PR #36, design/integration).
3. Then this branch: merge origin/main into it first (done 2026-10-25:
   `9a47faf6` merges main 899be058; "Merged main 899be058" under the Descope
   section lists each conflict and its resolution). Expect conflicts in
   the nine locale files, `public/llms.txt`, `src/components/AtsCoverage.tsx`,
   `src/data/guides.ts`, `src/pages/Index.tsx`, `src/pages/Pricing.tsx`,
   `docs/deploy-ledger.json` and six tests (git merge-tree, 2026-10-18),
   and since main's d823aae4 (2026-10-18) also `src/components/HomeHero.tsx`
   (git merge-tree, 2026-10-24, the same six tests). d823aae4 cut the hero's
   and the strip's "never submits" sentence, in nine locales and in
   `a-pass-number-on-a-page-is-a-placeholder.test.tsx`, only while the
   server-side agent was live; this branch retires it, so the merge may keep
   wave 4's sentence and that test's wave 4 side. Apart from HomeHero,
   company-profiles owns them; wave 4 keeps the other side and re-applies its
   own hunks and its 374 locale keys (349 from the integration and 25 from
   the fixes, adding only; the fixes also remove accountPrivacy.deletedList
   and agentPass.retiredBuyers, which nothing renders). Main has the
   `ledger/r1-verified` change (PR #37): keep its 20261014100000 in
   `appliedOutsideDrizzle` and its `verifiedDeploys` entry, and do not
   restore 20261008125000 or 20261008128000 there (this branch proves them
   by behaviour). Since the second recheck of the descope, two more merge
   steps: llms.txt's fourth hunk and SEO's /affiliates bake, which must read
   `affiliates.proCommission` and `AFFILIATE_PRO_FIRST_MONTH_CENTS` (see
   "Merging main" under the Descope section; the bake re-export test fails
   until it does). Re-run the gate,
   then generate the message at the merge commit on main with `node
   scripts/deploy-ledger.mjs --message`: migrations, then the functions, then
   the frontend publish.

### Owner steps

Before purchases can open:

- Put the seller's legal name and postal address in both
  `src/config/seller.ts` and `supabase/functions/_shared/seller-identity.ts`
  (never a placeholder), then publish the frontend and redeploy
  create-checkout, create-subscription-checkout and create-product-checkout.
  Marketing mail resumes at the same time.
- Optionally rehearse the webhook in Stripe test mode (set
  `STRIPE_TEST_SECRET_KEY` and `STRIPE_TEST_WEBHOOK_SECRET` from a test-mode
  endpoint and send a test checkout.session.completed for a Full Analysis).
  This proves only the webhook's claim, delivery row and link mail: the site's
  own checkout (create-checkout) and the success page's delivery
  (analyze-resume) use the live key only, so a test purchase cannot be
  carried to an analysis, and a test event touches no plan, dispute or
  affiliate. The first real proof of a purchase is one live Full Analysis.
- Get an accountant's ruling on India's GST and register for EU/UK VAT.
  Turning `EU_UK_SALES` on lifts the EU/EEA/UK refusal; India also needs IN,
  INR and Asia/Kolkata removed from `_shared/sales-territory-zones.ts`.

In Stripe:

- Cancel every trialing Agent subscription, decide on past_due ones, honour
  the active ones (S12-079).
- Expire every open checkout session for the Agent Pass, the Agent plan, the
  Apply Assistant and every cut product (Premium, ATS Defense, Career
  Snapshot, Graduate Game Plan, Career Path, Keyword Fix, Cover Letter,
  Interview Coach, scan packs, Freelance Boost, Transition Pro), and archive
  the cut products' Prices (IDs in section 92).
- Subscribe the webhook endpoint to `checkout.session.async_payment_succeeded`
  and `checkout.session.async_payment_failed`, and say whether delayed
  payment methods are on (CP-029).
- Turn on "Successful payments" customer emails (receipts, CP-026).
- If Radar custom rules are available, block `:card_country:` and
  `:ip_country:` for the EU-27, IS, LI, NO, GB and IN as a backstop.
- Count live Pro subscriptions; any that exist were promised every paid tool
  and Freelance Boost: email them the new perk list with a cancel link.
- Honour each open Apply Assistant order by hand with generate-apply-package;
  answer needs_input replies by delivering by hand. No refunds.

Secrets and settings:

- `CANARY_EMAIL` (a mailbox you read, with an account) and `HC_PING_URL` (a
  healthchecks.io check, 15-minute period) for mail-watch; a second,
  separate check for the heartbeat in `HC_HEARTBEAT_PING_URL` (10-minute
  period, 20-minute grace); the GitHub secret `BOARD_HEALTH_PING_URL` (30
  minutes, 60 grace). Never one check for two senders.
- Confirm the vault holds `email_cron_key` and
  `email_queue_service_role_key`, so the mail-watch cron posts.
- Optional: `MCP_BUCKET_SECRET` (changing it later rotates every keyless
  bucket); `SYNTHETIC_SCAN_SECRET` (and export it when running the load and
  smoke scripts).
- After section 92 shows scrape-linkedin answering 410, delete the
  `FIRECRAWL_API_KEY` secret.
- Lovable Cloud auth: switch on Confirm email and Secure email change (and
  Secure password change and a password-changed notification, if offered).
  "Change sign-in address" shows only once `mailer_autoconfirm` is false.
- Turn off Lovable's own analytics (`/~flock.js`), which our consent banner
  does not gate.
- Enable Stripe's customer-portal login link and set
  `STRIPE_PORTAL_LOGIN_URL` (CP-046).
- Optional and irreversible: `DELETE FROM public.shortlist_demographics`.

After the deploy:

- Run `scripts/verify-deploy.sh`. Then the reads section 92 prints as INFO:
  `pg_trigger` has `product_delivery_stays_closed` enabled;
  `product_delivery_health`'s definition contains `email_failed`;
  `has_table_privilege('authenticated','public.shortlist_demographics','INSERT')`
  is false; `select count(*) from pgmq.q_transactional_emails where
  message->>'label'='fix-plan-drip'` is 0; the ChatGPT nonces of sections 86
  and 92 count 0 in `job_board_search_events` and `job_board_search_misses`,
  and section 92's plain nonce counts 1 (the positive control; a 0 there
  means connector searches are not logged and the 0s prove nothing); the
  fixer section's two reads: `affiliate_commission_revoked` in `pg_trigger`
  and `account_erase_personal_data`'s source naming `purchased_content`; and
  fixer2's two: that source naming `public.resume_analyses`, and
  `career_path_past_buyers` with row level security on.
- Optional proof: pause `scan-heartbeat-sentinel` for 30 minutes once and
  confirm the healthchecks.io check mails you.
- Watch the INFO lines for the experience and country re-derivations
  (EXPERIENCE_VERSION 2, COUNTRY_MAP_VERSION 10). SALARY_PARSE_VERSION stays at
  main's 10 after the descope, so no salary re-sweep runs.
- Record the deploy with `--record-deploy` from main once verify passes;
  release `20261011103000` only when the ledger prints RELEASABLE.
- Changelog entries in nine locales, each checked live, in the next frontend
  publish.

### Left for other owners

- **profiles+design** (owns `src/pages/Jobs.tsx`, `Footer.tsx`,
  `scripts/prerender-*.mjs`, `public/sitemap.xml`, `public/llms*.txt`,
  `src/index.css`, the locale files):
  - Jobs.tsx: on 401 `sign_in_required` from generate-tailored-resume,
    generate-cover-letter or generate-interview-coach, a sign-in prompt that
    returns to /jobs; on 429 `daily_limit`/`monthly_limit`, the server's
    message or the reset time from `resetsAt` (ApplicationAnswers.tsx does
    this already and can be copied).
  - Footer.tsx: remove the Freelance Boost link; switch `footer.copyright`
    (en-GB renders "© {{year}} CV Booster") to a new key
    `footer.copyrightNamed` = "© {{year}} {{name}}. All rights reserved." with
    `name = TRADING_NAME`.
  - prerender-seo.mjs: `/freelance-boost` noindex, titled "Freelance Boost is
    no longer sold", body saying both tiers are no longer sold, not part of
    Pro, and a past buyer's link works 90 days; drop it from the sitemap
    list. `/pricing`: the one-time list is the $5 Full Analysis only (fix the
    "$5–$5" description), the Pro line from `PRO_SUMMARY` (not "Unlimited
    scans and every paid tool included"), no Apply Agent plan or pass, and
    "purchases open soon" while `purchasesOpen()` is false. The FAQ JSON-LD
    should read the reworded keys (`faq.questions.vsChatGPTTrue.*`,
    `howLongBound`, `subscriptionLineFa`).
  - `public/sitemap.xml`: remove `/freelance-boost`.
  - `public/llms.txt` lines 7 and 52: remove Freelance Boost ($29) and
    "all-access subscription (Pro)"; Pro is the writing tools, the $5 Full
    Analysis included and no daily cap on scans.
  - `src/index.css`: self-host the Google Fonts import (S12-011, CP-039).
  - Optional (S12-020 precision): `src/lib/invoke-job-board.ts` could send
    `tzOffset: new Date().getTimezoneOffset()` on list and facets calls; left
    out because a per-zone body would split the board's response cache.
- **R1** (auth-email-hook, process-email-queue): render GoTrue's
  `password_changed_notification` as a notice with no link to the account's
  address, like EmailChangeNoticeEmail (CP-007); optionally refuse purpose
  "marketing" payloads in process-email-queue while the seller identity is
  empty, as a second guard behind 20261011172000. (R1's verified deploy is
  recorded on main already, PR #37.)
- **ops-email-tests, next round**: scan-heartbeat still counts
  `content_generated` as delivered and its named-order mail lists neither
  `email_failed` nor made-but-unmailed orders (CP-021; the verdict is right,
  because product_delivery_health counts them stuck, and mail-watch R2/R8
  alarm on them); owner alerts from scan-heartbeat, check-alerts and
  check-error-spikes still come from `onboarding@resend.dev`/`alerts@resend.dev`
  and stamp before reading Resend's answer (CP-027); the S12-142 absolute
  ceiling alarm (count `scan_metrics` rows with `metadata->>'ceilingRefused'`
  each hour); and no cron migration sets pg_net's `timeout_milliseconds`.
- **payments-delivery, next round**: CP-023 (a résumé copy per session, read
  and deleted on delivery or after 48 h); CP-033's admin test mode; the
  success page's "Save this to your account" card shows only the masked
  address and asks for a code to the paid-with address (CP-F); revenue
  readers leave `metadata.livemode = false` rows out.
- **generators, next round**: InterviewCoach takes `initialData` from
  recover-purchase and generates only when nothing is saved, for past buyers
  (CP-024, CP-F half); `_shared/pro-standing.ts`'s comment still says
  "unlimited scans" (changing it changes many bundles, so it waits for a
  round that restamps them).
- **A later job-board round**: the layoff-filings alias table (S12-014's
  mirror part), regenerated in both byte-identical copies.

The translation pass added every builder's new keys and the integration's
own (349, all listed in the translation commit). 146 keys called in source
were already missing from en.json before this round (94 of them in the
switched-off agent's console, the rest under boardHero, receipt, atsCoverage,
accountPage and a few others); they render their English defaults and are
not this round's.

### Checks run on the second round

On the integration branch, 2026-10-18 (load average 7-20 from other workflows):

- `npx tsc --noEmit -p tsconfig.app.json` clean (also on every commit); the
  worker's `tsc --noEmit` clean.
- `bash scripts/check-functions.sh`: every edge function typechecks and the
  Deno tests beside them pass (`deno.lock` restored afterwards).
- The full vitest suite once, run alone (478 s): 1,077 files passed, 1
  skipped, 5 failed (9 tests), all left by the second r1/integration merge
  (the fake database lacked the `.neq` R1's guard now uses; two account tests
  assumed R1's sign-in switches were off; R1's member-checkout test pressed
  the cut Cover Letter; the D8 pin read the hook before R1's single prefill
  read). Fixed, those five files pass (47 tests); the pre-push hook runs the
  whole suite again on the push.
- The money-path E2E (`npx vitest run -c vitest.e2e.config.ts`): 4 files, 23
  tests.
- `node scripts/deploy-ledger.mjs --against origin/main`: 0 violations;
  `--draft`: 69 functions and 21 migrations to apply, the held
  20261011103000, and MUST BUMP only for R1's three functions, which main's
  record of R1's verified deploy (PR #37) clears at the merge.
- `--overlap HEAD origin/design/integration origin/r1/integration`: no
  undeclared overlap, no shared function.
- The job-board upload tally with design/integration's _shared files:
  4,434,303 bytes, 65,697 under the line.
- Every fix the integration made was proved by restoring the code it changed:
  its test fails there and passes on the fix.

### Fixes after the review

A review of this branch confirmed twelve major findings and twenty-three
minor ones. The fixer applied every one on `w4b-fix` (onto
wave4/integration), each with a test that fails on the code before it
(proved by restoring that code once) and passes on the fix. Builds `.30`
above; migrations 14 and 15 above; verifier `92-w4b-fixer.sh`.

Major:

- **A plan is not an order** (get-account-data): Pro and the agent plan left
  the account's orders list, where they showed Receipt (always 404), Email it
  again (always 409) and Open controls that could not work.
- **A price names its currency** (get-account-data, OrdersList,
  stripe-webhook): the currency comes from `checkout_starts`, then the
  delivery row's metadata (the webhook now records `session.currency`), else
  no price; amounts are formatted in Stripe's minor unit (770 JPY is ¥770,
  not $7.70).
- **A made-up session id never spends the Stripe read limit**
  (generate-career-path): a well-formed `cs_live_`/`cs_test_` id only, a
  per-address (10 an hour) and a function-wide (200 an hour) bucket before
  Stripe is asked, and a refused id is not asked about again for ten minutes.
- **A deleted account takes its documents and Pro grants** (20261011210000):
  `purchased_content` for bound sessions and the account's grants, and with
  a proven address the address's; the delete card (new key
  `accountPrivacy.deletedListDocs`) and Privacy section 6 say so.
- **No cover note for a signed-out caller** (generate-application-answers):
  the cover-note mode answers 401 `sign_in_required` unless our own servers
  ask.
- **A business word does not take the pay away** (_shared/salary-extract.ts):
  left in the descope of 2026-10-25. The salary miner is origin/main's and
  S12-019 is its own salary project.
- **A search never waits for the employer list** (job-board): the router
  routes on the live set this isolate built last or the table and rebuilds
  after the response; section 92 job-board asks cvs and UPS up to four times.
- **"not" negates a short phrase** (job-board search-routing): left in the
  descope of 2026-10-25. The exclusion is origin/main's ("not" takes one
  word) and S12-017 is its own search project. The place and the mode after
  a one-word negation stay, as on main.
- **A factual clause is the person's** (_shared/application-questions.ts,
  self-apply.ts, the worker's mirror): start date, pay, references, gaps,
  where the person lives (always) and covenants or conflicts of interest
  (the clause rule) in a later clause of a work-done or motivation question,
  or in a hint, go to the person.
- **No refund is promised** (AgentRetiredNotice, AgentPass, guides): the
  past-buyer line says what was bought is honoured (new key
  `agentPass.retiredBuyersHonour`); a guard reads every locale, guide and
  source default.
- **No guide sells Freelance Boost** (guides.ts): both answers describe the
  method and the free scan; the links are gone; a guard reads every guide.
- **The account asks before it takes this browser's scans, and offers the
  last résumé** (account-history-import, LocalHistoryOffer, Account,
  SaveResumeVersion): nothing is imported until "Add them to my account"; a
  scan one account added is never offered to another; the résumé this tab
  scanned is offered as a résumé version; the signed-out card returns to
  /account.

Minor: the affiliate's flat $10 is earned once per customer and never for
the affiliate's own purchase, and a refund or dispute takes it back
(20261011211000); a paid Pro member can run the included Full Analysis while
purchases are closed (Index, FreeKeywordResults); the test-mode owner step
above says what a rehearsal proves; a test-mode event acts only on a one-off
checkout, with no commission (stripe-webhook); check-subscription tells an
account that is not Pro only `linkPending` for an address's live plan; the
funnel and cohort hooks store nothing before consent and a no forgets them
(src/lib/analytics-session-store.ts); Privacy names ipinfo's checkout lookup
and speaks for our own analytics only; account-order counts receipts (30 an
hour) before Stripe; generate-apply-package and both free scanners read a
website session only (CP-J); live brand keys never claim a country, and a
two-letter or occupation-guard literal never joins an employer's boards; a
browse paged by a keyset cursor past 10,000 is served; "nurse jobs not in
Texas" drops the negated place and names `placeExclusion` in ignoredFilters
(new key `jobsPage.filterName.placeExclusion`, which the page's existing
"We couldn't apply …" line renders); the name-sync cursor carries a retry its
clock never reached; a wish word must belong to the years and "Additional
Qualifications" is not a wish list; withLiveBrands keeps its last set only;
fit_resume names the rule its gate applies; a name two carried employers
share is not listed in unknownCompanies; section 92 agents-api has a positive
control; the co-pilot words an hourly refusal as an hour; scan-heartbeat
fails `scan_ceiling_refused` above ten refused scans an hour (S12-142's
alarm); generate-apply-package fences the posting as data.

New keys, all nine locales: accountPrivacy.deletedListDocs,
agentPass.retiredBuyersHonour, jobsPage.filterName.placeExclusion,
accountPage.localScansOfferTitle, localScansOfferBody, localScansAdd,
localScansNotMine, lastResumeOfferTitle, lastResumeOfferBody, lastResumeSave,
lastResumeNo, lastResumeSaved, lastResumeLabel, lastResumeLabelScored,
localOfferFailed, acBusy, acLimitHours, acLimitMinutes;
saveResume.signedOutTitle, signedOutSearches, signedOutTracker,
signedOutKeeps, signedOutCta; freeResults.nextSteps.fullAnalysisIncluded,
fullAnalysisIncludedCta. Removed (nothing renders them):
accountPrivacy.deletedList, agentPass.retiredBuyers.

Nothing in the fixes needed a file another round owns: the place exclusion
reaches the page through ignoredFilters, which Jobs.tsx already words.

### Fixes after the recheck

A recheck of the fixes (at fa66a031) found four major and four minor
regressions or gaps in them. The fixer fixed every one on `w4b-fix`, each
with a test that fails on fa66a031 (proved by restoring that code once) and
passes on the fix. Builds `.31` above; migrations 16 and 17 above; verifier
`92-w4b-fixer2.sh`. No locale file was edited and no key was added.

Major:

- **A pay label keeps the pay, whatever follows** (_shared/salary-extract.ts,
  job-board .93): left in the descope of 2026-10-25. The salary miner is
  origin/main's and S12-019 is its own salary project.
- **A deleted account takes its Full Analysis** (20261011212000): the
  analysis lives in resume_analyses (it quotes the résumé; its share id
  reads it for 90 days) and purchased_content holds only `{shareId}`; the
  function now deletes the analysis each erased pointer names, then the
  pointers, and answers `analyses_deleted`. The DO block and the pglite test
  probe it, so the delete card's "the documents we made for your purchases
  and Pro inclusions" is true of the one document still sold.
- **A fact in a later clause is the person's, in any words**
  (_shared/application-questions.ts, self-apply.ts, the worker's mirror):
  TOPICS and topicOf moved beside the patterns and into the worker; a later
  sentence naming any topic is its own question, a later clause naming one
  follows the clause rule (so "payroll and wages" and "fixed income" stay the
  work's object), and every clause after a motivation opening is read against
  topicOf; PERSON_ASKS reads able or free to start, the date you can join,
  earliest, notice, what the person made or earned and their earnings, and
  who to contact to confirm. The recheck's ten labels and eleven of ours go
  to the person; eight controls are still drafted.
- **A place after a one-word negation stays in the search** (job-board
  search-routing, .93): true on main too, and since the descope of
  2026-10-25 by main's own rule ("not" takes one word). As built then, the
  phrase stopped before any place knownPlace() recognises, one to three
  words, or any state, metro or country name in any case ("sf", "uk", "us",
  which the place lift takes only in capitals), unless the place began
  inside the phrase ("not new york"): "warehouse not forklift Dallas"
  excluded forklift and searched Dallas, as main did, and "cook not line sf"
  excluded line and kept sf (2709842c, found by the fixer's own probe after
  705452b1).

Minor: the Teal comparison no longer counts Freelance Boost among our
products (it names the career-change bridge and the free account's writing
tools), and a guard reads every competitor string and every src/data string
literal for a cut product; the scroll and time milestones, the optimisation
events' session clock, the funnel's progress and the purchase dedup wait in
the page's memory until a yes and a no forgets them (the homepage, mounted
with no choice, leaves sessionStorage empty; the purchase-email test seeds
its checkout tab with a yes); a résumé saved from the last scan carries the
score of the scan of exactly that text (a whole-text fingerprint in the local
history) and is not offered otherwise, so /account never shows a latest 0;
a past Career Path buyer Stripe confirmed is remembered until their 90 days
end (20261011213000), so strangers who fill the function-wide bucket cannot
lock a genuine buyer out.

`accountPage.lastResumeLabel` is no longer rendered (every saved version now
has a score); the translator may drop it.

The gate after the recheck's fixes, at 2709842c: the frontend typecheck, the
worker's tsc and `scripts/check-functions.sh` (every edge function and the
Deno tests; deno.lock restored) are clean; `deploy-ledger --against
origin/main` finds 0 violations, `--against fa66a031` 7 functions moved and
the one reserved violation (job-board `.93`), and `--overlap HEAD
origin/design/integration origin/r1/integration` no undeclared overlap. All
nine recheck tests fail with fa66a031's code restored (75 of 106 cases) and
pass on the fixes. The full suite runs in the push's pre-push hook; its count
is in the PR #39 body. Main is not merged in this step.

### Fix round 3: corpus-first

Two rounds of fixes and two independent rechecks went around the same three
rules: the salary miner's business figures (S12-019), who answers a question
asked inside a work-done or motivation prompt (S12-081), and how far "not"
reaches in a search (S12-017). Each fix covered the spellings the reviewer
listed and each recheck broke it with new inputs or found a regression. This
round built a labelled corpus for each rule first (real inputs plus every
input of both rechecks, each with its answer and the reason), measured
origin/main (what is live), fa66a031 (round 1) and 9af3c783 (round 2) on it,
and changed the rule until, on the whole corpus, it is never worse than main.
The question rule does not meet that bar; it is reported below as it stands.

Three builders worked on disjoint files: w4b/fix3-salary (744c80f9),
w4b/fix3-questions (751bcdee) and w4b/fix3-search (7416bb6b). All three merged
here without a conflict. The corpora, measurements, tools and self-break
inputs are in `~/.config/resumebooster/wave4-fix3-corpora/<area>/`. The
committed fixtures are under `src/test/fixtures/w4b-fix3-*/`, anonymised, with
no personal data.

**Salary** (`_shared/salary-extract.ts`, job-board `.93`): this round's rule
did not ship. Round 4 replaced it and the descope of 2026-10-25 took both out:
the miner is origin/main's again and S12-019 is its own salary project. The
round's corpus and measurements are in
`~/.config/resumebooster/wave4-fix3-corpora/salary/` and in
`wave4-fix3-results-2026-10-25.json`.

**Questions** (`_shared/application-questions.ts`, `self-apply.ts`, the
worker's `questions/protected.ts`; the five `.32` builds). The corpus has
1,536 rows: 1,092 distinct real labels from 88 employers' public forms
(Greenhouse 65, Lever 15, Recruitee 8), every recheck input (11 and 22), the
round-1 review's 16 labels, the S12 controls the existing tests pin, and 324
generated S12-081 asks under every joiner. Each row is read as a required
textarea through whoAnswers. origin/main has no whoAnswers, so its stand-in is
classifyQuestion === "draftable", the gate main's drafting paths use.

| version | correct / wrong | person questions drafted | draftable sent to the person | worse than main |
|---|---|---|---|---|
| origin/main | 715 / 821 | 817 | 4 | |
| fa66a031 | 1,336 / 200 | 125 | 75 | 74 |
| 9af3c783 | 1,353 / 183 | 108 | 75 | 74 |
| round 3 | 1,472 / 64 | 0 | 64 | 63 |

The rule changes structure instead of adding words: a later clause defaults to
the person. Every joiner splits clauses, including any spaced run of symbols.
A later clause addressed to the person ("you", "your") goes to the person
unless it is about work done or about motivation. A clause about their
circumstances (a modal after "you", or "your current / expected / next")
goes to the person unless it tells work done in the past. A fact anywhere
after the work words is the work's object only when the work took an object
first and nothing after it points at the person. classifyQuestion also refuses
the person asks and fact words unless the label is about work done, and the
worker's isProtectedQuestion matches it on all 1,536 labels.

Not met: on the corpus this rule is worse than main on 63 rows. All 63 are
draftable questions it sends to the person: 62 open work or motivation
questions whose openings the default-deny gate does not recognise ("Tell us
about a time ...", "How do you approach ...", "Why <employer>?"), which every
apply_myself version since e21baaf4 has sent to the person, and one label
whose second sentence is a question. None is a factual ask. Drafting them
would mean widening what the AI may draft from open questions that no word
list can screen, so the safe side stands. At the classifier level (the gate
generate-application-answers and apply-agent use) the rule is worse than main
on 0 rows; it still lets 248 factual rows through there (main 616, 9af3c783
498).

Self-break: four rounds of 50 new inputs, each written after a change. Only
the fourth measured the final rule fresh: 42 / 50, 3 of 31 factual asks
drafted and 5 work questions over-routed (9af3c783 29 / 50 with 21 drafted,
main 22 / 50 with 28). One of the three was a regex defect ("need" read as a
past tense), fixed afterwards. The ones left are past-tense personal facts
("the city you grew up in", "the jobs you applied to recently"), and the
over-routes are present- or future-tense work clauses ("and your sales
methodology", "the CRM you prefer"). Five non-compete rows in
`src/test/fixtures/consent-corpus.json` now expect factual.

**Search** (job-board `search-routing.ts`, `.93`): this round's rule did not
ship. Round 4 replaced it and the descope of 2026-10-25 put origin/main's
exclusion back, whole; S12-017 is its own search project. As measured then,
the corpus had 591 cases (anonymised; every recheck input included):

| version | correct / wrong | worse than main |
|---|---|---|
| origin/main | 458 / 133 | |
| fa66a031 | 258 / 333 | 323 |
| 9af3c783 | 439 / 152 | 137 |
| round 3 | 579 / 12 | 0 |

9af3c783 was worse than main on 137 cases, mostly because it always took a
second word: a city its place list does not know ("San Jose", "New Orleans",
"Jacksonville FL"), a zip code, or a word the person still wants ("nurse not
travel er", "engineer not senior python").

The rule: "not" takes one word, as main always did. It takes two only when the
two words are a pinned compound from a short list (night / weekend / rotating
... shift, box / dump / tow truck, call center, home health, customer service,
data entry, team lead, part time, entry level, per diem, cold calling, long
haul and the like), and it takes a whole place of two or three words that the
board's place list knows ("not new york"). Every other second word is never
taken, capitalised or not. A comma ends the negation, a leading verb is
dropped ("not requiring night shifts"), a quoted phrase is negated whole, and
a trailing full stop no longer stays on the excluded word. Round 2's
place-stop machinery is removed.

Self-break: 50 new inputs. One miss was worse than main in effect: "nurse not
night shift." excluded "night shift." with its full stop, which struck no
title. It was fixed. The final score is 41 / 50 (main 20 / 50, 9af3c783
22 / 50), never worse than main.

Left: 12 corpus cases are still wrong, every one of them wrong on main too:
three-word compounds ("door to door", "12 hour shifts"), compounds left off
the list because their words are often wanted ("car sales", "travel nursing"),
negated cities the place list does not know ("nurse not San Jose"), and "not
Austin, TX". Round 3 is worse than 9af3c783 (not main) on 8 of them. Main's
folding of "part-time" to "parttime" and "travel/agency" to "travelagency" is
unchanged and needs its own fix.

**What the integration added.** The five functions that bundle the question
rule carry `.2026-10-11.32`. job-board keeps its reserved `2026-09-09.93`.
`scripts/verify-deploy.d/92-w4b-fixer3.sh` read round 3 after it deploys
(since the descope it wants main's answers instead):
the five `.32` builds; once the wave 4 board code serves, "nurse not night
shift, TX" excluding night shift, "nurse not travel er" excluding travel and
"warehouse not forklift San Jose" excluding forklift (only round 3 answers all
three). Its salary re-sweep lines left in the descope. The question rule has no live probe: no read-only route
classifies a label we choose, and the one real form found with a label that
rounds 2 and 3 answer differently (Airtable) is not carried. Its test runs the
section against a fake curl, and each regression reads FAIL.

The gate after fix round 3: the frontend typecheck, the worker's tsc and
`scripts/check-functions.sh` (every edge function and the Deno tests;
deno.lock restored) are clean. `deploy-ledger --against origin/main` finds 0
violations. `--against 9af3c783` finds 6 functions moved and the one reserved
violation (job-board `.93`). `--overlap HEAD origin/design/integration
origin/r1/integration` finds no undeclared overlap. The job-board upload is
4,447,116 bytes, 2,884 inside the agreed 50,000 of room. The full suite runs
in the push's pre-push hook; its count is in the PR #39 body. Main is not
merged in this step.

### Fix round 4: recheck 3, corpus-first again

Recheck 3 broke round 3 in all three rules, and found regressions from
origin/main in each: the search folded a one-word exclusion to its singular,
so "not news" struck every "New ..." title and "not parts" every "Part-Time"
one; the salary rule read a pay-transparency template ("the Target Earning
potential is $200,000 to $250,000 annually"), contractor and locum rates and
"+ RSUs" tails as business figures, and its re-sweep wrote NULL over that
stored pay; and the question rule drafted facts in words no list held, facts
in hints and a second ask on a new line, and its classifier refused motivation
questions that named "full-time". This round put every recheck-3 input and
the rechecker's own corpora into each rule's corpus, measured origin/main,
fa66a031 (round 1), 9af3c783 (round 2) and 237bf2e8 (round 3) on it, and
changed the rule until it is never wrong where main is right. On their
corpora the salary and search rules met that bar and the question rule met it
for every question labelled the person's, missing it on the safe side for open
work questions (below). The final recheck then found the salary miner and the
search's plural fold worse than main on fresh inputs, and the question rule
drafting 17 of 24 fresh questions about the person (main's classifier drafts
22). The descope of 2026-10-25 took the salary rule and the plural and hyphen
folds out; the question rule ships with its copy made true.

One builder, w4b-fix (this branch), on the round-3 files. The corpora,
measurements, tools and self-break inputs are in
`~/.config/resumebooster/wave4-fix3-corpora/<area>/round4/` (with the
rechecker's own in `questions-recheck3/` and `salary-recheck3/`). The committed
fixtures are under `src/test/fixtures/w4b-fix3-*/`, anonymised. Each corpus
test fails on the version it replaces.

**Search** (job-board `search-routing.ts`, `.93`): this round's rule did not
ship; the descope of 2026-10-25 put origin/main's exclusion back, whole, and
S12-017 is its own search project (figures under "Descope 2026-10-25"). As
measured then: 1,169 queries, each labelled from its structure before any
version ran: round 3's 591 (its
"part-time" labels corrected to the typed word, since main's "parttime"
strikes no title), the rechecker's 511 and the recheck-3 inputs with the
titles each exclusion must and must not strike. A case is right only when the
split is right and that version's own title match strikes what it should.

| version | correct / wrong | worse than main |
|---|---|---|
| origin/main | 764 / 405 | |
| fa66a031 | 496 / 673 | 568 |
| 9af3c783 | 737 / 432 | 320 |
| 237bf2e8 | 1,017 / 152 | 19 |
| round 4 | 1,161 / 8 | 0 |

The rule: one negated word, as main does, unless the words are a pinned
compound (three-word ones now too: "door to door", "12 hour shifts", "long
term care"), a known place, or a pinned region or city ("south florida", "new
england", "west coast", "long island", "sioux falls", "baton rouge"). "not A
or B" negates both ("or" or "nor"; a capitalised "OR" only in an all-capitals
query, where it is the search operator; a comma or full stop ends the chain). A hyphen
inside an excluded word is kept, and a slash between words lists alternatives
("travel/agency"). This round's title match also folded plurals and treated a
hyphen as an optional break. The descope of 2026-10-25 took the folds out
first and then the whole rule.

Self-break: 50 queries written after the change, then 25 more. All 75 were
right when written (origin/main 22, 237bf2e8 25). They are pinned in
`self-break-round4.json`.

Left: 8 cases, each wrong on main too: compounds left off the list because
their tail word is usually wanted ("car sales", "outside sales", "travel
nursing"), two phrases no list holds ("fast paced", "retail store"), "not
Austin, TX" (a comma place after "not" is never taken whole), and "not with
the agency".

**Salary** (`_shared/salary-extract.ts`, job-board `.93`): this round's rule
did not ship. The final recheck found its miner returning null where main
stores pay ("in high cost of labor markets", "in Investment Banking") and its
v11 re-sweep able to overwrite a stored pay with a benefit, so the descope of
2026-10-25 put the miner back to origin/main's. The 941-case corpus stays in
the repo as a benchmark (see "Descope 2026-10-25"); the round's measurements
and self-break set are in `~/.config/resumebooster/wave4-fix3-corpora/salary/round4/`.

**Questions** (`_shared/application-questions.ts`, `self-apply.ts`, the
worker's `questions/protected.ts`; the five functions build `.33`). 2,385
labels: round 3's 1,536, the rechecker's 643 and 51 follow-up probes, round
3's 200 self-break inputs and the recheck-3 labels, repeats removed, each
labelled twice: by policy (what the rule should do) and by text (what the
words say, where an HR or legal work question in protected words reads as
draftable). whoAnswers reads each as a required textarea; main's stand-in is
classifyQuestion === "draftable".

| version | right (policy) | person rows drafted | draftable rows sent to the person | worse than main (policy / text) |
|---|---|---|---|---|
| origin/main | 1,163 | 1,198 | 24 | |
| fa66a031 | 1,845 | 320 | 220 | 200 / 264 |
| 9af3c783 | 1,873 | 280 | 232 | 212 / 276 |
| 237bf2e8 | 2,060 | 95 | 230 | 234 / 298 |
| round 4 | 2,195 | 0 | 190 | 177 / 241 |

At the classifier (the gate generate-application-answers and apply-agent
use): main 913 of 1,626 right, 237bf2e8 1,254 (worse than main on 40), round
4 1,307 (worse on 0; it lets 303 factual rows through, main 690).

The rule: every later clause, later sentence and hint sentence is
default-deny. It is drafted only when it is visibly work (a verb of work done,
or made of work words) or motivation. "any <noun that is not work>" is an ask.
A fact is the work's object only when a work verb or work noun governs it,
never after "as a", "on a", "without", "while", "since" or "during". A line
break, a colon, a bracket and a second "your" start new parts, and a format
note ("Max 300 words.", "Keep your answer concise.") is not one. Words that
also name a job ("full-time", "eligibility", "visa") count only after the
opening ask and never at the classifier. The worker's mirror is
source-identical and agrees on every label.

Not met, on the safe side: the 177 rows worse than main by policy (241 by the
text labels) are all draftable questions sent to the person. None is a
factual ask. They are open work or motivation questions whose openings or
later clauses the default-deny gate does not recognise, which apply_myself
has sent to the person since e21baaf4.

Self-break: 50 labels written after the change found 9 misses (41 right): five
facts drafted ("... and hobbies", "... and native language", "... and social
media handles", "... as an immigrant yourself", "years of experience while
holding a green card") and four work questions over-routed. After the fix,
49 / 50. The next 25 found 4 (21 right): "... and favorite sports teams"
drafted and three questions main drafts sent to the person ("the PMO tools
you rolled out", "Keep your answer concise.", "Why are you excited ..., and
what you would like to learn?"). Fixing them found "citation tools" read as a
citation, also fixed. After that, 25 / 25. The one left is "running background
checks for new hires", which main also sends to the person. Both sets are
pinned in `self-break-round4.json`.

**What the integration added.** The five question functions carry
`.2026-10-11.33`. job-board keeps its reserved `2026-09-09.93`.
`scripts/verify-deploy.d/92-w4b-fixer3.sh` read round 4: the five `.33`
builds; "nurse not south florida", "nurse not travel or agency" and "barista
not part-time" beside round 3's three negations (since the descope all eight
of its negations want main's answers). Its five stored-salary lines
left in the descope. Its test still runs it against a fake curl and each regression reads
FAIL. To fit the job-board upload, comment runs in abuse-guards.ts,
chain-watchdog.ts, shadow.ts and stale-lane.ts moved into
`docs/job-board-index-notes.md`, with the code unchanged.

The gate after fix round 4: the frontend typecheck, the worker's tsc and
`scripts/check-functions.sh` (every edge function and the Deno tests;
deno.lock restored) are clean. `deploy-ledger --against origin/main` finds 0
violations. `--against 237bf2e8` finds 6 functions moved and the one reserved
violation (job-board `.93`). `--overlap HEAD origin/design/integration
origin/r1/integration` finds no undeclared overlap. The job-board upload is
4,444,874 bytes, 5,126 inside the agreed 50,000 of room. The full suite runs
in the push's pre-push hook; its count is in the PR #39 body. Main is not
merged in this step.
