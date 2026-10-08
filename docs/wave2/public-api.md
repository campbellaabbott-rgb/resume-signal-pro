# Wave 2: public-api (branch `wave2/public-api`, 2026-10-08)

The change feed stops serving doubted closure batches as closures, the scan
fallback stops promising more points than a score can gain, and the owner can
read the names behind the census's "2 unlisted" count. Verifier:
`scripts/verify-deploy.d/66-wave2-public-api.sh` (one PASS/FAIL/INFO line per
claim below; read-only).

## Register items

| id | what | state |
|---|---|---|
| L13-56 (1.70) | `/v1/changes` served `suspect` closure batches as outcome `closed`; its note claimed reconciliation | **fixed** as the owner approved: left out by default, `include_suspect=true` returns them marked `suspectBatch: true`; note, code comment, `/data-api` copy, crawler copy, docs and the ticker's catalogue description corrected |
| L9-25 (1.44) | the claim read neither the pause nor the blocklist; no cancel control | **skipped, already fixed on main and live**: `agent_claim_submission` in 20261005133000 gates on `active`/`paused_until`/funding and parks blocked-employer and cooldown packets; Cancel is wired (ApplyQueuePanel → agent-access → `agent_packet_decide`); section 45 shows that migration applied (`agent_unclaim_submission` 42501) |
| L13-50 (2.14) | the cooldown counted only sent applications | **skipped, already fixed on main and live**: `agent_employer_in_cooldown` (20261005133000) counts released-but-unsent packets, and apply-agent keeps an in-run `releasedCompanies` set |
| L13-25 (1.41) | the `/v1/companies` cursor skipped most of the directory and could loop | **skipped, already fixed on main and live**: `public-api/company-walk.ts` (one comparator, a `(count, token)` cursor), walked by `an-agent-sends-what-it-holds-and-says-what-it-did.test.ts`; public-api 2026-10-05.1 is serving |
| L13-64 (2.18) | the 7-day report cache replayed `creditUsed`/`creditsRemaining` | **skipped, already fixed on main**: free-keyword-scan strips both on write and on a hit (`the-free-scan-spends-a-credit-only-for-a-proven-buyer-and-a-delivered-report.test.ts`, "a cache hit is free, and an old cached receipt is not replayed"). The stream fork sets neither field, so there is nothing to port |
| L5-15 (stream port) | the improvement-potential clamp was missing from `free-keyword-scan-stream` | **fixed**: the fork now clamps `estimatedScoreIncrease` to `[0, 98 − final score]` after industry calibration, and on a report served from its 24-hour response cache |
| census names | `client_callable_census` gives only a count of unlisted client-callable definers | **added**: `client_callable_unlisted_names()`, service-role only, reached through admin-ops with the `ADMIN_API_KEY` |

## Deploy

Edge functions (any order between them):

| function | new `x-fn-build` | why |
|---|---|---|
| `public-api` | `public-api.2026-10-08.1` | `/v1/changes` default and `include_suspect`; `apiVersion` 2026-10-08.1 |
| `free-keyword-scan-stream` | `free-keyword-scan-stream.2026-10-08.1` | the improvement clamp, fresh and cached |
| `admin-ops` | `admin-ops.2026-10-08.1` | serves `client_callable_unlisted_names` (`ADMIN_CATALOGUE_RPCS`) |

Migrations, in this order, after the functions:

1. `20261008140000_the_takedown_ticker_no_longer_says_the_change_feed_counts_higher.sql`
   restates `get_takedowns_today()`'s description with the one sentence about the
   feed corrected. Comment only: no function body or grant changes. Apply after
   public-api 2026-10-08.1 is serving, because the sentence describes that build.
2. `20261008141000_the_owner_can_read_which_client_callable_definers_no_list_names.sql`
   creates `client_callable_unlisted_names()`, a SECURITY INVOKER SQL function,
   granted to `service_role` only. Its DO block raises unless the function is
   INVOKER, closed to anon and authenticated, open to service_role, reads at least
   one signature out of the census, and agrees with the census's count. It also
   prints the names in a NOTICE, so the apply output shows them.

Both are safe to re-run. Judge them by behaviour, not by what the runner reports:
`client_callable_unlisted_names` answers anon with 42501 (section 66), and the
owner's admin-ops call below answers names.

Frontend: publish `src/pages/DataApi.tsx` (the `/v1/changes` notes) and let the
prerender rebuild (`scripts/prerender-seo.mjs` `/data-api`, which also stops
saying closures reach 30 days on a free key; they reach 72 hours).

## What to tell the owner

- **The change feed narrowed by default.** `/v1/changes` `closed[]` no longer
  includes batches the collector flagged as a possible failed read of its own.
  A consumer that wants the whole log passes `include_suspect=true` and gets them
  with `suspectBatch: true`. Every response now carries `suspectBatchesIncluded`,
  and `apiVersion` moved to 2026-10-08.1 because what the default contains
  changed. Anything other than `true` or `false` is a 400. If any API customer
  should be told directly, this is the line to send; a changelog entry was not
  written (it would need all nine locales).
