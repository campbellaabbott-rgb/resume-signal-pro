// Bias-audit math for Shortlist: selection rates and impact ratios per
// group and intersectional group, in the shape NYC Local Law 144 audits use.
//
// Method (Uniform Guidelines / LL144):
//   selection rate  = advanced / total   (per group)
//   impact ratio    = group rate / highest group rate
//   four-fifths flag = impact ratio < 0.8
//
// Caveat carried into the output: the 4/5ths rule is a screening heuristic,
// not a safe harbor — smaller gaps can still evidence disparate impact
// (EEOC guidance). Groups below a minimum size are reported but marked
// low-sample, since ratios on tiny groups are statistically meaningless.

export interface AuditRecord {
  advanced: boolean;          // final HUMAN decision, not the AI score
  sex?: string | null;
  raceEthnicity?: string | null;
}

export interface GroupStat {
  group: string;
  total: number;
  advanced: number;
  selectionRate: number;      // 0..1, rounded to 4dp
  impactRatio: number | null; // vs highest-rate group; null when rate basis absent
  fourFifthsFlag: boolean;    // true = below 0.8 threshold
  lowSample: boolean;         // n < MIN_GROUP_SIZE — interpret with caution
}

export interface ImpactAnalysis {
  bySex: GroupStat[];
  byRaceEthnicity: GroupStat[];
  intersectional: GroupStat[];
  totalRecords: number;
  recordsWithDemographics: number;
  methodologyNote: string;
}

const MIN_GROUP_SIZE = 5;

const normalize = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim().toLowerCase();
  return t.length > 0 ? t : null;
};

function computeGroups(records: Array<{ key: string; advanced: boolean }>): GroupStat[] {
  const groups = new Map<string, { total: number; advanced: number }>();
  for (const r of records) {
    const g = groups.get(r.key) ?? { total: 0, advanced: 0 };
    g.total++;
    if (r.advanced) g.advanced++;
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

  // Impact ratio vs the HIGHEST selection rate among adequately-sampled groups
  // (falling back to all groups when every group is small).
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

export function computeImpactAnalysis(records: AuditRecord[]): ImpactAnalysis {
  const withDemo = records.filter(r => normalize(r.sex) || normalize(r.raceEthnicity));

  const bySex = computeGroups(
    records.filter(r => normalize(r.sex))
      .map(r => ({ key: normalize(r.sex)!, advanced: r.advanced })),
  );
  const byRace = computeGroups(
    records.filter(r => normalize(r.raceEthnicity))
      .map(r => ({ key: normalize(r.raceEthnicity)!, advanced: r.advanced })),
  );
  const intersectional = computeGroups(
    records.filter(r => normalize(r.sex) && normalize(r.raceEthnicity))
      .map(r => ({ key: `${normalize(r.sex)} × ${normalize(r.raceEthnicity)}`, advanced: r.advanced })),
  );

  return {
    bySex,
    byRaceEthnicity: byRace,
    intersectional,
    totalRecords: records.length,
    recordsWithDemographics: withDemo.length,
    methodologyNote:
      "Selection rate = advanced/total per group; impact ratio = group rate ÷ highest adequately-sampled group rate; " +
      "flag = ratio < 0.8 (four-fifths rule). The 4/5ths rule is a screening heuristic, not a safe harbor — smaller " +
      `disparities can still evidence disparate impact. Groups with n < ${MIN_GROUP_SIZE} are marked low-sample. ` +
      "Demographics are self-reported, stored separately from scoring inputs, and never provided to the model.",
  };
}
