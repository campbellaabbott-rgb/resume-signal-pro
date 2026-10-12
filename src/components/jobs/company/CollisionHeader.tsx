// A BOARD NAME TWO HIRING SYSTEMS SHARE NAMES NO EMPLOYER.
//
// /jobs/company/clear lists Clear on BambooHR beside CLEAR - Corporate on
// Greenhouse. With the collision notice below it, the page still read "Open
// roles at Clear", "straight from Clear's own job board" and "Watch Clear"
// (audit CP2, CP12). This header replaces all of it on the 139 tokens the
// catalogue lists twice: a neutral H1 about the board name, one line on why
// no employer fact is shown, and each board by its own catalogue name and
// hiring system with its open roles now and a button that shows only that
// board's roles (the vendor filter, through onShowOnly).
//
// A MISSING COUNT IS NEVER A ZERO. The counts are get_company_intel's
// open_by_source. A board the answer does not name says "count not
// available" and keeps a button that filters to it without a number.
import { Split } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CollidedBoard } from "@/lib/board-collisions";
import { useCompanyIntel } from "@/components/jobs/CompanyIntelPanel";
import { openBySource } from "@/components/jobs/BoardCollisionNotice";
import { dateTime as fmtDateTime, count as fmtCount } from "@/lib/company/format";
import { tPlural } from "@/lib/company/plural";
import { CompanyBreadcrumb, HeaderActions } from "./CompanyHeader";

export function CollisionHeader({ token, boards, labelOf, onShowOnly, onWatch, onCopyLink }: {
  token: string;
  boards: CollidedBoard[];
  /** The vendor's own name for a source, or null. */
  labelOf: (source: string) => string | null;
  /** Sets the board's vendor filter, so the list shows that board's roles alone. */
  onShowOnly: (source: string) => void;
  onWatch: () => void;
  onCopyLink?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const { intel, readAt } = useCompanyIntel(token);
  const open = openBySource(intel?.open_by_source);
  const other = t("jobsPage.collision.otherSystem", "another hiring system");

  return (
    <header data-company-header="collision" className="mb-4 space-y-3">
      <CompanyBreadcrumb name={null} />
      <h1 className="text-2xl font-semibold tracking-tight text-foreground break-words sm:text-3xl">
        {t("companyProfile.collision.h1", "Open roles on boards named “{{token}}”", { token })}
      </h1>
      <p className="flex items-start gap-2 text-meta text-foreground" data-collision-line="">
        <Split className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          {tPlural(t, "companyProfile.collision.lead", boards.length, { n: fmtCount(boards.length, { lng: lang }) },
            "{{n}} hiring system carries a board with this name. Nothing we hold says whether they are one employer, so this page shows no employer facts.",
            "{{n}} hiring systems carry a board with this name. Nothing we hold says whether they are one employer, so this page shows no employer facts.")}
        </span>
      </p>
      <ul className="space-y-2" data-collision-boards="">
        {boards.map((b) => {
          const system = labelOf(b.source) ?? other;
          const n = open && typeof open[b.source] === "number" ? open[b.source] : null;
          return (
            <li key={b.source} className="rounded-md border border-border bg-card px-3 py-2" data-collision-board={b.source}>
              <p className="text-sm font-medium text-foreground break-words">{b.name}</p>
              <p className="text-meta text-muted-foreground" data-collision-count={n === null ? "unavailable" : "known"}>
                {n === null
                  ? t("companyProfile.collision.boardUnavailable", "{{system}} board · count not available", { system })
                  : tPlural(t, "companyProfile.collision.board", n, { system, n: fmtCount(n, { lng: lang }) },
                      "{{system}} board · {{n}} open role now", "{{system}} board · {{n}} open roles now")}
              </p>
              {n !== 0 && (
                <button
                  type="button"
                  onClick={() => onShowOnly(b.source)}
                  className="mt-1 inline-flex min-h-8 max-w-full items-center whitespace-normal rounded-md border border-border-strong bg-card px-2.5 text-left text-meta font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {n === null
                    ? t("companyProfile.collision.showOnlyUncounted", "Show only this board's roles")
                    : tPlural(t, "companyProfile.collision.showOnly", n, { n: fmtCount(n, { lng: lang }) }, "Show only this role", "Show only these {{n}} roles")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {open && readAt && (
        <p className="text-xs text-subtle-foreground">
          {t("companyProfile.collision.basis", "Counts are postings each board's own feed still serves, as of {{when}}.", { when: fmtDateTime(readAt, { lng: lang }) })}
        </p>
      )}
      <HeaderActions
        watchLabel={t("companyProfile.actions.watchBoards", "Watch boards named “{{token}}”", { token })}
        menuLabel={t("companyProfile.actions.more", "More actions for {{name}}", { name: token })}
        onWatch={onWatch}
        onCopyLink={onCopyLink}
      />
    </header>
  );
}
