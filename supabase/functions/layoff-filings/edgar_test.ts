// EDGAR readers on the saved pages: the latest-filings Atom feed (two
// pages fetched 2026-09-18 11:31 EDT), the full-text search hits page for
// "Item 2.05", the submissions JSON of filers with and without an
// amendment, and the row builder on a saved primary document. No request
// leaves this file; the Http class is exercised through a recorded fetch.
//
// Run: deno test --allow-read --allow-env supabase/functions/layoff-filings/

import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  atomPageUrl, buildSecRow, columnarToRows, fetchFiling, filingIndexUrl, ftsUrl, keep205, parseAtom, parseFtsHits,
  parseSubmissions, primaryDocUrl, resolveAmends, submissionsUrl,
} from "./edgar.ts";
import { Http } from "./http.ts";
import { PARSER_VERSION } from "./parse205.ts";
import { sampleJson, sampleText } from "./fixtures.ts";

const READ_AT = new Date("2026-09-18T15:31:52Z");

Deno.test("the Atom page: 100 entries, accession + CIK + items on each, the 8-K/A entries marked, and Item 2.05 kept only when the summary names it", () => {
  for (const page of ["getcurrent_8k.atom", "getcurrent_8k_p2.atom"]) {
    const xml = sampleText(page);
    const entries = parseAtom(xml);
    assertEquals(entries.length, 100, page);
    assert(entries.every((e) => /^\d{10}-\d{2}-\d{6}$/.test(e.adsh)), "every entry has an accession number");
    assert(entries.every((e) => e.cik > 0), "every entry has a CIK from its title");
    assert(entries.every((e) => e.filedDate != null && e.acceptedAt != null));
    assert(entries.every((e) => e.items.length > 0), "every 8-K names at least one item");
    // A filing with co-registrants appears once per filer; the kept set is one row per accession.
    const distinct = new Set(entries.map((e) => e.adsh)).size;
    assert(distinct >= 90 && distinct <= 100, `distinct accessions ${distinct}`);
    const amendments = entries.filter((e) => e.form === "8-K/A").length;
    const amendmentsInXml = (xml.match(/term="8-K\/A"/g) ?? []).length;
    assertEquals(amendments, amendmentsInXml);
    const kept = keep205(entries);
    const named = entries.filter((e) => e.items.includes("2.05"));
    assertEquals(kept.length, new Set(named.map((e) => e.adsh)).size, `${page}: the kept set is the accessions whose summary lists Item 2.05`);
    assertEquals(named.length, (xml.match(/Item 2\.05:/g) ?? []).length);
    // Newest first: the acceptance stamps descend down the page.
    for (let i = 1; i < entries.length; i++) {
      assert(Date.parse(entries[i - 1].acceptedAt!) >= Date.parse(entries[i].acceptedAt!), "acceptance order");
    }
  }
  assertEquals(atomPageUrl(0), "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=100&output=atom");
  assertStringIncludes(atomPageUrl(100), "&start=100");
  const first = parseAtom(sampleText("getcurrent_8k.atom"))[0];
  assertEquals(first.adsh, "0001654954-26-008445");
  assertEquals(first.cik, 1329842);
  assertEquals(first.filerName, "Federal Home Loan Bank of New York");
  assertEquals(first.items, ["5.02", "8.01", "9.01"]);
  assertEquals(first.filedDate, "2026-09-18");
});

Deno.test("the full-text hits page: distinct accessions whose items carry 2.05; a non-hits body is the end of the results", () => {
  const json = sampleJson<{ hits: { hits: Array<{ _source: { adsh: string; items: string[] } }> } }>("efts_22Item2020522.json");
  const hits = parseFtsHits(json);
  assert(hits);
  const distinct = new Set(json.hits.hits.filter((h) => h._source.items.includes("2.05")).map((h) => h._source.adsh));
  assertEquals(hits.length, distinct.size);
  assertEquals(hits.length, 18);
  assert(hits.every((h) => h.cik > 0 && h.fileDate != null));
  const amendment = hits.find((h) => h.adsh === "0001193125-26-368858");
  assert(amendment);
  assertEquals(amendment.form, "8-K/A");
  assertEquals(amendment.periodEnding, "2025-11-09");
  assertEquals(parseFtsHits({ message: "Internal server error" }), null);
  assertEquals(parseFtsHits(null), null);
  const url = ftsUrl("2026-09-15", "2026-09-18", 100);
  assertStringIncludes(url, "q=%22Item+2.05%22");
  assertStringIncludes(url, "forms=8-K");
  assertStringIncludes(url, "from=100");
});

