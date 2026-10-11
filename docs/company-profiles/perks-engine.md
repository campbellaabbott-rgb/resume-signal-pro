# Company profiles, phase 1: the perk engine

Plan: company profiles (2026-10-11), sections 3, 5 and 6 A and C. This phase
stores what employers' own postings say they offer, rolls it up per board,
country and perk, and opens one reader. **Nothing shows to anyone yet**: every
perk key ships unpublished, and the lander's perks block is phase 2.

## What ships

| Piece | What it is |
|---|---|
| `supabase/functions/_shared/perks-extract.ts` | The frozen prototype extractor (sha1 c9c0cf6f), decisions unchanged, plus the stored encoding. Imported by employer-profiles only. |
| `supabase/functions/employer-profiles` (`employer-profiles.2026-10-12.2`) | `sweep` (cron key only) and four owner actions (`audit_status`, `audit_draw`, `audit_record`, `audit_pause`, admin key only). `verify_jwt = false`. |
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

## What the reader may say, and when

- **English postings only.** Every posting is marked `english` when read
  (`isEnglishText` in `_shared/perks-extract.ts`: the Latin script and the
  share of English function words against those of the other languages the
  extractor's headings name; a posting it cannot place is not English). The
  rollup counts only English postings, in k and in n, so a key that passes its
  audit publishes no German, French, Dutch, Swedish or Polish line. Other
  languages wait for the blind second labelled set (plan section 3, D2), and
  then a per-key, per-language flag. The audit draw and its spot check read
  English postings only. The lander's basis line says so.
- **Fail closed whole.** With no key live, `get_employer_perks` answers
  `withheld: []` and `collision: false`: a board's franchise share, agency
  share and vendor suppression are the rollup's own output and stay inside
  until something is published. Verify section 80 fails a reader that leaks
  them.
- **A legal-minimum note only where the line can be the minimum.** A leave
  line carries the days it states (`employer_perk_lines.pto_days`, weeks
  counted as five, hours never; `pto_plus_holidays` when bank or public
  holidays come on top). The reader drops the baseline when the line states
  more than `perk_legal_baselines.minimum_days` (DE 20 on a five-day week; GB
  28, or 20 when bank holidays come on top).
- **Statute extent.** The GB rows say where their statute applies (the Working
  Time Regulations 1998 extend to Great Britain, the Pensions Act 2008 to
  England, Wales and Scotland) and cite the Northern Ireland law that sets the
  same minimum (Working Time Regulations (Northern Ireland) 2016, regs 15 and
  16; Pensions (No. 2) Act (Northern Ireland) 2008, Part 1, Chapter 1), read
  on legislation.gov.uk on 2026-10-11. Northern Ireland postings share the GB
  country group.
- **An expired key stays expired.** `employer_perk_audit_status` reports
  `published` as the reader does (the flag and an audit under 45 days old),
  with `flag`, `expired` and `live` beside it. A re-audit never brings back a
  key whose 45 days ran out: it needs a launch audit of 60 rows.
  `perk-audit.mjs status` prints it as EXPIRED, and `reaudit-draw` skips it.

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

Monthly: `reaudit-draw` (60 rows across the published, unexpired keys, at
least 5 each), judge, `record`. Under 57 of 60 pooled pauses every perk; two
wrong in one key's stratum unpublishes that key; otherwise each key's 45 days
restart. A key nobody re-audits stops showing on day 45 by itself, and from
then on only a launch audit brings it back.

Withheld keys (flex, mental, childcare, discount, commute, meals, bonus,
learning, generic, positive visa offers) can never publish: the publish
table's CHECK, the reader and the audit function each refuse them.

## Switches

- `pause --sweep on|off`: the sweep stops between batches.
- `pause --publish on|off`: every perk hidden at once.
- `employer_profile_config.suppressed_sources` (default lever, oracle,
  pinpoint, usajobs): rows are counted but never shown, with the reason, until
  job-board stores those vendors' benefits text (phase 3).
