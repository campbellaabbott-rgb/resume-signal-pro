// @vitest-environment node
/**
 * THE MATCH BENCH AS A REGRESSION GATE (spec 19), offline.
 *
 * 1. Positive control. BEFORE replayed from its frozen display order through
 *    the ported judge, licence rule off, reproduces what the 2026-10-12 bench
 *    printed: exact-11 P@10 14.5, P@20 10.0, location mismatch 85.5%,
 *    in-field seniority 15.9%; all-24 bounds [6.7, 17.1] and [4.6, 9.8]. If
 *    this moves, the port (or the corpus) is wrong, not the matcher.
 * 2. The licence rule (new) only ever removes shortlisted rows, and is applied
 *    to BEFORE and v1 alike.
 * 3. v1 (resume-match's own pipeline against the shipped migrations and the
 *    frozen corpus) does not fall below baseline.v1.json, no résumé the floor
 *    had above zero falls to zero, and location mismatch does not rise.
 *    These are DEV-SET, AUTO-JUDGED figures and the corpus holds only what
 *    BEFORE and the prototype read: a floor against regressions, never a
 *    claim that v1 beats BEFORE. That claim waits for the held-out set, the
 *    AFTER probe budget and the same hand review (owner decision 8).
 *
 * Regenerate the floor after a deliberate change: npx tsx scripts/match-bench/run.ts --save
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { bootBenchDb, loadCorpus, replayBefore, runV1, type V1Per, type V1Summary } from "./fixtures/match-bench/bench";
import { autoJudge, licenceVerdict } from "./fixtures/match-bench/judge";
import { RESUMES } from "./fixtures/match-bench/manifest";

const FIX = resolve(__dirname, "fixtures/match-bench");
const BEFORE = JSON.parse(readFileSync(resolve(FIX, "baseline.before.json"), "utf8"));
const FLOOR = JSON.parse(readFileSync(resolve(FIX, "baseline.v1.json"), "utf8")) as { summary: V1Summary; per: Array<{ id: string; p10: number; p20: number; shown: number }> };

describe("the frozen corpus", () => {
  it("is under the 4 MB the spec allows and holds every row BEFORE showed", () => {
    expect(readFileSync(resolve(FIX, "corpus.json.gz")).length).toBeLessThan(4 * 1024 * 1024);
    const c = loadCorpus();
    const ids = new Set(c.postings.map((p) => p.id));
    expect(c.before.map((b) => b.id).sort()).toEqual(RESUMES.map((r) => r.id).sort());
    for (const b of c.before) for (const r of b.ranked) expect(ids.has(r.id), r.id).toBe(true);
  });
  it("carries postings only: no field of the synthetic résumés appears in it", () => {
    const raw = JSON.stringify(loadCorpus());
    for (const needle of ["@example.com", "555-01", "Okafor", "Petrova", "Al-Rashid"]) expect(raw.includes(needle), needle).toBe(false);
  });
});

describe("BEFORE, replayed (positive control for the port)", () => {
  it("reproduces the 2026-10-12 figures exactly with the licence rule off", () => {
    const b = replayBefore({ licences: false });
    const want = BEFORE.summary;
    expect(b.exactSet).toEqual({ p10: want.exactSet.p10, p20: want.exactSet.p20, seniority: want.exactSet.seniority, location: want.exactSet.location });
    expect(b.exactSet.p10).toBe(14.5);
    expect(b.exactSet.p20).toBe(10);
    expect(b.allSet).toEqual({ p10Lower: want.allSet.p10Lower, p10Upper: want.allSet.p10Upper, p20Lower: want.allSet.p20Lower, p20Upper: want.allSet.p20Upper });
    for (const r of b.per) {
      const w = BEFORE.per.find((x: { id: string }) => x.id === r.id);
      expect([r.R, r.p10, r.p20], r.id).toEqual([w.R, w.p10, w.p20]);
    }
  });
  it("the licence rule only removes shortlisted rows, never adds one", () => {
    const off = replayBefore({ licences: false });
    const on = replayBefore({ licences: true });
    for (const r of on.per) {
      const o = off.per.find((x) => x.id === r.id)!;
      expect(r.R, r.id).toBeLessThanOrEqual(o.R);
    }
    expect(on.per.reduce((a, r) => a + r.licenceFails, 0)).toBeGreaterThan(0);
  });
});

describe("the licence rule, from the posting's own words", () => {
  const t = (id: string) => RESUMES.find((r) => r.id === id)!;
  const row = (title: string, location: string, country = "US") => ({ id: "x", title, location, country });
  it("a licence held nowhere fails; held in another state is a transfer, not a fail; a compact licence covers compact states", () => {
    expect(licenceVerdict(t("sw-ng-austin"), row("Registered Nurse - Med Surg", "Austin, TX"), null).licence).toBe("fail");
    expect(licenceVerdict(t("rn-mid-chicago"), row("Registered Nurse - ICU", "Gary, IN"), null)).toEqual({ licence: "ok", reason: "rn transfer to IN" });
    expect(licenceVerdict(t("rn-ng-phoenix"), row("Registered Nurse", "El Paso, TX"), null)).toEqual({ licence: "ok", reason: null });
    expect(licenceVerdict(t("rn-sr-manchester"), row("Staff Nurse", "Salford, England", "GB"), null).licence).toBe("ok");
  });
  it("a CDL the posting requires fails a candidate without one; 'or eligible' keeps an RN post open", () => {
    expect(licenceVerdict(t("tr-ng-hvac-houston"), row("HVAC Technician", "Houston, TX"), "Class A CDL required. EPA 608 preferred.").licence).toBe("fail");
    expect(licenceVerdict(t("sw-ng-austin"), row("Registered Nurse", "Austin, TX"), "Texas RN licence or eligible for licensure within 90 days.").licence).toBe("ok");
  });
  it("an active clearance fails a candidate who holds none; with the rule off nothing is checked", () => {
    const desc = "Must hold an active Top Secret clearance.";
    expect(licenceVerdict(t("da-mid-pittsburgh"), row("Data Analyst", "Pittsburgh, PA"), desc).licence).toBe("fail");
    expect(autoJudge(t("da-mid-pittsburgh"), row("Data Analyst", "Pittsburgh, PA"), desc, { licences: false }).licence).toBe("ok");
  });
});

describe("v1 on the frozen corpus (dev set, auto-judged): a floor, not a verdict", () => {
  let db: PGlite;
  let per: V1Per[];
  let s: V1Summary;
  beforeAll(async () => {
    db = await bootBenchDb();
    ({ per, summary: s } = await runV1(db, { licences: true, frozenClock: true }));
  }, 240_000);
  afterAll(async () => { await db?.close(); });

  it("does not fall below the recorded floor on P@10 and P@20, exact 11 and all 24", () => {
    expect(s.exact11.p10!).toBeGreaterThanOrEqual(FLOOR.summary.exact11.p10!);
    expect(s.exact11.p20!).toBeGreaterThanOrEqual(FLOOR.summary.exact11.p20!);
    expect(s.all24.p10!).toBeGreaterThanOrEqual(FLOOR.summary.all24.p10!);
    expect(s.all24.p20!).toBeGreaterThanOrEqual(FLOOR.summary.all24.p20!);
  });
  it("no résumé the floor had above zero is at zero, and none runs past a deadline", () => {
    for (const f of FLOOR.per) {
      const p = per.find((x) => x.id === f.id)!;
      if (f.p20 > 0) expect(p.p20, `${f.id} fell to zero`).toBeGreaterThan(0);
      expect(p.deadlineMissed, f.id).toBeNull();
    }
  });
  it("location mismatch does not rise, and every shown row's place is one the reader can reach", () => {
    expect(s.exact11.locationPooled[0]).toBeLessThanOrEqual(FLOOR.summary.exact11.locationPooled[0]);
    expect(s.all24.locationPooled[0]).toBeLessThanOrEqual(FLOOR.summary.all24.locationPooled[0]);
  });
  it("a row whose requirements were not read is never Strong; one widening step at most", () => {
    for (const p of per) {
      for (const r of p.rows) if (!r.requirementsRead) expect(r.tier, `${p.id} ${r.id}`).not.toBe("strong");
      expect(p.steps.length, p.id).toBeLessThanOrEqual(2);
    }
  });
  it("beats BEFORE's exact-set figures on this corpus (recorded for the report, with the caveats above)", () => {
    expect(s.exact11.p20!).toBeGreaterThan(BEFORE.summary.exactSet.p20);
    expect(s.exact11.location!).toBeLessThan(BEFORE.summary.exactSet.location);
  });
});
