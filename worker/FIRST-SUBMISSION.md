# The first real submission

One run closes the last unknown in the apply chain. Everything else is verified:
dry runs drive live vendor forms up to the button, and `src/harness.ts` drives
the real `applyToPosting` past the click across all six outcomes. What has never
happened is a submit against an actual vendor.

**What it tests that nothing else can.** Every phrase in `CONFIRMED_RE` is a
guess — nobody has seen a Breezy confirmation page. Until one is seen, a
successful send most likely lands as `uncertain`: parked for a human, never
retried. That is the safe failure, but it means unattended sending does nothing
useful. This run replaces the guess with the real sentence.

## Why a job you own

The application arrives in your own inbox instead of a stranger's. Every other
posting on the board belongs to a real employer with a real person reading it,
and a test application wastes their time and burns the posting for whoever the
CV belongs to.

## Setup — free, no card

Breezy's **Bootstrap** plan is free forever and includes a branded career site.
No credit card, and no 14-day clock to race.

1. Sign up at <https://breezy.hr> — Bootstrap plan.
2. Post one position. It becomes public at `https://<yourcompany>.breezy.hr/p/<id>`.
3. Configure it deliberately:

   | setting | value | why |
   |---|---|---|
   | Title | `TEST — do not process` | unambiguous to anyone who sees it |
   | Résumé | required | exercises the file-upload path |
   | One screening question | "Are you legally authorized to work in the US?" — Yes/No, **required** | the matcher answering a REAL vendor's question is the part with no live coverage |

   Resist adding more questions on the first run. One answerable question proves
   the matcher end to end; a wall of them only proves it refuses, which the dry
   run already showed on bidvestbank.

## Dry run first — sends nothing

```bash
cd worker
npx tsx src/dryrun.ts "https://<yourcompany>.breezy.hr/p/<id>" breezy --profile applicant.json
```

Expect `[4b]` to show `ANSWER [work-authorization] … -> choose "Yes"` and
`DRY RUN CLEAN`. If it refuses, stop and read the reason — that is the matcher
telling you something true about the form.

## Then the real one

```bash
cp applicant.example.json applicant.json     # gitignored; real details, real résumé path
npx tsx src/dryrun.ts "https://<yourcompany>.breezy.hr/p/<id>" breezy \
  --submit --profile applicant.json --headed
```

`--headed` so you watch it happen. Before anything is sent it prints the
posting, name, email and résumé path and waits for you to type `SUBMIT`.

**This is irreversible.** A real application arrives at a real inbox — yours.

## What to do with the result

- **`submitted`** — the phrase matched. Nothing to change; record which one hit.
- **`uncertain`** — the expected outcome, and the useful one. The reason now
  carries the landing URL and the page's first 220 characters, and a screenshot
  is saved under `worker/mac/uncertain/`. Copy the confirmation sentence into
  `CONFIRMED_RE` in `src/vendors/confirmed.ts`, add a harness case for it, and
  re-run.
- **`not-submitted`** — the form was still on screen, so nothing was sent. Read
  the reason; something upstream of the click failed.

Do not "fix" an `uncertain` by loosening the phrase list until it passes. The
list exists to recognise a real confirmation, and a pattern broad enough to
match anything would report every failed submit as sent — the exact bug found in
all three adapters on 2026-07-31.

## After it works

Delete the test posting. Leaving a fake job on a public careers site is the kind
of thing this product exists to complain about.
