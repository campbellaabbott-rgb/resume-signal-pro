// Bias-audit math for Shortlist: selection rates and scoring rates, with
// impact ratios, per EEO-1 sex and race/ethnicity category and their
// intersection -- the two tables NYC LL144 bias audits of a scoring tool use.
//
// Method (Uniform Guidelines / LL144 rules, 6 RCNY 5-301):
//   selection rate  = advanced / decided          (per group, human decisions)
//   scoring rate    = share scoring above the sample's median AI score
//   impact ratio    = group rate / highest adequately-sampled group rate
//   four-fifths flag = impact ratio < 0.8
//
// Sweep S8-042. The selection table counted pending candidates as not
// selected under a "final HUMAN decisions" heading (men 5 of 10 advanced,
// women 3 advanced, 2 rejected, 5 pending: a false 0.6 flag), and the
// demographics were free text with only trim and lowercase, so "Female", "F"
// and "woman" were three small groups whose real disparity the page hid as
// low-sample. Pending candidates are now left out of selection rates and
// counted apart, every value is read into one EEO-1 category (or counted as
// unclassified), and the scoring-rate table is computed from the scores.
//
// Caveat carried into the output: the 4/5ths rule is a screening heuristic,
// not a safe harbor. Groups below a minimum size are reported but marked
// low-sample.

export interface AuditRecord {
  advanced: boolean;          // final HUMAN decision, not the AI score
  /** No human decision yet: left out of selection rates, counted apart. */
  pending?: boolean;
  /** The AI score, for scoring rates; null when unscored or routed to alternative review. */
  score?: number | null;
  sex?: string | null;
  raceEthnicity?: string | null;
}

export interface GroupStat {
  group: string;
  total: number;
  advanced: number;           // selected (selection table) or above the median (scoring table)
  selectionRate: number;      // 0..1, rounded to 4dp
  impactRatio: number | null; // vs highest-rate group; null when rate basis absent
  fourFifthsFlag: boolean;    // true = below 0.8 threshold
  lowSample: boolean;         // n < MIN_GROUP_SIZE — interpret with caution
}

export interface ImpactAnalysis {
  bySex: GroupStat[];
  byRaceEthnicity: GroupStat[];
  intersectional: GroupStat[];
  scoringBySex: GroupStat[];
  scoringByRaceEthnicity: GroupStat[];
  scoringIntersectional: GroupStat[];
  /** The sample's median AI score, or null with no scores. */
  medianScore: number | null;
  totalRecords: number;
  recordsWithDemographics: number;
  /** Candidates with no human decision yet, left out of selection rates. */
  pendingExcluded: number;
  /** Recorded values that are no EEO-1 category, left out of every table. */
  unclassified: number;
  methodologyNote: string;
}

const MIN_GROUP_SIZE = 5;

/** The EEO-1 categories, as stored and shown. */
export const SEX_CATEGORIES = ["Female", "Male", "Another identity"] as const;
export const RACE_CATEGORIES = [
  "Hispanic or Latino",
  "White",
  "Black or African American",
  "Asian",
  "Native Hawaiian or Other Pacific Islander",
  "American Indian or Alaska Native",
  "Two or more races",
] as const;

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

const SEX_WORDS: Record<string, string> = {
  f: "Female", female: "Female", woman: "Female", women: "Female", w: "Female", girl: "Female",
  m: "Male", male: "Male", man: "Male", men: "Male", boy: "Male",
  "another identity": "Another identity", nonbinary: "Another identity", "non binary": "Another identity", nb: "Another identity",
  other: "Another identity", x: "Another identity", genderqueer: "Another identity", "gender non conforming": "Another identity",
};
const RACE_WORDS: Array<[RegExp, string]> = [
  [/^(two or more( races)?|multiracial|multi racial|mixed( race)?|biracial)$/, "Two or more races"],
  [/^(hispanic|latino|latina|latinx|latine|hispanic or latino|hispanic latino)$/, "Hispanic or Latino"],
  [/^(white|caucasian|white non hispanic)$/, "White"],
  [/^(black|african american|black or african american|black african american)$/, "Black or African American"],
  [/^(asian|asian american)$/, "Asian"],
  [/^(native hawaiian|pacific islander|native hawaiian or other pacific islander|nhpi)$/, "Native Hawaiian or Other Pacific Islander"],
  [/^(american indian|alaska native|native american|american indian or alaska native|aian|indigenous)$/, "American Indian or Alaska Native"],
];

