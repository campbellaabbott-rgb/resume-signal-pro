// The state maps, run on the saved raw files and on the states' own files
// fetched the same day (2026-09-18), never on a live site. Each verified
// map's newest public date is held to within a day of the newest date in
// the state's own file; the two direct feeds are held to the same bar
// where Big Local News' copy is weeks behind (the reason they exist); the
// maps without a saved sample are held to refusing a file they cannot read.
//
// Run: deno test --allow-read --allow-env --allow-net supabase/functions/layoff-filings/
// (--allow-net only for the one-time esm.sh download of the xlsx reader;
//  nothing in these tests touches sec.gov or a state site.)

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { buildWarnRows, extractFailuresFrom, feedVerdict, isStale, latestRunJobsUrl, mapTable, tableFromCsv } from "./warn.ts";
import { tableFromGrid, tableFromTwcXlsx } from "./tx-xlsx.ts";
import { cellLines, pagerPages, tableFromFlHtml } from "./fl-html.ts";
import { ALL_STATE_MAPS, AZ, CA, FL, GA, IA, IL, MA, MD, NY, OH, OR, TX, VA, WA } from "./warn-maps/index.ts";
import { resolveHeaders } from "./warn-maps/types.ts";
import type { StateMap } from "./warn-maps/types.ts";
import {
  amendKind, daysBetween, dedupeKey, eventTypeOf, foldAmendments, keyNorm, readCount, readDate, stripAmendAffix, temporaryOf, warnPrePass,
} from "./normalize.ts";
import type { WarnRecord } from "./normalize.ts";
import { sampleBytes, sampleText } from "./fixtures.ts";

const READ_AT = new Date("2026-09-18T15:40:00Z");
const READ_ISO = "2026-09-18";

function rawRecords(map: StateMap, file: string) {
  const r = mapTable(map, tableFromCsv(sampleText(file), map), "bln_raw");
  assert(r.ok, `${map.state}: ${r.ok ? "" : r.reason}`);
  return r;
}

function newest(dates: Array<string | null>): string {
  const d = dates.filter((x): x is string => x != null && x <= READ_ISO).sort();
  return d[d.length - 1];
}

/** Dates of one column of the state's own xlsx, ISO. */
function xlsxColumn(bytes: Uint8Array, sheetName: string, headerRow: number, col: number): string[] {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const ws = wb.Sheets[sheetName];
  assert(ws, `sheet ${JSON.stringify(sheetName)} missing`);
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  return grid.slice(headerRow + 1).map((r) => readDate(r[col])).filter((x): x is string => x != null);
}

// ── the verified maps, against the states' own files ───────────────────────

Deno.test("CA: Big Local News' raw copy is at parity with EDD's own warn_report1.xlsx (0–1 day on the processed date)", () => {
  const r = rawRecords(CA, "bln-raw-ca.csv");
  assertEquals(r.dropped, { noFiler: 0, noVisibleDate: 0, notWarn: 0 });
  const blnLatest = newest(r.records.map((x) => x.visibleDate));
  const stateLatest = newest(xlsxColumn(sampleBytes("ca-warn_report1.xlsx"), "Detailed WARN Report ", 1, 2));
  console.log(`[warn CA] bln raw latest processed ${blnLatest}, EDD file latest processed ${stateLatest}`);
  assert(Math.abs(daysBetween(blnLatest, stateLatest)) <= 1);
  // The verbatim closure cell survives (the processed file loses it).
  const kinds = new Set(r.records.map((x) => x.eventType));
  assert(kinds.has("closure") && kinds.has("layoff"));
  assert(r.records.some((x) => x.isTemporary === true) && r.records.some((x) => x.isTemporary === false));
  assert(r.records.every((x) => x.noticeDate != null && x.visibleBasis === "state_processed"));
});

