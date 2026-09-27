/**
 * THE PINNED FX TABLE CANNOT DRIFT IN SILENCE.
 *
 * WHAT THIS GUARDS. The pay floor, the pay ceiling and the pay sort all compare
 * `salary_rank_usd`, a GENERATED ALWAYS ... STORED column built from seventeen
 * hardcoded FX factors. A stored generated column only changes when a migration
 * changes it, so those factors are frozen at the day they were written, and
 * three things can go wrong quietly:
 *
 *   1. THE RATES MOVE AND NOTHING SAYS SO. The floor and the ceiling decide
 *      MEMBERSHIP on that column, not just order, so a stale factor changes
 *      which postings a searcher is allowed to see -- and the wrongly-excluded
 *      side is invisible to them by construction. Measured 2026-09-26 against
 *      ECB reference rates of 2026-09-25: all sixteen non-USD factors are off,
 *      by 2.7% (MXN) to 15.0% (INR). On the live board that hides ~61 GB
 *      postings which clear a $60k floor at today's rate and admits ~85 CA
 *      postings which do not. This build's answer is DISCLOSURE, not a
 *      750k-row column rewrite, so the guard's job is to make the disclosure
 *      non-optional while the drift exists.
 *   2. THE COPY'S DATE AND THE TABLE'S DATE COME APART. src/pages/Jobs.tsx
 *      exports SALARY_FX_PINNED_SINCE and four user-visible strings interpolate
 *      it. SQL cannot import a TypeScript constant, so nothing but a test can
 *      hold the two together: the day a new migration re-issues the rates, that
 *      date is false everywhere it is printed (the project_claim_drift pattern
 *      -- copy goes false when the thing it describes moves runtimes).
 *   3. A CURRENCY THE PARSER LEARNS HAS NO ARM HERE. _shared/salary-extract.ts
 *      already detects HKD, the CASE has no HKD branch, and every HKD posting
 *      therefore ranks NULL and is dropped by both pay filters and by the
 *      salary-sorted text search. The set of detected-but-unrankable currencies
 *      is pinned below so the NEXT one cannot arrive unnoticed.
 *
 * WHY NOT REUSE THE HEARTBEAT'S FX CHECK. supabase/functions/scan-heartbeat
 * carries its own hand copy of the same pinned numbers and validates the filter
 * against it, so it is green at any drift -- a consistency check sold as a
 * freshness one. This file is the freshness half and is deliberately separate.
 *
 * TEETH, PROVEN NOT ASSUMED (2026-09-26; each break applied, the file run, the
 * break reverted by inverse patch, restore verified byte-identical). What went
 * red, by name:
 *   * GBP 1.27 -> 1.30 in ONE of the two migrations ->
 *     "the two migrations that define salary_rank_usd agree on every arm".
 *   * GBP 1.27 -> 1.30 in BOTH ->
 *     "the recorded drift is what the snapshot and the table actually say".
 *   * a fake `WHEN 'CZK' THEN 0.04` arm in both -> four cases: the seventeen-arm
 *     case, "every ranked currency can be checked against the dated reference",
 *     the recorded-drift case, and "HKD is the only detected currency with no
 *     arm, and every arm is detectable".
 *   * SALARY_FX_PINNED_SINCE moved to "2026-09-01" ->
 *     "the date the copy prints is the day the rates were pinned".
 *   * `{{since}}` deleted from de.json's salaryFloorTip ->
 *     "while any rate is past the threshold, all nine locales date the
 *     conversion" (it named de.json in the failure message).
 * One number in this file was WRONG on the first run and this guard is what
 * caught it: the docblock said all sixteen non-USD factors were past the 3%
 * threshold, and MXN (2.7%) is not. Fifteen.
 *
 * READS COMMENT-STRIPPED SOURCES. Every literal this file pins is read through
 * src/test/helpers/strip-comments.ts: the migration header quotes its own rate
 * table in prose and the page's docblock quotes the date, so an unstripped read
 * would be satisfied by the explanation while the code said something else.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf, sqlCodeOf } from "./helpers/strip-comments";

const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");
const LOCALES = resolve(__dirname, "../i18n/locales");

/** Every migration whose CODE (not prose) defines salary_rank_usd as generated. */
function generatedDefinitions(): Array<{ file: string; stamp: string; arms: Record<string, number> }> {
  const out: Array<{ file: string; stamp: string; arms: Record<string, number> }> = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = sqlCodeOf(readFileSync(resolve(MIGRATIONS, file), "utf8"));
    if (!/salary_rank_usd\s+numeric\s+GENERATED\s+ALWAYS/i.test(sql)) continue;
    const body = sql.slice(sql.search(/CASE\s+salary_currency/i));
    const arms: Record<string, number> = {};
    for (const m of body.matchAll(/WHEN\s+'([A-Z]{3})'\s+THEN\s+([0-9.]+)/gi)) arms[m[1].toUpperCase()] = Number(m[2]);
    out.push({ file, stamp: file.slice(0, 8), arms });
  }
  return out;
}

