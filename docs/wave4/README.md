# Wave 4: connect your own AI, search, and apply yourself

Wave 4 merges five builder branches onto `origin/main` at `e75945fe` (PR #32,
the post-wave-3 tooling). The integration branch is `wave4/integration`,
built 2026-10-12. It implements the two specs of 2026-10-11, with the owner
decisions appended to each (those supersede the options above them):

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

## What a person can do after this deploy

- **Connect** Claude or ChatGPT with no key and no account. Every read tool
  answers keyless: `board_stats`, `search_jobs`, `search`, `fetch`, `get_job`,
  `get_jobs`, `check_jobs_open`, `employer_hiring_record`, `employer_growth`,
  and `apply_myself`. `tools/list` shows a caller only what it can call (21 KB
  with no key, under 25,000 bytes with one), with no oauth2 schemes while
  sign-in is off.
- **Search the way they speak.** "nurse jobs in Texas" searches Texas, an
  employer named in `companies` resolves by name, and "City, ST" searches that
  city in that state.
- **Apply themselves.** When the employer uses Greenhouse, Ashby, Recruitee,
  Breezy or Pinpoint (only Greenhouse and Recruitee inside ChatGPT), the AI
  reads the real application form. The drafting rule is default-deny: the AI
  drafts only open questions about work done and a short list of motivation
  questions. Every factual question (authorisation, sponsorship, pay,
  references, gaps, terminations), every demographic question and every
  consent goes to the person. We never submit anything.
- **Developers** get the same from `/v1`, fit scoring free at 25 a day on a
  confirmed key, and a "Builder API (planned)" card at $49 a month whose only
  action is an email request.
- **Nothing retired is sold.** The Agent plan, the Agent Pass and the $7 Apply
  Assistant answer a purchase with 410, and no page offers them or says we send
  applications. The server-side apply agent is switched off; its code is kept,
  dormant, behind `supabase/functions/_shared/apply-agent-switch.ts`.

## The owner's figures, as built

