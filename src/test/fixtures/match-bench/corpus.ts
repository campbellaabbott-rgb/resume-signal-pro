/**
 * THE FROZEN CORPUS: every posting the 2026-10-12 BEFORE bench and the two
 * prototypes saw through job-board's read-only list and detail calls, and
 * every description any of them read. Built once by
 * scripts/match-bench/build-corpus.ts; the gate reads it and never the network.
 *
 * It is a closed world. The AFTER pipeline run against it finds only postings
 * one of those runs retrieved, and reads requirements only where one of them
 * read a description (618 of 4,684 rows), so it measures regressions in the
 * engine's reading, gating, tiering and ordering, not the live board's recall.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export interface CorpusRow {
  id: string; source: string | null; token: string | null; company: string | null; title: string | null;
  location: string | null; country: string | null; remote: boolean | null; workMode: string | null;
  employmentType: string | null; department: string | null; category: string | null; postedAt: string | null;
  lastSeen: string | null; missingSince: string | null; salary: string | null; salaryMinAnnual: number | null;
  salaryMaxAnnual: number | null; salaryPeriod: string | null; salaryCurrency: string | null;
  experienceBand: string | null; minYears: number | null; agency: boolean | null;
  /** This row is a collapsed sibling of another posting (the same requisition at another location). */
  siblingOf?: string;
  /** Which run first saw it. */
  origin: string;
}
export interface Corpus {
  version: string;
  frozenAt: string;
  rows: Map<string, CorpusRow>;
  /** The description any run read for this posting, or null. */
  description(id: string): string | null;
  /** Where it came from: "before:live", "before:prior", "match-acc-1012:detail", "sibling-of:<id>" ... */
  descriptionSource(id: string): string | null;
  descriptionCount: number;
}

export const FIXTURES = dirname(fileURLToPath(import.meta.url));
let cached: Corpus | null = null;

export function loadCorpus(): Corpus {
  if (cached) return cached;
  const raw = JSON.parse(gunzipSync(readFileSync(join(FIXTURES, "corpus.json.gz"))).toString("utf8")) as {
    version: string; frozenAt: string; rows: CorpusRow[]; descriptions: Record<string, { text: string; source: string }>;
  };
  const rows = new Map(raw.rows.map((r) => [r.id, r]));
  cached = {
    version: raw.version,
    frozenAt: raw.frozenAt,
    rows,
    description: (id) => raw.descriptions[id]?.text ?? null,
    descriptionSource: (id) => raw.descriptions[id]?.source ?? null,
    descriptionCount: Object.keys(raw.descriptions).length,
  };
  return cached;
}

/** The descriptions the BEFORE run itself held: what the legacy rubric read. */
export function beforeDescription(id: string): string | null {
  const c = loadCorpus();
  return c.descriptionSource(id)?.startsWith("before:") ? c.description(id) : null;
}

/** Every description in the corpus, whichever run read it: what the v2 rubric reads. */
export function anyDescription(id: string): string | null {
  return loadCorpus().description(id);
}
