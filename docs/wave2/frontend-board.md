# Wave 2 — frontend-board deploy note

Branch `wave2/frontend-board`, from `acd64c4c`. Register: the 2026-10-04 platform
debug (private), every item with `fix_group: frontend-board`, the L1-10 and L8-08
React-side handoffs, and the "Recently found by us" label.

## What ships

**Frontend only.** No edge function changes, so no `FN_BUILD` / `BUILD_VERSION`
bump; no migrations. The Lovable session publishes the frontend and the bake
runs as usual.

| Function | Build | Note |
|---|---|---|
| — | — | none touched |

| Migration | Apply order |
|---|---|
| — | none |

Files: `src/pages/Jobs.tsx`, `src/pages/JobPosting.tsx`, `src/pages/Explore.tsx`,
`src/pages/Companies.tsx`, `src/components/seo/SEO.tsx`,
`src/components/jobs/{SavedSearchPills,EmployerContext,SimilarCompanies,LayoffFilingLine,CompanyClaim}.tsx`,
`src/pages/{GhostJobIndex,AdminClaims}.tsx` (one-line link change each),
`src/lib/{public-href,prerendered-head}.ts` (new), `src/lib/board-facets.ts`,
all nine `src/i18n/locales/*.json`.

## What changed, item by item

| Register id | Fix |
|---|---|
| L2-01 | The lander's "Is X hiring?" answer speaks only from a successful reply to the unnarrowed company request (no error, reply for the filters on screen, nothing but the company bound). The old regex guard is replaced by a behavioural file. |
| L2-17 | `Jobs` (default export) remounts the board on every in-app navigation between board routes and on Back/Forward onto an entry the board did not write; the board stamps its history entries with its id (`rbBoard`) so closing the posting panel with Back keeps the instance. |
| L2-18, L2-16 | A dead `?job=` 404 or description-only reply is "no longer listed on this board" (no employer claim, description offered); a failed read shows a retry; the banner renders above the loading/error/zero/list switch; Dismiss drops `?job=`. |
| L2-19, L2-07, L2-20 | The posting page treats the board's 404 as gone at once (one read, noindex); the gone title/description and markup clearing apply to `gone` only (the baked head stands while loading, failed, refused); the pay line says WE found no figure (`jobPostingPage.noPayFound`; `noPay` retired). |
| L2-02 | A field lander narrowed by a query, location or any other filter prints no headline number (neither the board-wide field facet nor the board total). |
| L4-04 | `SEO` takes `canonicalPath`, spells the canonical with the bake's trailing-slash rule, and removes baked canonical/description tags React does not own once it has written its own (React 19 adopted neither in jsdom, so every page carried two). Secondary-board landers read the bake's own canonical before React writes and keep it. |
| L2-03 | Clearing a search retires the facet probe still in flight. |
| L2-04, L2-05, L2-09 | `/explore`'s employer check links a multi-board employer to the group-scoped board (same scope as `/companies`), withholding a sum the link cannot carry; an unsettled closure read is released on a tab round-trip; budget refusals short-circuit every counted read (facets reader, probes, closure read), and `/explore`, `/companies` render `BoardBudgetNotice`; saved-search pills probe one at a time and stop at a refusal. |
| L2-12, L8-08 (client) | The company chip falls back to the rows' employer name before the token; the typeahead folds names with the server's `foldName`. |
| L2-13 | Palette "Scan my resume (free)" → `navigate("/#upload")`. |
| L2-15 | `verifyJobOutcome` separates our failed check from a page-capped feed; "logged" only when the report request succeeded; an unsent report leaves the card reportable. |
| L2-08 | Dropped nl-search filters are named ("Couldn't apply: …") and the chips come from `applied` when anything was dropped. |
| L12-05 | A search's order claim is withheld until the reply on screen answers the request on screen. |
| label | `effective_posted = coalesce(posted_at, last_seen)` with `last_seen` written at insert only: the discovery order is the employer's date where stated, our first-seen stamp otherwise. "Recently found by us" → "Newest, undated by our date"; the order sentences on the discovery view, exact-word tier, routed-employer exit, ranking fallback and agent prompt name both halves. Eight keys reminted (`*2`), old ones retired in all nine locales. Server sort unchanged. |
| L1-10 (React half) | `companyLanderPath()` adds the trailing slash a dotted token needs; used by every React company link in the files above, the board's address bar and its canonical. |

New strings (all nine locales): `jobsPage.unlistedLink`, `unlistedLinkDesc`,
`deepLinkFailed`, `reportCheckedBodyUnsent`, `reportUncheckableBodyUnsent`,
`reportCheckFailedTitle`, `reportCheckFailedBody`, `reportCheckFailedBodyUnsent`,
`reportUnsentTitle`, `reportUnsentBody`, `nlDropped`, `filterName.{q,location,activelyHiring,sort}`,
the eight `*2` discovery-order keys, `jobPostingPage.noPayFound`.
Retired: `jobPostingPage.noPay`, `jobsPage.{sortDiscovered,orderDiscovered,orderDiscoveredWoven,orderUndatedShow,orderExactWord,sortedExactWordDiscovery,sortedEmployerDiscovery,sortedDiscoveryFallback}`.

## Tell the owner

- On the board, clicking an employer, "Also hiring in", or the header's Jobs link now
  actually loads that page; Back between board pages works.
- Several sentences changed meaning: the discovery sort is now labelled
  "Newest, undated by our date", dead posting links that we cannot attribute to the
  employer say "no longer listed on this board", and posting pages say "We found no
  pay figure" instead of "This employer states no pay".
- Nothing to do in Stripe, Supabase or the database for this group.

## Integrator

- `src/i18n/locales/*.json` are seo-content-i18n's files; this branch adds and
  retires keys in all nine (merge by key). If seo-content-i18n also edited
  `jobPostingPage.noPay`, keep this branch's deletion and its `noPayFound`.
- `scripts/prerender-seo.mjs` (seo-content-i18n) still bakes "This employer states no
  pay on this posting, so this page states none." and hand-built dotted company hrefs;
  the React copy now differs until that group lands its half.
- `src/pages/PayTransparencyIndex.tsx:166` and `src/pages/EntryLevelIndex.tsx:162`
  (data-pages-sql) still hand-build `/jobs/company/<token>`; switch them to
  `companyLanderPath(token[, "experience=entry"])` from `@/lib/public-href`.
- Server half of L8-08 (company-suggest fold) is job-board's; the client now folds,
  so the head facet finds "dominos" either way.
- No anon/authenticated SECURITY DEFINER functions added; nothing for the census.

## Rollback

Revert the branch's commits (frontend only) and republish. No data or schema to undo.
The retired locale keys come back with the revert.

## Measure

- `scripts/verify-deploy.d/62-wave2-frontend-board.sh`: every line should read PASS
  (pre-deploy all FAIL on the old bundle, 2026-10-08).
- Analytics: `agent_handoff_search` and board click-through on lander-to-lander
  navigation should rise (previously dead links); "posting is gone" reports should
  no longer produce the feed-size toast on verify failures.
- GSC: secondary-board landers (e.g. pwc~wd3~crm_experienced_careers_site,
  maersk~wd3~Maersk_Manual) should stop reporting "Duplicate, Google chose
  different canonical" over the following crawls.