Deno.test("WA: the received stamp is the visible date and no layoff-start date ever stands in for it (0–1 day against ESD's own grid)", () => {
  const r = rawRecords(WA, "bln-raw-wa.csv");
  const blnLatest = newest(r.records.map((x) => x.visibleDate));
  const html = sampleText("wa-search.html");
  const received: string[] = [];
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    if (cells.length >= 7) { const d = readDate(cells[6]); if (d) received.push(d); }
  }
  const stateLatest = newest(received);
  console.log(`[warn WA] bln raw latest received ${blnLatest}, ESD grid latest received ${stateLatest}`);
  assert(Math.abs(daysBetween(blnLatest, stateLatest)) <= 1);
  assert(r.records.every((x) => x.noticeDate == null && x.visibleBasis === "state_received"));
  // A future layoff-start date is the effective date, never the event date.
  const future = r.records.filter((x) => x.effectiveDate != null && x.effectiveDate > READ_ISO);
  assert(future.length > 0);
  assert(future.every((x) => x.visibleDate <= READ_ISO));
});

Deno.test("NY: the posted stamp is the visible date, the notice date the event (0–1 day against DOL's own Tableau export)", () => {
  const r = rawRecords(NY, "bln-raw-ny.csv");
  const blnLatest = newest(r.records.map((x) => x.visibleDate));
  const own = tableFromCsv(sampleText("ny-tableau.csv"), NY);
  const stateLatest = newest(own.rows.map((row) => readDate(row["Date Posted"])));
  console.log(`[warn NY] bln raw latest posted ${blnLatest}, DOL export latest posted ${stateLatest}`);
  assert(Math.abs(daysBetween(blnLatest, stateLatest)) <= 1);
  assert(r.records.every((x) => x.noticeDate != null && x.visibleBasis === "state_posted"));
  // NY posts near the effective date: the notice date runs well ahead of the posted date.
  const lag = r.records.map((x) => daysBetween(x.noticeDate!, x.visibleDate)).sort((a, b) => a - b);
  assert(lag[Math.floor(lag.length / 2)] >= 30, `NY median posted lag ${lag[Math.floor(lag.length / 2)]} days`);
  // "(Rescission)" in the legal-name cell is read as a rescinded notice, never a layoff.
  assert(r.records.some((x) => x.amend === "rescinded" && /catholic guardian/i.test(x.filerRaw)));
});

Deno.test("OH: the state's CSV (two junk lines, then the header) maps; the PDF link and the received stamp are kept", () => {
  const r = rawRecords(OH, "oh-2026.csv");
  assertEquals(r.dropped, { noFiler: 0, noVisibleDate: 0, notWarn: 0 });
  const text = sampleText("oh-2026.csv");
  const inFile = newest([...text.matchAll(/,(\d{1,2}\/\d{1,2}\/\d{4}),https:/g)].map((m) => readDate(m[1])));
  const mapped = newest(r.records.map((x) => x.visibleDate));
  console.log(`[warn OH] mapped latest received ${mapped}, file latest received ${inFile}`);
  assertEquals(mapped, inFile);
  assert(r.records.every((x) => x.noticePdfUrl != null && x.noticePdfUrl.startsWith("https://")));
  const updates = r.records.filter((x) => x.amend === "update");
  assert(updates.length >= 5, "the UPDATE affix is read");
  assert(updates.every((x) => !/^update/i.test(x.filerRaw)), "the affix is not part of the stored filer");
});

