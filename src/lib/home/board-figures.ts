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

/** Systems the AI connector and the data API never hand on (MCP_WITHHELD_SOURCES). USAJOBS left with OD16 (2026-11-18). */
export const HOME_WITHHELD_SOURCES: readonly string[] = ["smartrecruiters"];

/** The federal listing site: always its own row in the table, with its note. */
export const FEDERAL_SOURCE = "usajobs";

/**
 * THE REACH STILL LEAVES EVERY FEDERAL POSTING OUT (OD16 review, 2026-11-19).
 *
 * USAJOBS left the withheld lists, but the connector hands a federal posting
 * on only once job-board has stored the agency's statement of who may apply:
 * none before agent-mcp 2026-11-19.1 and job-board .104 both serve, and at
 * most 10,000 a lap until .105 reads the whole feed. This page cannot count
 * the labelled ones, and a site publish can go out before either build. So
 * the AI line subtracts every federal posting and names USAJOBS beside
 * SmartRecruiters, which keeps "Your AI searches N" at or below what the AI
 * can reach in every deploy order (it can only understate, by the labelled
 * rows, until this flips).
 *
 * The board's own hand-off follows the same flag (src/lib/agent-handoff.ts
 * isWithheldSource): while the line says USAJOBS postings stay on this
 * website, a federal posting or a search for them is not handed to the AI.
 *
 * Flip to true only once the OD16 verify section's FED6 shows agent-mcp
 * 2026-11-19.1 live and the labelled federal rows /v1 serves at about the
 * board's federal count; FED6 FAILs a live reach that counts federal
 * postings before then. The flip changes the line, the hand-off and the
 * clause about the count in MCP_WITHHELD_NOTE together, and the tests that
 * hold each say so when they fail.
 */
export const FEDERAL_ROWS_IN_REACH: boolean = false;

/** What the AI line subtracts from the open total, in the order it names them: every federal posting first, until they are in reach. */
export const reachLeavesOut = (federalInReach: boolean): readonly string[] =>
  federalInReach ? HOME_WITHHELD_SOURCES : [FEDERAL_SOURCE, ...HOME_WITHHELD_SOURCES];
/** The list the site publishes with (FEDERAL_ROWS_IN_REACH). */
export const REACH_LEAVES_OUT: readonly string[] = reachLeavesOut(FEDERAL_ROWS_IN_REACH);
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

/**
 * What the AI connector can search, at most: openTotal less the withheld
 * systems' postings and, until FEDERAL_ROWS_IN_REACH, every federal posting.
 * `leavesOut` is the list subtracted; every page passes none and gets the
 * published one, and the guard passes each of the two to hold both.
 */
export function aiReach(
  counts: Record<string, number> | null | undefined, openTotal: number | null | undefined,
  leavesOut: readonly string[] = REACH_LEAVES_OUT,
): { searchable: number; withheld: number; names: string[] } | null {
  if (!counts || typeof openTotal !== "number" || !Number.isFinite(openTotal) || openTotal <= 0) return null;
  const present = leavesOut.filter((s) => typeof counts[s] === "number" && counts[s] > 0);
  // A system the line subtracts that the read does not carry is unmeasured, not zero: no line.
  if (present.length !== leavesOut.length) return null;
  const withheld = present.reduce((n, s) => n + counts[s], 0);
  if (withheld >= openTotal) return null;
  return { searchable: openTotal - withheld, withheld, names: present.map((s) => systemLabel(s) ?? s) };
}
