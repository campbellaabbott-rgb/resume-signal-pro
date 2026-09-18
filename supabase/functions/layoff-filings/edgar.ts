// SEC EDGAR: the latest-filings Atom channel (hourly; the items are named
// in each entry's summary, the acceptance stamp is seconds behind), the
// full-text search index (the daily completeness audit and the one-time
// backfill), and the per-filer submissions JSON that names the primary
// document, the report date and the acceptance time. Three GETs per new
// filing, all sequential through one Http, dedupe on the accession number.
//
// An 8-K/A is never an event of its own: its row carries status amendment
// and points at the original through amends_adsh, resolved from the filer's
// own submissions history at any age — the same report date first, else
// the newest earlier 8-K with Item 2.05 — or amend_unresolved when the
// history holds no candidate.

import type { Http } from "./http.ts";
import { parse205, parseConfidence, PARSER_VERSION, textOf, unescapeHtml } from "./parse205.ts";

export const ATOM_URL = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=100&output=atom";
export const FTS_URL = "https://efts.sec.gov/LATEST/search-index";

export interface AtomEntry {
  adsh: string;
  cik: number;
  form: string;
  filerName: string;
  filedDate: string | null;
  acceptedAt: string | null;
  items: string[];
  indexUrl: string | null;
  /** Every registrant's CIK the feed listed for this accession, in feed order (set by keep205). */
  coCiks?: number[];
}

export function atomPageUrl(start: number): string {
  return start > 0 ? `${ATOM_URL}&start=${start}` : ATOM_URL;
}

/** Every entry of one Atom page. */
export function parseAtom(xml: string): AtomEntry[] {
  const out: AtomEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const title = unescapeHtml(pick(e, "title") ?? "");
    const tm = /^\s*(\S+)\s+-\s+(.*?)\s+\((\d{10})\)\s+\((?:Filer|Reporting|Subject|Issuer)[^)]*\)\s*$/.exec(title)
      ?? /^\s*(\S+)\s+-\s+(.*?)\s+\((\d{10})\)/.exec(title);
    const summaryRaw = pick(e, "summary") ?? "";
    const summary = unescapeHtml(summaryRaw);
    const acc = /AccNo:<\/b>\s*(\d{10}-\d{2}-\d{6})/.exec(summary) ?? /(\d{10}-\d{2}-\d{6})/.exec(summary);
    const idAcc = /accession-number=(\d{10}-\d{2}-\d{6})/.exec(e);
    const adsh = idAcc?.[1] ?? acc?.[1];
    if (!adsh) continue;
    const items = [...summary.matchAll(/Item\s+(\d\.\d\d)\s*:/g)].map((x) => x[1]);
    const filed = /Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/.exec(summary);
    const term = /<category[^>]*term="([^"]+)"/.exec(e);
    const link = /<link[^>]*href="([^"]+)"/.exec(e);
    out.push({
      adsh,
      cik: tm ? parseInt(tm[3], 10) : 0,
      form: term?.[1] ?? (tm?.[1] ?? "8-K"),
      filerName: tm ? tm[2].trim() : title.trim(),
      filedDate: filed?.[1] ?? null,
      acceptedAt: pick(e, "updated"),
      items,
      indexUrl: link?.[1] ?? null,
    });
  }
  return out;
}

function pick(entry: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry);
  return m ? m[1].trim() : null;
}

/**
 * The entries whose summary lists Item 2.05, one per accession: a filing
 * with co-registrants appears once per filer in the feed, and the row is
 * the filing. Every registrant's CIK is kept on the entry (coCiks) so the
 * fetch can choose the filer of record among them -- the feed's order is
 * acceptance order, not role, and lists the subsidiary before the parent as
 * often as not.
 */
export function keep205(entries: AtomEntry[]): AtomEntry[] {
  const byAdsh = new Map<string, AtomEntry>();
  for (const e of entries) {
    if (!e.items.includes("2.05") || !(e.form === "8-K" || e.form === "8-K/A")) continue;
    const kept = byAdsh.get(e.adsh);
    if (kept) {
      if (e.cik > 0 && !kept.coCiks!.includes(e.cik)) kept.coCiks!.push(e.cik);
      continue;
    }
    byAdsh.set(e.adsh, { ...e, coCiks: e.cik > 0 ? [e.cik] : [] });
  }
  return [...byAdsh.values()];
}

