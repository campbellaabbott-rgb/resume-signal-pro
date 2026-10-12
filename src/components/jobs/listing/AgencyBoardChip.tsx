/**
 * "Staffing agency board" — the agency flag is set per BOARD (job_board
 * catalogue), so the chip claims the board, not the posting (audit JL9). It
 * renders only on a literal true: ranked-path rows omit the field, and no chip
 * is the right render for "not stated".
 */
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AgencyBoardChip() {
  const { t } = useTranslation();
  const tip = t("listing.card.agencyBoardTip", "This board belongs to a staffing or recruiting agency. We flag the board, not each posting, so the roles here are usually for the agency's clients rather than for the agency itself.");
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-foreground" title={tip} data-chip="agency">
      <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
      {t("listing.card.agencyBoard", "Staffing agency board")}
    </span>
  );
}