Deno.test("IL: the IEBS export maps row for row; non-WARN layoff reports are not kept; the revised count wins", () => {
  const wb = XLSX.read(sampleBytes("il-export.xlsx"), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][];
  const table = tableFromGrid(grid);
  const r = mapTable(IL, table, "bln_raw");
  assert(r.ok, r.ok ? "" : r.reason);
  const total = table.rows.length;
  assertEquals(r.records.length + r.dropped.notWarn + r.dropped.noFiler + r.dropped.noVisibleDate, total);
  const own = newest(table.rows.map((row) => readDate(row["Initial Date Reported"])));
  const mapped = newest(r.records.map((x) => x.visibleDate));
  console.log(`[warn IL] mapped latest reported ${mapped}, export latest reported ${own}, kept ${r.records.length} of ${total} (not_warn ${r.dropped.notWarn})`);
  assert(Math.abs(daysBetween(mapped, own)) <= 1);
  const withNotice = r.records.filter((x) => x.noticeDate != null).length;
  console.log(`[warn IL] notice date present on ${withNotice}/${r.records.length}`);
  assert(withNotice >= r.records.length * 0.97, `notice date present on ${withNotice}/${r.records.length}`);
});

Deno.test("TX: the TWC xlsx read directly is at the file's own newest notice; Big Local News' copy is weeks behind (the reason for the direct read)", async () => {
  const xlsx = tableFromTwcXlsx(sampleBytes("tx-2026.xlsx"));
  const direct = mapTable(TX, xlsx, "tx_twc_xlsx");
  assert(direct.ok, direct.ok ? "" : direct.reason);
  const directLatest = newest(direct.records.map((x) => x.visibleDate));
  const fileLatest = newest(xlsx.rows.map((row) => readDate(row["WFDD_RECEIVED_DATE"])));
  const bln = rawRecords(TX, "bln-raw-tx.csv");
  const blnLatest = newest(bln.records.map((x) => x.visibleDate));
  const behind = daysBetween(blnLatest, directLatest);
  console.log(`[warn TX] direct latest received ${directLatest} (file ${fileLatest}); bln raw latest ${blnLatest}, ${behind} days behind`);
  assert(Math.abs(daysBetween(directLatest, fileLatest)) <= 1);
  assert(behind >= 30, "the direct feed exists because BLN's Texas extract is frozen");
  assert(direct.records.every((x) => x.noticeDate != null && x.visibleBasis === "state_received"));
  // The same notice through either feed hashes to one filing id: the xlsx
  // carries every in-window row of the frozen raw copy (74) plus the new ones.
  const a = await buildWarnRows(direct.records, READ_AT, 365);
  const b = await buildWarnRows(bln.records, READ_AT, 365);
  const ids = new Set(b.rows.map((x) => x.filing_id));
  const shared = a.rows.filter((x) => ids.has(x.filing_id)).length;
  console.log(`[warn TX] ${shared} of ${b.rows.length} in-window raw rows collapse onto xlsx rows (${a.rows.length} in the xlsx)`);
  assert(shared >= 70 && shared === b.rows.length - (b.rows.length - shared), `dedupe across feeds: ${shared}`);
  assert(shared >= Math.floor(b.rows.length * 0.5));
  // The site parenthetical is stripped for matching, kept in the stored filer.
  const z = direct.records.find((x) => /zenimax/i.test(x.filerRaw)) ?? bln.records.find((x) => /zenimax/i.test(x.filerRaw));
  assert(z);
  assertEquals(z.filerForNorm, "ZeniMax MEDIA INC.");
  assertStringIncludes(z.filerRaw, "ZeniMax");
});

