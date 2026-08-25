import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * sources.ts and BUILD_VERSION must change together.
 *
 * WHAT THIS PREVENTS, learned the expensive way on 2026-08-01. 22 verified
 * Pinpoint boards were merged into sources.ts and deployed. The catalog grew by
 * exactly 22, the tokens were present, and not one posting appeared on the
 * board for hours.
 *
 * The cause: brand-new boards are jumped ahead of the ~28,000-board cold
 * rotation by a bootstrap lane, and that lane is keyed on BUILD_VERSION. With
 * the constant unchanged it never recomputed, so the new boards took their
 * place at the back of a queue that takes days to come round. Catalog correct,
 * board empty — nothing errored, nothing looked wrong, and the only symptom was
 * an absence.
 *
 * The comment in index.ts said to bump BUILD_VERSION when a SHARED MODULE
 * changed. It did not mention sources.ts. A rule that lives only in a comment
 * fails exactly when someone edits the one file the comment forgot to name, so
 * this asserts it instead.
 *
 * WHEN THIS TEST FAILS, that is it working. Bump BUILD_VERSION in
 * supabase/functions/job-board/index.ts, then paste the new hash it prints
 * below. Two deliberate edits, which is the point — the second is the receipt
 * for the first.
 */
const ROOT = resolve(__dirname, "../../supabase/functions/job-board");

