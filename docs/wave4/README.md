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
  drafting rule is default-deny: the AI drafts only open questions about work
  done and a short list of motivation questions, each a single ask. Every
  factual question (authorisation, sponsorship, pay, start date, references,
  gaps, terminations, a previous application), every demographic question,
  every consent and every attestation goes to the person, even when it rides
  inside a work-done or motivation question. We never submit anything.
- **Developers** get the same from `/v1`, fit scoring free at 25 a key a day
  across `fit_resume` and `/v1/fit` together on a confirmed key, and a
  "Builder API (planned)" card at $49 a month whose only action is an email
  request.
- **Nothing retired is sold by the server.** The Agent plan, the Agent Pass
  and the $7 Apply Assistant answer a purchase with 410, each behind its own
  switch. The server-side apply agent is switched off; its code is kept,
  dormant, behind `supabase/functions/_shared/apply-agent-switch.ts`. Every
  page wave 4 may touch says so: `/agents`, the pass page, pricing, the Trust
  page, the apply-agent guide, and the signed-in console (`/account`,
  `/agent`). Two places wave 4 may not touch still sell or describe the
  retired products: the `/jobs` board (`src/pages/Jobs.tsx`) and the crawler
  bake (`scripts/prerender-seo.mjs`). They are listed under "Left for other
  owners" with every line, and the deploy order below makes the owner decide
  how the frontend publishes beside them.

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

**3. Publish the frontend**, as the owner decided in owner step 1: either
after the profiles/design owner has removed the `/jobs` and bake lines under
"Left for other owners", or now, with them named as a known gap in the
changelog hold.

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

1. **Before the deploy, decide how the frontend publishes beside the two
   gaps wave 4 may not close** (below): the `/jobs` board's apply-agent pitch
   ("can fill and submit N of these for you", "7 days free ... then
   $99/mo", the 5th/12th-save toast, "runs your search nightly", the "Agent
   can apply" chips and tooltips) and the crawler bake's homepage, `/agents`,
   `/agent` and `/pricing` copy and JSON-LD Offers for the $99 plan and the
   $29 pass. Either wait for the profiles/design owner's change, or publish
   and name both as a known gap in the changelog hold.
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

- **`src/pages/Jobs.tsx`** (profiles and design). Each still sells the
  retired plan or says our agent fills and submits applications, in all nine
  locales:
  - about line 11431-11437, shown whenever the page holds one Breezy,
    Personio, Pinpoint or Teamtailor posting (`agentReadyOnPage` is
    `isSendableVendor` on the client): `jobsPage.agentPitchCounted` ("The
    apply agent can fill and submit {{n}} of these for you") and the `/agent`
    link `jobsPage.agentPitchCta` ("... {{trialDays}} days free for
    first-time subscribers, then ${{agentPrice}}/mo"); remove the block;
  - line 3665, the 5th/12th-save toast `jobsPage.savedMilestoneDesc` ("The
    Apply Agent can prep tailored answers ... a {{trialDays}}-day free
    trial");
  - lines 3865 and 5059, `jobsPage.queueBridge` ("The Apply Agent runs your
    search nightly");
  - lines 7926-7929 and 12516-12519, the "Agent can apply" chip and its
    tooltip `jobsPage.agentAppliesTip2` ("our apply agent can fill and
    submit on its own ... Needs the Agent plan or a live pass");
  - lines 9192-9201, the "Agent can apply" filter and its tooltip
    `jobsPage.agentOnlyTip` ("our apply agent can fill and submit for you");
  - the job pane's "Apply with your AI" label and the "Not connected yet?"
    install link (spec D1 and D2 §2.7);
  - with them, the guards that pin the priced pitch:
    `agent-is-visible-on-the-board`, `pricing-truth` (the board's two trial
    sentences), `half-of-all-users-were-told-most-ats-require-60-to-pass`
    (the save toast), and the `agentPitchCta` probe in sections 65 and 74's
    English-chunk finder (pick another key the chunk carries).
- **`scripts/prerender-seo.mjs`** (company-profiles):
  - the homepage: the meta description (line 1633, "An AI agent ranks them
    to your CV and applies where employers allow"), the Service JSON-LD
    (lines 1657-1668: "submits on hiring systems that permit it", and Offers
    at `D.SUBSCRIPTIONS.agent.priceUsd` and `D.PASS.priceUsd` to
    `/agents/pass`), the H1 (line 1673, "The agent applies for you."), the
    "What the AI apply agent does" list (line 1676), and line 1685's
    `AGENT_OFFER` lines;
  - the `/agents` bake still names the $99 plan and the $29 pass (meta, hero,
    apply-tools sentences, `SENDABLE_VENDOR_SENTENCE`), and has no install
    link; line 2916 says "ask your apply agent to submit applications for
    you";
  - the `/agent` bake names the plan's free days;
  - `FREE_KEY_RATE_SENTENCE` names the pass, three times (/data-api and
    llms-full);
  - the /pricing bake's description ("pass for your own agent."),
    `offerPrices` and JSON-LD Offer rows (line 3133) carry the Agent plan and
    the pass;
  - llms-full's MCP line (3375) and lines 1616, 2866, 2924 and 2947 read
    `MCP_ANON_CAPS.perAddressPerDay`, `hostPoolPerDay` and `globalPerDay`. The
    mirror keeps those three names with the nearest true figure (100, 10,000,
    20,000) until the bake moves to `otherPerConnection`, `shares.claude` and
    `overallPerDay`; then delete them (the first-call guard pins them).
  - When the pass is gone from the bake, set `BAKE_STILL_SELLS_THE_PASS=false`
    in `src/test/a-pass-number-on-a-page-is-a-placeholder.test.tsx`. The
    verifier lines that read the bake (7d's $99/$29 and description lines,
    76's L1-08, 65's `/agent` trial line) turn from INFO to PASS by
    themselves; nothing in them needs editing.
- **`public/sitemap.xml`** still lists `/guides/how-the-apply-agent-works`
  (line 1702). The guide at that address now says the agent is switched off,
  so the entry can stay; drop it only if the owner wants the page out of the
  index.
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