// ── full-text search ───────────────────────────────────────────────────────

export interface FtsHit {
  adsh: string;
  cik: number;
  form: string;
  items: string[];
  fileDate: string | null;
  periodEnding: string | null;
  displayName: string | null;
  /** Every registrant's CIK the index lists for the accession. */
  coCiks: number[];
}

export function ftsUrl(startdt: string, enddt: string, from: number): string {
  const q = new URLSearchParams({
    q: '"Item 2.05"', forms: "8-K", dateRange: "custom", startdt, enddt, from: String(from),
  });
  return `${FTS_URL}?${q.toString()}`;
}

/** Distinct filings (by accession) whose items carry 2.05; null when the body is not a hits page (end of results). */
export function parseFtsHits(json: unknown): FtsHit[] | null {
  const hits = (json as { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } } | null)?.hits?.hits;
  if (!Array.isArray(hits)) return null;
  const seen = new Map<string, FtsHit>();
  for (const h of hits) {
    const s = h._source ?? {};
    const adsh = String(s.adsh ?? "");
    if (!/^\d{10}-\d{2}-\d{6}$/.test(adsh)) continue;
    const items = Array.isArray(s.items) ? (s.items as unknown[]).map(String) : [];
    if (!items.includes("2.05")) continue;
    if (seen.has(adsh)) continue;
    const ciks = Array.isArray(s.ciks) ? (s.ciks as unknown[]).map(String) : [];
    seen.set(adsh, {
      adsh,
      cik: ciks[0] ? parseInt(ciks[0], 10) : 0,
      coCiks: ciks.map((c) => parseInt(c, 10)).filter((c) => Number.isFinite(c) && c > 0),
      form: String(s.form ?? "8-K"),
      items,
      fileDate: typeof s.file_date === "string" ? s.file_date : null,
      periodEnding: typeof s.period_ending === "string" ? s.period_ending : null,
      displayName: Array.isArray(s.display_names) ? String((s.display_names as unknown[])[0] ?? "") : null,
    });
  }
  return [...seen.values()];
}

// ── submissions JSON ───────────────────────────────────────────────────────

export interface SubmissionsFiling {
  adsh: string;
  form: string;
  filingDate: string;
  reportDate: string | null;
  acceptanceDateTime: string | null;
  items: string[];
  primaryDocument: string | null;
}

export interface Submissions {
  cik: number;
  name: string;
  tickers: string[];
  filings: SubmissionsFiling[];
  /** Older history files (data.sec.gov/submissions/<name>), when the recent block overflowed. */
  olderFiles: string[];
}

