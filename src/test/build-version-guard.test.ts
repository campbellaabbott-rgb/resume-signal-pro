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
  sourcesHash: "6bac7c8103784266",
  buildVersion: "2026-08-12.1",
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
