import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADAPTERS } from "../../worker/src/vendors/index.js";

/**
 * The queue's idea of "the agent can finish this" must match the worker's.
 *
 * `SENDABLE_VENDORS` in supabase/functions/_shared/apply-automation.ts is a
 * hand-written COPY of the worker's `ADAPTERS` keys. It has to be: the worker is
 * Node and the edge functions are Deno, so there is no import that would keep
 * them together.
 *
 * A copy of a fact in another runtime is exactly the thing that goes stale
 * without anyone noticing — the same shape as public copy describing a feature
 * that has since moved. The failure here is quiet in a specific, expensive way:
 * a vendor listed as sendable but with no adapter makes the queue prefer
 * postings the worker will then refuse, so a subscriber's morning queue fills
 * with jobs that look automatic and never send.
 *
 * The reverse is milder but still wrong: an adapter the queue does not know
 * about means drivable postings are never preferred, and the feature quietly
 * does nothing.
 *
 * This reads both sides from source and fails on either divergence.
 */
describe("the sendable-vendor list mirrors the worker's adapters", () => {
  const shared = readFileSync(
    resolve(__dirname, "../../supabase/functions/_shared/apply-automation.ts"),
    "utf8",
  );

  const declared: string[] = (() => {
    const m = shared.match(/export const SENDABLE_VENDORS[^=]*=\s*\[([^\]]*)\]/);
    expect(m, "SENDABLE_VENDORS is no longer declared as a literal array").toBeTruthy();
    return [...m![1]!.matchAll(/"([a-z0-9_-]+)"/g)].map((x) => x[1]!);
  })();

  it("lists exactly the vendors that have an adapter", () => {
    const real = Object.keys(ADAPTERS).sort();
    expect(
      [...declared].sort(),
      `SENDABLE_VENDORS (${declared.join(", ")}) has drifted from worker ADAPTERS (${real.join(", ")})`,
    ).toEqual(real);
  });

  it("finds something — an empty match would pass the comparison vacuously", () => {
    // Both sides could read as [] if the regex stopped matching, and an
    // ([] === []) assertion is a test that has quietly stopped testing.
    expect(declared.length, "the SENDABLE_VENDORS extractor matched nothing").toBeGreaterThan(0);
    expect(Object.keys(ADAPTERS).length, "no adapters found in the worker").toBeGreaterThan(0);
  });

  it("never claims a vendor the recon notes record as blocked", () => {
    // A last backstop against the list being edited by hand to "unlock" coverage.
    // These three are blocked for reasons no code change addresses: a per-tenant
    // candidate account, invisible reCAPTCHA Enterprise scoring, and a visible v2
    // checkbox on one platform-wide sitekey.
    for (const blocked of ["workday", "greenhouse", "bamboohr"]) {
      expect(declared, `${blocked} cannot be sendable — see worker/RECON.md`).not.toContain(blocked);
    }
  });
});

describe("isSendableVendor reads the vendor out of a board posting id", () => {
  it("matches on the id's first segment, and treats anything unknown as not sendable", async () => {
    const { isSendableVendor } = await import(
      "../../supabase/functions/_shared/apply-automation.ts"
    );
    // Board ids are `vendor:token:jobid`.
    expect(isSendableVendor("breezy:gold-care-homes:c28bbb")).toBe(true);
    expect(isSendableVendor("personio:acme:1234")).toBe(true);
    expect(isSendableVendor("pinpoint:trilongroup:017c")).toBe(true);
    // The vendors that are ~63% of what users see, and are all blocked.
    expect(isSendableVendor("workday:hfecorp~wd503~palace_jobs:JR106617")).toBe(false);
    expect(isSendableVendor("greenhouse:stripe:44")).toBe(false);
    expect(isSendableVendor("bamboohr:deciphex:398")).toBe(false);
    // A bare vendor name also works, for callers holding `source` not `id`.
    expect(isSendableVendor("breezy")).toBe(true);
    // Nothing about an absent or malformed value may read as sendable.
    expect(isSendableVendor("")).toBe(false);
    expect(isSendableVendor(undefined as unknown as string)).toBe(false);
    expect(isSendableVendor(":::")).toBe(false);
    expect(isSendableVendor("breezyish:x:1")).toBe(false);
  });
});