/** Updated together with BUILD_VERSION, never on its own. */
const PINNED = {
  // 2026-08-10.1: +11 of the 14 HELD Workable boards (~1,786 postings), finally
  // given a real verdict — Workable stopped throttling, so the description
  // screen could actually read them. Three were confirmed mills and stay out:
  // solution-sft (597p, hospital nurse placement), gotham-enterprises (563p,
  // near-identical therapist ads + on-behalf language), ubteam (122p, 6/12
  // recruiting-on-behalf). Two lessons paid for in this batch: rimkus's 8/12
  // "our client" hits were a CONSULTANCY describing its own service work
  // (context read, kept), and 4chain's Schwertfels-shaped salary-band titles
  // carried zero placement language in two languages across 40 ads (kept).
  // Evidence convicts; names alone do not.
  // 2026-08-10.2: +Domino's (smartrecruiters:dominos, 24,566 postings) — the
  // hold from 2026-08-07 released on the middle path: merged into the board
  // and search, excluded from EDITORIAL stats via showcase_excluded, and kept
  // out of the hot tier through both doors (velocity RPC and size ranking).
  // Same commit: +11 of the held Workable boards.
  // 2026-08-10.3: SR_CAP 800 -> 2,000. sources.ts is UNCHANGED by that (the
  // hash below still pins the Domino's + Workable merge); the bump is for the
  // fetcher itself, so the deployed bundle is identifiable when checking
  // whether the larger window actually landed.
  // 2026-08-11.1: 29 boards renamed in sources.ts. Most were the slug
  // title-cased and rendered that way on company cards — "Thehartford",
  // "Hdsupply", "Nyp", "Umd", "Ummh", "Ncsecu". Four were worse than cosmetic:
  // Fabletics, Savage X Fenty and JustFab all sat under the parent slug
  // "Justfab", and PHP Agency / Ritter / Connexion Point under
  // "Integritymarketing" — and get_size_segments merges boards BY DISPLAY NAME,
  // so those distinct employers were being counted as one company.
  // Ships with NAME_SYNC_VERSION 2, because the refresh is insert-only and a
  // rename reaches stored rows through that sweep or not at all.
  // 2026-08-11.2: 9 more board renames (8 employers; Embry-Riddle has two
  // boards). These became visible only AFTER the Explore migrations landed —
  // "Transparent about pay" rendered for the first time and the size bands
  // re-cut on served counts, surfacing cards that had never been on screen.
  // Every name was verified against the employer's own board or careers site;
  // two differed from the obvious guess (Alignment Health, not Healthcare;
  // AnewHealth, not ExactCare). Ships with NAME_SYNC_VERSION 3.
  // 2026-08-11.3: name-sync repair only — sources.ts is UNCHANGED (the hash
  // below still pins the v3 renames). Measured after the v2 sweep ran: tokens
  // 1-14 renamed, 15-29 untouched, and the run would have stamped itself
  // complete over its own failures. The sweep now skips already-correct boards,
  // narrows each UPDATE to rows that differ, and refuses to stamp its version
  // when any board failed. Bumped so the deploy is externally identifiable.
  // 2026-08-12.1: +18 iCIMS employers / 9,282 postings (round 2, two-hop CDX
  // discovery — see the block comment above the iCIMS entries in sources.ts).
  // This test is the reason they will actually appear: the bootstrap lane is
  // keyed on BUILD_VERSION, and 18 new boards behind a 28,000-board cold
  // rotation would have been days of "catalog correct, board empty" — the exact
  // Pinpoint failure this guard was written for, reproduced at 18x the size.
  //
  // Same bump also carries the structured-sweep lane, which is index.ts-only.
  // 2026-08-12.2: structured-sweep kick MOVED out of the starved tail of
  // maybeKickMaintenance up to the independent-track block. sources.ts is
  // UNCHANGED (the hash below still pins the iCIMS round-2 merge); the bump is
  // so the fix is externally identifiable. The lane had deployed and never run
  // — four status polls over 13 minutes, structuredSweep all-null — because two
  // branches above it return after kicking.
  // 2026-08-12.3: the lane still never ran after .2, and the reorder was not
  // the whole bug. `id` is source:token:externalId, so ordering by id orders by
  // VENDOR, and every vendor sorts before "workday" — an empty cursor made hop
  // one scan ~300k non-matching rows and time out. Every later hop would have
  // been fine, so it could only fail at the one hop it could never get past.
  // Cursor now seeds to `workday:`, the walk is bounded above at `workday;`,
  // and the progress row is stamped BEFORE the work so a dead hop stops looking
  // identical to a hop that was never kicked. sources.ts UNCHANGED.
  // 2026-08-12.5 (.4 was minted and reverted with the backlog-policy change):
  // structured-sweep totals become CUMULATIVE through the chain and the
  // done-stamp reports {doneAt, scanned, filled} instead of erasing the pass's
  // evidence — the first real pass finished in ~7 minutes and left a bare
  // {doneAt}, making "small eligible set" and "early termination"
  // indistinguishable. sources.ts UNCHANGED.
  // 2026-08-12.6: the sweep's progress stamp gains firstId/lastId/pageLen —
  // the id window each hop actually visited. The 17:50 pass "completed"
  // against 148,776 eligible rows with the id-prefix assumption verified
  // correct, so the only remaining way to see where the walk went is for the
  // walk to report it. sources.ts UNCHANGED.
  // 2026-08-12.7: the sweep's upper-bound sentinel ";" -> "~". The semicolon
  // is truncated in the REST query string (proven live: lt.workday; matches
  // zero rows, lt.workday~ matches), so the bounded window was empty and two
  // passes stamped doneAt over 148,776 untouched rows. sources.ts UNCHANGED.
  // 2026-08-12.8: structured-sweep hop 120 -> 24 (id-ordered hops cluster on
  // one tenant; a hanging board = 15 waves x 20s = past the wall clock — two
  // passes died mid-hop), and the start-stamp carries its cursor so a dead
  // hop resumes in place instead of from the range start. sources.ts UNCHANGED.
  // 2026-08-13.1: +795 boards / ~6,392 postings across the FOUR SENDABLE
  // vendors (breezy +186, teamtailor +33, pinpoint +288, personio +288) —
  // direct apply-agent inventory, ~19% on top of its 34.5k. Wayback CDX
  // round, every board probed live, names from the employer's own payload or
  // careers-page title (skip-on-doubt), 7 staffing-named boards held out, 52
  // exact-name duplicates skipped. The bump is what puts these into the
  // bootstrap lane instead of a days-long cold rotation.
  // 2026-08-13.2: round 2 of the sendable census. Common Crawl 504s on
  // wildcard host queries (recorded so it is not retried blind); a deeper
  // Wayback pull found breezy/teamtailor already saturated by round 1 and
  // added 19 personio boards. Small by design — the namespaces are close to
  // exhausted, which is itself the finding.
  // 2026-08-17.1: the data-integrity round. sources.ts is UNCHANGED (the hash
  // below still pins the round-2 sendable census); this bump is so the fixes
  // are externally identifiable, and because POSTED_BACKFILL_VERSION 6 -> 7
  // re-arms a sweep that must not run on the old code. Five defects, all
  // measured live: (1) the backfill's draw ran with an EMPTY cursor, so it
  // could not use the primary key and timed out at 3.1-3.3s against a ~3s
  // statement timeout — seeded to `${phase}:` it returns in 0.23s; (2) a draw
  // timeout was read as "phase exhausted" and, on the terminal phase, wrote an
  // unconditional completion stamp recording backlogAtSweep 43,118 rows that
  // nothing had touched — poisoning the growth re-arm into a ratchet; (3) the
  // Workday work-mode classifier tested five substrings against a
  // TENANT-AUTHORED free-text field and matched 0 of 154 sampled postings, so
  // the structured sweep reported 154,003 scanned / 0 filled; (4) `filled`
  // counted update ATTEMPTS, since PostgREST returns no error on a zero-row
  // match; (5) pinpoint sat at exactly 0% dated because a note concluded "no
  // sweep can fix them" from inspecting one endpoint — postings.json has no
  // date, but every posting PAGE carries an employer-stated datePosted in its
  // JSON-LD, and the list already hands us the URL.
  // 2026-08-19.1: +PetSmart (icims, 10,911 postings measured — the census
  // find that also exposed the windowing bug: the global 12-page cap would
  // have served 1,200 of them, so JobSource gained a per-tenant `pages`
  // budget) and +USAJOBS, the first SINGLE-SOURCE vendor on the board (one
  // national federal feed, agency-as-employer, never agent-sendable).
  // 2026-08-21.1: index.ts only — sources.ts is UNCHANGED (the hash below still
  // pins the PetSmart + USAJOBS merge), so no board is waiting on the bootstrap
  // lane and this bump carries no catalog risk. Three search fixes ride on it,
  // all measured live before and after:
  //   - the PGRST203 overload drop, which had left every ranked search falling
  //     through to the recency path with the fuzzy and semantic tiers dead;
  //   - close matches reordered above description-only rows, after "maneger"
  //     was measured putting 7 Dutch care postings above 39 Managers;
  //   - a pay figure typed alone ("120000", "80k") now filters instead of being
  //     searched as text — it returned 0 against a floor that counts 13,381.
  // The bump was applied by the deploy rather than by hand, which is exactly
  // the case this guard exists to catch: the version moved and its receipt did
  // not, so the failure is the test working.
  // 2026-08-21.2: index.ts only — sources.ts UNCHANGED, so no board is waiting
  // on the bootstrap lane. Bumped for a reason this guard did not anticipate:
  // NOT to make a change work, but to make a deploy IDENTIFIABLE. Three commits
  // (intent-to-filter, filter coverage, the servable headline) sat undeployed
  // while the version string read the same as the build that was live, so
  // "is it deployed?" could only be answered by probing behaviour — the exact
  // rung-2 pain the version exists to remove. A version that does not move
  // across a deploy boundary cannot answer the one question it is for.
  // 2026-08-21.3: index.ts only, sources.ts UNCHANGED. Carries the exact-word
  // tier's company half, the possessive variant, and the deadline raise. Bumped
  // as a matter of course this time — the .2 bump had to be made retroactively
  // after three commits shipped undeployed behind an unchanged version string,
  // and "is it live?" cost six behavioural probes to answer.
  sourcesHash: "00d5b6f6d8749589",
  // 2026-08-21.4: disables the exact-word tier's company matcher, whose index
  // never built. Bumped so the mitigation is externally identifiable.
  // 2026-08-21.5: routed retrieval. index.ts + two new modules; sources.ts
  // UNCHANGED, so nothing waits on the bootstrap lane.
  buildVersion: "2026-08-25.3",
};

describe("sources.ts and BUILD_VERSION move together", () => {
  it("has a BUILD_VERSION matching the one pinned here", () => {
    const idx = readFileSync(resolve(ROOT, "index.ts"), "utf8");
    const m = /BUILD_VERSION = "([^"]+)"/.exec(idx);
    expect(m, "BUILD_VERSION not found in index.ts").toBeTruthy();
    expect(
      m![1],
      "BUILD_VERSION changed but PINNED.buildVersion in this test did not — update it",
    ).toBe(PINNED.buildVersion);
  });

  it("fails when sources.ts changes without a BUILD_VERSION bump", () => {
    const hash = createHash("sha256")
      .update(readFileSync(resolve(ROOT, "sources.ts")))
      .digest("hex")
      .slice(0, 16);
    expect(
      hash,
      `sources.ts changed. New boards will NOT enter the bootstrap lane until ` +
        `BUILD_VERSION is bumped — they queue behind ~28,000 boards instead.\n` +
        `  1. bump BUILD_VERSION in supabase/functions/job-board/index.ts\n` +
        `  2. set PINNED.sourcesHash here to: ${hash}\n` +
        `  3. set PINNED.buildVersion to the new version`,
    ).toBe(PINNED.sourcesHash);
  });
});
