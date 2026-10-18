/**
 * THE BOARD'S FIGURES, ALL FROM ONE READ (owner decision D1).
 *
 * Every count on the homepage comes from get_board_vendor_counts, read once
 * through useBoardVendorCounts: openTotal for "open postings", sourcesFacet for
 * the hiring-system table, and both under the one as_of. No figure on the page
 * is read from a second source, and no figure prints without that as_of.
 *
 * The AI line's withheld systems are mirrored here, not imported: the
 * connector's list lives in src/config/mcp-tools.ts (about 1,200 lines that
 * must never load on "/"), and src/test/hp-home-mirrors.test.ts holds the two
 * lists equal. At switch-over this reads wave 4's src/config/mcp-withheld.ts.
 */
import { systemLabel } from "@/lib/listing/apply-url";

/** Systems the AI connector and the data API never hand on (MCP_WITHHELD_SOURCES). */
export const HOME_WITHHELD_SOURCES: readonly string[] = ["usajobs", "smartrecruiters"];

/** The federal listing site: always its own row in the table, with its note. */
export const FEDERAL_SOURCE = "usajobs";
/** Hiring systems listed before "N more systems". */
export const TOP_SYSTEM_ROWS = 6;

export interface SourceRow {
  source: string;
  name: string;
  total: number;
}

export interface SourcesTable {
  top: SourceRow[];
  federal: SourceRow | null;
  more: SourceRow[];
  moreSum: number;
  /** Sum of every row: equal to openTotal on a healthy read. */
  sum: number;
}

const rowOf = (source: string, total: number): SourceRow => ({ source, name: systemLabel(source) ?? source, total });

/** The table: the six largest systems, USAJOBS on its own row, then the rest with their sum. */
export function sourcesTable(counts: Record<string, number> | null | undefined): SourcesTable | null {
  const rows = Object.entries(counts ?? {})
    .filter(([, n]) => Number.isFinite(n) && n > 0)
    .map(([s, n]) => rowOf(s, Math.round(n)))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  if (rows.length === 0) return null;
  const federal = rows.find((r) => r.source === FEDERAL_SOURCE) ?? null;
  const others = rows.filter((r) => r.source !== FEDERAL_SOURCE);
  const top = others.slice(0, TOP_SYSTEM_ROWS);
  const more = others.slice(TOP_SYSTEM_ROWS);
  const sum = rows.reduce((n, r) => n + r.total, 0);
  return { top, federal, more, moreSum: more.reduce((n, r) => n + r.total, 0), sum };
}

/** The systems named in the FAQ ("Workday, Oracle Recruiting … and N more"): the largest five, USAJOBS apart. */
export function namedSystems(counts: Record<string, number> | null | undefined, n = 5): { names: string[]; more: number } | null {
  const table = sourcesTable(counts);
  if (!table) return null;
  const others = [...table.top, ...table.more];
  return { names: others.slice(0, n).map((r) => r.name), more: Math.max(0, others.length - n) };
}

/** What the AI connector can search: openTotal less the withheld systems' postings. */
export function aiReach(counts: Record<string, number> | null | undefined, openTotal: number | null | undefined):
  { searchable: number; withheld: number; names: string[] } | null {
  if (!counts || typeof openTotal !== "number" || !Number.isFinite(openTotal) || openTotal <= 0) return null;
  const present = HOME_WITHHELD_SOURCES.filter((s) => typeof counts[s] === "number" && counts[s] > 0);
  // A withheld system the read does not carry is unmeasured, not zero: no line.
  if (present.length !== HOME_WITHHELD_SOURCES.length) return null;
  const withheld = present.reduce((n, s) => n + counts[s], 0);
  if (withheld >= openTotal) return null;
  return { searchable: openTotal - withheld, withheld, names: present.map((s) => systemLabel(s) ?? s) };
}
