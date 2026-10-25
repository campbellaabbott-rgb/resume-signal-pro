// The company page of a board token two hiring systems carry (139 in the
// catalogue, src/lib/board-collisions.ts). /jobs/company/clear is Clear on
// BambooHR and CLEAR - Corporate on Greenhouse, and every per-employer reader
// keys on the token, so the page shows this split in place of every
// employer-level block: each board by its own name and hiring system, with the
// roles it serves now, and nothing that would describe two companies as one.
//
// The counts are get_company_intel's open_by_source (20261012101000): open
// roles on THIS token per hiring system, under both serving rules. Until it
// answers, or when it cannot, the boards are still named and no count is
// printed -- a missing count is never a zero, and a board the answer does not
// name says "count not available" rather than "0".
//
// The redesigned company page renders CollisionHeader
// (src/components/jobs/company/CollisionHeader.tsx) in this notice's place,
// with a "Show only these roles" button per board; this notice stays the
// lander's until the wiring pass swaps it.

import { Split } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CollidedBoard } from "@/lib/board-collisions";
import { useCompanyIntel } from "@/components/jobs/CompanyIntelPanel";

/** Open roles per hiring system from the intel answer, or null when it did not say. */
export function openBySource(rows: Array<{ source: string; open_roles: number }> | undefined | null): Record<string, number> | null {
  if (!Array.isArray(rows)) return null;
  const counts: Record<string, number> = {};
  for (const r of rows) if (typeof r?.source === "string" && typeof r.open_roles === "number") counts[r.source] = r.open_roles;
  return counts;
}

export function BoardCollisionNotice({ companyToken, boards, labelOf }: {
  companyToken: string;
  boards: CollidedBoard[];
  /** The vendor's own name for a source, or null (never the raw column value). */
  labelOf: (source: string) => string | null;
}) {
  const { t } = useTranslation();
  const { intel } = useCompanyIntel(companyToken);
  const open = openBySource(intel?.open_by_source);

  const titleId = `board-collision-${companyToken}`;
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border bg-card p-4 mb-4 max-w-xl text-meta">
      <div className="flex items-center gap-2 mb-1">
        <Split className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          {t("jobsPage.collision.title", "{{n}} hiring systems carry a board with this name", { n: boards.length })}
        </h2>
      </div>
      <p className="text-muted-foreground">
        {t("jobsPage.collision.body", "Nothing we hold says whether these boards belong to one employer, and often they do not. So this page lists the roles from all of them and shows no employer facts here: no pay or headcount figures, hiring record, filings or similar employers, because we could not say which employer they describe.")}
      </p>
      <ul className="mt-2 space-y-1">
        {boards.map((b) => (
          <li key={b.source}>
            <span className="text-foreground font-medium">
              {t("jobsPage.collision.board", "{{name}} on {{vendor}}", {
                name: b.name,
                vendor: labelOf(b.source) ?? t("jobsPage.collision.otherSystem", "another hiring system"),
              })}
            </span>
            {open && (
              <span className="text-muted-foreground" data-collision-count={typeof open[b.source] === "number" ? "known" : "unavailable"}>
                {" · "}
                {typeof open[b.source] === "number"
                  ? t("jobsPage.collision.openRoles", "open roles now: {{n}}", { n: open[b.source].toLocaleString() })
                  : t("companyProfile.collision.countUnavailable", "count not available")}
              </span>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <p className="text-xs text-subtle-foreground mt-2">
          {t("jobsPage.collision.basis", "Open roles are postings each board's own feed still serves whose date falls inside the last 30 days: the employer's date, or for a posting that carries none, the day we last saw it.")}
        </p>
      )}
      <p className="text-xs text-subtle-foreground mt-1">
        {t("jobsPage.collision.filterHint", "To see one board's roles alone, choose its hiring system in the filters.")}
      </p>
    </section>
  );
}
