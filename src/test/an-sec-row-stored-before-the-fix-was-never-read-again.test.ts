// @vitest-environment node
/**
 * AN SEC ROW STORED BEFORE THE FIX WAS NEVER READ AGAIN (review of sweep
 * S8-026 and S8-108, 2026-10-10).
 *
 * The status-update rule (S8-026) and the no-row-on-a-throttled-read rule
 * (S8-108) ran only in the row builder, and every ingest path skips a
 * filing_id it already holds. A status update stored by the old build kept
 * printing as a new reduction until it aged out of the window (Freshworks'
 * 2026-08-04 row, about 2026-11-02), and every "(document not read)" row kept
 * its placeholder. The one-shot action edgar_reread reads those rows again,
 * and replaces a row only when the document was read, so a good row is never
 * overwritten by a failed read.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000 });

const SECRET = "test-layoff-cron-secret-0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LAYOFF_CRON_SECRET: SECRET };
const CIK = 4242;
const today = new Date();
const iso = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const UPDATE = "As part of the previously announced restructuring plan, the Company has now reduced its workforce by approximately 120 employees. The restructuring plan is substantially complete.";
const NEW_CUT = "On August 28, 2026, the Board of Directors of Acme Corp approved a reduction in force of approximately 140 employees, about 8% of the Company's workforce.";
const docHtml = (section: string) =>
  `<html><body><p>Item 2.05 Costs Associated with Exit or Disposal Activities.</p><p>${section}</p><p>Item 9.01 Financial Statements and Exhibits.</p></body></html>`;

// A: a status update the old build stored as a workforce event. B: a placeholder.
// C: a genuine cut, correctly stored (not a candidate). D: a status update whose
// document read now fails (must not be overwritten).
const ADSH = { A: "0001234567-26-000010", B: "0001234567-26-000020", C: "0001234567-26-000030", D: "0001234567-26-000040" };
const docs: Record<string, { status: number; html: string }> = {
  [`${ADSH.A.replace(/-/g, "")}/a.htm`]: { status: 200, html: docHtml(UPDATE) },
  [`${ADSH.B.replace(/-/g, "")}/b.htm`]: { status: 200, html: docHtml(NEW_CUT) },
  [`${ADSH.C.replace(/-/g, "")}/c.htm`]: { status: 200, html: docHtml(NEW_CUT) },
  [`${ADSH.D.replace(/-/g, "")}/d.htm`]: { status: 503, html: "busy" },
};
const subs = JSON.stringify({
  cik: String(CIK), name: "Acme Corp", tickers: ["ACME"],
  filings: { recent: {
    accessionNumber: [ADSH.A, ADSH.B, ADSH.C, ADSH.D], form: ["8-K", "8-K", "8-K", "8-K"],
    filingDate: [iso(20), iso(18), iso(16), iso(14)], reportDate: [iso(21), iso(19), iso(17), iso(15)],
    acceptanceDateTime: [`${iso(20)}T16:05:00.000Z`, `${iso(18)}T16:05:00.000Z`, `${iso(16)}T16:05:00.000Z`, `${iso(14)}T16:05:00.000Z`],
    items: ["2.05", "2.05", "2.05", "2.05"], primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm"],
  }, files: [] },
});
const stored = [
  { filing_id: `sec:${ADSH.A}`, cik: CIK, adsh: ADSH.A, filer_raw: "Acme Corp", section_text: UPDATE, parse_confidence: 1, is_workforce_event: true },
  { filing_id: `sec:${ADSH.B}`, cik: CIK, adsh: ADSH.B, filer_raw: "Acme Corp", section_text: "(document not read)", parse_confidence: 0, is_workforce_event: null },
  { filing_id: `sec:${ADSH.C}`, cik: CIK, adsh: ADSH.C, filer_raw: "Acme Corp", section_text: NEW_CUT, parse_confidence: 1, is_workforce_event: true },
  { filing_id: `sec:${ADSH.D}`, cik: CIK, adsh: ADSH.D, filer_raw: "Acme Corp", section_text: UPDATE, parse_confidence: 1, is_workforce_event: true },
];

let upserted: Array<Record<string, unknown>> = [];
let fetchedDocs: string[] = [];
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  g.fetch = async (input: string) => {
    const url = String(input);
    if (url === `https://data.sec.gov/submissions/CIK${String(CIK).padStart(10, "0")}.json`) {
      return new Response(subs, { status: 200, headers: { "content-type": "application/json" } });
    }
    const m = /\/Archives\/edgar\/data\/\d+\/(.+)$/.exec(url);
    const d = m ? docs[m[1]] : undefined;
    if (d) { fetchedDocs.push(m![1]); return new Response(d.html, { status: d.status, headers: { "content-type": "text/html" } }); }
    return new Response("not found", { status: 404 });
  };
  const db = new ProxyDb();
  db.answer = (q) => {
    if (q.table === "layoff_filings" && q.calls.some(([m]) => m === "select")) return { data: stored, error: null };
    if (q.rpc === "layoff_filings_upsert") {
      const rows = (q.calls[0][1][0] as { p_rows: Array<Record<string, unknown>> }).p_rows;
      upserted.push(...rows);
      return { data: [{ lu_inserted: 0, lu_updated: rows.length, lu_refused: 0 }], error: null };
    }
    return undefined;
  };
  g.__layoffDb = db;
  handler = await loadEdgeHandler("layoff-filings", {
    "https://deno.land/std@0.190.0/http/server.ts": "export const serve = (h) => { globalThis.__edgeHandler = h; };",
    "https://esm.sh/xlsx@0.18.5": "export const read = () => ({ Sheets: {}, SheetNames: [] }); export const utils = { sheet_to_json: () => [] };",
    "_shared/supabase-client.ts": "export const getServiceClient = () => globalThis.__layoffDb;",
  });
}, 60_000);

beforeEach(() => { upserted = []; fetchedDocs = []; });

const reread = async () => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", {
    method: "POST", headers: { "content-type": "application/json", "x-layoff-cron": SECRET }, body: JSON.stringify({ action: "edgar_reread" }),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

describe("a stored SEC row the old build got wrong", () => {
  it("a status update stored as a workforce event is re-read and stored as none", async () => {
    const r = await reread();
    expect(r.status).toBe(200);
    const a = upserted.find((x) => x.filing_id === `sec:${ADSH.A}`);
    expect(a, "the stored status update was never read again").toBeDefined();
    expect(a?.is_workforce_event).toBe(false);
  });

  it("a placeholder row is re-read into a row with its numbers", async () => {
    await reread();
    const b = upserted.find((x) => x.filing_id === `sec:${ADSH.B}`);
    expect(b, "the \"(document not read)\" row kept its placeholder").toBeDefined();
    expect(b?.headcount).toBe(140);
    expect(b?.is_workforce_event).toBe(true);
  });

  it("positive control: a correct row is not fetched, and a failed read overwrites nothing", async () => {
    await reread();
    expect(fetchedDocs.some((d) => d.endsWith("/c.htm")), "a correctly stored cut was fetched again").toBe(false);
    expect(fetchedDocs.some((d) => d.endsWith("/d.htm"))).toBe(true);
    expect(upserted.find((x) => x.filing_id === `sec:${ADSH.D}`), "a 503 replaced a good row with a placeholder").toBeUndefined();
    expect(upserted.length).toBe(2);
  });
});
