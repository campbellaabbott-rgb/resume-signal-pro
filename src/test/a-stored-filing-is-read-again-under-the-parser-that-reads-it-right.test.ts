// @vitest-environment node
/**
 * A STORED FILING IS READ AGAIN UNDER THE PARSER THAT READS IT RIGHT
 * (S14X-149, S14X-150, S14X-278).
 *
 * Every ingest path skips a filing_id it already holds, so a row an older
 * parser read keeps that parser's answer for as long as it is shown: an exit-
 * cost 8-K that said "No employees will be terminated" stays "reported a
 * workforce reduction", and Workday's "2.5% of Workday's global workforce"
 * stays a row with no percentage. The re-read was a hand-run action
 * (edgar_reread), and a 403 from sec.gov (its fair-access block) was stored as
 * a "(document not read)" placeholder. The daily audit now re-reads a bounded
 * share of the candidates -- placeholders, status updates and rows an older
 * parser read -- and a 403 is retried, never stored.
 *
 * Runs the shipped handler (edge harness) with only its network faked.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { ProxyDb } from "./helpers/proxy-db";
import { PARSER_VERSION } from "../../supabase/functions/layoff-filings/parse205";

vi.setConfig({ testTimeout: 60_000 });

const SECRET = "test-layoff-cron-secret-0123456789";
const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", LAYOFF_CRON_SECRET: SECRET };
const CIK = 4242;
const today = new Date();
const iso = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const DENIAL = "On August 1, 2026, the Board approved a plan to consolidate two warehouses. No employees will be terminated in connection with the plan. The Company expects to incur approximately $2 million of lease exit costs.";
const CUT = "On August 28, 2026, the Board of Directors of Acme Corp approved a reduction in force of approximately 140 employees.";
const docHtml = (section: string) =>
  `<html><body><p>Item 2.05 Costs Associated with Exit or Disposal Activities.</p><p>${section}</p><p>Item 9.01 Financial Statements and Exhibits.</p></body></html>`;
const adsh = (n: number) => `0001234567-26-${String(100 + n).padStart(6, "0")}`;

// adsh(0): a denial an older parser stored as a workforce event. adsh(1): a
// placeholder whose document sec.gov now answers 403. adsh(10..21): twelve
// placeholders whose documents read.
const docs: Record<string, { status: number; html: string }> = {
  [`${adsh(0).replace(/-/g, "")}/d0.htm`]: { status: 200, html: docHtml(DENIAL) },
  [`${adsh(1).replace(/-/g, "")}/d1.htm`]: { status: 403, html: "Your request has been identified as part of a network of automated tools" },
};
for (let n = 10; n < 22; n++) docs[`${adsh(n).replace(/-/g, "")}/d${n}.htm`] = { status: 200, html: docHtml(CUT) };
const ALL = [0, 1, ...Array.from({ length: 12 }, (_, i) => 10 + i)];
const subs = JSON.stringify({
  cik: String(CIK), name: "Acme Corp", tickers: ["ACME"],
  filings: { recent: {
    accessionNumber: ALL.map(adsh), form: ALL.map(() => "8-K"),
    filingDate: ALL.map(() => iso(20)), reportDate: ALL.map(() => iso(21)),
    acceptanceDateTime: ALL.map(() => `${iso(20)}T16:05:00.000Z`),
    items: ALL.map(() => "2.05"), primaryDocument: ALL.map((n) => `d${n}.htm`),
  }, files: [] },
});
const row = (n: number, over: Record<string, unknown>) => ({
  filing_id: `sec:${adsh(n)}`, cik: CIK, adsh: adsh(n), filer_raw: "Acme Corp", parser_version: PARSER_VERSION, ...over,
});
const OLDER = row(0, { section_text: `Item 2.05 ${DENIAL}`, parse_confidence: 0.5, is_workforce_event: true, parser_version: "parse205_v2_ts" });
const BLOCKED = row(1, { section_text: "(document not read)", parse_confidence: 0, is_workforce_event: null });
const PLACEHOLDERS = Array.from({ length: 12 }, (_, i) => row(10 + i, { section_text: "(document not read)", parse_confidence: 0, is_workforce_event: null }));

let stored: Array<Record<string, unknown>> = [];
let upserted: Array<Record<string, unknown>> = [];
let fetchedDocs: string[] = [];
let db: ProxyDb;
let handler: EdgeHandler;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  g.fetch = async (input: string) => {
    const url = String(input);
    if (url.startsWith("https://efts.sec.gov/")) return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    if (url === `https://data.sec.gov/submissions/CIK${String(CIK).padStart(10, "0")}.json`) {
      return new Response(subs, { status: 200, headers: { "content-type": "application/json" } });
    }
    const m = /\/Archives\/edgar\/data\/\d+\/(.+)$/.exec(url);
    const d = m ? docs[m[1]] : undefined;
    if (d) { fetchedDocs.push(m![1]); return new Response(d.html, { status: d.status, headers: { "content-type": "text/html" } }); }
    return new Response("not found", { status: 404 });
  };
  db = new ProxyDb();
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

beforeEach(() => { upserted = []; fetchedDocs = []; db.queries = []; });

const post = async (action: string) => {
  const res = await handler(new Request("https://h.supabase.co/functions/v1/layoff-filings", {
    method: "POST", headers: { "content-type": "application/json", "x-layoff-cron": SECRET }, body: JSON.stringify({ action }),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const auditNote = () => {
  const ins = db.on("layoff_read_log", "insert").map((q) => q.calls.find(([m]) => m === "insert")?.[1][0] as Record<string, unknown>);
  return ins.find((r) => r.kind === "edgar_fts_audit")?.note as string | undefined;
};

describe("the daily audit re-reads stored rows", () => {
  it("a denial an older parser stored as a workforce event is re-read and stored as none, under this parser's version", async () => {
    stored = [OLDER, BLOCKED];
    const r = await post("edgar_audit");
    expect(r.status).toBe(200);
    const a = upserted.find((x) => x.filing_id === `sec:${adsh(0)}`);
    expect(a, "the audit never re-read a row an older parser stored").toBeDefined();
    expect(a?.is_workforce_event).toBe(false);
    expect(a?.parser_version).toBe(PARSER_VERSION);
    expect(auditNote()).toMatch(/reread=2\b/);
  });

  it("a 403 from sec.gov is retried, and nothing is written over the row", async () => {
    stored = [BLOCKED];
    await post("edgar_audit");
    expect(fetchedDocs.some((d) => d.endsWith("/d1.htm"))).toBe(true);
    expect(upserted.find((x) => x.filing_id === `sec:${adsh(1)}`), "a fair-access block was written as a placeholder").toBeUndefined();
  });

  it("at most ten stored rows are re-read in one audit run", async () => {
    stored = PLACEHOLDERS;
    await post("edgar_audit");
    expect(fetchedDocs.length).toBe(10);
    expect(upserted.length).toBe(10);
    expect(auditNote()).toMatch(/reread=10\b/);
  });

  it("the hand-run re-read takes a row an older parser read too", async () => {
    stored = [OLDER];
    const r = await post("edgar_reread");
    expect(r.status).toBe(200);
    expect(upserted.find((x) => x.filing_id === `sec:${adsh(0)}`)?.is_workforce_event).toBe(false);
  });
});
