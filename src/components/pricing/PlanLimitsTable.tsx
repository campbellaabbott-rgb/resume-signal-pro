/**
 * WHAT EACH PLAN ALLOWS: one table from 768px, and under it the same rows as
 * labelled lines (each value on its own line below 400px), never both in the
 * DOM at once. Every value is interpolated from plan-facts.ts and the Pro
 * column from pro-perks-mirror.ts's definition; the note under it names the
 * day the limits were read and that days are UTC days.
 *
 * Fit is "Included" for a signed-out visitor: job-fit takes no session, and
 * the board scores against the résumé this browser scanned or dropped.
 * "In your AI" is split: Claude Code sends a key by header, so a free key's
 * quota and its fit allowance apply there, not in Claude or ChatGPT.
 */
import { Check, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import "@/i18n/pricing-strings";
import { count, date, money } from "@/lib/format";
import { LIMITS_AS_OF } from "./plan-facts";
import { limitGroups, type Cell, type Group } from "./limit-groups";
import type { SaleGates } from "./sale-gates";
import { useMinWidth } from "./use-media";

function Value({ cell }: { cell: Cell }) {
  return (
    <span className="inline-flex min-w-0 items-start gap-1.5 [overflow-wrap:anywhere] hyphens-auto">
      {cell.tone === "ok" ? <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : null}
      {cell.tone === "no" ? <Minus aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : null}
      <span className={cell.tone === "no" ? "text-muted-foreground" : undefined}>{cell.text}</span>
    </span>
  );
}

/** The table's rows in the reader's language (limit-groups.ts holds them, for the bake too). */
export function useLimitGroups(gates: SaleGates): { columns: [string, string, string]; groups: Group[] } {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  return limitGroups((k, v) => t(`pricingPlans.limits.${k}`, v), gates, {
    money: (usd) => money(usd, "USD", { lng }),
    count: (n) => count(n, { lng }),
  });
}

export function PlanLimitsTable({ gates }: { gates: SaleGates }) {
  const { t, i18n } = useTranslation();
  const wide = useMinWidth(768);
  const { columns, groups } = useLimitGroups(gates);
  const note = t("pricingPlans.limits.note", { date: date(LIMITS_AS_OF, { lng: i18n.language }) });

  return (
    <section aria-labelledby="pricing-limits" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container">
        <h2 id="pricing-limits" className="text-2xl font-semibold tracking-tight md:text-3xl">
          {t("pricingPlans.limits.h2")}
        </h2>
        {wide ? (
          <table className="mt-4 w-full table-fixed border-collapse text-left text-sm" data-testid="limits-table">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="px-3 pb-2.5 text-meta font-semibold text-foreground">{t("pricingPlans.limits.feature")}</th>
                {columns.map((c) => (
                  <th key={c} scope="col" className="px-3 pb-2.5 text-meta font-semibold text-foreground">{c}</th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.id} data-group={g.id}>
                <tr>
                  <th colSpan={4} scope="rowgroup" className="px-3 pb-1 pt-5 text-xs font-semibold tracking-wide text-subtle-foreground">
                    {g.caption}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.id} data-row={r.id} className="border-t border-border align-top">
                    <th scope="row" className="px-3 py-2.5 font-normal text-foreground">{r.label}</th>
                    {r.cells.map((c, i) => (
                      <td key={i} className="px-3 py-2.5 text-foreground">
                        <Value cell={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        ) : (
          <div className="mt-4" data-testid="limits-stack">
            {groups.map((g, gi) => (
              <div key={g.id} data-group={g.id}>
                <h3 className={`${gi > 0 ? "pt-5" : ""} text-xs font-semibold tracking-wide text-subtle-foreground`}>{g.caption}</h3>
                {g.rows.map((r) => (
                  <div key={r.id} data-row={r.id} className="border-b border-border py-3">
                    <h4 className="text-sm font-semibold text-foreground">{r.label}</h4>
                    <dl className="mt-1.5 grid gap-1.5 min-[400px]:grid-cols-3 min-[400px]:gap-3">
                      {r.cells.map((c, i) => (
                        <div key={i} className="flex min-w-0 items-baseline justify-between gap-3 min-[400px]:block">
                          <dt className="text-xs text-subtle-foreground">{columns[i]}</dt>
                          <dd className="min-w-0 text-right text-sm text-foreground min-[400px]:mt-0.5 min-[400px]:text-left">
                            <Value cell={c} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-subtle-foreground">
          {note} {t("pricingPlans.limits.chatgptNote")}
        </p>
      </div>
    </section>
  );
}
