// Florida, read directly from the DEO REACT listing because Big Local
// News' Florida extract has failed since at least 2026-08-18 (their raw
// fl.csv ends 2026-08-13; the listing showed 2026-09-16 the day this was
// written). One year is one HTML table over a few pages; the pager links in
// the table's footer say how many, and an out-of-range page re-serves the
// last one, so the page numbers are read from the footer and never guessed.
//
// The table is turned into the same five-column shape as Big Local News'
// raw fl.csv (company cell = name + address lines, "MM-DD-YY" dates, the
// "start thru end" layoff pair), so the two feeds share one map and one
// dedupe key. The Attachment column is a button that posts a filename; there
// is no plain link to store, so notice_pdf_url stays null for Florida.

import type { Http } from "./http.ts";
import type { Table } from "./warn.ts";
import { FL } from "./warn-maps/fl.ts";

export const FL_LISTING = "https://reactwarn.floridajobs.org/WarnList/Records";

export function flListingUrl(year: number, page = 1): string {
  return page <= 1 ? `${FL_LISTING}?year=${year}` : `${FL_LISTING}?year=${year}&page=${page}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

/** A table cell's inner HTML to lines: <br>/<p> boundaries become newlines, tags are dropped. */
export function cellLines(inner: string): string[] {
  const t = inner
    .replace(/<\s*\/?\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/?\s*(p|div|i)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(t).split(/\n/).map((l) => l.replace(/\s+/g, " ").trim());
}

/** The page numbers the footer pager links to (1 is the page itself). */
export function pagerPages(html: string): number[] {
  const pages = new Set<number>([1]);
  for (const m of html.matchAll(/href="[^"]*[?&](?:amp;)?page=(\d+)[^"]*"/gi)) pages.add(+m[1]);
  return [...pages].sort((a, b) => a - b);
}

/** One listing page to the five-column raw shape. */
export function tableFromFlHtml(html: string): Table {
  const header = ["Company Name", "State Notification Date", "Layoff Date", "Employees Affected", "Industry"];
  const rows: Record<string, string>[] = [];
  const bodyStart = html.search(/<tbody[^>]*>/i);
  const body = bodyStart === -1 ? html : html.slice(bodyStart);
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 5) continue;
    const company = cellLines(cells[0]).filter((l) => l !== "").join("\n");
    const notified = cellLines(cells[1]).join(" ").trim();
    const layoff = cellLines(cells[2]).filter((l) => l !== "").join(" ").replace(/\s+/g, " ").trim();
    const affected = cellLines(cells[3]).join(" ").trim();
    const industry = cellLines(cells[4]).join(" ").trim();
    if (company === "" || notified === "") continue;
    rows.push({
      "Company Name": company,
      "State Notification Date": notified,
      "Layoff Date": layoff,
      "Employees Affected": affected,
      "Industry": industry,
    });
  }
  return { header, rows };
}

export interface FlFetch {
  status: number;
  pages: number;
  table: Table;
}

/** Read one year's listing across its pages (capped), sequentially. */
export async function fetchFlYear(http: Http, year: number, maxPages = 10): Promise<FlFetch> {
  const first = await http.getText(flListingUrl(year, 1), { Accept: "text/html" });
  if (first.status !== 200) return { status: first.status, pages: 0, table: { header: [], rows: [] } };
  const table = tableFromFlHtml(first.text);
  const pages = pagerPages(first.text).filter((p) => p > 1 && p <= maxPages);
  let read = 1;
  for (const p of pages) {
    const r = await http.getText(flListingUrl(year, p), { Accept: "text/html" });
    if (r.status !== 200) break;
    read += 1;
    table.rows.push(...tableFromFlHtml(r.text).rows);
  }
  return { status: 200, pages: read, table };
}

export { FL };
