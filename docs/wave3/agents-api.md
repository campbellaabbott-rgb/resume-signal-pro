# Wave 3: agents-api (branch `wave3/agents-api`, 2026-10-09)

The apply agent stops answering protected questions with model text, reads
sponsorship, countries, yes/no options, required markers and contact fields the
way a person would, and stops sending one user's résumé with another's
applications. A refunded pass packet can no longer be sent free. The paid API
and the MCP connector withhold SmartRecruiters (owner decision 4) and say so
everywhere they are described. The $99 agent card names the four systems the
agent can send on, not seven. Claude and ChatGPT users get the host's own
unkeyed allowance instead of sharing one address's 25 calls.

Verifier: `scripts/verify-deploy.d/73-wave3-agents-api.sh` (one PASS/FAIL/INFO
line per claim; read-only; spends one unkeyed MCP call and, with
`RB_API_KEY`, two calls of the owner's free /v1 key). Run against production
on 2026-10-10 before deploy: every new-build claim FAILs as expected, nothing
crashes, and the claims that hold today (no SmartRecruiters row in an unkeyed
search, `agent_adoption_metrics` closed to anon) PASS.

## Register items (S8 debug sweep, 2026-10-08, `fix_group: agents-api`)

All 18 are fixed. None was already fixed by wave 2 (PR #24): the five marked
`wave2_overlap` (S8-010, 029, 077, 078, 079) were checked against main at
12a37285 and were still open.

| id | sev | what was wrong | fix (commit) |
|---|---|---|---|
| S8-006 | high | the worker answered "without needing/requiring sponsorship" backwards while the review sheet said the opposite | the worker carries the sheet's inversion rule character for character; a cross-runtime test feeds both (1910e552) |
| S8-007 | high | "U.S.", "U.S.A.", "U.K." read as no country; the pronoun "us" read as the United States; one covered country of several counted as covered | initialisms lose their dots first; bare "us" is the country only as the capitalised initialism or in a place phrase; every named country must be covered (ddd72c82) |
| S8-008 | high | criminal history, age, citizenship, pay, medical and other protected questions were `draftable`; the worker filled the model's text into required boxes | `PROTECTED_FACTUAL` / `PROTECTED_DEMOGRAPHIC` in the classifier, mirrored in `worker/src/questions/protected.ts`; the worker refuses a prepared draft for them, so they stop for the candidate; `supported` must be a literal true; invented questions are classified (defc7554) |
| S8-043 | med | "I do not require sponsorship", "I am not authorized", "I do not consent" chosen as the yes | a yes must say yes and not negate itself; two yeses is ambiguous and refused (0fd9d5a6) |
| S8-044 | med | essay questions got the phone, address, LinkedIn, salary or "No" because contact words matched first; "Emergency contact" got the candidate's own phone | contact patterns count only on a field-shaped label; somebody else's contact never; server classifier gated the same way (b20f6269) |
| S8-045 | med | "UK" chose Ukraine, York chose New York, Atlanta chose LA, US chose Australia | city matches only a whole option part; country only through `toCode()`; residence-country questions answer from the identity country (c9e676d5) |
| S8-046 | med | Teamtailor/Personio required markers in labels were ignored, so required questions neither blocked nor were asked | the enumerator reads `*`, `*Required`, `(erforderlich)` and similar before stripping the marker (6f1435ba) |
| S8-047 | med | a drafted answer typed into a radio/select was refused by Playwright and the posting lost for good | drafts fill only text/textarea; a leading yes/no maps through `chooseBoolean`; anything else becomes a pending question (e48f4ddb) |
| S8-048 | med | one learned answer served C#, C++ and C (and .NET/NET) | `learnedKey` spells `c++`/`c#`/`f#`/`.net` as words; rows are re-keyed where read, by stored label (ba858cc7) |
| S8-082 | low | Breezy put the cover note in Work History (`cSummary`) and the Cover Letter box | the note goes to `cCoverLetter`; `cSummary` goes through the matcher (a218b293) |
| S8-080 | low | apply-broker signed any path the mandate owner wrote into `resume_file_url` | `_shared/resume-path.ts` `ownResumePath`; apply-broker and apply-agent use only an own-folder path; trigger 20261009120000 refuses a new or changed foreign path (139d778c) |
| S8-010 | med | a refunded pass packet could be set back to `ready` by its owner and sent; on a full pass the re-charge was capped, so the send was free | 20261009121000: clients may set status only to `submitted`; `agent_packet_pass_funds` funds a refunded packet only while the pass can charge it again; claim and both work counts read it (27fff467). Parts not done: see below |
| S8-076 | low | the morning digest read the plan by the mandate's email | `agent_subscription_rows` by user id, as every other gate (8a15792d) |
| S8-081 | low | the OAuth consent page named the client's self-declared homepage as where "you return to" | names the pending `redirect_uri` host, or no host (159feb1b). Latent: the OAuth server is off |
| S8-079 | low | hand-typed coverage percentages in board tips, MCP tool descriptions and /v1 explain | numbers removed; the live `filterCoverage` passes through (28988c95, aac699f8) |
| S8-029 | med | MCP search and /v1 `engine=ranked` folded sibling postings and never delivered them | both send `groupSimilar: false` (aac699f8) |
| S8-077 | low | the title-only `total` with `relatedTotal`/`matchScope` dropped | passed through on MCP and /v1 ranked (aac699f8) |
| S8-078 | low | /v1 engines parsed parameters differently (`employment_type` unvalidated, empty `max_years` bound 0, ranked dropped `remote=false`) | closed case-folded list on both engines, shared `intParam`, strict booleans, `remote=false` refused on ranked (aac699f8) |

## The rest of the group's scope

| item | state |
|---|---|
| Owner decision 4: SmartRecruiters withheld from /v1 and the MCP connector, as USAJOBS | **done** (aac699f8, adc813b6): both servers' `NO_REDISTRIBUTION_SOURCES` = usajobs, smartrecruiters; `?source=` and a SmartRecruiters `company_token` answer 451; `/v1/companies` omits their employers through `v1_withheld_company_tokens` (20261009122000); the /v1 index, `/data-api`, `/agents`, the guide resource, the `search_jobs` vendor field and both crawler copies say so. The public board keeps them |
| Commercial: "the $99 agent card advertises 7 systems, it sends on 4" | **done** (c1ccac08): the card's sending bullet, the front page's "We apply for you" card and the strip's agent icon read the sendable list (Breezy, Personio, Pinpoint, Teamtailor); Workday, SmartRecruiters and Oracle move to "you press send" |
| Wave-2 handoff: /v1 binds `location.ilike` itself (L13-01 on /v1) | **done** (aac699f8): `_shared/location-match.ts`, a byte copy of job-board's, pinned by `the-apis-copy-of-the-boards-location-rule-is-the-boards` |
| MCP directory prep: per-host allowance instead of one shared 25/day | **done** (9bcaaa6c), see "The host's own allowance" |
| MCP directory prep: result links to job pages with tracking | **done** (aac699f8): cards carry `siteUrl` = `resumebooster.work/jobs?job=<id>&utm_source=mcp&utm_medium=connector`; the research `search` links there |
| MCP directory prep: no prices or checkout links in ChatGPT-facing output | **done** (aac699f8): a tools/call result going to ChatGPT (an `openai/` `_meta` key or its user agent) has every buy/subscribe clause and the `buy`/`upgrade` fields removed at the one exit |
| Found by guards this branch had not run | **fixed**: `v1_withheld_company_tokens` was SECURITY INVOKER over the corpus (8505bb6e, the key-wall rule); the pass-number guard read 20261009121000's claim lease default (10 minutes) as the pass's 10 applications (71cbcff6: the guard sets aside exactly the lease spellings, with a teeth case) |

### The host's own allowance (agent-mcp 2026-10-09.2)

A call with no key whose platform-seen address (cf-connecting-ip, else the
last forwarded hop) is in the host's published egress list is counted first
in the host's own bucket:

- ChatGPT (OpenAI's `chatgpt-connectors.json`, read at most every six hours per
  isolate, 1.5 s timeout): per user, keyed by a hash of `openai/subject`, at the
  address cap (25/day). A subject from any other address keys nothing.
- Claude (Anthropic's documented outbound range 160.79.104.0/21; Claude sends
  no user id): one pool of 500/day for every Claude user.

A spent host bucket falls through to the address bucket (nobody has fewer
calls than before); the global 2,000/day still binds; an unreadable OpenAI
list means the address bucket. Each answer's `unkeyed.allowance` says which
bucket answered (`chatgpt-user`, `claude`, `chatgpt`, `address`). The
initialize paragraph is unchanged (it sits at 2,028 of 2,048 bytes); the guide
resource, `/agents`, the home strip, llms.txt and llms-full carry the rule.

## Not done, and why

- **S8-010, the parts the register listed beyond the gate.** (a) apply-broker's
  `packetIsFunded` still accepts any `pass_id`: the claim runs first and is the
  gate, and under wave 2's rule a given-back application may be sent and
  charged again, so refusing every refunded receipt in the broker would refuse
  sends wave 2 allows. (b) `agent_queue_enqueue`'s requeue keeps a queue row's
  `pass_id`, and apply-agent copies it: a second refund needs the first packet
  gone (apply-agent skips a posting that already has one), and wave 2's carry
  trigger stamps a packet prepared from a refunded queue row. (c) The parks
  keep `released_at`: the owner can no longer flip the status, which was the
  only way back.
- **S8-047, last clause**: passing the control type and options to
  generate-application-answers needs apply-agent to harvest them (it collects
  labels only). The worker change makes the loss impossible without it.
- **The install repository** (github.com/campbellaabbott-rgb/resumebooster-mcp)
  README still says a chat service's servers count as one address. It is
  outside this repo: update it when this deploys.
- **MCP directory submission itself** (Claude and ChatGPT): the code prep is
  done; whether to submit before sign-in is switched on is the owner's call
  (commercial plan item 5).

## Deploy

Edge functions (the integrator's merged tree; wave 2's builds are superseded by
these where both touch a function):

| function | new `x-fn-build` | why |
|---|---|---|
| `agent-mcp` | `agent-mcp.2026-10-09.2` | SmartRecruiters withheld; `groupSimilar:false`; `relatedTotal`/`matchScope`/`filterCoverage` pass-through; card `siteUrl` with tracking; no purchase text inside ChatGPT; the host's own allowance; the guide names the withheld systems |
| `public-api` | `public-api.2026-10-09.1` (`apiVersion` 2026-10-09.1) | SmartRecruiters withheld (451, `/v1/companies`); ranked `groupSimilar:false`, `total.related`, `match_scope`; parameter parsing (S8-078); the shared location rule; no typed percentage |
| `apply-agent` | `apply-agent.2026-10-09.1` | the protected-question classifier; packet profile carries only an own-folder résumé path |
| `apply-broker` | `apply-broker.2026-10-09.1` | signs only an own-folder résumé path |
| `generate-application-answers` | `generate-application-answers.2026-10-09.1` | the classifier; `supported` must be true; invented questions classified |
| `send-agent-digest` | `send-agent-digest.2026-10-09.1` | the plan read by account, not address |

Not redeployed by this group, but their bundles change:

- **job-board** (the job-board group's `.92`): imports `_shared/application-questions.ts`
  (+6.5 KB raw source: the protected-topic patterns and the identity gate, used
  by its `application-questions` action) and `_shared/board-domains.ts` (+0.3 KB,
  `EMPLOYMENT_TYPES`). Count both against the ~4.5 MB cap.
- **generate-apply-package** imports only `roleGuidance`, which did not change:
  no redeploy needed.

The **worker** (`worker/`, S8-006/007/008/043/044/045/046/047/048/082) has no
deploy step: `apply-worker.yml` checks out main, so it is live from the first
scheduled or woken run after merge.

The **frontend** (Lovable publish): `AgentSubscriptionCard`, `AtsCoverage`,
`src/config/sendable-vendors.ts`, `OAuthConsent`, the board tips in `Jobs.tsx`,
`AgentConnect`, `Index` (home strip), `DataApi`, `src/config/mcp-tools.ts`, all
nine locales, `public/llms.txt`, and `scripts/prerender-seo.mjs` (`/agents`,
`/data-api`, llms-full).

### Migrations, in this order

1. `20261009120000_a_mandate_can_name_only_a_resume_in_its_own_folder.sql` — a
   BEFORE INSERT / UPDATE OF `resume_file_url` trigger on `agent_mandates`
   refuses a new or changed path outside the account's folder (22023); an
   unchanged legacy path passes. Prints how many legacy rows exist (NOTICE).
   Self-checked on a scratch table. No dependency.
2. `20261009121000_a_refunded_pass_application_is_sent_only_if_it_is_paid_for_again.sql`
   — `agent_submissions_owner_status_trg`, `agent_packet_pass_funds`, and
   `agent_claim_submission` / `agent_work_pending` (20261005133000's bodies with
   one predicate). **Apply after wave 2's 20261008132000** (the re-charge
   trigger this file's rule completes); requires 20261005133000. Self-checked.
3. `20261009122000_v1_names_the_employers_whose_rows_it_withholds.sql` —
   `v1_withheld_company_tokens(text[])`, SECURITY DEFINER, service_role only.
   Either side of public-api .1: without it `/v1/companies` answers
   `employersOmitted: false` and the source filter still withholds every row.
4. `20261009123000_the_adoption_reader_counts_addresses_not_a_hosts_own_buckets.sql`
   — `agent_adoption_metrics` (20260917200000's body) counts only address rows
   as addresses. Apply with or before agent-mcp .2, so no host bucket is ever
   read as an address. Self-checked on today's rows inside its transaction.

All four are safe to re-run, revoke from PUBLIC/anon/authenticated and grant
service_role only. None adds an anon- or authenticated-callable SECURITY
DEFINER function; none touches a cron. Judge them by behaviour (section 73's
probes answer 42501, not PGRST202), not by what the runner reports.

## Owner steps

1. Keep the OAuth server off until dynamic client registration is limited to
   allowlisted redirect hosts (Supabase Auth setting; S8-081 is only latent
   while it is off).
2. Ask SmartRecruiters (SAP) for permission. On a yes: remove `smartrecruiters`
   from `NO_REDISTRIBUTION_SOURCES` in `public-api` and `agent-mcp` and from
   `MCP_WITHHELD_SOURCES`, and reword `MCP_WITHHELD_NOTE`; the mirror test
   holds the three lists together.
3. Read the NOTICE from 20261009120000: any legacy mandate whose
   `resume_file_url` names another folder is left as is and will not be signed;
   that candidate re-uploads.
4. Update the install repository's README sentence about the unkeyed allowance.

## Rollback

- Functions: revert this branch's commits and redeploy. The builds on main
  before this branch: agent-mcp 2026-10-05.2, public-api 2026-10-08.2 (wave
  2), apply-agent and apply-broker 2026-10-05.2, generate-application-answers
  2026-10-04.1, send-agent-digest 2026-10-08.1 (wave 2). Live on 2026-10-10:
  the same, except public-api 2026-10-05.1 and send-agent-digest 2026-10-04.1
  (wave 2 not yet deployed).
- 120000: `DROP TRIGGER agent_mandates_resume_in_own_folder ON public.agent_mandates; DROP FUNCTION public.agent_mandates_resume_in_own_folder();`
- 121000: re-run the `agent_claim_submission` and `agent_work_pending` blocks of
  20261005133000, then `DROP TRIGGER agent_submissions_owner_status_trg ON public.agent_submissions; DROP FUNCTION public.agent_submissions_owner_status(); DROP FUNCTION public.agent_packet_pass_funds(uuid, timestamptz);`
- 122000: `DROP FUNCTION public.v1_withheld_company_tokens(text[]);` (public-api
  degrades to `employersOmitted: false`).
- 123000: re-run the `agent_adoption_metrics` block of 20260917200000.
- Worker: revert the worker commits on main.

## What to measure

- **Protected questions stop for the candidate.** Expect more pending questions
  per prepared packet and zero sends carrying a model answer to a criminal,
  age, citizenship, pay or health question (`agent_pending_questions` rows by
  label, `agent_submissions` with blockers).
- **The host's own allowance.** Edge log lines
  `[AGENT-MCP] unkeyed allowance claude|chatgpt-user|chatgpt` per day, and
  `[AGENT-MCP] ChatGPT egress list unreadable` (should be rare). Buckets:
  `SELECT bucket, calls FROM public.mcp_anon_rate WHERE day = (now() AT TIME ZONE 'utc')::date AND (bucket LIKE 'ip:host:%' OR bucket LIKE 'ip:u:%');`
  If no `ip:host:claude` row appears after Claude traffic, claude.ai is not
  calling from 160.79.104.0/21 and its users still share the address bucket
  (nothing breaks).
- **Connector visits.** Site visits tagged `utm_source=mcp` (the commercial
  plan's experiment-2 measure: calls per day and visits from the connector).
- **/v1.** 451s for `source=smartrecruiters`; `/v1/companies`
  `employersOmitted: true`.
- **The agent card.** The live card names Breezy, Personio, Pinpoint and
  Teamtailor under "Applies for you automatically" when the sender is online.

## Tests added (each failed on the code before its change)

| test | proven to fail before |
|---|---|
| `the-worker-answered-without-requiring-sponsorship-backwards-and-the-review-sheet-said-the-opposite` | reverting the worker hunk fails 10 of 16 |
| `the-agent-read-u-s-as-no-country-and-the-pronoun-us-as-the-united-states` | reverting countries.ts fails 11 of 15 |
| `the-model-drafted-criminal-age-citizenship-pay-and-health-answers-and-the-worker-sent-them` | removing the worker check fails 33; the classifier arm 30; `!== false` the supported case |
| `the-agent-picked-i-do-not-require-sponsorship-for-a-candidate-who-requires-it` | reverting match.ts fails 5 of 6 |
| `an-essay-question-got-the-candidates-phone-address-or-linkedin-instead-of-its-answer` | restoring both files fails 12 of 24 |
| `the-agent-told-employers-a-uk-candidate-lives-in-ukraine` | restoring match.ts fails 6 of 7 |
| `a-drafted-answer-was-typed-into-a-radio-button-and-the-posting-was-lost` | 3 of 4 |
| `teamtailor-and-personio-forms-were-submitted-with-required-questions-unanswered` | 3 of 4 |
| `a-learned-answer-about-c-sharp-answered-the-c-plus-plus-question` | 3 of 4 |
| `breezy-put-the-cover-note-in-the-work-history-box-and-the-cover-letter-box` | 3 of 3 |
| `a-mandate-could-send-another-users-resume-with-its-applications` | disabling the trigger condition fails the DB case |
| `a-refunded-pass-packet-could-be-put-back-and-sent-for-free` | without the migration 3 of 5 |
| `the-morning-shortlist-looked-up-the-plan-by-an-address-the-account-had-changed` | the HEAD handler fails 3 of 3 |
| `the-consent-page-named-the-clients-homepage-not-where-allow-sends-the-code` | 3 of 3 |
| `the-paid-api-handed-on-what-it-may-not-and-hid-what-it-matched` | 10 of 10 on HEAD |
| `the-connector-handed-on-smartrecruiters-folded-siblings-and-sold-inside-chatgpt` | 4 of 4 on HEAD, and the guide case added in adc813b6 |
| `the-apis-copy-of-the-boards-location-rule-is-the-boards` | mirror test (the copy did not exist) |
| `the-agent-card-said-it-applies-on-seven-systems-and-it-sends-on-four` | 4 of 4 on HEAD |
| `every-claude-and-chatgpt-user-shared-one-addresss-unkeyed-allowance` | 4 of 6 handler cases on HEAD; the reader case without 20261009123000 (3 addresses, max 500, against 1 and 7) |
| `the-connector-page-never-said-which-systems-it-withholds` | 3 of 3 on HEAD |