- **What the default walk reconciles with.** Drop rows with outcome `relisted`
  and rows with `closedAtIsObservation: true`, and a default walk is counted on
  the same rules as the daily takedown figure on the jobs board, except that the
  figure also counts the hiring systems `/v1` may not redistribute (the federal
  feed). The feed can come out lower by those, never higher. The old promise of
  matching `get_board_flow()` was false: that function counts suspect batches
  and re-listings in `closed`.
- **Reading the unlisted definers' names.** After admin-ops 2026-10-08.1 and
  migration 20261008141000:

  ```sh
  curl -s -X POST "https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/admin-ops" \
    -H "Content-Type: application/json" \
    -H "apikey: $VITE_SUPABASE_PUBLISHABLE_KEY" -H "Authorization: Bearer $VITE_SUPABASE_PUBLISHABLE_KEY" \
    -H "x-admin-key: $ADMIN_API_KEY" \
    -d '{"fn":"client_callable_unlisted_names"}'
  ```

  The answer is `{"data": {"unlisted": [{"signature", "anon", "authenticated"}],
  "census_unlisted_client_callable", "agrees", "census_signatures_read",
  "census_signatures_missing"}}`. `agrees: false` means the census was rewritten
  in a shape this reader does not parse; trust the census's count and read the
  names with the SQL below instead. Each name then needs a decision: add it to
  `src/test/helpers/client-callable-allowlist.ts` and the census's lists with the
  caller that needs it, or revoke it.

  Without admin-ops (SQL editor, as the owner), the same names without the
  census comparison:

  ```sql
  SELECT p.oid::regprocedure AS signature,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
          OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
   ORDER BY 1;
  ```

  and compare the list with `CLIENT_CALLABLE` and `OWNED_ELSEWHERE` in
  `src/test/helpers/client-callable-allowlist.ts`.

## Rollback

- public-api: redeploy the parent commit's `supabase/functions/public-api/index.ts`
  (`public-api.2026-10-05.1`, `apiVersion` 2026-09-30.1). The feed serves suspect
  rows as `closed` again. If you do this, also re-apply the
  `COMMENT ON FUNCTION public.get_takedowns_today()` statement from
  `20261002113617`, so the ticker's description matches the feed.
- free-keyword-scan-stream, admin-ops: redeploy the parent commit's file. Nothing
  is stored differently.
- 20261008141000: `DROP FUNCTION IF EXISTS public.client_callable_unlisted_names();`
  (nothing else depends on it; admin-ops then answers 502 for that one name).
- 20261008140000: re-apply the old COMMENT as above. No data or grant changed.

## What to measure

- Section 66: three builds, `apiVersion` 2026-10-08.1, `/data-api` crawler copy,
  42501 for the names reader with the publishable key. With `RB_API_KEY` in
  `.env.local`, also the default walk (`suspectBatchesIncluded: false`, every row
  `suspectBatch: false`), `include_suspect=true` (marked rows) and
  `include_suspect=yes` (400).
- `node scripts/api-contract-probe.mjs` (needs `RB_API_KEY`): the version pin and
  three new `/v1/changes` checks.
- The owner's admin-ops call: `agrees: true`, and `unlisted` the same length as
  section 40's `unlisted_client_callable` (2 on 2026-10-07).
- Optional, keyed: for one 24-hour window, the count of `closed[]` rows with and
  without `include_suspect=true` is the share of that day's closures the
  collector doubted. It moves with the Workday resumed-visit flaps described in
  20261002113617, so a large share is expected until that fetcher is fixed.

## For the integrator

- No anon- or authenticated-callable SECURITY DEFINER function is added. The one
  new function, `client_callable_unlisted_names()`, is INVOKER and
  service-role only, so it is not in the client-callable census and needs no
  entry in `client-callable-allowlist.ts`.
  `the-census-counted-the-unlisted-definers-and-named-none.test.ts` replays every
  migration and holds that each name in `ADMIN_CATALOGUE_RPCS` stays INVOKER and
  closed to client roles.
- The names reader reads the census's lists from the census's stored body (the
  quoted `'public.name(args)'` literals). If the integration re-issues
  `client_callable_census`, keep its signatures as quoted literals in the body,
  or the reader reports `agrees: false`. Its migration's self-check runs only at
  its own apply time, so a later census in another shape is not caught there.
  The test re-runs the reader against a re-issued census with one entry added.
- `admin-ops/rpcs.ts` has a second exported set, `ADMIN_CATALOGUE_RPCS`. The
  census test's `ADMIN_RPCS` parse reads only the first set (`ADMIN_OPS_RPCS`),
  so the "admin-ops serves exactly closed readers" check is unchanged.
- Pins relaxed to "this build or later": `scripts/verify-deploy.d/40-db-exposure.sh`
  (admin-ops, now `build_ge`) and
  `src/test/the-agent-seams-answer-the-caller-they-name.test.ts` (the
  agents-api builds, read from `FN_BUILD` or `BUILD_VERSION`).
- `src/test/the-scorer-in-its-own-isolate.test.ts` pins `apiVersion`
  2026-10-08.1 and forbids 2026-09-30.1; `scripts/api-contract-probe.mjs` moved
  with it. If another group also bumps public-api's `apiVersion`, take the later
  one and add this one to the forbidden list.