/** The EEO-1 sex category a recorded value means, or null. */
export function sexCategory(v: string | null | undefined): string | null {
  const k = fold(v ?? "");
  return k ? SEX_WORDS[k] ?? null : null;
}

/** The EEO-1 race/ethnicity category a recorded value means, or null. */
export function raceCategory(v: string | null | undefined): string | null {
  const k = fold(v ?? "");
  if (!k) return null;
  for (const [re, cat] of RACE_WORDS) if (re.test(k)) return cat;
  return null;
}

const recorded = (v: string | null | undefined) => (v ?? "").trim().length > 0;

function computeGroups(records: Array<{ key: string; hit: boolean }>): GroupStat[] {
  const groups = new Map<string, { total: number; advanced: number }>();
  for (const r of records) {
    const g = groups.get(r.key) ?? { total: 0, advanced: 0 };
    g.total++;
    if (r.hit) g.advanced++;
    groups.set(r.key, g);
  }

  const stats: GroupStat[] = Array.from(groups.entries()).map(([group, g]) => ({
    group,
    total: g.total,
    advanced: g.advanced,
    selectionRate: g.total > 0 ? Math.round((g.advanced / g.total) * 10000) / 10000 : 0,
    impactRatio: null,
    fourFifthsFlag: false,
    lowSample: g.total < MIN_GROUP_SIZE,
  }));

  // Impact ratio vs the HIGHEST rate among adequately-sampled groups (falling
  // back to all groups when every group is small).
  const basisPool = stats.filter(s => !s.lowSample);
  const basis = Math.max(...(basisPool.length > 0 ? basisPool : stats).map(s => s.selectionRate), 0);
  for (const s of stats) {
    if (basis > 0) {
      s.impactRatio = Math.round((s.selectionRate / basis) * 10000) / 10000;
      s.fourFifthsFlag = s.impactRatio < 0.8;
    }
  }

  return stats.sort((a, b) => b.total - a.total);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function tables(rows: Array<{ sex: string | null; race: string | null; hit: boolean }>) {
  return {
    bySex: computeGroups(rows.filter(r => r.sex).map(r => ({ key: r.sex!, hit: r.hit }))),
    byRace: computeGroups(rows.filter(r => r.race).map(r => ({ key: r.race!, hit: r.hit }))),
    intersectional: computeGroups(rows.filter(r => r.sex && r.race).map(r => ({ key: `${r.sex} × ${r.race}`, hit: r.hit }))),
  };
}

export function computeImpactAnalysis(records: AuditRecord[]): ImpactAnalysis {
  const read = records.map(r => ({ ...r, sexCat: sexCategory(r.sex), raceCat: raceCategory(r.raceEthnicity) }));
  const unclassified = read.filter(r => (recorded(r.sex) && !r.sexCat) || (recorded(r.raceEthnicity) && !r.raceCat)).length;
  const withDemo = read.filter(r => r.sexCat || r.raceCat);

  const decided = read.filter(r => !r.pending);
  const selection = tables(decided.map(r => ({ sex: r.sexCat, race: r.raceCat, hit: r.advanced })));

  const scored = read.filter(r => typeof r.score === "number" && Number.isFinite(r.score));
  const med = median(scored.map(r => r.score as number));
  const scoring = tables(scored.map(r => ({ sex: r.sexCat, race: r.raceCat, hit: med !== null && (r.score as number) > med })));

  return {
    bySex: selection.bySex,
    byRaceEthnicity: selection.byRace,
    intersectional: selection.intersectional,
    scoringBySex: scoring.bySex,
    scoringByRaceEthnicity: scoring.byRace,
    scoringIntersectional: scoring.intersectional,
    medianScore: med,
    totalRecords: records.length,
    recordsWithDemographics: withDemo.length,
    pendingExcluded: read.length - decided.length,
    unclassified,
    methodologyNote:
      "Selection rate = advanced ÷ decided per group (candidates with no human decision yet are left out); scoring rate = " +
      "share of a group scoring above the sample's median AI score (candidates routed to alternative review are left out); " +
      "impact ratio = group rate ÷ highest adequately-sampled group rate; flag = ratio < 0.8 (four-fifths rule). The 4/5ths " +
      "rule is a screening heuristic, not a safe harbor — smaller disparities can still evidence disparate impact. Groups " +
      `with n < ${MIN_GROUP_SIZE} are marked low-sample. Categories are EEO-1's; a recorded value that is none of them is ` +
      "counted as unclassified and left out. Demographics are stored separately from scoring inputs and never provided to the model.",
  };
}