describe("the queue boost is a preference, never an override", () => {
  const runner = readFileSync(
    resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"),
    "utf8",
  );

  it("keeps the boost small enough that a clearly better match still wins", () => {
    // The whole justification for reordering someone's queue is that it only
    // shuffles jobs that were already close. A large boost would start showing
    // people worse jobs because we happen to be able to submit them, which is
    // optimising for us rather than for them.
    const m = runner.match(/const SENDABLE_BOOST\s*=\s*(\d+)/);
    expect(m, "SENDABLE_BOOST is no longer a plain literal").toBeTruthy();
    expect(Number(m![1]), "a boost this large can outrank a materially better fit")
      .toBeLessThanOrEqual(8);
  });

  it("applies only in auto mode", () => {
    // Somebody who reviews and submits their own applications gets nothing from
    // the vendor being drivable, so reordering their queue by it would be pure
    // loss to them.
    expect(runner, "the boost must be gated on apply_mode === auto")
      .toMatch(/sendable\s*&&\s*m\.apply_mode\s*===\s*"auto"\s*\?\s*SENDABLE_BOOST\s*:\s*0/);
  });

  it("only ranks postings that already cleared the fit floor", () => {
    // The boost reorders inside an already-qualified pool. If the low-fit filter
    // ever moved below the ranking, the boost could promote a job that should
    // never have been queued at all.
    const floorAt = runner.indexOf("MIN_FIT_PCT");
    const rankAt = runner.indexOf("const SENDABLE_BOOST");
    expect(floorAt, "MIN_FIT_PCT filter not found").toBeGreaterThan(0);
    expect(floorAt, "the fit floor must be applied before ranking").toBeLessThan(rankAt);
  });
});

describe("the sendable pull widens the pool without loosening anyone's criteria", () => {
  const runner = readFileSync(
    resolve(__dirname, "../../supabase/functions/agent-runner/index.ts"),
    "utf8",
  );
  // Everything after the second query is declared.
  const second = runner.slice(runner.indexOf('if (m.apply_mode === "auto")'));

  it("applies every mandate filter the main query applies", () => {
    // The failure this prevents is a queue that quietly ignores the salary floor
    // or the location the person set, purely because those postings happen to be
    // submittable. That is worse than showing nothing: it is the product
    // overriding a stated preference to make its own numbers look better.
    //
    // Two of these are now applied through a shared helper rather than inline —
    // `applyCategory(sb2, m)` and `applyMaxAge(sb2, m)` — because the category
    // rule grew an opt-in (the `other` bucket) and a second hand-written copy
    // of it is exactly what this test exists to prevent. Each filter therefore
    // names either the field or the helper that carries it, and BOTH forms
    // still have to appear in this block.
    const HONOURED: Array<[string, RegExp]> = [
      ["m.category", /applyCategory\(sb2, m\)|m\.category/],
      ["m.max_age_days", /applyMaxAge\(sb2, m\)/],
      ["m.remote_only", /m\.remote_only/],
      ["m.location", /m\.location/],
      ["m.q", /m\.q/],
      ["m.salary_min", /m\.salary_min/],
    ];
    for (const [filter, re] of HONOURED) {
      expect(second.slice(0, 2400), `the sendable pull must also honour ${filter}`).toMatch(re);
    }
  });

  it("is gated on auto mode and capped", () => {
    expect(runner).toMatch(/if \(m\.apply_mode === "auto"\)/);
    const cap = runner.match(/const SENDABLE_CANDIDATES\s*=\s*(\d+)/);
    expect(cap, "SENDABLE_CANDIDATES must stay a plain literal").toBeTruthy();
    // Smaller than the main pull: this guarantees representation, it does not
    // hand the queue over to whichever vendors we happen to support.
    expect(Number(cap![1])).toBeLessThan(400);
  });

  it("dedupes against the main pull", () => {
    // Both queries can return the same posting. Scoring it twice would let one
    // job occupy two of the day's slots.
    expect(second).toMatch(/seen\.has\(c\.id\)/);
  });

  it("restricts itself to the mirrored vendor list, not a hand-written one", () => {
    expect(second).toMatch(/SENDABLE_VENDORS\.map/);
  });
});
