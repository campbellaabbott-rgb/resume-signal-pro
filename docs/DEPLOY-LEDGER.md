# Deploy ledger: how parallel work reaches production without mistakes

Several workstreams run at once (fix waves, audits, sweeps, feature builds).
Only Lovable deploys, one session at a time, from GitHub main. These rules keep
what is on main, what is deployed, and what each workstream is building from
drifting apart.

## 1. The ledger is the only source of a deploy list

Never write a deploy message by hand. Run:

    node scripts/deploy-ledger.mjs --message

It compares every edge function's build stamp on main with the `x-fn-build`
production answers, and every migration on main with the ones Lovable's staged
runner recorded (`drizzle/migrations`), and prints the Lovable message that
closes the gap. Policy lives in `docs/deploy-ledger.json`:

- `neverApply`: superseded migrations (applying them would revert a later one).
- `holdUntilVerified`: migrations that start scheduled work; they go out in a
  second message only after the first one verifies live.
- `drizzleBaseline`: the staged-runner record is complete from this stamp on.
- `migrationOrder`: per migration stamp, `after` is `fn:<name>@<YYYY-MM-DD.N>`
  (apply once that function answers that build or later) or `frontend`
  (apply once the frontend is published), and `before` lists `fn:<name>`
  the migration must precede. The message prints five steps: migrations
  before the functions, the functions, migrations after the function each
  waits for, the frontend, migrations after the frontend. A rule that cannot
  be met (main carries an earlier build, or no such function) stops the
  message (exit 6). A migration with no entry goes before the functions.
- `reservations`: the migration-timestamp day and job-board version each
  workstream may use, so two branches never collide, and the order they
  deploy in (`deployOrder`, §3).
- `sharedFiles`: the owner of each file that two parallel branches both
  change (§6; checked by `--overlap`).

`--message` runs `git fetch origin main` and refuses (exit 5) unless HEAD is
origin/main: Lovable pulls main, and a stale checkout re-lists migrations
already applied. It also refuses, naming the paths, when any input it reads
from the working tree (supabase/functions, supabase/migrations,
drizzle/migrations, docs/deploy-ledger.json, the script itself) differs from
that commit: an untracked migration would otherwise be listed under main's
commit. `--draft` prints the same message from any checkout, headed
as a draft that is not a deploy message. A function whose preflight does not
answer, twice, is "could not check": the report lists it, the message opens
with a STOP naming it, section 49 FAILs it, and the script exits 4.

The script exits 2 when a function's own code changed after a stamp that is
ALREADY LIVE ("MUST BUMP"): such a deploy could not be told apart from what is
live. It also lists "CHECK" functions whose `_shared` imports changed after their
live stamp; bump them unless the change cannot reach their behaviour (an added
export, a comment).

`scripts/verify-deploy.d/49-deploy-ledger.sh` runs the same comparison after
every deploy: anything main has that production does not is a FAIL line.

## 2. One deploy at a time, main frozen in between

1. A workstream lands on main only through an integration PR whose full test
   suite passed. An integration branch must pass `--against origin/main` and
   `--against` each merged branch's tip before it merges:

       node scripts/deploy-ledger.mjs --against origin/main --against wave3/job-board --against ...

   For every function whose folder or `_shared` imports differ between the
   ref and HEAD, HEAD's build must sort at or after the ref's (`buildAtLeast`:
   date first, then the numeric sequence) and be a different string. The
   same string on different code is the class wave 3 hit:
   send-search-digest.2026-10-09.1 on three branches, eleven functions'
   .2026-10-09.1 on two. Any violation exits 3 (exit 2 stays MUST BUMP).
   The mode is read-only and makes no network call. A relabel is not moved
   code: every changed line carries the function's own build marker, and with
   the marker masked the removed and added lines are the same lines. A line
   that changes anything beside the marker is code. A build whose sequence
   has a leading zero (`.04`) is unreadable, never "later".
   One string may be shared: the job-board version reserved to a workstream
   (`reservations`), between a ref and HEAD that both belong to that
   workstream, while main carries neither that version nor a later one. A
   branch belongs to the workstream whose `branches` list names it (an entry
   ending in `/` is a prefix). A commit id, an unnamed branch or another
   workstream's branch shares nothing. `--main` names the deployable ref and
   `--head` judges another commit (by its branch name, so a commit id gets no
   allowance).
2. After it merges, main is FROZEN: nothing else merges until the owner has run
   the Lovable message generated from that exact commit and the verifier (plus
   the ledger) shows no gap.
3. When it verifies, record it in `docs/deploy-ledger.json` `verifiedDeploys`:
   the commit the message named and every function it deployed, with its
   build. Lovable deploys a function as main holds it, so code changed after a
   stamp was written but before that commit is live; from then on the ledger
   asks for a bump only for changes after the recorded deploy (without the
   record, all seven functions fixed during wave 2's integration read MUST
   BUMP the moment their stamps went live). Then release the held migrations
   (empty their `holdUntilVerified` entries) and send them in a second message.
