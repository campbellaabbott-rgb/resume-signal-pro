import { useTranslation } from "react-i18next";
import { REPORT_ENUM_KEY } from "@/lib/career-report-shape";

// Interview Coach and Career Path keep these fixed choices in English too
// (the same instruction). Kept here, not in career-report-shape.ts, which is
// byte-identical to the generators' copy.
const TOOL_ENUM_KEY: Record<string, string> = {
  Easy: "easy", Hard: "hard", Lead: "lead", Director: "director", VP: "vp",
  Behavioral: "behavioral", Technical: "technical", Situational: "situational", "Culture Fit": "cultureFit",
};

/**
 * A paid report's fixed-choice value in the reader's language, from its
 * English value; anything else as written (sweep S8-034). The model keeps
 * these in English because the pages pick colours by them.
 */
export function useReportEnumLabel() {
  const { t } = useTranslation();
  return (value: string) => {
    const key = REPORT_ENUM_KEY[value] ?? TOOL_ENUM_KEY[value];
    return key ? t(`careerReportEnum.${key}`) : value;
  };
}