Deno.test("the submissions JSON: columnar recent block to rows; the 8-K/A resolves to the filer's own earlier Item 2.05 8-K", () => {
  const pdsb = parseSubmissions(sampleJson("submissions_pdsb.json"));
  assert(pdsb);
  assertEquals(pdsb.cik, 1472091);
  assertEquals(pdsb.name, "PDS Biotechnology Corp");
  const f = pdsb.filings.find((x) => x.adsh === "0001140361-26-034320");
  assert(f);
  assertEquals(f.form, "8-K");
  assertEquals(f.items, ["2.05", "5.02"]);
  assertEquals(f.reportDate, "2026-08-21");
  assertEquals(f.primaryDocument, "ef20081077_8k.htm");
  assertEquals(submissionsUrl(1472091), "https://data.sec.gov/submissions/CIK0001472091.json");

  // enGene: an 8-K/A three days after the 8-K, with a different report date —
  // it resolves to the newest earlier Item 2.05 8-K, never to itself.
  const engene = parseSubmissions(sampleJson("sub_1980845.json"));
  assert(engene);
  const amendment = engene.filings.find((x) => x.adsh === "0001193125-26-275815");
  assert(amendment && amendment.form === "8-K/A");
  assertEquals(resolveAmends(engene.filings, amendment), "0001193125-26-270384");

  // Same report date wins over a newer one; nothing earlier means unresolved.
  const rows = columnarToRows({
    accessionNumber: ["a-1", "a-2", "a-3", "a-4"],
    form: ["8-K", "8-K", "8-K/A", "8-K"],
    filingDate: ["2026-01-05", "2026-03-01", "2026-03-10", "2026-04-01"],
    reportDate: ["2026-01-04", "2026-01-04", "2026-01-04", "2026-03-30"],
    items: ["2.05", "2.05,9.01", "2.05", "2.05"],
    primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm"],
  });
  assertEquals(resolveAmends(rows, rows[2]), "a-1", "the oldest same-report-date 8-K");
  assertEquals(resolveAmends(rows.filter((r) => r.adsh === "a-3"), rows[2]), null);
  assertEquals(resolveAmends(rows, { ...rows[2], filingDate: "2025-12-01", reportDate: "2025-11-30" }), null, "nothing filed earlier");
});

Deno.test("the SEC row: report date is the event, filing date the public date, the section text always present, an 8-K/A is an amendment", () => {
  const html = sampleText("docs/0001104659-26-103548.htm"); // TELA Bio
  const { row, parsed } = buildSecRow({
    cik: 1561921, adsh: "0001104659-26-103548", filerName: "TELA Bio, Inc.", form: "8-K", reportDate: "2026-08-28",
    filingDate: "2026-08-31", primaryDocument: "tm2624390d1_8k.htm", documentHtml: html, amendsAdsh: null, readAt: READ_AT,
  });
  assert(parsed);
  assertEquals(row.filing_id, "sec:0001104659-26-103548");
  assertEquals(row.source, "sec_8k_205");
  assertEquals(row.filer_raw, "TELA Bio, Inc.");
  assertEquals(row.event_date, "2026-08-28");
  assertEquals(row.event_basis, "sec_report_date");
  assertEquals(row.public_date, "2026-08-31");
  assertEquals(row.public_basis, "sec_filed");
  assertEquals(row.status, "active");
  assertEquals(row.form, "8-K");
  assertEquals(row.pct, 20);
  assertEquals(row.headcount, 41);
  assertEquals(row.headcount_basis, "derived_from_to");
  assertEquals(row.parser_version, PARSER_VERSION);
  assertEquals(row.parse_confidence, 1);
  assertEquals(row.source_name, "SEC EDGAR");
  assertEquals(row.source_url, "https://www.sec.gov/Archives/edgar/data/1561921/000110465926103548/tm2624390d1_8k.htm");
  assert(typeof row.section_text === "string" && (row.section_text as string).startsWith("Item 2.05"));
  assertEquals(row.is_workforce_event, true);
  assertEquals(row.amends_adsh, null);
  assertEquals(row.amend_unresolved, false);

  const amend = buildSecRow({
    cik: 883241, adsh: "0001193125-26-368858", filerName: "SYNOPSYS INC", form: "8-K/A", reportDate: "2025-11-09",
    filingDate: "2026-08-26", primaryDocument: "d135796d8ka.htm", documentHtml: sampleText("docs/0001193125-26-368858.htm"),
    amendsAdsh: null, readAt: READ_AT,
  }).row;
  assertEquals(amend.status, "amendment");
  assertEquals(amend.form, "8-K/A");
  assertEquals(amend.amend_unresolved, true);
  assertEquals(amend.pct, null);
  const resolved = buildSecRow({
    cik: 883241, adsh: "0001193125-26-368858", filerName: "SYNOPSYS INC", form: "8-K/A", reportDate: "2025-11-09",
    filingDate: "2026-08-26", primaryDocument: "d135796d8ka.htm", documentHtml: null, amendsAdsh: "0001193125-25-000001", readAt: READ_AT,
  }).row;
  assertEquals(resolved.amends_adsh, "0001193125-25-000001");
  assertEquals(resolved.amend_unresolved, false);
  assert(typeof resolved.section_text === "string" && (resolved.section_text as string).length > 0, "section_text is never null on a SEC row");
  assertEquals(resolved.parse_confidence, 0);
  assertEquals(primaryDocUrl(1472091, "0001140361-26-034320", "ef20080812_8k.htm"), "https://www.sec.gov/Archives/edgar/data/1472091/000114036126034320/ef20080812_8k.htm");
  assertEquals(filingIndexUrl(1472091, "0001140361-26-034320"), "https://www.sec.gov/Archives/edgar/data/1472091/000114036126034320/0001140361-26-034320-index.htm");
});

