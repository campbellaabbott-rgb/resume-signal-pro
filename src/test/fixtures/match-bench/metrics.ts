/**
 * THE NUMBERS, ONE DEFINITION FOR BEFORE AND AFTER.
 *
 *   P@10, P@20    shortlisted rows in the first 10 / 20, over 10 / 20: an empty
 *                 slot is a miss, so a page that shows 3 rows cannot score 100.
 *   location      of the rows shown, the share the candidate cannot take from
 *                 where they are or will move to: location mismatch OR no right
 *                 to work in the posting's country. Pooled over the set's rows.
 *   seniority     of the shown rows in the candidate's field (role target,
 *                 adjacent or related), the share too junior or too senior.
 *   wrong field   rows in another occupation, or the career changer's old one.
 *   descRead      rows whose description the rubric could read (sponsorship,
 *                 citizenship, clearance and licence wording come from it).
 *
 * LIKE WITH LIKE (spec 19.2). BEFORE's exact set is the 11 résumés whose 60-row
 * pools had every description read, so their fit order is known; AFTER is
 * always reported on the SAME 11 ids, and on all 24, never one against the
 * other. BEFORE's other 13 pools are bounded, so all-24 BEFORE is a [low, high]
 * pair, and AFTER's all-24 point is compared with it as a bound.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anyDescription, beforeDescription, FIXTURES, loadCorpus, type CorpusRow } from "./corpus.ts";
import { RESUMES } from "./dev/manifest.ts";
import { judge, type PostingRow, type Rubric, type Verdict } from "./judge.ts";
import type { ResumeTruth } from "./types.ts";

export const round1 = (x: number) => Math.round(x * 10) / 10;
export const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
export const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? round1(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const inField = (v: Verdict) => v.role === "target" || v.role === "adjacent" || v.role === "related";
const pAt = (vs: Verdict[], k: number) => pct(vs.slice(0, k).filter((v) => v.shortlist).length, k) ?? 0;

export function rates(vs: Verdict[], denom: number) {
  const infield = vs.filter(inField);
  return {
    shortlisted: vs.filter((v) => v.shortlist).length,
    seniority: pct(infield.filter((v) => v.seniority !== "ok").length, infield.length),
    infield: infield.length,
    location: pct(vs.filter((v) => v.location === "mismatch" || v.auth === "fail").length, denom),
    locationUnknown: pct(vs.filter((v) => v.location === "unknown").length, denom),
    wrongField: pct(vs.filter((v) => v.role === "off" || v.role === "old").length, denom),
    oldCareer: pct(vs.filter((v) => v.role === "old").length, denom),
    reviewed: vs.filter((v) => v.reviewed).length,
  };
}

// ─── BEFORE, replayed from the frozen measurement ──────────────────────────
export interface BeforeRankedRow { rank: number; poolRank: number; status: "scored" | "null" | "unknown"; fit: number | null; row: PostingRow }
export interface BeforeResume {
  id: string; q: string | null; terms: string[]; poolSize: number; exact: boolean;
  counts: { scored: number; null: number; unknown: number }; resumeYears: number | null;
  listMs: number; fitCpuMsPerBatch: number[]; termsCpuMs: number; ranked: BeforeRankedRow[];
}
let beforeCache: BeforeResume[] | null = null;
export function beforeRanked(): BeforeResume[] {
  beforeCache ??= JSON.parse(readFileSync(join(FIXTURES, "before", "ranked.json"), "utf8")) as BeforeResume[];
  return beforeCache;
}
/** The 11 résumés BEFORE measured exactly. AFTER is compared on these ids and no others. */
export function exactIds(): string[] {
  return beforeRanked().filter((b) => b.exact).map((b) => b.id);
}
export const truthById = (id: string): ResumeTruth => {
  const t = RESUMES.find((r) => r.id === id);
  if (!t) throw new Error(`no dev résumé ${id}`);
  return t;
};

/** What the rubric reads per row: legacy = the descriptions BEFORE held; v2 = any the corpus holds. */
export const descriptionFor = (rubric: Rubric) => (rubric === "legacy" ? beforeDescription : anyDescription);

export function replayBefore(rubric: Rubric) {
  const desc = descriptionFor(rubric);
  const per = beforeRanked().map((b) => {
    const t = truthById(b.id);
    const N = b.poolSize;
    const all = b.ranked.map((x) => ({ x, v: judge(t, x.row, desc(x.row.id), rubric) }));
    const R = all.filter((a) => a.v.shortlist).length;
    const pool = rates(all.map((a) => a.v), N);
    const out: Record<string, unknown> & { id: string; exact: boolean; N: number; R: number } = { id: b.id, q: b.q, exact: b.exact, N, R, pool };
    if (b.exact) {
      const top = all.slice(0, 20).map((a) => a.v);
      out.p10 = pAt(top, 10);
      out.p20 = pAt(top, 20);
      out.top20 = rates(top, 20);
      out.verdicts = top;
      out.topIds = all.slice(0, 20).map((a) => a.x.row.id);
    } else {
      out.p20Bounds = [pct(Math.max(0, R - (N - 20)), 20), pct(Math.min(R, 20), 20)];
      out.p10Bounds = [pct(Math.max(0, R - (N - 10)), 10), pct(Math.min(R, 10), 10)];
    }
    return out;
  });
  const exact = per.filter((r) => r.exact) as Array<typeof per[number] & { p10: number; p20: number; top20: ReturnType<typeof rates>; verdicts: Verdict[] }>;
  const bounded = per.filter((r) => !r.exact) as Array<typeof per[number] & { p10Bounds: number[]; p20Bounds: number[] }>;
  const both = per as Array<Record<string, any>>;
  return {
    rubric,
    per,
    exact11: summarizeLists(exact.map((r) => ({ id: r.id, verdicts: r.verdicts }))),
    all24: {
      n: per.length,
      p10Lower: mean(both.map((r) => (r.exact ? r.p10 : r.p10Bounds[0]))),
      p10Upper: mean(both.map((r) => (r.exact ? r.p10 : r.p10Bounds[1]))),
      p20Lower: mean(both.map((r) => (r.exact ? r.p20 : r.p20Bounds[0]))),
      p20Upper: mean(both.map((r) => (r.exact ? r.p20 : r.p20Bounds[1]))),
      poolP: mean(per.map((r) => pct(r.R, r.N))),
      poolLocation: mean(both.map((r) => r.pool.location)),
      resumesWithRzero: per.filter((r) => r.R === 0).length,
    },
    boundedCount: bounded.length,
  };
}

