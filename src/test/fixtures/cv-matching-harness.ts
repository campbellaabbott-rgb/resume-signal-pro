/**
 * THE MEASUREMENT, SEPARATED FROM THE ASSERTIONS.
 *
 * Guards assert; this scores. Keeping the scoring here means the same numbers
 * can be printed as a table and asserted as thresholds, without the thresholds
 * being what defines the metric.
 *
 * Five numbers, and each answers a question the others cannot:
 *
 *   top1      — the query the client actually runs is `terms[0]`. Nothing
 *               downstream can recover from this being wrong.
 *   any       — the client renders the runners-up as clickable chips, so a right
 *               answer in position 2 is worth strictly less than one in position
 *               1 and strictly more than nothing.
 *   harmful   — `terms[0]` is a real query for somebody else's occupation. This
 *               is worse than an empty answer, not a milder version of it, and
 *               it is counted separately for exactly that reason.
 *   rprec     — R-precision over the scored page: of the top R rows by fit,
 *               where R is how many on-occupation rows exist, the share that
 *               are on-occupation. Pairwise accuracy saturates at 100% on any
 *               corpus with clean lexical separation; this does not.
 *   seniority — of every (within-reach, out-of-reach) pair inside the reader's
 *               OWN occupation, the share ordered correctly. A new graduate and
 *               a nurse-manager posting are both nursing; only one of them will
 *               interview her, and no amount of cross-field separation can tell
 *               them apart because they are the same field.
 */
import { computeFit, resumeRoleTerms, scanResume, type ResumeScan } from "../../../supabase/functions/_shared/fit-score.ts";
import { detectExperience } from "../../../supabase/functions/job-board/experience.ts";
import { POSTINGS, RESUMES, type CorpusPosting, type CorpusResume } from "./cv-matching-corpus.ts";

export type StampedPosting = CorpusPosting & { minYears: number | null; band: string | null };

/** Postings stamped with experience the same way ingestion stamps the table. */
export const STAMPED: StampedPosting[] = POSTINGS.map((p) => {
  const exp = detectExperience(p.title, p.description);
  return { ...p, minYears: exp.minYears, band: exp.band };
});

/**
 * How a caller hands a posting to the scorer. Swapped to measure variants.
 * The scan is passed in rather than taken from the résumé for the reason
 * fit-batch does the same: it is the expensive half and it does not change
 * between posting 1 and posting 32.
 */
export type Scorer = (posting: StampedPosting, resume: CorpusResume, scan: ResumeScan) => number | null;

/**
 * The call shape job-fit ships: the 150-character floor and the 40-term cap
 * mirror fit-batch exactly, so a number measured here is a number the reader
 * would have seen.
 */
export const shippedScorer: Scorer = (p, _r, scan) =>
  p.description && p.description.length > 150
    ? computeFit(p.description, scan, 40, p.minYears).pct
    : null;

/** The same call WITHOUT the posting's stated minimum — the .32 behaviour. */
export const descriptionOnlyScorer: Scorer = (p, _r, scan) =>
  p.description && p.description.length > 150
    ? computeFit(p.description, scan, 40).pct
    : null;

/** One scan per résumé for the whole run — the corpus never changes. */
const SCANS = new Map<string, ResumeScan>();
export function scanFor(r: CorpusResume): ResumeScan {
  let s = SCANS.get(r.id);
  if (!s) SCANS.set(r.id, (s = scanResume(r.text)));
  return s;
}

export interface ResumeMeasurement {
  id: string;
  occupation: string;
  emptyIsFine: boolean;
  terms: string[];
  top1Ok: boolean;
  anyOk: boolean;
  harmful: boolean;
  rprecOk: number;
  rprecTotal: number;
  seniorityPairsOk: number;
  seniorityPairsTotal: number;
  scores: { id: string; pct: number | null; good: boolean }[];
}

/**
 * A posting is "out of reach" when its stated minimum exceeds what the reader
 * has by a margin no hiring manager waives. Three years is that margin: a job
 * asking 8 from a reader with 6 is a stretch worth showing; the same job in
 * front of a reader with 0 is not a match in any sense she would recognize.
 */
export const OUT_OF_REACH_MARGIN = 3;

