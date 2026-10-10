import { useTranslation } from "react-i18next";
import { REPORT_ENUM_KEY } from "@/lib/career-report-shape";

/**
 * A Career Snapshot or Game Plan verdict in the reader's language, from its
 * English value; anything else as written (sweep S8-034). The model keeps
 * these in English because the pages pick colours by them.
 */
export function useReportEnumLabel() {
  const { t } = useTranslation();
  return (value: string) => (REPORT_ENUM_KEY[value] ? t(`careerReportEnum.${REPORT_ENUM_KEY[value]}`) : value);
}
