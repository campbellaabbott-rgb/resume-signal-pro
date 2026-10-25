// @vitest-environment node
/**
 * THE ENGINE'S OWN BENCH: the request path and the engine's promises, offline.
 *
 * This is NOT the accuracy gate. The one gate on P@10, top-20 location
 * mismatch, résumés at zero and the held-out reader is
 * match-bench-gate.test.ts (rubric v2, the 4,684-posting corpus, a stated
 * tolerance). Two gates on one metric drift apart, so when rm/engine and
 * rm/bench were merged on rm/integration this file stopped holding v1 to
 * baseline.v1.json. That file stays as scripts/match-bench/run.ts's record
 * (the CPU figures in docs/resume-match.md come from it).
 *
 * 1. Positive control. BEFORE replayed from its frozen display order through
 *    the ported judge, licence rule off, reproduces what the 2026-10-12 bench
 *    printed: exact-11 P@10 14.5, P@20 10.0, location mismatch 85.5%,
 *    in-field seniority 15.9%; all-24 bounds [6.7, 17.1] and [4.6, 9.8]. If
 *    this moves, the port (or the corpus) is wrong, not the matcher.
 * 2. The licence rule only ever removes shortlisted rows.
 * 3. v1 runs the way the device calls it: each dev résumé read on the device,
 *    sent as the body src/lib/match/request.ts builds, validated by the
 *    handler's own siteInput, matched by runMatch against the shipped
 *    migrations. Over all 24 it keeps the engine's promises: no deadline
 *    missed, a row whose requirements were not read is never Strong, and one
 *    automatic widening step at most.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { bootBenchDb, loadCorpus, replayBefore, runV1, type V1Per } from "./fixtures/match-bench/bench";
import { autoJudge, licenceVerdict } from "./fixtures/match-bench/judge";
import { RESUMES } from "./fixtures/match-bench/manifest";

const FIX = resolve(__dirname, "fixtures/match-bench");
const BEFORE = JSON.parse(readFileSync(resolve(FIX, "baseline.before.json"), "utf8"));

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

describe("v1 through the device's request path, on the frozen corpus: the engine's promises", () => {
  let db: PGlite;
  let per: V1Per[];
  beforeAll(async () => {
    db = await bootBenchDb();
    ({ per } = await runV1(db, { licences: true, frozenClock: true }));
  }, 240_000);
  afterAll(async () => { await db?.close(); });

  it("runs every dev résumé, and none runs past a deadline", () => {
    expect(per.map((p) => p.id).sort()).toEqual(RESUMES.map((r) => r.id).sort());
    for (const p of per) expect(p.deadlineMissed, p.id).toBeNull();
  });
  it("a row whose requirements were not read is never Strong; one widening step at most", () => {
    let unread = 0;
    for (const p of per) {
      for (const r of p.rows) {
        if (r.requirementsRead) continue;
        unread++;
        expect(r.tier, `${p.id} ${r.id}`).not.toBe("strong");
      }
      expect(p.steps.length, p.id).toBeLessThanOrEqual(2);
    }
    // Positive control: the corpus leaves most rows unread, so the cap was exercised.
    expect(unread).toBeGreaterThan(0);
  });
});