Deno.test("FL: the REACT listing read directly is at the day's newest notification; Big Local News' copy is a month behind", async () => {
  const html = sampleText("fl-2026.html");
  assertEquals(pagerPages(html), [1, 2, 3]);
  const table = tableFromFlHtml(html);
  assertEquals(table.rows.length, 100);
  const direct = mapTable(FL, table, "fl_react_html");
  assert(direct.ok, direct.ok ? "" : direct.reason);
  const directLatest = newest(direct.records.map((x) => x.visibleDate));
  const pageLatest = newest([...html.matchAll(/<td>(\d\d-\d\d-\d\d)<\/td>/g)].map((m) => readDate(m[1])));
  const bln = rawRecords(FL, "bln-raw-fl.csv");
  const blnLatest = newest(bln.records.map((x) => x.visibleDate));
  const behind = daysBetween(blnLatest, directLatest);
  console.log(`[warn FL] direct latest ${directLatest} (page ${pageLatest}); bln raw latest ${blnLatest}, ${behind} days behind`);
  assertEquals(directLatest, pageLatest);
  assert(behind >= 20);
  // The address in the company cell is the site, not part of the filer.
  const first = direct.records[0];
  assertEquals(first.filerRaw, "Health First Inc., and Health First Shared Services, Inc.");
  assertStringIncludes(first.siteRaw ?? "", "ROCKLEDGE, FL");
  assertEquals(first.effectiveDate, "2026-09-16");
  assert(direct.records.every((x) => !/\d{5}\s*$/.test(x.filerRaw)), "no zip code inside a filer");
  // Same notice through either feed → one filing id (96 of the 100 listed rows predate the raw copy's freeze).
  const a = await buildWarnRows(direct.records, READ_AT, 365);
  const b = await buildWarnRows(bln.records, READ_AT, 365);
  const ids = new Set(b.rows.map((x) => x.filing_id));
  const shared = a.rows.filter((x) => ids.has(x.filing_id)).length;
  console.log(`[warn FL] ${shared} of ${a.rows.length} listing rows collapse onto raw rows`);
  assert(shared >= 90);
  assertEquals(cellLines("<b>Acme</b> </br>1 Main St</br></br>TOWN, FL, 33000"), ["Acme", "1 Main St", "", "TOWN, FL, 33000"]);
});

// ── the maps without a saved sample refuse what they cannot read ───────────

Deno.test("every map without a saved sample says so, and refuses a file whose header it does not recognise", () => {
  const unverified = ALL_STATE_MAPS.filter((m) => !m.verifiedAgainstSample).map((m) => m.state).sort();
  assertEquals(unverified, ["AZ", "GA", "IA", "MA", "MD", "OR", "VA"]);
  const verified = ALL_STATE_MAPS.filter((m) => m.verifiedAgainstSample).map((m) => m.state).sort();
  assertEquals(verified, ["CA", "FL", "IL", "NY", "OH", "TX", "WA"]);
  const caTable = tableFromCsv(sampleText("bln-raw-ca.csv"), CA);
  for (const m of [AZ, GA, IA, MA, MD, OR, VA]) {
    const r = mapTable(m, caTable, "bln_raw");
    assert(!r.ok, `${m.state} must not map California's header`);
    assertStringIncludes(r.ok ? "" : r.reason, "header_mismatch");
    assert(m.blnRawUrl.endsWith(`/raw/${m.state.toLowerCase()}.csv`));
    assert(m.sourceUrl.startsWith("https://"));
  }
  // A header that names the roles resolves; one that names only the filer is refused (no visible stamp = no row).
  const ok = resolveHeaders(MA, ["RECEIVED", "EMPLOYER", "CITY/TOWN", "REGION", "DATE(S) OF LAYOFFS", "# EMPLOYEES IMPACTED"]);
  assert(ok.ok);
  const bad = resolveHeaders(MA, ["EMPLOYER", "CITY/TOWN"]);
  assert(!bad.ok && bad.missing.includes("visible"));
  // Twelve raw maps plus the two direct states, one file each, no duplicates.
  assertEquals(new Set(ALL_STATE_MAPS.map((m) => m.state)).size, 14);
});

