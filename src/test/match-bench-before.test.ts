// @vitest-environment node
/**
 * BEFORE REPLAYS TO THE DECIMAL, AND EVERY COMPARISON IS LIKE WITH LIKE.
 *
 * THE POSITIVE CONTROL. The 2026-10-12 BEFORE measurement (wave-3 main, the
 * "For you" path: q = the first role term, 60 rows, three fit batches) is frozen
 * in fixtures/match-bench/before/ranked.json. Replayed through the legacy
 * rubric it must print what the hand-reviewed run printed: P@10 14.5 and P@20
 * 10.0 on the exact 11, location mismatch 85.5% of 220, seniority 15.9%, and
 * the all-24 bounds. If this drifts, the bench is broken, not the matcher.
 * The same holds for the Requirements-First prototype's spec-table figures.
 *
 * LIKE WITH LIKE (review problem 2). The spec's first table set BEFORE's
 * exact-11 rates beside the prototypes' all-24 rates. Here BEFORE, the
 * prototype and AFTER are summarised by ONE function over the SAME résumé ids:
 * exact 11 with exact 11, all 24 with all 24, each rate with its denominator.
 *
 * THE v2 FIGURES are recorded in baselines/before.json; a rubric change has to
 * re-record them (scripts/match-bench/report.ts --save-before) on purpose.
 */
import { describe, expect, it } from "vitest";
import { loadBeforeBaseline } from "./fixtures/match-bench/bench";
import { RESUMES } from "./fixtures/match-bench/dev/manifest";
import { beforeRanked, exactIds, judgeShown, protoLegacyDescription, protoShown, replayBefore, summarizeLists } from "./fixtures/match-bench/metrics";

describe("the BEFORE positive control", () => {
  const legacy = replayBefore("legacy");

  it("reproduces the exact-11 figures of the hand-reviewed run", () => {
    expect(legacy.exact11).toMatchObject({ n: 11, p10: 14.5, p20: 10, shown: 220, location: 85.5, locationRows: 188, seniority: 15.9, seniorityRows: 35, wrongField: 0 });
  });

  it("reproduces the all-24 bounds and the pool rates", () => {
    expect(legacy.all24).toMatchObject({ n: 24, p10Lower: 6.7, p10Upper: 17.1, p20Lower: 4.6, p20Upper: 9.8, poolP: 6.5, poolLocation: 90.6, resumesWithRzero: 6 });
    expect(legacy.boundedCount).toBe(13);
  });

  it("reproduces the Requirements-First prototype's figures in the spec's table", () => {
    const e = judgeShown(protoShown("extract"), "legacy", protoLegacyDescription);
    expect(e.exact11).toMatchObject({ p10: 85.5, p20: 85, location: 1.5, locationRows: 3, shown: 200, seniority: 4.5, seniorityRows: 9, infield: 199 });
    expect(e.all24).toMatchObject({ p10: 74.6, p20: 70, location: 0.8, locationRows: 3, shown: 364, seniority: 6.4, seniorityRows: 23, infield: 362, descRead: 54, reviewed: 1, under10: 7 });
  });
});

describe("like with like", () => {
  it("compares on the same 11 exact résumés and the same 24", () => {
    const ids = exactIds();
    expect(ids).toHaveLength(11);
    expect(beforeRanked().map((b) => b.id).sort()).toEqual(RESUMES.map((r) => r.id).sort());
    const shown = Object.fromEntries(RESUMES.map((r) => [r.id, [] as string[]]));
    const j = judgeShown(shown);
    expect(j.exact11.n).toBe(11);
    expect(j.all24.n).toBe(24);
  });

  it("counts an empty slot as a miss, so a short page cannot score 100", () => {
    const v2 = replayBefore("v2");
    const r = v2.per.find((x) => x.exact && (x.verdicts as Array<{ shortlist: boolean }>).some((v) => v.shortlist)) as unknown as {
      id: string; topIds: string[]; verdicts: Array<{ shortlist: boolean }>;
    };
    const hit = r.topIds[r.verdicts.findIndex((v) => v.shortlist)];
    const one = judgeShown({ [r.id]: [hit] }).lists.find((l) => l.id === r.id)!;
    expect(one.verdicts.map((v) => v.shortlist)).toEqual([true]);
    expect(summarizeLists([one])).toMatchObject({ p10: 10, p20: 5, under10: 1 });
  });

  it("holds BEFORE and the prototype under the v2 rubric where baselines/before.json recorded them", () => {
    const rec = loadBeforeBaseline();
    const v2 = replayBefore("v2");
    expect(v2.exact11).toEqual(rec.v2.exact11);
    expect(v2.all24).toEqual(rec.v2.all24);
    for (const k of ["extract", "oracle"] as const) {
      const j = judgeShown(protoShown(k), "v2");
      expect(j.exact11).toEqual(rec.proto[k].v2.exact11);
      expect(j.all24).toEqual(rec.proto[k].v2.all24);
    }
  });

  it("reads a description for every BEFORE exact top-20 row, so its licence and authorisation are judged in full", () => {
    expect(replayBefore("v2").exact11.descRead).toBe(220);
  });
});
