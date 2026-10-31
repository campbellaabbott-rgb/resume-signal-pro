/**
 * WHAT EACH PLAN ALLOWS, AS DATA: the rows of the pricing page's limits
 * table, for the page (PlanLimitsTable) and the crawler bake
 * (scripts/prerender-seo.mjs, "/pricing") alike, so the two print one table.
 * Pure: the caller passes the string lookup (pricingPlans.limits.<key>) and
 * how a price and a count are written in its language. No React.
 */
import {
  FREE_KEY_DAILY_QUOTA,
  FREE_SCANS_PER_DAY,
  FULL_ANALYSIS_PRICE_USD,
  MCP_FIT_FREE_PER_DAY,
  MCP_FIT_FULL_PER_DAY,
  SIGNED_IN_SCANS_PER_DAY,
  WRITING,
} from "./plan-facts";
import type { SaleGates } from "./sale-gates";

export type Tone = "ok" | "no" | undefined;
export interface Cell {
  text: string;
  tone?: Tone;
}
export interface Row {
  id: string;
  label: string;
  cells: [Cell, Cell, Cell];
}
export interface Group {
  id: string;
  caption: string;
  rows: Row[];
}

/** A pricingPlans.limits.<key> string, with its placeholders filled. */
export type LimitString = (key: string, vars?: Record<string, unknown>) => string;

export function limitGroups(
  L: LimitString,
  gates: Pick<SaleGates, "fullAnalysis" | "alertsStatable">,
  write: { money: (usd: number) => string; count: (n: number) => string },
): { columns: [string, string, string]; groups: Group[] } {
  const inc: Cell = { text: L("included"), tone: "ok" };
  const no: Cell = { text: L("notIncluded"), tone: "no" };
  const same = (c: Cell): [Cell, Cell, Cell] => [c, c, c];
  const faPrice = write.money(FULL_ANALYSIS_PRICE_USD);
  const faCells: [Cell, Cell, Cell] = gates.fullAnalysis.onSale
    ? [{ text: L("faEach", { price: faPrice }) }, { text: L("faEach", { price: faPrice }) }, inc]
    : same({ text: L("faNotOnSale"), tone: "no" });
  return {
    columns: [L("colOut"), L("colFree"), L("colPro")],
    groups: [
      {
        id: "site",
        caption: L("groupSite"),
        rows: [
          { id: "search", label: L("rowSearch"), cells: same(inc) },
          {
            id: "scans",
            label: L("rowScans"),
            cells: [{ text: L("perDay", { n: FREE_SCANS_PER_DAY }) }, { text: L("perDay", { n: SIGNED_IN_SCANS_PER_DAY }) }, { text: L("noScanCap") }],
          },
          { id: "fit", label: L("rowFit"), cells: [{ text: L("fitBrowser"), tone: "ok" }, { text: L("fitSaved"), tone: "ok" }, inc] },
          { id: "saved", label: L(gates.alertsStatable ? "rowSaved" : "rowSavedNoAlerts"), cells: [no, inc, inc] },
          {
            id: "writing",
            label: L("rowWriting"),
            cells: [
              no,
              { text: L("writingFree", { perDay: WRITING.freePerToolPerDay }) },
              { text: L("writingPro", { perDay: WRITING.proPackagesPerDay, perMonth: WRITING.proPackagesPerMonth }) },
            ],
          },
          { id: "fa", label: L("rowFa"), cells: faCells },
        ],
      },
      {
        id: "ai",
        caption: L("groupAi"),
        rows: [
          { id: "ai-search", label: L("rowAiSearch"), cells: same({ text: L("sharedAllowance") }) },
          { id: "ai-account", label: L("rowAiAccount"), cells: [no, { text: L("notYet") }, { text: L("notYet") }] },
        ],
      },
      {
        id: "code",
        caption: L("groupCode"),
        rows: [
          { id: "code-search", label: L("rowCodeSearch"), cells: same({ text: L("codeSearch", { perDay: write.count(FREE_KEY_DAILY_QUOTA) }) }) },
          {
            id: "code-fit",
            label: L("rowCodeFit"),
            // A key whose account has Pro scores 1,000 a day (agent-mcp fitStandingOf).
            cells: [
              { text: L("perDay", { n: MCP_FIT_FREE_PER_DAY }) },
              { text: L("perDay", { n: MCP_FIT_FREE_PER_DAY }) },
              { text: L("fitProKey", { n: write.count(MCP_FIT_FULL_PER_DAY) }) },
            ],
          },
        ],
      },
    ],
  };
}
