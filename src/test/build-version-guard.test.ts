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
  sourcesHash: "62b79a3adda5601f",
  // 2026-08-03.4: _shared/application-questions.ts gained the `consent` class,
  // and job-board imports classifyQuestion — so the deployed bundle changed
  // even though sources.ts did not. sourcesHash is therefore unchanged.
  buildVersion: "2026-08-03.4",
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