Deno.test("the employer's notice date never stands in for the state's stamp: a header with Notice Date and no received/posted column resolves for NO map, and no visible slot names a notice-date spelling", () => {
  const noticeOnly = ["Company", "Company Name", "Employer", "Notice Date", "WARN Date", "Date of Notice", "notice_date", "WARN Notice Date", "Effective Date", "Layoff Date", "Number of Employees", "Type", "Location", "City", "County"];
  for (const m of ALL_STATE_MAPS) {
    const r = resolveHeaders(m, noticeOnly);
    assert(!r.ok && r.missing.includes("visible"), `${m.state} must refuse a file whose only date is the employer's notice date`);
    for (const c of m.columns.visible) {
      assert(!/notice/i.test(c), `${m.state}: ${JSON.stringify(c)} is a notice-date spelling in the visible slot`);
    }
  }
  // The same header plus a received stamp resolves for the maps that name one.
  const withReceived = [...noticeOnly, "Date Received"];
  for (const m of [MD, AZ, VA, OR, IA, GA]) {
    const r = resolveHeaders(m, withReceived);
    assert(r.ok, `${m.state} resolves once the state's own stamp is present`);
    assertEquals(r.ok ? r.pick.visible : null, "Date Received");
  }
});

// ── rows for the upsert ────────────────────────────────────────────────────

function rec(over: Partial<WarnRecord>): WarnRecord {
  return {
    state: "OH", feed: "bln_raw", sourceName: "Ohio JFS", sourceUrl: "https://jfs.ohio.gov/x", filerRaw: "Acme Corp", filerForNorm: "Acme Corp",
    amend: null, siteRaw: "Toledo/Lucas", siteCity: null, siteCounty: null, workers: 120, noticeDate: null, visibleDate: "2026-09-01",
    visibleBasis: "state_received", effectiveDate: "2026-11-01", effectiveRaw: "11/1/2026", eventType: "closure", isTemporary: null,
    noticePdfUrl: null, blnHashId: null, ...over,
  };
}

Deno.test("a future-dated notice is refused before the upsert, a notice older than the window is never inserted, and dates carry their basis", async () => {
  const b = await buildWarnRows([
    rec({ visibleDate: "2026-12-31" }),
    rec({ visibleDate: "2025-01-02", filerRaw: "Old Co", filerForNorm: "Old Co" }),
    rec({ noticeDate: "2026-08-30" }),
  ], READ_AT, 365);
  assertEquals(b.futureDated, 1);
  assertEquals(b.tooOld, 1);
  assertEquals(b.rows.length, 1);
  const row = b.rows[0];
  assertEquals(row.event_date, "2026-08-30");
  assertEquals(row.event_basis, "warn_notice_date");
  assertEquals(row.public_date, "2026-09-01");
  assertEquals(row.public_basis, "state_received");
  assertEquals(row.source, "state_warn");
  assertEquals(row.filer_for_norm, "Acme Corp");
  assert(String(row.filing_id).startsWith("warn:") && String(row.filing_id).length === 5 + 56);
  assertEquals(b.latestPublicDate, "2026-09-01", "the latest public date never reads a future stamp");
  const noNotice = await buildWarnRows([rec({ visibleBasis: "state_processed" })], READ_AT, 365);
  assertEquals(noNotice.rows[0].event_basis, "warn_processed");
});