export function measureResume(r: CorpusResume, score: Scorer, termLimit = 4): ResumeMeasurement {
  const terms = resumeRoleTerms(r.text, termLimit);
  const top1Ok = terms.length > 0 && r.accept.includes(terms[0]);
  const anyOk = terms.some((t) => r.accept.includes(t));
  // An empty answer is never harmful; a confident wrong answer always is.
  const harmful = terms.length > 0 && !r.accept.includes(terms[0]);

  const scores = STAMPED.map((p) => ({
    id: p.id,
    pct: score(p, r, scanFor(r)),
    good: r.goodFamilies.includes(p.family),
  }));
  const scored = scores.filter((s): s is { id: string; pct: number; good: boolean } => typeof s.pct === "number");

  // R-precision: rank the page the way the board does and read the top R.
  // Ties broken by id so the number is reproducible rather than sort-dependent.
  const ranked = [...scored].sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id));
  const R = scored.filter((s) => s.good).length;
  const rprecOk = ranked.slice(0, R).filter((s) => s.good).length;

  const byId = new Map(STAMPED.map((p) => [p.id, p]));
  const good = scored.filter((s) => s.good);
  const reach = good.filter((s) => (byId.get(s.id)!.minYears ?? 0) <= r.years + OUT_OF_REACH_MARGIN);
  const overReach = good.filter((s) => (byId.get(s.id)!.minYears ?? 0) > r.years + OUT_OF_REACH_MARGIN);
  let senOk = 0;
  for (const a of reach) for (const b of overReach) senOk += a.pct > b.pct ? 1 : a.pct === b.pct ? 0.5 : 0;

  return {
    id: r.id,
    occupation: r.occupation,
    emptyIsFine: Boolean(r.emptyIsFine),
    terms,
    top1Ok,
    anyOk,
    harmful,
    rprecOk,
    rprecTotal: R,
    seniorityPairsOk: senOk,
    seniorityPairsTotal: reach.length * overReach.length,
    scores,
  };
}

/**
 * Memoised because it is not cheap — sixteen résumés against thirty-two
 * postings is ~500 dictionary walks — and because vitest runs this file's
 * suite beside a hundred others that have their own five-second timeouts.
 */
const RUNS = new WeakMap<Scorer, Map<number, ResumeMeasurement[]>>();
export function measureAll(score: Scorer = shippedScorer, termLimit = 4): ResumeMeasurement[] {
  let byLimit = RUNS.get(score);
  if (!byLimit) RUNS.set(score, (byLimit = new Map()));
  let rows = byLimit.get(termLimit);
  if (!rows) byLimit.set(termLimit, (rows = RESUMES.map((r) => measureResume(r, score, termLimit))));
  return rows;
}

const share = (ok: number, total: number) => (total === 0 ? "  n/a" : `${((ok / total) * 100).toFixed(0).padStart(4)}%`);

/** The table that goes in the commit message. */
export function report(rows: ResumeMeasurement[]): string {
  const out: string[] = [];
  out.push("occupation                            terms[0]                  top1  any  harm  rprec  senio");
  out.push("-".repeat(96));
  for (const m of rows) {
    out.push(
      m.occupation.slice(0, 36).padEnd(38) +
        (m.terms[0] ?? "(none)").slice(0, 25).padEnd(26) +
        (m.top1Ok ? "  Y " : "  . ") + (m.anyOk ? "  Y " : "  . ") +
        (m.harmful ? " HARM" : "   ok") + "  " +
        share(m.rprecOk, m.rprecTotal) + " " +
        share(m.seniorityPairsOk, m.seniorityPairsTotal),
    );
  }
  const sum = (f: (m: ResumeMeasurement) => number) => rows.reduce((a, m) => a + f(m), 0);
  out.push("-".repeat(96));
  out.push(
    `TOTAL  top1 ${rows.filter((m) => m.top1Ok).length}/${rows.length}` +
      `  any ${rows.filter((m) => m.anyOk).length}/${rows.length}` +
      `  harmful ${rows.filter((m) => m.harmful).length}/${rows.length}` +
      `  rprec ${share(sum((m) => m.rprecOk), sum((m) => m.rprecTotal))}` +
      `  seniority ${share(sum((m) => m.seniorityPairsOk), sum((m) => m.seniorityPairsTotal))}`,
  );
  return out.join("\n");
}
