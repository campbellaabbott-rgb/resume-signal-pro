/**
 * The interview-prep guide's and the career roadmap's labels as the English
 * shard words them, for tests that export a guide (the export module itself
 * carries no words of its own: RC-S12-114).
 */
import type { CareerPathLabels, InterviewPrepLabels } from "@/lib/career-tools-export";
import EN from "@/i18n/shards/writing-tools/en.json";

type Shard = { writingTools: { export: Record<string, string> } };

/** Labels from one language's shard, filling {{probability}} and {{risk}}. */
export function labelsFrom(shard: Shard): { prep: InterviewPrepLabels; path: CareerPathLabels } {
  const x = shard.writingTools.export;
  return {
    prep: {
      title: x.prepTitle, whyAsked: x.whyAsked, opener: x.opener, modelAnswer: x.modelAnswer,
      tips: x.tips, avoid: x.avoid, before: x.before, during: x.during, askThem: x.askThem,
    },
    path: {
      title: x.pathTitle, current: x.current,
      odds: (probability, risk) => x.pathOdds.replace("{{probability}}", probability).replace("{{risk}}", risk),
      skills: x.skills, actionPlan: x.actionPlan, thisWeek: x.thisWeek,
    },
  };
}

export const EN_LABELS = labelsFrom(EN as Shard);