export function submissionsUrl(cik: number): string {
  return `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;
}

/** The columnar `filings.recent` block (and any older file's block) as rows. */
export function columnarToRows(block: unknown): SubmissionsFiling[] {
  const b = block as Record<string, unknown[]> | null;
  if (!b || !Array.isArray(b.accessionNumber)) return [];
  const n = b.accessionNumber.length;
  const col = (k: string, i: number): string | null => {
    const v = (b[k] as unknown[] | undefined)?.[i];
    return v == null || v === "" ? null : String(v);
  };
  const out: SubmissionsFiling[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      adsh: String(b.accessionNumber[i]),
      form: col("form", i) ?? "",
      filingDate: col("filingDate", i) ?? "",
      reportDate: col("reportDate", i),
      acceptanceDateTime: col("acceptanceDateTime", i),
      items: (col("items", i) ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      primaryDocument: col("primaryDocument", i),
    });
  }
  return out;
}

export function parseSubmissions(json: unknown): Submissions | null {
  const j = json as Record<string, unknown> | null;
  if (!j || typeof j !== "object" || j.cik == null) return null;
  const filings = (j.filings as Record<string, unknown> | undefined) ?? {};
  const older = Array.isArray(filings.files)
    ? (filings.files as Array<{ name?: string }>).map((f) => f.name).filter((n): n is string => typeof n === "string")
    : [];
  return {
    cik: parseInt(String(j.cik), 10),
    name: String(j.name ?? ""),
    tickers: Array.isArray(j.tickers) ? (j.tickers as unknown[]).map(String) : [],
    filings: columnarToRows(filings.recent),
    olderFiles: older,
  };
}

/**
 * The original an 8-K/A amends: an 8-K in the same filer's history carrying
 * Item 2.05, filed no later than the amendment — same report date first
 * (oldest of those), else the newest earlier one. Null when none.
 */
export function resolveAmends(filings: SubmissionsFiling[], amendment: SubmissionsFiling): string | null {
  const cands = filings.filter((f) =>
    f.form === "8-K" && f.items.includes("2.05") && f.adsh !== amendment.adsh && f.filingDate <= amendment.filingDate
  );
  if (cands.length === 0) return null;
  const same = cands.filter((f) => f.reportDate != null && f.reportDate === amendment.reportDate)
    .sort((a, b) => a.filingDate.localeCompare(b.filingDate));
  if (same.length > 0) return same[0].adsh;
  return cands.sort((a, b) => b.filingDate.localeCompare(a.filingDate))[0].adsh;
}

export function primaryDocUrl(cik: number, adsh: string, primaryDocument: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${primaryDocument}`;
}

