/**
 * WHAT THE PAGE SAYS WHEN THE BOARD'S DAILY ALLOWANCE IS SPENT.
 *
 * The board answers a 429 `board_budget` past its per-address cap (see
 * src/lib/board-budget.ts). Rendering that as "The board couldn't load right
 * now" with a Try again button would send a person to retry a request that
 * cannot succeed until the reset, and an empty board would read as "no jobs".
 * So it says what happened, when it lifts, and who to write to -- and offers
 * no retry. The country variant carries no number: there is no allowance to
 * quote.
 */
import { useTranslation } from "react-i18next";
import { PauseCircle } from "lucide-react";
import type { BoardBudgetRefusal } from "@/lib/board-budget";

export const BOARD_BUDGET_CONTACT_EMAIL = "resumeboostersupp@gmail.com";

export function BoardBudgetNotice({ refusal, variant = "panel" }: { refusal: BoardBudgetRefusal; variant?: "panel" | "banner" }) {
  const { t } = useTranslation();
  const reset = refusal.resetAt ? new Date(refusal.resetAt) : null;
  const time = reset && Number.isFinite(reset.getTime())
    ? reset.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "00:00 UTC";
  const body = refusal.code === "country"
    ? t("jobsPage.budgetCountry", "Job board reads from your region are paused right now.")
    : t("jobsPage.budgetAddress", "This connection has used today's allowance of {{limit}} job board reads. It resets at {{time}} your time.", {
        limit: (refusal.limit ?? 0).toLocaleString(),
        time,
      });
  return (
    <div
      role="status"
      data-board-budget-notice={refusal.code}
      className={variant === "banner"
        ? "rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 px-4 py-3 mb-4 text-left"
        : "rounded-2xl border border-border bg-card p-6 my-4 text-left max-w-xl mx-auto"}
    >
      <p className="flex items-center gap-2 font-semibold text-foreground mb-1">
        <PauseCircle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden="true" />
        {t("jobsPage.budgetTitle", "The job board is paused for this connection")}
      </p>
      <p className="text-sm text-muted-foreground">{body}</p>
      <p className="text-sm text-muted-foreground mt-2">
        {t("jobsPage.budgetContact", "If you are looking for work and this is in your way, write to {{email}} and we will sort it out.", { email: BOARD_BUDGET_CONTACT_EMAIL })}
      </p>
    </div>
  );
}
