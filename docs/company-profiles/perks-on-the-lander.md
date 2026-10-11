# Company profiles, phase 2: perks on the company lander

Plan: company profiles (2026-10-11), section 8 "Phase 2", owner decision D1
(checkmark list, built honestly). The hydrated `/jobs/company/:token` lander
reads `get_employer_perks` and shows the perks the employer's own open postings
state. **Nothing shows until a key passes its 60-row audit**: every key ships
unpublished (phase 1), and an unpublished or expired key renders nothing: no
heading, no placeholder, no "being checked".

## What ships

| Piece | What it is |
|---|---|
| `src/lib/employer-perks.ts` | The pure half: reads the reader's answer and decides what may print (`perksView`). Mirrors the candidate keys, the claim threshold (n >= 5, k >= 2, k/n >= 10%) and the visa bar (k >= 3); a guard reads each back from the migration and `_shared/perks-extract.ts`. |
| `src/components/jobs/CompanyPerks.tsx` | The block, mounted in `src/pages/Jobs.tsx` under `landerCompany`, after the intel strip. |
| `jobsPage.perks.*` | 29 strings in all nine locales. |
| `20261012110000` (edited, still unapplied) | The reader now names the keys live right now (`published_keys`), and a stated visa limit needs three postings in the reader and in the owner's draw (plan section 4, "Stated limits"). |
| `scripts/verify-deploy.d/80-company-profiles-perks.sh` | The shape check now requires `published_keys`, every printed row inside it, and k >= 3 on a visa row. |

No edge function changes. job-board is not touched.

## What the block prints

- Heading "Perks stated in their job postings", and the line saying a perk not
  listed doesn't mean it isn't offered.
- One check per live key above the threshold, per country; countries get a
  subheading only when more than one qualifies.
- Tap, hover (mouse or pen) or keyboard focus opens the basis: "Stated in at
  least k of n open <country> postings we could read, read <date>", the
  verbatim line, and a link to the posting it came from while that posting
  still serves (otherwise it says the posting is no longer on the board).
- Tags on the check: "conditions stated" when a third or more of the k
  postings hedge it or limit who is eligible (the panel gives the count), and
  "may be the legal minimum" on UK and German rows with a statutory baseline
  (the panel links the statute and says "this line may describe that
  minimum").
- A stated visa limit is listed apart under "Stated limits", never with a
  checkmark.
- A token two vendors share, an agency's board, a franchise board or a vendor
  whose benefits text we drop: no check, only the reason, and only while some
  key is live. With no key live anywhere, those boards render nothing too.
  On the lander, a token the catalogue lists as carried by two hiring systems
  (`src/lib/board-collisions.ts`) does not mount the block at all: its page
  shows only the per-vendor split, so the collision reason appears only where
  the reader finds two sources among a token's perk rows that the catalogue
  does not list.

Each check is a `<button>` with `aria-expanded`, `aria-controls` (its panel)
and `aria-describedby` (the count sentence). Escape closes an open panel and
returns focus to the check.

## Deploy

It rides phase 1's step 1: migration `20261012110000` (with this edit) and
`20261012110100`, the employer-profiles function, and a frontend publish
carrying the block. Section 80 must pass, including the new
`published_keys` clause. The lander shows nothing until the first key's audit
records 57 of 60 (`node scripts/perk-audit.mjs draw|record`, see
perks-engine.md).

## Changelog

Hold the changelog entry until a key is published and the block is seen live on
a lander: before then there is nothing a visitor can see.

## Not in this phase

- The plan's eligibility tag quotes the qualifier itself. The rollup stores one
  line per row (the modal line), not a separate qualifier line, so the tag
  gives the count of hedged postings instead; the quoted line often carries the
  qualifier. A qualifier quote needs a rollup column (phase 4 precompute).
- Bake, MCP and `/v1` (phases 4 and 5) must apply the same view rules; the copy
  module for those surfaces is phase 4.