Deno.test("the fetch chain for one accession: submissions → primary document → row, three requests, sequential, one User-Agent naming a contact", async () => {
  const log: Array<{ url: string; ua: string | null; at: number }> = [];
  const doc = sampleText("docs/0001140361-26-034320.htm");
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    const ua = new Headers(init?.headers).get("User-Agent");
    log.push({ url, ua, at: Date.now() });
    if (url === submissionsUrl(1472091)) return Promise.resolve(new Response(sampleText("submissions_pdsb.json"), { status: 200, headers: { "content-type": "application/json" } }));
    if (url.endsWith("/ef20081077_8k.htm")) return Promise.resolve(new Response(doc, { status: 200, headers: { "content-type": "text/html" } }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  const http = new Http({ userAgent: "ResumeSignalPro layoff-filings (test@example.com)", minIntervalMs: { "sec.gov": 300 }, fetchImpl });
  const f = await fetchFiling(http, 1472091, "0001140361-26-034320", READ_AT);
  assert(f.row);
  assertEquals(f.requests, 2);
  assertEquals(f.row.pct, 36);
  assertEquals(f.row.filer_raw, "PDS Biotechnology Corp");
  assertEquals(f.row.event_date, "2026-08-21");
  assertEquals(f.row.public_date, "2026-08-25");
  assertEquals(f.parsedPct, true);
  assertEquals(f.amend, false);
  assert(log.every((l) => l.ua === "ResumeSignalPro layoff-filings (test@example.com)"));
  // 300 ms floor, 200 ms asserted: the slack is for a busy event loop, not for the floor.
  assert(log[1].at - log[0].at >= 200, `one floor for every sec.gov host: data.sec.gov then www.sec.gov wait on each other (${log[1].at - log[0].at} ms)`);

  // An accession the filer's history does not hold is a note, not a row.
  const missing = await fetchFiling(http, 1472091, "0001140361-26-999999", READ_AT);
  assertEquals(missing.row, null);
  assertEquals(missing.note, "accession_not_in_submissions");
  // A filer whose submissions cannot be read is a note, not a crash.
  const noSubs = await fetchFiling(http, 999, "0000000999-26-000001", READ_AT);
  assertEquals(noSubs.row, null);
  assertStringIncludes(noSubs.note ?? "", "submissions_404");
});

/** A synthetic submissions JSON for one filer: one filing, columnar like data.sec.gov's. */
function subsJson(cik: number, name: string, tickers: string[], adsh: string, reportDate: string | null, doc = "x_8k.htm"): string {
  return JSON.stringify({
    cik: String(cik), name, tickers,
    filings: { recent: { accessionNumber: [adsh], form: ["8-K"], filingDate: ["2026-09-01"], reportDate: [reportDate ?? ""], acceptanceDateTime: ["2026-09-01T16:05:00.000Z"], items: ["2.05"], primaryDocument: [doc] }, files: [] },
  });
}

Deno.test("a filing with no period of report is no row (note no_report_date): the filing date never stands in as the event date", async () => {
  const adsh = "0001234567-26-000010";
  const fetchImpl: typeof fetch = (input) => {
    const url = String(input);
    if (url === submissionsUrl(4242)) return Promise.resolve(new Response(subsJson(4242, "Acme Corp", ["ACME"], adsh, null), { status: 200 }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  const http = new Http({ userAgent: "t", defaultIntervalMs: 0, fetchImpl });
  const f = await fetchFiling(http, 4242, adsh, READ_AT);
  assertEquals(f.row, null);
  assertEquals(f.note, "no_report_date");
  assertEquals(f.requests, 1, "the document is not fetched for a row that will not be stored");
});

Deno.test("co-registrants: the row is keyed on the registrant whose submissions carry a ticker, whichever the feed listed first", async () => {
  // The saved page 2 lists PBF Holding Co LLC (the operating subsidiary) before
  // PBF Energy Inc. (the listed parent) on one accession; keep205 keeps both CIKs.
  const p2 = parseAtom(sampleText("getcurrent_8k_p2.atom")).map((e) => (e.adsh === "0001193125-26-394108" ? { ...e, items: [...e.items, "2.05"] } : e));
  const kept = keep205(p2);
  const pbf = kept.find((e) => e.adsh === "0001193125-26-394108");
  assert(pbf);
  assertEquals(pbf.cik, 1566011, "the feed's first entry is the subsidiary");
  assertEquals(pbf.coCiks, [1566011, 1534504]);
  assertEquals(kept.filter((e) => e.adsh === "0001193125-26-394108").length, 1, "one row per accession");

  const adsh = "0001193125-26-394108";
  const doc = sampleText("docs/0001140361-26-034320.htm");
  const log: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = String(input);
    log.push(url);
    if (url === submissionsUrl(1566011)) return Promise.resolve(new Response(subsJson(1566011, "PBF Holding Co LLC", [], adsh, "2026-08-28"), { status: 200 }));
    if (url === submissionsUrl(1534504)) return Promise.resolve(new Response(subsJson(1534504, "PBF Energy Inc.", ["PBF"], adsh, "2026-08-28"), { status: 200 }));
    if (url.endsWith("/x_8k.htm")) return Promise.resolve(new Response(doc, { status: 200, headers: { "content-type": "text/html" } }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  const http = new Http({ userAgent: "t", defaultIntervalMs: 0, fetchImpl });
  const f = await fetchFiling(http, 1566011, adsh, READ_AT, "PBF Holding Co LLC", [1566011, 1534504]);
  assert(f.row);
  assertEquals(f.row.cik, 1534504, "the parent with the ticker is the filer of record");
  assertEquals(f.row.filer_raw, "PBF Energy Inc.");
  assertEquals(f.row.source_url, primaryDocUrl(1534504, adsh, "x_8k.htm"));
  assertStringIncludes(f.note ?? "", "co_registrant_parent=1534504");
  assertEquals(f.requests, 3, "one extra submissions GET, then the document");
  assertEquals(log.filter((u) => u.includes("/submissions/")).length, 2);

  // Without co-registrants nothing extra is fetched; with none carrying a ticker the first listed stays.
  const alone = await fetchFiling(http, 1534504, adsh, READ_AT);
  assert(alone.row && alone.row.cik === 1534504 && alone.requests === 2);
  const noTicker: typeof fetch = (input) => {
    const url = String(input);
    if (url === submissionsUrl(1566011)) return Promise.resolve(new Response(subsJson(1566011, "PBF Holding Co LLC", [], adsh, "2026-08-28"), { status: 200 }));
    if (url === submissionsUrl(1534504)) return Promise.resolve(new Response(subsJson(1534504, "PBF Energy Inc.", [], adsh, "2026-08-28"), { status: 200 }));
    if (url.endsWith("/x_8k.htm")) return Promise.resolve(new Response(doc, { status: 200 }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  };
  const stays = await fetchFiling(new Http({ userAgent: "t", defaultIntervalMs: 0, fetchImpl: noTicker }), 1566011, adsh, READ_AT, undefined, [1566011, 1534504]);
  assert(stays.row && stays.row.cik === 1566011);
  assertStringIncludes(stays.note ?? "", "co_registrants=1");

  // The full-text index lists every registrant's CIK too.
  const hits = parseFtsHits({ hits: { hits: [{ _source: { adsh, ciks: ["0001566011", "0001534504"], items: ["2.05"], form: "8-K", file_date: "2026-09-01" } }] } });
  assert(hits);
  assertEquals(hits[0].coCiks, [1566011, 1534504]);
});

Deno.test("the body cap: an oversize response is refused, never buffered", async () => {
  const big = new Uint8Array(3000);
  const http = new Http({
    userAgent: "t", defaultIntervalMs: 0,
    fetchImpl: () => Promise.resolve(new Response(big, { status: 200, headers: { "content-length": "3000" } })),
  });
  await assertRejects(() => http.request("https://example.invalid/x", { maxBytes: 1000 }), Error, "oversize");
});
