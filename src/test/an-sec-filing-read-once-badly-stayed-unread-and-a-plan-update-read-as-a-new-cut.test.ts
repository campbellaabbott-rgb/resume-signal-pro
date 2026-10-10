// @vitest-environment node
/**
 * AN SEC FILING READ ONCE BADLY STAYED UNREAD, AND A PLAN UPDATE READ AS A
 * NEW CUT (sweep S8-108, S8-026).
 *
 * S8-108. When the primary document GET failed once (SEC throttles), the
 * filing was still stored, as "(document not read)" with parse_confidence 0
 * and no numbers, and every ingest path skips a filing_id it already holds:
 * the numbers were lost for good. A throttled, server-side or unanswered read
 * now stores no row (a note, retried next run); a 404 is the document's own
 * answer and is stored as before.
 *
 * S8-026. An Item 2.05 section that only reports progress on a plan already
 * filed (Freshworks' 2026-08-04 earnings 8-K on its May plan) was stored as a
 * workforce event, printed as a new reduction and counted in the Ghost
 * Index's filed arm for ninety days. Such a section is now
 * is_workforce_event = false. The rule is narrow on purpose: the saved
 * wind-down filing that mentions an earlier 8-K about its strategic review
 * (holdout 0001213900-26-079061) stays a workforce event, and no saved filing
 * of the 28 flips.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSecRow, fetchFiling, submissionsUrl } from "../../supabase/functions/layoff-filings/edgar";
import { Http } from "../../supabase/functions/layoff-filings/http";
import { parse205 } from "../../supabase/functions/layoff-filings/parse205";

const READ_AT = new Date("2026-09-18T15:40:00Z");
const ADSH = "0001234567-26-000010";
const subs = JSON.stringify({
  cik: "4242", name: "Acme Corp", tickers: ["ACME"],
  filings: { recent: { accessionNumber: [ADSH], form: ["8-K"], filingDate: ["2026-09-01"], reportDate: ["2026-08-28"], acceptanceDateTime: ["2026-09-01T16:05:00.000Z"], items: ["2.05"], primaryDocument: ["acme_8k.htm"] }, files: [] },
});
const docHtml = (section: string) =>
  `<html><body><p>Item 2.05 Costs Associated with Exit or Disposal Activities.</p><p>${section}</p><p>Item 9.01 Financial Statements and Exhibits.</p></body></html>`;
const NEW_CUT = "On August 28, 2026, the Board of Directors of Acme Corp approved a reduction in force of approximately 120 employees, about 8% of the Company's workforce, to be substantially implemented by the end of 2026.";
const UPDATE = "As part of the previously announced restructuring plan, the Company has now reduced its workforce by approximately 120 employees. The restructuring plan is substantially complete.";

function http(docStatus: number, html = docHtml(NEW_CUT)) {
  const fetchImpl: typeof fetch = (input) => {
    const url = String(input);
    if (url === submissionsUrl(4242)) return Promise.resolve(new Response(subs, { status: 200, headers: { "content-type": "application/json" } }));
    if (url.endsWith("/acme_8k.htm")) return Promise.resolve(new Response(docStatus === 200 ? html : "busy", { status: docStatus, headers: { "content-type": "text/html" } }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  return new Http({ userAgent: "test (test@example.com)", defaultIntervalMs: 0, fetchImpl });
}

describe("an SEC filing read once badly stayed unread", () => {
  it("positive control: a document that answers is read into a row with its numbers", async () => {
    const f = await fetchFiling(http(200), 4242, ADSH, READ_AT);
    expect(f.row?.headcount).toBe(120);
  });

  it("a throttled or failed document read stores no row, so the next run reads it again", async () => {
    for (const status of [429, 503, 500]) {
      const f = await fetchFiling(http(status), 4242, ADSH, READ_AT);
      expect(f.row, `HTTP ${status} stored a "(document not read)" row that is never re-read`).toBeNull();
      expect(f.note).toBe(`document_${status}_retry`);
    }
  });

  it("a document the SEC says is not there (404) is still stored, linked, as the document's own answer", async () => {
    const f = await fetchFiling(http(404), 4242, ADSH, READ_AT);
    expect(f.row).not.toBeNull();
    expect(f.row?.parse_confidence).toBe(0);
  });
});

describe("a plan update read as a new cut", () => {
  const row = (section: string) => buildSecRow({
    cik: 4242, adsh: ADSH, filerName: "Acme Corp", form: "8-K", reportDate: "2026-08-28", filingDate: "2026-09-01",
    primaryDocument: "acme_8k.htm", documentHtml: docHtml(section), amendsAdsh: null, readAt: READ_AT,
  }).row;

  it("positive control: a newly approved reduction is a workforce event", () => {
    expect(row(NEW_CUT).is_workforce_event).toBe(true);
  });

  it("a progress report on a previously announced plan is not a new workforce event", () => {
    expect(row(UPDATE).is_workforce_event, "a status update was stored as a new reduction").toBe(false);
  });

  it("the narrow rule leaves every saved filing's reading as it was, the wind-down that cites an earlier 8-K included", () => {
    const root = resolve(__dirname, "../../scripts/data/layoff-samples");
    let n = 0;
    for (const sub of ["docs", "holdout"]) {
      for (const f of readdirSync(resolve(root, sub))) {
        const html = readFileSync(resolve(root, sub, f), "utf8");
        const r = buildSecRow({
          cik: 1, adsh: "0000000001-26-000001", filerName: "x", form: "8-K", reportDate: "2026-08-01", filingDate: "2026-08-02",
          primaryDocument: f, documentHtml: html, amendsAdsh: null, readAt: READ_AT,
        }).row;
        expect(r.is_workforce_event, `${sub}/${f}`).toBe(parse205(html).isWorkforce);
        n++;
      }
    }
    expect(n).toBe(28);
  });
});
