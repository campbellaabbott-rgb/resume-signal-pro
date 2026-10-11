# Company profiles, phase 1: the perk engine

Plan: company profiles (2026-10-11), sections 3, 5 and 6 A and C. This phase
stores what employers' own postings say they offer, rolls it up per board,
country and perk, and opens one reader. **Nothing shows to anyone yet**: every
perk key ships unpublished, and the lander's perks block is phase 2.

## What ships

| Piece | What it is |
|---|---|
| `supabase/functions/_shared/perks-extract.ts` | The frozen prototype extractor (sha1 c9c0cf6f), decisions unchanged, plus the stored encoding. Imported by employer-profiles only. |
| `supabase/functions/employer-profiles` (`employer-profiles.2026-10-12.1`) | `sweep` (cron key only) and four owner actions (`audit_status`, `audit_draw`, `audit_record`, `audit_pause`, admin key only). `verify_jwt = false`. |
| `20261012110000` | Eleven private tables (RLS on, no policy, every client privilege revoked), the sweep's take and store, the nightly rollup, the lease, the owner's audit functions, and the reader `get_employer_perks(p_token)`, which also names the keys live right now (`published_keys`, read by the phase-2 lander block) and shows a stated visa limit only on three postings or more (the draw holds the same bar). |
| `20261012110100` | `client_callable_census()` re-issued whole with the reader on its anon list. |
| `20261012111000` | The vault key, `employer_profiles_cron_key_matches`, and two crons: `employer-perks-sweep` every minute, `employer-perks-rollup` at 00:13, 00:43, 01:13 and 01:43 UTC. **Held** until step 1 verifies (`docs/deploy-ledger.json`). |
| `scripts/perk-audit.mjs` | Draws rows for the row audit, writes the review file, records the judgement. |
| `scripts/verify-deploy.d/80-company-profiles-perks.sh` | The deploy's claims. |

job-board is not touched.

## Deploy

1. Step 1: migrations `20261012110000` and `20261012110100`, and the
   employer-profiles function. Run `bash scripts/verify-deploy.sh`: section 80
   must pass (the build, both key headers allowed, a keyless POST refused, the
   reader answering anon in shape, the perk tables refusing anon). Section 40's
   census must still show nothing unlisted.
2. Step 2: release `20261012111000` from `holdUntilVerified` and apply it. The
   sweep starts within a minute.

## After deploy

- `node scripts/perk-audit.mjs status` (needs `ADMIN_API_KEY` in the
  environment or `~/.config/resumebooster/admin-api-key`) prints each key's
  audit state, the queue, the rollup lap and the newest runs. The sweep's
  `msPerPosting` is in every run note. Raise `employer_profile_config.sweep_batch`
  above 300 only once that is measured under 3 ms.
- Measure the perk tables' size after the top 2,000 boards are read
  (`pg_total_relation_size` on `employer_perk_postings` and `employer_perk_lines`)
  before letting the sweep run on; disk headroom is unresolved.
- V6b: compare job-board's deep-cursor advance rate over the 2 hours before
  and after the sweep starts; it should stay within 10%. If not:
  `node scripts/perk-audit.mjs pause --sweep on`.

## Publishing a perk (D2, D19)

For each candidate key (health, dental, vision, life_dis, retire, pto,
parental, equity, visa_not_offered):

1. `node scripts/perk-audit.mjs draw --perk health` writes 60 random
   publishable rows, each with the employer, the quoted line, the posting link
   and a 3-posting spot check, to `~/.config/resumebooster/perk-audits/`.
2. Independent judges fill `judges` on every row; the owner sets `owner` on at
   least 10. A row is right only if the quote says the hiring employer (not an
   agency, franchisor or customer) offers the perk in that posting and the spot
   check agrees. The owner's word overrides the judges; one judge's dissent
   makes a row wrong.
3. `node scripts/perk-audit.mjs record --file <file>`: 57 of 60 publishes the
   key for 45 days; fewer unpublishes it.

Monthly: `reaudit-draw` (60 rows across the published keys, at least 5 each),
judge, `record`. Under 57 of 60 pooled pauses every perk; two wrong in one
key's stratum unpublishes that key; otherwise each key's 45 days restart. A key
nobody re-audits stops showing on day 45 by itself.

Withheld keys (flex, mental, childcare, discount, commute, meals, bonus,
learning, generic, positive visa offers) can never publish: the publish
table's CHECK, the reader and the audit function each refuse them.

## Switches

- `pause --sweep on|off`: the sweep stops between batches.
- `pause --publish on|off`: every perk hidden at once.
- `employer_profile_config.suppressed_sources` (default lever, oracle,
  pinpoint, usajobs): rows are counted but never shown, with the reason, until
  job-board stores those vendors' benefits text (phase 3).
