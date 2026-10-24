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
  S12-017, S12-018, S12-019, S12-020, S12-027, S12-028, S12-035, S12-036,
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
  `2026-09-09.93` and carries the salary and negation fixes.

`--against origin/main` reports 0 violations. Against each w4b branch the only
"same build string on different code" lines are job-board `.93` (shared by
reservation) and R1's three functions (below, under the owner's steps).
After the fixes, `--against origin/wave4/integration` (the branch before
them) finds 14 functions whose code moved and one violation, job-board `.93`
by reservation: every other one carries a `.30` build. After the recheck's
fixes, `--against` the branch before them (fa66a031) finds 7 functions moved
and one violation, job-board `.93` by reservation; the other six carry `.31`.

The job-board upload, tallied the deploy's way (its folder plus all of
_shared, comments included) with the profiles round's two _shared files at
their size on design/integration (72,818 bytes), is 4,443,315 bytes after
the fixes: 56,685 under the 4.5 MB line (4,434,303 and 65,697 before them),
and 4,447,626 after the recheck's fixes: 52,374 under the line, 2,374 inside
the agreed 50,000 of room (the classifier's shared TOPICS moved into
_shared/application-questions.ts and the salary rule grew; their comments
were cut to keep the room). It was 4,466,852 (33,148 under) before the
integration moved the long comment runs of four more job-board files into
`docs/job-board-index-notes.md`.

### Verify

One read-only section per group: `scripts/verify-deploy.d/92-w4b-payments-delivery.sh`,
`92-w4b-checkout-catalogue.sh`, `92-w4b-generators.sh`,
`92-w4b-account-compliance.sh`, `92-w4b-job-board.sh`,
`92-w4b-agents-api.sh`, `92-w4b-ops-email-tests.sh`, and for the fixes after
the review `92-w4b-fixer.sh` (every `.30` build, a signed-out cover note
refused 401, and three board behaviours), and for the fixes after the recheck
`92-w4b-fixer2.sh` (six `.31` builds, career_path_past_buyers closed to the
anon key, "warehouse not forklift Dallas" excluding only forklift). `verify-deploy.sh` runs
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
3. Then this branch: merge origin/main into it first. Expect conflicts in
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
   by behaviour). Re-run the gate,
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
- Watch the INFO lines for the experience, salary and country re-derivations
  (EXPERIENCE_VERSION 2, SALARY_PARSE_VERSION 11, COUNTRY_MAP_VERSION 10).
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
  a business figure counts only in the figure's own clause, next to it, a
  nearer pay label wins, lines and block tags end a clause, and the generic
  words (inventory, transactions, claims, loans, costs, volume, equity) are
  gone, so the version 11 re-sweep NULLs no correct pay.
- **A search never waits for the employer list** (job-board): the router
  routes on the live set this isolate built last or the table and rebuilds
  after the response; section 92 job-board asks cvs and UPS up to four times.
- **"not" negates a short phrase** (job-board search-routing): it stops at
  two words, a place word or state, or an intent word.
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
  job-board .93): ending a clause at a colon had taken "Pay Range:" out of
  the figure's clause, so the standard transparency line "Pay Range: $17.00 -
  $19.00 per hour plus profit sharing" (and "... + deal commissions", "OTE:
  ... on closed deals", the label on the line above) was refused, and the
  version 11 re-sweep would have NULLed that stored pay. The rule now: a range
  is a business figure only as that figure's own amount (the business word
  right before it through amount words, "portfolio of", "projects worth",
  "valued at"; or right after it, "$5M in deals"); profit sharing, deal
  bonuses and commissions and a fleet vehicle are not business figures; a
  pay label before the figure in its labelled clause makes it pay whatever
  follows, NOT_PAY's words after it included; job titles ("Portfolio
  Analyst", "Pipeline Welder") keep their pay. minedSalaryRefused reads
  S12-019's rule only (not NOT_PAY, which the old miner applied more widely,
  so a figure it refuses is a vendor's field), at every place the description
  quotes the stored text. The test runs the recheck's seven lines, ten of
  ours, four titles, 1,200 label/layout/tail/figure combinations, and
  backfill-salary through the board handler, where only the business figure
  is rewritten.
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
  search-routing, .93): the phrase stops before any place knownPlace()
  recognises, one to three words, unless the place began inside the phrase
  ("not new york"): "warehouse not forklift Dallas" excludes forklift and
  searches Dallas, as main did.

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