// ─── Any shown list (BEFORE exact top-20s, the prototype, AFTER) ───────────
export interface ShownList { id: string; verdicts: Verdict[] }
export interface SetSummary {
  n: number; p10: number | null; p20: number | null;
  shown: number; shortlisted: number; precisionShown: number | null;
  location: number | null; locationRows: number;
  seniority: number | null; seniorityRows: number; infield: number;
  wrongField: number | null; oldCareer: number;
  licenceFail: number; authFail: number; descRead: number; reviewed: number;
  under10: number; under20: number; zero: number;
}
export function summarizeLists(lists: ShownList[]): SetSummary {
  const all = lists.flatMap((l) => l.verdicts.slice(0, 20));
  const infield = all.filter(inField);
  const locRows = all.filter((v) => v.location === "mismatch" || v.auth === "fail").length;
  const senRows = infield.filter((v) => v.seniority !== "ok").length;
  const shortlisted = all.filter((v) => v.shortlist).length;
  return {
    n: lists.length,
    p10: mean(lists.map((l) => pAt(l.verdicts, 10))),
    p20: mean(lists.map((l) => pAt(l.verdicts, 20))),
    shown: all.length, shortlisted, precisionShown: pct(shortlisted, all.length),
    location: pct(locRows, all.length), locationRows: locRows,
    seniority: pct(senRows, infield.length), seniorityRows: senRows, infield: infield.length,
    wrongField: pct(all.filter((v) => v.role === "off" || v.role === "old").length, all.length),
    oldCareer: all.filter((v) => v.role === "old").length,
    licenceFail: all.filter((v) => v.licence === "fail").length,
    authFail: all.filter((v) => v.auth === "fail").length,
    descRead: all.filter((v) => v.descRead).length,
    reviewed: all.filter((v) => v.reviewed).length,
    under10: lists.filter((l) => l.verdicts.length < 10).length,
    under20: lists.filter((l) => l.verdicts.length < 20).length,
    zero: lists.filter((l) => l.verdicts.length === 0).length,
  };
}

/** A posting row as the judge reads it, from a corpus row or a job-board list row. */
export function toPostingRow(r: Pick<CorpusRow, "id"> & Partial<CorpusRow>): PostingRow {
  return {
    id: r.id, title: r.title ?? "", company: r.company ?? null, location: r.location ?? null, country: r.country ?? null, workMode: r.workMode ?? null,
    remote: r.remote ?? null, minYears: r.minYears ?? null, experienceBand: r.experienceBand ?? null, category: r.category ?? null, agency: r.agency ?? null,
  };
}
/** A corpus row as the judge reads it. */
export function postingRow(id: string): PostingRow {
  const r: CorpusRow | undefined = loadCorpus().rows.get(id);
  if (!r) throw new Error(`posting ${id} is not in the corpus`);
  return toPostingRow(r);
}

/** Judge shown lists for any résumé set (dev or held-out); rows come from `rowOf` (the corpus by default). */
export function judgeLists(
  truths: ResumeTruth[], shown: Record<string, string[]>, rubric: Rubric = "v2",
  desc: (id: string) => string | null = descriptionFor(rubric), rowOf: (id: string) => PostingRow = postingRow,
) {
  return truths.map((t) => {
    const rows = (shown[t.id] ?? []).slice(0, 20).map((id) => { const row = rowOf(id); return { row, v: judge(t, row, desc(id), rubric) }; });
    return { id: t.id, verdicts: rows.map((r) => r.v), rows } as ShownList & { rows: Array<{ row: PostingRow; v: Verdict }> };
  });
}

/** Judge shown id lists for the dev résumés, and summarise them on the exact 11 and on all 24. */
export function judgeShown(shown: Record<string, string[]>, rubric: Rubric = "v2", desc: (id: string) => string | null = descriptionFor(rubric)) {
  const lists = judgeLists(RESUMES, shown, rubric, desc);
  const ex = new Set(exactIds());
  return { lists, exact11: summarizeLists(lists.filter((l) => ex.has(l.id))), all24: summarizeLists(lists) };
}

/** The prototype's own description view (its judge read the BEFORE set plus its own detail cache). */
export function protoLegacyDescription(id: string): string | null {
  const src = loadCorpus().descriptionSource(id) ?? "";
  return /^(before:|match-baseline-1012:|match-acc-1012:)/.test(src) ? loadCorpus().description(id) : null;
}
let protoCache: Record<string, { extract: string[]; oracle: string[] }> | null = null;
export function protoTop20(): Record<string, { extract: string[]; oracle: string[] }> {
  protoCache ??= JSON.parse(readFileSync(join(FIXTURES, "baselines", "proto-top20.json"), "utf8"));
  return protoCache!;
}
export function protoShown(kind: "extract" | "oracle"): Record<string, string[]> {
  return Object.fromEntries(Object.entries(protoTop20()).map(([id, v]) => [id, v[kind]]));
}