Deno.test("an UPDATE folds onto its ancestor: the newest row shows, the ancestor is superseded, a rescission hides both", async () => {
  const chain = await buildWarnRows([
    rec({ visibleDate: "2026-07-01", workers: 100 }),
    rec({ visibleDate: "2026-08-01", workers: 140, amend: "update" }),
  ], READ_AT, 365);
  const byStatus = Object.fromEntries(chain.rows.map((r) => [r.status, r]));
  assert(byStatus.active && byStatus.superseded, JSON.stringify(chain.rows.map((r) => r.status)));
  assertEquals(byStatus.active.workers, 140);
  assertEquals(byStatus.active.supersedes_id, byStatus.superseded.filing_id);
  assertEquals(chain.rows[0].status, "superseded", "the ancestor is ordered first so the reference resolves in one batch");
  assertEquals(chain.superseded, 1);

  const resc = await buildWarnRows([
    rec({ visibleDate: "2026-07-01", workers: 100 }),
    rec({ visibleDate: "2026-08-01", workers: 100, amend: "rescinded" }),
  ], READ_AT, 365);
  assertEquals(resc.rows.map((r) => r.status).sort(), ["rescinded", "superseded"]);
  assertEquals(resc.rescinded, 1);

  // Two distinct notices at one site and one UPDATE: the update amends the
  // NEAREST earlier original; the first original is a chain of its own and
  // stays active, never superseded by a later notice it has nothing to do with.
  const two = await buildWarnRows([
    rec({ visibleDate: "2026-01-10", workers: 100 }),
    rec({ visibleDate: "2026-06-10", workers: 50 }),
    rec({ visibleDate: "2026-07-10", workers: 60, amend: "update" }),
  ], READ_AT, 365);
  const byDate = Object.fromEntries(two.rows.map((r) => [r.public_date, r]));
  assertEquals(byDate["2026-01-10"].status, "active", "the January notice is its own event");
  assertEquals(byDate["2026-01-10"].supersedes_id, null);
  assertEquals(byDate["2026-06-10"].status, "superseded");
  assertEquals(byDate["2026-07-10"].status, "active");
  assertEquals(byDate["2026-07-10"].supersedes_id, byDate["2026-06-10"].filing_id, "the update points at June, not January");
  assertEquals(two.superseded, 1);

  // An amendment whose ancestor is not in the file is a filing on its own — and carries no dangling reference.
  const lone = foldAmendments([{ ...rec({ amend: "update" }), filingId: "warn:x" }]);
  assertEquals(lone[0].status, "active");
  assertEquals(lone[0].supersedesId, null);
  const orphan = await buildWarnRows([
    rec({ visibleDate: "2025-01-02", workers: 100 }),
    rec({ visibleDate: "2026-08-01", workers: 140, amend: "update" }),
  ], READ_AT, 365);
  assertEquals(orphan.rows.length, 1);
  assertEquals(orphan.rows[0].supersedes_id, null);
});

Deno.test("the dedupe key is the notice, not the feed: same fields → same key; a different count → a different key", async () => {
  const base = { state: "TX", filerForNorm: "ZeniMax MEDIA INC.", siteRaw: null, siteCity: "Austin", noticeDate: "2026-07-06", visibleDate: "2026-07-07", effectiveDate: "2026-09-04", workers: 22 };
  const k1 = await dedupeKey(base);
  const k2 = await dedupeKey({ ...base, filerForNorm: "ZeniMax Media, Inc." });
  const k3 = await dedupeKey({ ...base, workers: 23 });
  assertEquals(k1, k2, "the key normaliser folds case and punctuation");
  assert(k1 !== k3);
  assertEquals(k1.length, 56);
});

// ── the pre-pass and the readers ───────────────────────────────────────────