const DEFS = generatedDefinitions();
const REFERENCE = JSON.parse(readFileSync(resolve(__dirname, "data/fx-reference-2026-09-25.json"), "utf8")) as {
  asOf: string; usdPerUnit: Record<string, number>;
};

/* The threshold at which a pinned rate is no longer "deliberately approximate"
 * for a MEMBERSHIP comparison. 3% is named, not derived: at a $60k floor it is
 * about $1,800 of someone's pay band, and fifteen of the sixteen non-USD
 * factors are past it today (MXN, at 2.7%, is the one inside it -- which is why
 * the case below asserts 15 and not 16: the round number was wrong and this
 * guard is what caught it). It is the trigger for a DISCLOSURE requirement, not
 * for a failure, because failing on drift would leave a permanently red test in
 * the suite and a red test is a test somebody eventually deletes. */
const DRIFT_DISCLOSE = 0.03;

describe("the pinned rate table is one table, in one place, with one date", () => {
  /* GUARDS: that the rates live in exactly the two files this build's copy and
   * migration say they live in, and that those two agree. The table is
   * hand-copied (20260716160824 created the column; 20260716180000 re-states it
   * under ADD COLUMN IF NOT EXISTS, a no-op that carries the docblock), and a
   * hand copy is where a rate change goes half-landed. */
  it("exactly two migrations define salary_rank_usd, both stamped the day the copy names", () => {
    expect(DEFS.map((d) => d.file)).toEqual([
      "20260716160824_f578f66d-5c62-4221-85d0-7fc59fa423c8.sql",
      "20260716180000_salary_rank_usd.sql",
    ]);
    for (const d of DEFS) expect(d.stamp, `${d.file} is not stamped 2026-07-16`).toBe("20260716");
  });

  it("the two migrations that define salary_rank_usd agree on every arm", () => {
    const [a, b] = DEFS;
    expect(Object.keys(a.arms).length, "the first definition parsed no CASE arms").toBeGreaterThan(10);
    expect(b.arms, "the duplicate definition's rate table has been edited away from the original").toEqual(a.arms);
  });

  it("the table holds USD at parity plus sixteen convertible currencies", () => {
    const arms = DEFS[0].arms;
    expect(arms.USD, "USD is not at parity, so every US posting's rank is scaled").toBe(1.0);
    expect(Object.keys(arms).length).toBe(17);
  });

  it("the date the copy prints is the day the rates were pinned", () => {
    // SALARY_FX_PINNED_SINCE is the page's half of a mirror the SQL cannot hold.
    const page = codeOf(readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8"));
    const m = page.match(/export const SALARY_FX_PINNED_SINCE = "([0-9-]+)";/);
    expect(m, "Jobs.tsx no longer exports SALARY_FX_PINNED_SINCE — the pay copy has nothing to date itself with").toBeTruthy();
    const newest = DEFS[DEFS.length - 1].stamp;
    const expected = `${newest.slice(0, 4)}-${newest.slice(4, 6)}-${newest.slice(6, 8)}`;
    expect(m![1], `the newest migration defining salary_rank_usd is stamped ${expected}; the page tells visitors the rates are unchanged since ${m![1]}`).toBe(expected);
  });
});

describe("a rate that has moved past the threshold must be disclosed on the page", () => {
  /* GUARDS: the user-visible consequence of the decision NOT to rewrite the
   * column. Every pay control that compares salary_rank_usd must tell the
   * visitor that it converts and since when, in all nine locales, for as long as
   * any pinned factor is more than DRIFT_DISCLOSE from the dated reference. A
   * locale VALUE beats an inline English default, so a locale that keeps the old
   * sentence is a language in which the disclosure does not exist. */
  const drift = Object.entries(DEFS[0].arms)
    .filter(([c]) => c !== "USD")
    .map(([c, pinned]) => {
      const ref = REFERENCE.usdPerUnit[c];
      return { currency: c, pinned, ref, rel: ref ? pinned / ref - 1 : NaN };
    });

  it("every ranked currency can be checked against the dated reference", () => {
    const unchecked = drift.filter((d) => !Number.isFinite(d.rel)).map((d) => d.currency);
    expect(unchecked, `ranked but absent from ${REFERENCE.asOf} reference snapshot — re-fetch the snapshot before trusting any drift figure below`).toEqual([]);
  });

  it("the recorded drift is what the snapshot and the table actually say", () => {
    // The numbers the migration header, the page docblock and the commit
    // message all quote. Recomputed here so an edit to any of those prose
    // copies is caught, rather than believed.
    const pct = Object.fromEntries(drift.map((d) => [d.currency, Math.round(d.rel * 1000) / 10]));
    expect(pct).toEqual({
      MXN: -2.7, CAD: 3.2, JPY: 4.0, PLN: -4.2, GBP: -4.2, DKK: -4.9, EUR: -5.3,
      SGD: -5.5, SEK: -5.9, AUD: -6.1, PHP: 6.2, BRL: -6.7, CHF: -7.2, NZD: 7.6,
      NOK: -10.6, INR: 15.0,
    });
    expect(drift.filter((d) => Math.abs(d.rel) > DRIFT_DISCLOSE).length,
      "fifteen of the sixteen non-USD factors were past the threshold when this was written (MXN, 2.7%, was not); if that has changed, re-measure before relaxing the disclosure").toBe(15);
  });

  it("while any rate is past the threshold, all nine locales date the conversion", () => {
    const stale = drift.filter((d) => Math.abs(d.rel) > DRIFT_DISCLOSE);
    if (!stale.length) return; // rates refreshed: the requirement below is moot
    // The FIVE strings a visitor reads BEFORE deciding the filter lied to them.
    // Counted from the array, not from memory: it said "four" over five entries,
    // which is the same class of slip this file exists to catch one runtime over
    // (a round number in it was wrong once already). The count is asserted below
    // so the next entry cannot land under a stale word.
    const DATED = ["salaryFloorTip", "salaryCeilingTip", "salaryFloorNote", "orderSalaryUsd", "orderSalaryStated"];
    expect(DATED.length, "the comment above this list names its length — move both together").toBe(5);
    const files = readdirSync(LOCALES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const jp = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8")).jobsPage as Record<string, string>;
      for (const k of DATED) {
        expect(typeof jp[k], `${f} has no jobsPage.${k}`).toBe("string");
        expect(jp[k], `${f} jobsPage.${k} does not carry {{since}} — ${stale.length} pinned rates are stale and this language does not say the figure is converted, at what vintage`).toContain("{{since}}");
      }
      // The retired caption claimed an ordering by the posting's own stated
      // floor. It is an ordering by a converted approximation, and a locale
      // value that survived would go on saying otherwise.
      expect(Object.keys(jp), `${f} still carries the retired jobsPage.orderSalary`).not.toContain("orderSalary");
    }
  });
});

describe("a currency the parser can read and the table cannot rank is recorded", () => {
  /* GUARDS: the silent-drop class. A currency detected by the parser but absent
   * from the CASE gets salary_rank_usd NULL, which both pay filters and the
   * salary-sorted text search exclude outright — so the postings vanish from
   * every pay surface with no disclosure anywhere. HKD is in that state today
   * and cannot be fixed without the column rewrite; this pins the set so the
   * next addition to the parser's currency list fails here instead. */
  it("HKD is the only detected currency with no arm, and every arm is detectable", () => {
    const extract = codeOf(readFileSync(resolve(root, "supabase/functions/_shared/salary-extract.ts"), "utf8"));
    const iso = extract.match(/const P_ISO = \/\\b\(([A-Z|]+)\)\\b\/i;/);
    expect(iso, "P_ISO in salary-extract.ts no longer parses — the currency list moved").toBeTruthy();
    const detected = iso![1].split("|");
    expect(detected.length).toBeGreaterThan(15);
    const ranked = new Set(Object.keys(DEFS[0].arms));
    const unrankable = detected.filter((c) => !ranked.has(c));
    expect(unrankable, "a currency the parser now reads has no arm in salary_rank_usd, so those postings rank NULL and are dropped by every pay filter with no disclosure").toEqual(["HKD"]);
    // And nothing is ranked that the parser could never produce.
    expect([...ranked].filter((c) => !detected.includes(c)), "salary_rank_usd ranks a currency the parser cannot detect").toEqual([]);
  });
});