- **Keyless allowance:** 20,000 a day: Claude 10,000, ChatGPT 6,000 (200 for
  each person when ChatGPT's call names them, 2,000 for calls with no id),
  other callers 4,000 (100 for each IPv4 address or IPv6 /64). Per minute: 60
  overall, Claude 30, ChatGPT 20, other 15. Application forms have their own
  pool: 5,000 a day at 20 a minute. A share is chosen only by the verified
  address, never by the path, user agent or `_meta`. Timeouts are never
  refunded; refunds are capped at 5 a day per bucket. `board_stats` is served
  from a five-minute cache and never counted. The SQL is `mcp_anon_check_v2`
  and `mcp_anon_refund` (20261011102000); the constant is
  `ANON_ALLOWANCE` in `agent-mcp/allowance.ts`, mirrored in
  `src/config/mcp-tools.ts` and pinned to it.
- **Fit scoring:** 25 a day on a key whose email was confirmed or whose
  account proved its mailbox, on both doors, and 1,000 with a paid tier, a
  pass, the plan or Pro. It is never offered inside ChatGPT. Both doors read
  one decision (`_shared/fit-gate.ts`) over one SQL reader
  (`api_key_fit_allowance`, 20261011110000).
- **Privacy:** ChatGPT searches are not logged (job-board honours `noLog` only
  with the reader proof, and agent-mcp sets it for ChatGPT). Connector
  searches from everywhere else keep their words and no shown ids, for 30 days
  (20261011103000, held: see below). `find_roles_for_my_cv` takes no CV.
  The Privacy page carries the draft MCP table, marked for counsel.

## What the integration itself fixed

The five branches were built in parallel, and these are the places where
their combination, or a file no group owned, needed work:

1. **The frontend mirror** (`src/config/mcp-tools.ts`) now registers what the
   wave-4 server registers: the ten keyless tools with `apply_myself`, none of
   the retired apply tools, the five prompts, and the owner's allowance
   figures. The four mirror guards that went red when `w4/mcp` merged pass.
   The hand-off drops the retired agent-ready filter, which the server no
   longer declares.
2. **One fit rule on both doors.** `w4/mcp` gave the free 25 to every live
   key, while `w4/api` refused keys with no confirmed email. `fit_resume` now
   follows `/v1/fit` (`agent-mcp` 2026-10-11.2, `public-api` 2026-10-11.2).
3. **The Apply Assistant is no longer sold.** It is one row of
   `create-product-checkout`'s product table, which `w4/retire` did not own;
   it now answers 410 like the other two (`create-product-checkout`
   2026-10-11.1) and is in `HIDDEN_PRODUCT_IDS`.
4. **The signed-in console sells nothing retired.** The Morning Queue panel,
   `/agent`, the application kit and the OAuth consent page offered the $99
   plan, the pass or the $7 kit; they now show the retirement notice (the
   retirement page's own nine-locale keys) or nothing.
5. **The 30-day retention** the owner decided and the Privacy draft states
   (20261011103000). `w4/mcp` deferred it until job-board `.93`'s write side
   was beside it.
6. **Stamps.** `apply-agent` 2026-10-11.14, and `generate-application-answers`
   and `generate-apply-package` 2026-10-11.1: they import the classifier
   `w4/mcp` widened. `generate-application-answers` now hands termination,
   reasons for leaving, gaps, references and grades to the person.
7. **The verifier** (see below), the live contract probe, `llms.txt`, and the
   ledger (order rules, the hold, the `w4/` branches in the reservation, the
   shared-file owners).

## Deploy

Generate the message at the merge commit on main with
`node scripts/deploy-ledger.mjs --message` (docs/DEPLOY-LEDGER.md). The
draft from this branch reads:

**1. Migrations before the functions**, in this order. The first two are wave
3's released holds, which main still owes.

1. `20261009112000` (wave 3; shortlist-evaluate already serves its build)
2. `20261009160100` (wave 3; layoff-filings already serves its build)
3. `20261011100000` the application-form cache: before agent-mcp and public-api
4. `20261011101000` the call counter and the 50% alerts: before agent-mcp
5. `20261011102000` the split allowance (`mcp_anon_check_v2`, `mcp_anon_refund`): before agent-mcp
6. `20261011102100` the adoption reader counts address rows only: before agent-mcp
7. `20261011110000` the fit-allowance reader: before public-api and agent-mcp
8. `20261011130000` the apply agent's two schedules removed by name

If agent-mcp lands before 102000, every keyless call fails closed; if public-api
or agent-mcp lands before 110000, fit refuses (503 on /v1) rather than scoring
for free.

**2. Fourteen functions:** agent-access, agent-pass-status, agent-runner,
apply-broker, create-agent-checkout and create-pass-checkout at
`2026-10-11.13`; apply-agent `2026-10-11.14`; agent-mcp and public-api
`2026-10-11.2`; api-key-request, create-product-checkout,
generate-application-answers and generate-apply-package `2026-10-11.1`;
job-board `2026-09-09.93`.

**3. After the functions:** `20261009100300` (wave 3, once job-board answers .92 or later).

**4. Publish the frontend.**

**Second message, after wave 4 verifies.** `20261011103000` is in
`holdUntilVerified`. It schedules the nightly 30-day prune of the connector's
searches, an irreversible delete of raw rows. Release it once sections 82 and
86 pass, then empty its hold and record the deploy in `verifiedDeploys`.

The old `mcp_anon_check` stays until the live agent-mcp has moved off it. A
later migration drops it.

## Verify

`bash scripts/verify-deploy.sh` runs these wave-4 sections. Each checks the
wave-4 builds with `build_ge` and can fail. A test runs each one against a
fake curl whose free connector answers come from the real agent-mcp handler
(`src/test/the-wave-four-sections-fail-what-they-claim.test.ts`).

- **82, keyless surface:** the build, the instructions (search first, the six
  rules, no price, 2,048 characters or fewer), the keyless tool list (the ten,
  no oauth2, 25,000 bytes or fewer, titles and hints), the ChatGPT edition
  (no price, plan, checkout or tag; forms for Greenhouse and Recruitee only),
  the four keyless prompts (no CV argument), and each read tool answering
  with no key. A malformed id costs nothing.
- **84, applying yourself:** the public-api and two generator builds, a live Greenhouse posting's real form, who
  answers each question, no choice question drafted, the person submitting,
  the forms pool spent rather than a lookup, the markdown packet's five
  headings, Workday not-published, SmartRecruiters restricted, the `/v1` twin
  (200 and 451, with `RB_API_KEY`), and the cache closed to anon.
- **85, allowance and protocol:** the api-key-request build, the counted search's share (other,
  connection, 100 / 4,000 / 20,000), the guide's figures including the
  per-minute caps and the forms pool, the counters and readers refusing anon,
  a null body answering -32600, CORS, and the protected-resource document's
  404 while sign-in is off. The per-minute refusal itself is proved in pglite,
  because provoking it would spend 60 calls.
- **86, job-board .93:** the build, the latest pass-end receipt finished step
  by step (INFO while in flight), the no-log flag (with the owner's SQL for
  this run's nonce), "nurse jobs in Texas" and "software engineer jobs in new
  york" returning at least 90% of their location form, and "Humana" resolving
  by name.
- **93, retire:** the seven builds, the three retired checkouts' 410
  refusals (the Apply Assistant added by the integration), the agent's
  schedules gone, and the worker workflow started only by hand.

Sections 73 and 73w, and the 5n block in `verify-deploy.sh`, were written for
the wave-3 agent and its pass. With a wave-4 build serving, they now check
that the retired tool is listed to nobody, that no pass link remains, and
that the protected-resource document answers 404, instead of failing a
correct deploy.

A full run spends nine keyless lookups (82: six, 86: one, 73: two) and four
form reads.

## Owner steps

1. **Stripe** (section 93 prints the list):
   - list active Apply Agent subscriptions ($99 a month), and every paid
     session whose `product_type` is `agent_pass` or `apply_assistant`;
   - refund or honour each buyer;
   - expire any checkout session still open for the three products (a
     session lives 24 hours, and paying one still grants);
   - there is no dashboard Price to archive, because all three bill inline
     `price_data`; archive only a Product the catalogue lists under those
     names.
2. **Add to Claude** (spec owner actions 1-3): check on signed-in Claude
   accounts that the install link opens prefilled and that "Sign in when
   needed" connects and searches. Then set `MCP_ADD_TO_CLAUDE_LIVE = true` in
   `src/config/mcp-tools.ts` and publish the frontend.
3. **Counsel:** review the Privacy page's MCP section (`src/config/mcp-privacy.ts`;
   the body is English only, like the rest of the policy) and the old
   apply-agent sentences, then bump `PRIVACY_LAST_UPDATED`. The Terms clause
   that replaces the bots ban is owner action 9.
4. **After the deploy:** record `verifiedDeploys`, release 20261011103000,
   and publish the changelog in nine locales, each entry checked against
   production.

## Before this branch merges

The S12 sweep fixes and the SEO fix round run on this branch, before it
merges to main.

## Shared files

`node scripts/deploy-ledger.mjs --overlap origin/wave4/integration
origin/profiles/integration` lists ten files both change: `public/llms.txt`
and the nine locale files. No function is changed by both. company-profiles
deploys first (deployOrder 2), so it owns those files in `sharedFiles`. Wave 4
owns its own keys and lines in them and re-applies only those when it rebases:

- 57 en keys added or changed and 67 removed, under agentConnect, agentPass,
  homeAgent, homeHero, pricingPage, dataApiPage, faq, agentMatches,
  atsCoverage, jobsPage and privacy, the same in every locale;
- the llms.txt lines on connecting, applying yourself, paid tools and the
  Builder API.

A `git merge-tree` of the two tips merged all ten files without a conflict.
No `design/*` branch is on origin.

## Left for other owners (files wave 4 may not touch)

- **`scripts/prerender-seo.mjs`** (company-profiles):
  - the `/agents` bake still names the $99 plan and the $29 pass (meta, hero,
    apply-tools sentences, `SENDABLE_VENDOR_SENTENCE`), and has no install
    link;
  - `FREE_KEY_RATE_SENTENCE` names the pass, three times (/data-api and
    llms-full);
  - the /pricing bake's description, `offerPrices` and JSON-LD Offer rows
    carry the Agent plan and the pass;
  - llms-full's MCP line (3375) and lines 1616, 2866, 2924 and 2947 read
    `MCP_ANON_CAPS.perAddressPerDay`, `hostPoolPerDay` and `globalPerDay`. The
    mirror keeps those three names with the nearest true figure (100, 10,000,
    20,000) until the bake moves to `otherPerConnection`, `shares.claude` and
    `overallPerDay`; then delete them (the first-call guard pins them).
  - When the pass is gone from the bake, set `BAKE_STILL_SELLS_THE_PASS=false`
    in `src/test/a-pass-number-on-a-page-is-a-placeholder.test.tsx`.
- **`src/pages/Jobs.tsx`** (profiles and design):
  - the "Agent can apply" filter chip and its tooltip ("our apply agent can
    fill and submit for you", `jobsPage.agentOnlyTip`);
  - the Sparkles sendable badge and the sendable block at about line 7919;
  - the comment naming `request_application` at about line 7934;
  - the job pane's "Apply with your AI" label and the "Not connected yet?"
    install link (spec D1 and D2 §2.7).
  - The hand-off already drops the agent-ready filter.
- **The company lander's "Ask your AI" block** (spec P1, profiles).

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

## Checks run on this branch

- `npm run typecheck`: clean (it runs on every commit).
- The worker's `tsc --noEmit`: clean.
- `bash scripts/check-functions.sh`: every edge function typechecks, and the
  Deno tests pass (`deno.lock` restored afterwards).
- `node scripts/deploy-ledger.mjs --against origin/main --against w4/mcp
  --against w4/api --against w4/jobboard --against w4/retire --against
  w4/frontend`: 0 violations. job-board `.93` is the one string the wave
  shares, as its reservation allows.
- `--message` refuses on this branch (exit 5: HEAD is not origin/main), and
  never exits 2; `--draft` prints the message above.
- The full vitest suite: see the push.