export function filingIndexUrl(cik: number, adsh: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${adsh}-index.htm`;
}

// ── the row ────────────────────────────────────────────────────────────────

export interface SecRowInput {
  cik: number;
  adsh: string;
  filerName: string;
  form: string;
  /** The period of report: the event date, never the filing date standing in for it. */
  reportDate: string;
  filingDate: string;
  primaryDocument: string | null;
  documentHtml: string | null;
  amendsAdsh: string | null;
  readAt: Date;
}

/** Build the upsert row for one filing from its document; the parser never refuses a row. */
export function buildSecRow(input: SecRowInput): { row: Record<string, unknown>; parsed: ReturnType<typeof parse205> | null } {
  const isAmendment = input.form === "8-K/A";
  const parsed = input.documentHtml ? parse205(input.documentHtml) : null;
  const url = input.primaryDocument ? primaryDocUrl(input.cik, input.adsh, input.primaryDocument) : filingIndexUrl(input.cik, input.adsh);
  // The whole section is stored on every SEC row. When no Item 2.05 heading
  // was found (an exhibit, a PDF-only filing), the head of the document text
  // stands in and parse_confidence says 0 — the row still ships with a link.
  const sectionText = parsed?.sectionText ?? (parsed ? headOf(input.documentHtml!) : "(document not read)");
  return {
    parsed,
    row: {
      filing_id: `sec:${input.adsh}`,
      source: "sec_8k_205",
      filer_raw: input.filerName,
      event_date: input.reportDate,
      event_basis: "sec_report_date",
      public_date: input.filingDate,
      public_basis: "sec_filed",
      source_read_at: input.readAt.toISOString(),
      source_url: url,
      source_name: "SEC EDGAR",
      status: isAmendment ? "amendment" : "active",
      cik: input.cik,
      adsh: input.adsh,
      form: isAmendment ? "8-K/A" : "8-K",
      amends_adsh: isAmendment ? input.amendsAdsh : null,
      amend_unresolved: isAmendment && input.amendsAdsh == null,
      section_text: sectionText.slice(0, 20_000),
      excerpt: parsed?.excerpt ?? null,
      pct: parsed?.pct ?? null,
      headcount: parsed?.headcount ?? null,
      headcount_basis: parsed?.headcountBasis ?? null,
      timing_text: parsed?.timing ?? null,
      is_workforce_event: parsed ? parsed.isWorkforce : null,
      parse_confidence: parsed ? parseConfidence(parsed) : 0,
      parser_version: PARSER_VERSION,
    },
  };
}

function headOf(html: string): string {
  return textOf(html).slice(0, 8000);
}

// ── the fetch chain for one accession ──────────────────────────────────────

export interface FilingFetch {
  row: Record<string, unknown> | null;
  requests: number;
  note: string | null;
  parsedPct: boolean;
  amend: boolean;
  amendUnresolved: boolean;
}

/**
 * submissions JSON → the filing's record → primary document → parser → row.
 * A filing missing from the recent block is looked up in the first older
 * history file (one more GET); still missing means no row and a note. A
 * filing with no period of report is no row either (note no_report_date;
 * the audit retries it): the filing date is not the event date and must
 * never be stored under that basis.
 *
 * CO-REGISTRANTS. A filing several registrants sign appears once per
 * registrant in the feed and the index, in no role order (PBF Holding Co
 * LLC before PBF Energy Inc.; Brandywine Operating Partnership before
 * Brandywine Realty Trust). The row is keyed on ONE cik and an alias row is
 * keyed on the parent's, so when the caller hands the co-registrant CIKs
 * the filer of record is the registrant whose submissions carry a ticker --
 * the listed parent -- and the operating subsidiary or trust is not. One
 * extra submissions GET per co-registrant, on such filings only; when none
 * carries a ticker the first listed stays.
 */
export async function fetchFiling(
  http: Http, cik: number, adsh: string, readAt: Date, fallbackName?: string, coCiks: number[] = [],
): Promise<FilingFetch> {
  const before = http.requests;
  const subRes = await http.getJson(submissionsUrl(cik));
  let subs = subRes.status === 200 ? parseSubmissions(subRes.json) : null;
  if (!subs) {
    return { row: null, requests: http.requests - before, note: `submissions_${subRes.status}`, parsedPct: false, amend: false, amendUnresolved: false };
  }
  let coNote: string | null = null;
  const others = coCiks.filter((c) => c > 0 && c !== cik);
  if (others.length > 0 && subs.tickers.length === 0) {
    for (const other of others) {
      const r = await http.getJson(submissionsUrl(other));
      const s = r.status === 200 ? parseSubmissions(r.json) : null;
      if (s && s.tickers.length > 0 && s.filings.some((f) => f.adsh === adsh)) {
        coNote = `co_registrant_parent=${other}`;
        cik = other;
        subs = s;
        break;
      }
    }
    if (!coNote) coNote = `co_registrants=${others.length}`;
  }
  let filings = subs.filings;
  let rec = filings.find((f) => f.adsh === adsh) ?? null;
  if (!rec && subs.olderFiles.length > 0) {
    const older = await http.getJson(`https://data.sec.gov/submissions/${subs.olderFiles[0]}`);
    if (older.status === 200) {
      filings = filings.concat(columnarToRows(older.json));
      rec = filings.find((f) => f.adsh === adsh) ?? null;
    }
  }
  if (!rec) {
    return { row: null, requests: http.requests - before, note: "accession_not_in_submissions", parsedPct: false, amend: false, amendUnresolved: false };
  }
  if (rec.reportDate == null) {
    return { row: null, requests: http.requests - before, note: "no_report_date", parsedPct: false, amend: false, amendUnresolved: false };
  }
  let html: string | null = null;
  let note: string | null = coNote;
  if (rec.primaryDocument) {
    const doc = await http.getText(primaryDocUrl(cik, adsh, rec.primaryDocument), { Accept: "text/html" });
    if (doc.status === 200) html = doc.text; else note = `document_${doc.status}`;
  } else note = "no_primary_document";
  const isAmendment = rec.form === "8-K/A";
  const amendsAdsh = isAmendment ? resolveAmends(filings, rec) : null;
  const { row, parsed } = buildSecRow({
    cik, adsh, filerName: subs.name || fallbackName || `CIK ${cik}`, form: rec.form,
    reportDate: rec.reportDate, filingDate: rec.filingDate, primaryDocument: rec.primaryDocument,
    documentHtml: html, amendsAdsh, readAt,
  });
  if (parsed && !parsed.sectionText) note = note ? `${note};no_205_section` : "no_205_section";
  return {
    row, requests: http.requests - before, note,
    parsedPct: parsed?.pct != null, amend: isAmendment, amendUnresolved: isAmendment && amendsAdsh == null,
  };
}