Deno.test("the WARN pre-pass: parentheticals dropped, dba/aka split, affixes stripped; the key normaliser keeps group/holdings/usa/numerals", () => {
  assertEquals(warnPrePass("Takeda Pharmaceuticals USA, Inc. (dba Takeda)"), "Takeda Pharmaceuticals USA, Inc.");
  assertEquals(warnPrePass("Jabil Inc. (aka Jabil - Clinton JHC)"), "Jabil Inc.");
  assertEquals(warnPrePass("UPDATE 2 Republic National Distributing Company"), "Republic National Distributing Company");
  assertEquals(warnPrePass("Public Storage Correction to 7/22/26 WARN"), "Public Storage");
  assertEquals(amendKind("Public Storage Correction to 7/22/26 WARN"), "correction");
  assertEquals(amendKind("Acme Corp - Rescinded"), "rescinded");
  assertEquals(amendKind("Catholic Guardian Services (Rescission)"), "rescinded");
  assertEquals(amendKind("Updated Living LLC"), null);
  assertEquals(stripAmendAffix("Updated Living LLC"), "Updated Living LLC");
  assertEquals(amendKind("Restaurant Associates"), null);
  assertEquals(keyNorm("Wells Fargo & Company"), "wells fargo");
  assertEquals(keyNorm("BANK OF AMERICA CORP /DE/"), "bank of america");
  assertEquals(keyNorm("The New York Times Co"), "new york times");
  assertEquals(keyNorm("FUSE GROUP HOLDING"), "fuse group holding");
  assertEquals(keyNorm("Compass Group USA"), "compass group usa");
  assertEquals(keyNorm("3M CO"), "3m");
  assertEquals(keyNorm("Émile & Fils S.A."), "emile and fils s a", "the same tokens layoff_norm() yields");
  assertEquals(readDate("09-16-26"), "2026-09-16");
  assertEquals(readDate("9/16/2026"), "2026-09-16");
  assertEquals(readDate("2026-07-06 00:00:00"), "2026-07-06");
  assertEquals(readDate("September 14, 2026"), "2026-09-14");
  assertEquals(readDate("46199"), "2026-06-26");
  assertEquals(readDate("2299"), null, "a four-digit serial is a 1906 date, not a notice");
  assertEquals(readDate("n/a"), null);
  assertEquals(readCount("1,037"), 1037);
  assertEquals(readCount("0"), null, "zero is not a stated count");
  assertEquals(readCount(""), null);
  assertEquals(eventTypeOf("Closure Permanent"), "closure");
  assertEquals(eventTypeOf("Layoff Temporary"), "layoff");
  assertEquals(eventTypeOf("Relocation"), "relocation");
  assertEquals(eventTypeOf(""), "unknown");
  assertEquals(temporaryOf("Permanent"), false);
  assertEquals(temporaryOf("Layoff Temporary"), true);
  assertEquals(temporaryOf("N/A"), null);
});

Deno.test("the Big Local News run reader: failed extracts per state, the jobs URL from the runs listing, the stale rule", () => {
  const f = extractFailuresFrom(JSON.parse(sampleText("bln-jobs.json")));
  assert(f);
  assertEquals([...f.failed].sort(), ["FL", "TX"]);
  assert(f.seen.size >= 40);
  const url = latestRunJobsUrl(JSON.parse(sampleText("bln-runs.json")));
  assert(url && url.startsWith("https://api.github.com/repos/biglocalnews/warn-github-flow/actions/runs/"));
  assertEquals(extractFailuresFrom({ message: "rate limited" }), null);
  assertEquals(isStale("2026-09-16", false, READ_ISO, 21), false);
  assertEquals(isStale("2026-07-06", false, READ_ISO, 21), true, "Texas via BLN is stale");
  assertEquals(isStale("2026-09-16", true, READ_ISO, 21), true, "a failed extract is stale whatever the date");
  assertEquals(isStale(null, false, READ_ISO, 21), true);
});

Deno.test("a refused unverified map is a note on the slice, never a failed read; a verified map's refusal and every error are failures", () => {
  const unverified = { verifiedAgainstSample: false };
  const verified = { verifiedAgainstSample: true };
  assertEquals(feedVerdict({ ok: true, refused: false }, unverified), "ok");
  assertEquals(feedVerdict({ ok: false, refused: true }, unverified), "refused");
  assertEquals(feedVerdict({ ok: false, refused: true }, verified), "failed", "a verified map that no longer recognises its state's header is a real failure");
  assertEquals(feedVerdict({ ok: false, refused: false }, unverified), "failed", "a fetch or write error on an unverified map is a failure");
  assertEquals(feedVerdict({ ok: false, refused: false }, verified), "failed");
  // The seven maps shipped unverified all answer "refused" on California's header, so the slice's ok is untouched by them.
  const caTable = tableFromCsv(sampleText("bln-raw-ca.csv"), CA);
  for (const m of [AZ, GA, IA, MA, MD, OR, VA]) {
    const r = mapTable(m, caTable, "bln_raw");
    assertEquals(feedVerdict({ ok: r.ok, refused: !r.ok }, m), "refused", m.state);
  }
});