4. Then the next integration may merge.

Branches keep working while main is frozen; they merge when it thaws, against
the new main, and the ledger is re-run.

## 3. Reserved ranges

The deploy order from 2026-10-11 is the order of the rows after the done ones.
Each row is a `reservations` key in `docs/deploy-ledger.json`, which carries
the order as `deployOrder`.

| deploy | workstream (`reservations` key; branches) | migrations | job-board BUILD_VERSION | other FN_BUILD date |
|---|---|---|---|---|
| done | wave 2 (`wave2`; PR #24, verified 2026-10-11) | 20261008* | 2026-09-09.91 | 2026-10-08 |
| done | ledger repair (PR #25) | none | none | 2026-10-10 |
| 1 | wave 3 (`wave3`; wave3/, the S11 round's w31/, post-wave3/). Deployed 2026-10-11. Its closeout is the post-wave-3 tooling PR, then the three released migrations | 20261009* | 2026-09-09.92 | 2026-10-09 |
| 2 | company profiles phases 0-2 (`company-profiles`; profiles/) | 20261012* | none: no job-board change | 2026-10-12 |
| 3 | wave 4 (`wave4`; wave4/, connect-apply/): the S12 sweep fixes, the connect-search-apply build and the profiles MCP and /v1 tools, built and integrated as ONE wave. Until 2026-10-11 this was the connect-and-apply reservation | 20261011* | 2026-09-09.93 | 2026-10-11 |
| 4 | company profiles phase 3, vendor benefits capture (`company-profiles-phase3`; profiles-p3/) | 20261013* | 2026-09-09.94 | 2026-10-13 |
| after | next | 20261014* onwards, one day each | 2026-09-09.95+ | that day |

A migration stamp need not sort in deploy order. Wave 4's 20261011* deploys
after profiles' 20261012*, and the ledger lists whatever the staged runner has
not recorded, whatever sorts first. Function stamps follow the rule below:
wave 4 may not stamp 2026-10-11 on a function profiles already stamped
2026-10-12.

When two branches bump the same function, the integration keeps BOTH changes
and gives the function a new stamp later than either. Every function whose code
the integration changed gets a stamp later than main's and later than, and
different from, every merged branch's. A function main last stamped on a later
day (PR #25's 2026-10-10.1) takes that day with a higher sequence. The
`--against` checks in §2 enforce this.

## 4. Findings go to one backlog, fixes to one wave

Audits and sweeps never edit code. Their registers live privately under
`~/.config/resumebooster/` and are merged into the next fix wave's input, with
items already fixed or in flight removed. A fix wave owns its files until it
merges; a finding that touches files an in-flight wave owns waits for the next
wave.

## 5. Every function carries a build marker

A function without `x-fn-build` cannot be verified after a deploy, and a
stamp the function never SENDS counts as no marker (layoff-filings carries a
BUILD_VERSION that only reaches a JSON body). Any
workstream that changes such a function adds a marker (`FN_BUILD` in the CORS
headers, as the other functions do). The ledger lists the ones still missing.

## 6. Parallel branches own their files

Branches that run at the same time change disjoint sets of files, or the
ledger names who owns each file they share. A file two branches both edit is
merged by whoever comes second, from memory, and the edits made in the other
branch are what gets lost. A function two branches both change is the same
risk one level up, plus a build-stamp collision (§2).

`docs/deploy-ledger.json` `sharedFiles` maps a path to the workstream (a
`reservations` key) that owns it. A key ending in `/` covers its folder, and
`fn:<name>` covers a function. The owner's version is the base. The other
branch rebases onto it after the owner merges and re-applies only its own
entries. Name an owner only when the overlap cannot be moved to one branch.

    node scripts/deploy-ledger.mjs --overlap <ref> [<ref> ...] [--main <ref>]

For each ref it diffs `merge-base(ref, origin/main)..ref`, so each branch is
judged by its own changes and not by what main gained since it forked. It
lists every file changed by more than one ref, and every function changed by
more than one ref (its own folder, or a `_shared` module it imports at that
ref). It exits 4 when any of them has no owner in `sharedFiles`, or an owner
that no reservation names. Pure git: no network, no fetch (run
`git fetch origin` first).

Run it on every in-flight branch:

- **before launching parallel builders**, on the branches they will start
  from, and again once each has pushed;
- **before merging any branch while another is in flight**, on all of them,
  the one merging included.

An undeclared overlap is settled before the work continues: move the change to
one branch, or give the file an owner in `sharedFiles` and say in both
branches' notes what the other must keep.
