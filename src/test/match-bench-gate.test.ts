// @vitest-environment node
/**
 * THE MATCH BENCH IS A CI GATE (spec §19).
 *
 * WHAT IT HOLDS. The résumé matcher (spec §18: _shared/resume-profile.ts,
 * title-families.ts, posting-requirements.ts, match-tiers.ts, licence-rules.ts,
 * resume-match/, and the migration that creates match_candidates) runs offline
 * against the frozen corpus of 4,684 postings the 2026-10-12 runs saw, for the
 * 24 dev résumés, and every row it shows is judged by the recruiter rubric (v2:
 * licences checked, clearance a credential, authorisation wording read wherever
 * a description exists). The run fails when, against the AFTER baseline
 * recorded in fixtures/match-bench/baselines/v1.json:
 *
 *   - P@10 on the exact 11 falls more than GATE_TOLERANCE.p10Points (5) below it;
 *   - location mismatch in the shown top 20 (exact 11, and all 24) rises more
 *     than GATE_TOLERANCE.locationPoints (2) above it;
 *   - a résumé shows zero rows that did not before;
 *   - AFTER stops beating BEFORE on the same 11 résumés under the same rubric;
 *   - the profile reader, scored on the 60 held-out résumés written blind,
 *     falls more than GATE_TOLERANCE.readerPoints (5) on country, city, years or
 *     entry recall, or at all on authorisation precision.
 *
 * WHAT IT DOES NOT CLAIM. The corpus is a closed world: AFTER finds only
 * postings an earlier run retrieved and reads requirements only where one of
 * them read a description. It measures regressions in reading, gating,
 * tiering and ordering, not the live board's recall, and no AFTER row has a
 * hand review yet. The v1-beats-BEFORE verdict needs the held-out AFTER run
 * with its own probe budget and hand review (spec §19.2, owner decision 8).
 *
 * WHEN IT SKIPS. Only while NONE of the engine's modules is on the branch (the
 * bench landed before rm/engine). A branch with some but not all of them fails,
 * naming what is missing: a half-merged engine is not a reason to stay quiet.
 * MATCH_ENGINE_ROOT=<checkout> points it at another checkout's engine.
 *
 * IT NEVER TOUCHES THE NETWORK: global fetch throws for the whole measurement,
 * and the offline client answers only metro_ring and match_candidates.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ENGINE_FILES, REPO_ROOT } from "./fixtures/match-bench/after-pipeline";
import {
  engineReadiness, gateFailures, GATE_TOLERANCE, loadAfterBaseline, loadBeforeBaseline, measureAfter, measureReader,
  readerFailures, withoutMisses, type AfterMeasure, type AfterBaseline,
} from "./fixtures/match-bench/bench";
import type { ReaderScore } from "./fixtures/match-bench/reader-score";

const ENGINE_ROOT = process.env.MATCH_ENGINE_ROOT ? resolve(process.env.MATCH_ENGINE_ROOT) : REPO_ROOT;
const readiness = engineReadiness(ENGINE_ROOT);
if (readiness.kind === "absent") {
  console.warn(`[match-bench gate] SKIPPED: ${readiness.message}. The gate runs as soon as the engine is merged.`);
}

describe("the gate knows whether the engine is here", () => {
  it("looks for spec §18's modules by their import paths", () => {
    expect([...ENGINE_FILES]).toEqual([
      "supabase/functions/_shared/resume-profile.ts",
      "supabase/functions/_shared/title-families.ts",
      "supabase/functions/_shared/posting-requirements.ts",
      "supabase/functions/_shared/match-tiers.ts",
      "supabase/functions/_shared/licence-rules.ts",
      "supabase/functions/resume-match/index.ts",
      "supabase/functions/resume-match/pipeline.ts",
    ]);
  });

  it("skips only when nothing is there, and calls one module without the rest a half-merged engine", () => {
    const tmp = mkdtempSync(join(tmpdir(), "match-bench-ready-"));
    try {
      expect(engineReadiness(tmp).kind).toBe("absent");
      const one = join(tmp, ENGINE_FILES[0]);
      mkdirSync(dirname(one), { recursive: true });
      writeFileSync(one, "export {};\n");
      const r = engineReadiness(tmp);
      expect(r.kind).toBe("partial");
      expect(r.kind === "partial" && r.missing.some((m) => m.includes("match_candidates"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("is never half-merged on this branch", () => {
    expect(readiness.kind === "partial" ? readiness.message : "ok").toBe("ok");
  });
});

describe("the gate's rule, on numbers it is handed", () => {
  const before = loadBeforeBaseline();
  const recorded = loadAfterBaseline();
  const base: AfterBaseline = recorded ?? ({} as AfterBaseline);
  const shift = (m: AfterMeasure, d: { p10?: number; loc?: number; zero?: string[] }): AfterMeasure => ({
    ...m,
    exact11: { ...m.exact11, p10: (m.exact11.p10 ?? 0) + (d.p10 ?? 0), location: (m.exact11.location ?? 0) + (d.loc ?? 0) },
    all24: { ...m.all24, location: (m.all24.location ?? 0) + (d.loc ?? 0) },
    zero: d.zero ?? m.zero,
  });

  it("has a recorded AFTER baseline that names what it measured and the tolerance it was recorded with", () => {
    expect(recorded).not.toBeNull();
    expect(base.engine.ref).toMatch(/\S/);
    expect(base.rubric).toBe("v2");
    expect(base.tolerance).toEqual(GATE_TOLERANCE);
    expect(base.extract.exact11.n).toBe(11);
    expect(base.extract.all24.n).toBe(24);
  });

  it("passes the baseline itself and a drop inside the tolerance", () => {
    expect(gateFailures(base.extract, base, before)).toEqual([]);
    expect(gateFailures(shift(base.extract, { p10: -GATE_TOLERANCE.p10Points, loc: GATE_TOLERANCE.locationPoints }), base, before)).toEqual([]);
  });

  it("fails a P@10 drop beyond the tolerance, a location rise beyond it, and a résumé newly at zero", () => {
    expect(gateFailures(shift(base.extract, { p10: -GATE_TOLERANCE.p10Points - 0.1 }), base, before).join()).toMatch(/P@10/);
    expect(gateFailures(shift(base.extract, { loc: GATE_TOLERANCE.locationPoints + 0.1 }), base, before).join()).toMatch(/location mismatch/);
    expect(gateFailures(shift(base.extract, { zero: [...base.extract.zero, "sw-ng-austin"] }), base, before).join()).toMatch(/newly at zero rows: sw-ng-austin/);
  });

  it("fails an AFTER that no longer beats BEFORE on the same résumés, whatever the baseline says", () => {
    const lowBase: AfterBaseline = { ...base, extract: shift(base.extract, { p10: -80 }) };
    const atBefore = { ...base.extract, exact11: { ...base.extract.exact11, p10: before.v2.exact11.p10 } };
    expect(gateFailures(atBefore, lowBase, before).join()).toMatch(/no longer beats BEFORE/);
  });

  it("holds authorisation precision with no tolerance at all", () => {
    const r = base.reader!;
    expect(readerFailures(r, r)).toEqual([]);
    expect(readerFailures({ ...r, country: (r.country ?? 0) - GATE_TOLERANCE.readerPoints }, r)).toEqual([]);
    expect(readerFailures({ ...r, country: (r.country ?? 0) - GATE_TOLERANCE.readerPoints - 0.1 }, r).join()).toMatch(/country/);
    expect(readerFailures({ ...r, authPrecision: (r.authPrecision ?? 100) - 0.1 }, r).join()).toMatch(/authorisation precision/);
  });
});

describe.skipIf(readiness.kind !== "ready")("AFTER, offline, against the recorded baseline", () => {
  let measure: AfterMeasure;
  let reader: ReaderScore;
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;

  beforeAll(async () => {
    globalThis.fetch = ((...args: unknown[]) => {
      fetchCalls++;
      throw new Error(`the match bench gate must not touch the network (fetch ${String(args[0]).slice(0, 80)})`);
    }) as typeof fetch;
    try {
      measure = (await measureAfter("extract", ENGINE_ROOT)).measure;
      reader = await measureReader(ENGINE_ROOT);
    } finally {
      globalThis.fetch = realFetch;
    }
  }, 55_000);

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it("made no network call", () => {
    expect(fetchCalls).toBe(0);
  });

  it("holds P@10 and top-20 location mismatch to the recorded baseline, and still beats BEFORE", () => {
    const fails = gateFailures(measure, loadAfterBaseline()!, loadBeforeBaseline());
    const b = loadAfterBaseline()!.extract;
    const line = `exact-11 P@10 ${measure.exact11.p10}% (recorded ${b.exact11.p10}%), location ${measure.exact11.location}% (recorded ${b.exact11.location}%), all-24 location ${measure.all24.location}% (recorded ${b.all24.location}%)`;
    expect(fails, `${line}\n${fails.join("\n")}`).toEqual([]);
  });

  it("keeps the held-out profile reader where it was recorded (aggregates only: the held-out set is not for tuning)", () => {
    const rec = loadAfterBaseline()!.reader!;
    const fails = readerFailures(withoutMisses(reader), rec);
    expect(fails, fails.join("\n")).toEqual([]);
  });
});
