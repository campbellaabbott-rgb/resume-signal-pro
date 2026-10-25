# resume-match deploy notes

## 2026-10-16.1: phase 0, the engine and resume-match behind no UI

Branch `rm/engine`. Design and measurements: `docs/resume-match.md`. Proof
after deploy: `scripts/verify-deploy.d/97-resume-match.sh` (section 97). Every
claim below has a line there.

### What ships

- **A new function, `resume-match`**, build `resume-match.2026-10-16.1`, sent
  in `x-fn-build` on every response, the preflight included. No page calls it.
- **Five new shared modules** (`_shared/resume-profile.ts`,
  `_shared/title-families.ts`, `_shared/posting-requirements.ts`,
  `_shared/match-tiers.ts`, `_shared/licence-rules.ts`). Only resume-match
  imports them, so no other function's bundle changes and no other build stamp
  moves.
- **Four migrations**, new objects only (nothing existing is altered):

  | stamp | objects |
  |---|---|
  | 20261016100000 | `geo_places` (empty until the GeoNames seed) |
  | 20261016101000 | `metro_ring(city, region, country, km, max)` |
  | 20261016102000 | `match_candidates`, its builder `match_candidates_query`, and `match_candidates_explain` for the timing gate |
  | 20261016103000 | `job_posting_requirements` and the daily cron `purge-job-posting-requirements`, whose command sets its own `statement_timeout` |

  Every object is service-role only: RLS on with no policy for the tables,
  Supabase's default grants revoked from PUBLIC, anon and authenticated by
  name, and a DO block in each file that RAISEs if a client role still holds
  anything. No definer is added. Each file is safe to run twice.
- **No frontend change, no `config.toml` change** (the anon key is a JWT, so
  the default verify_jwt passes), **no new secret**. `RESUME_MATCH_ORDER=recent`
  is an optional switch for the timing gate's fallback; leave it unset.

### Deploy order

1. **The four migrations first.** Without `match_candidates` every match
   answers 500. Lovable's staged runner has edited failing migrations before,
   so judge "applied" by behaviour: section 97's probes answer 42501 for each
   of the four functions and both tables (a missing object is a FAIL once the
   build serves), and the purge job appears in `get_cron_health` with its
   timeout.
2. **Then the function** (`resume-match`).
3. **Run section 97.** It makes ten timed anonymous matches with synthetic
   profiles, then repeats the first profile until this network's bucket
   answers 429 (at most 31 calls in all). That spends the verifying network's
   hour: a second run within the hour prints the timings as INFO and judges
   the 429 at once. Run it again an hour later if the timings were INFO.
4. **The changelog** entry is written from what section 97 proved live, after section
   97 passes (owner rule). Phase 0 has no reader-visible change.
5. **Before phase 1**: the timing gate (`docs/resume-match.md`, "The timing
   gate"), in the deploy session with SQL access.

The ledger reservation (`resume-match`: `rm/`, `20261016*`, fnBuildDate
2026-10-16, deployOrder 5) is the integrator's to add to
`docs/deploy-ledger.json`.

### Claims and the section 97 lines that check them

| claim | section 97 line |
|---|---|
| resume-match serves `resume-match.2026-10-16.1` or later and answers the site's origin | `resume-match preflight x-fn-build = ...`; `access-control-allow-origin = ...` |
| no client role can call `match_candidates`, `match_candidates_query`, `match_candidates_explain` or `metro_ring` | `<fn> as anon -> 42501` (GET probes: read-only even if a revoke regressed) |
| no client role can read `geo_places` or `job_posting_requirements` | `<table> as anon -> 401 42501` |
| the requirement cache is purged daily under its own timeout | `purge-job-posting-requirements sets its own timeout in the command: 120s` |
| the site's matcher refuses résumé text; the server surfaces answer only the service role | `resume text from a site caller -> 400 resume_text_refused`; `the mcp surface without the service key -> 403 server_surface` |
| first page p50 ≤2.5 s and p90 ≤4 s wall over ten synthetic profiles | `wall p50 = ...`, `wall p90 = ...` (nearest rank, curl's wall time, the cold start included) |
| the candidates statement p90 ≤700 ms | `phaseMs.candidates p90 = ...` |
| edge CPU under the 2 s cap | `cpuMs p50 ..., p90 ..., max ...` |
| every answer names its phases, its CPU and its build | `10 answers carry phaseMs {...}, cpuMs, and a build equal to their x-fn-build` |
| every row is tiered strong, good or stretch | `N rows over 10 answers, every one tiered ...` |
| a row whose requirements were not read is capped at Good and labelled `requirements not read` | `N of M rows have requirements not read: each capped at good and labelled ...` (INFO when no row came back unread) |
| the reader's profile values are not echoed (a former job, work authorisation, a licence) | `the canary profile ... is not echoed` |
| Columbus, OH never reaches Columbus, GA | `Columbus, OH: N rows, 0 in Georgia`; with the GeoNames seed applied, also `Columbus, OH ring (...) contains Westerville: true` (INFO while the ring is the city alone) |
| no served match sentence uses a banned word | `N served match sentences hold none of the ... banned patterns` (the list is read from `_shared/match-tiers.ts`) |
| 30 calls an hour per network, then 429 from the function itself | `call N of this run -> 429 rate_limited limit 30 scope network, Retry-After 3600, from resume-match...` |

### Known INFO lines after this deploy

- **The Columbus, OH ring** prints INFO (`ring source = city-only`) until the
  GeoNames seed is generated (`scripts/match/build-geo-seed.mjs`, from the
  owner's download of `cities5000.txt` and `admin1CodesASCII.txt`) and
  applied. The Georgia line is judged regardless.
- **The cap on unread requirements** is INFO only if every row of the ten
  answers had its description read, which the live corpus makes unlikely.

### Not in this deploy

- The parse-pdf and parse-docx logging fix (file names and raw IPs in logs).
  Wave 4's second round owns both files; S12 routes their items to job-board.
- The GeoNames seed rows, the held-out AFTER run with its own probe budget
  and hand review, family mining, and phases 1-4 (`docs/resume-match.md`, "Not
  done in phase 0").

### Rollback

Nothing calls resume-match, and the migrations add objects nothing else reads.
Leaving them in place is harmless; there is nothing to roll back for any other
feature.
