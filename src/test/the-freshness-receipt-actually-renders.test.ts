import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD'S STRONGEST SENTENCE HAS NEVER RENDERED TO ANYONE.
 *
 * attachRecheckedAt keys its lookup on each row's company token, then stamps
 * `recheckedAt` — "we re-fetched THIS employer's feed N minutes ago". It is the
 * per-posting version of the board's whole pitch, and three UI surfaces were
 * built to display it.
 *
 * It read `j.companyToken`. rowToJob emits the field as `token`. So the token
 * list was empty on every call, the function returned early every time, and
 * the stamp was never attached. MEASURED live before the fix: 0 of 60 served
 * rows carried recheckedAt, and the payload key list contains `token` with no
 * `companyToken` anywhere.
 *
 * Silent by construction: an empty token list is indistinguishable from "no
 * verification rows exist", which is a legitimate state this function is
 * designed to degrade into. Nothing errored, nothing logged, and the aggregate
 * freshness line kept working — so the page looked fine while its best claim
 * was missing.
 *
 * This file pins the field name to the emitter, so the two cannot drift again.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

describe("the per-posting freshness stamp reaches the page", () => {
  it("reads the field name rowToJob actually emits", () => {
    // The logic lives in attachRecheckedAtInner since the outer function became
    // a timing wrapper (the per-phase search instrumentation). This assertion
    // is about the LOOKUP, so it follows the lookup — anchoring on the wrapper
    // would have silently passed against a two-line function.
    const fn = /async function attachRecheckedAtInner\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn, "attachRecheckedAtInner not found").not.toBe("");
    // Both the token-collection and the per-row lookup must use `token`.
    expect(fn).toMatch(/jobs\.map\(\(j\) => String\(j\.token \?\? ""\)\)/);
    expect(fn).toMatch(/byToken\.get\(String\(j\.token \?\? ""\)\)/);
    // The dead field must not come back at either site. Scoped to CODE:
    // the doc comment above deliberately names `j.companyToken` to record what
    // the bug was, and an assertion that forbids the word forbids the
    // explanation too — the same mistake as forbidding "honeypot" in a file
    // whose job is to document the honeypot.
    const code = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/j\.companyToken/);
  });

  it("pins the field name to the emitter so they cannot drift apart", () => {
    // rowToJob is the authority. If it ever renames `token`, this fails and
    // whoever renames it has to update the consumer in the same commit —
    // which is exactly what did not happen the first time.
    const rowToJob = /const rowToJob = \(r: any\) => \(\{[\s\S]*?\n\}\);/.exec(FN)?.[0] ?? "";
    expect(rowToJob, "rowToJob not found").not.toBe("");
    expect(rowToJob, "rowToJob no longer emits `token` — update attachRecheckedAt with it")
      .toMatch(/\btoken:/);
  });

  it("attaches the stamp on the DETAIL path, not only the list paths", () => {
    // The pane is where the apply decision is made. Three list paths called
    // this and the detail branch did not.
    const detail = FN.slice(FN.indexOf('if (action === "detail")'));
    const body = detail.slice(0, detail.indexOf("description });") + 20);
    expect(body).toMatch(/attachRecheckedAt\(client, \[rowToJob\(jobRow\)/);
  });

  it("still degrades to ABSENT rather than to a wrong value", () => {
    // The bug this function exists to remove was showing last_seen as
    // freshness, which understated the board ~100x. On failure the field must
    // stay absent — never fall back to a different timestamp.
    const fn = /async function attachRecheckedAtInner\([\s\S]*?\n}/.exec(FN)?.[0] ?? "";
    expect(fn).toMatch(/if \(error \|\| !Array\.isArray\(data\)\) return jobs;/);
    const codeOnly = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(codeOnly).not.toMatch(/lastSeen|last_seen/);
    // And a posting known to be gone must not claim a fresh re-check.
    expect(fn).toMatch(/if \(v && !j\.missingSince\) j\.recheckedAt = v;/);
  });
});
