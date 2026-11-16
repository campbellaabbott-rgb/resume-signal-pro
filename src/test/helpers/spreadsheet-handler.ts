/**
 * THE SHIPPED parse-spreadsheet HANDLER, RUN UNDER NODE WITH ITS NETWORK FAKED.
 *
 * The limiter answers yes, every Google Sheets fetch is recorded and answered
 * by `sheets` (a CSV by default), and the workbook parser is stubbed at
 * whatever specifier index.ts imports it from, so the same harness runs the
 * handler before and after the parser moved.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./edge-harness";

const SRC = readFileSync(resolve(__dirname, "../../../supabase/functions/parse-spreadsheet/index.ts"), "utf8");
/** The specifier the handler imports SheetJS from. */
export const XLSX_SPECIFIER = (/import \* as XLSX from "([^"]+)";/.exec(SRC) ?? [])[1] ?? "";

export type SpreadsheetHarness = {
  post(body: BodyInit, headers?: Record<string, string>): Promise<Response>;
  multipart(name: string, bytes: Uint8Array | string): FormData;
  /** Every URL the handler fetched, in order. */
  fetched: string[];
  /** What a Google Sheets export answers; a CSV of two jobs by default. */
  sheets: (url: string) => Response;
};

export async function spreadsheetHarness(): Promise<SpreadsheetHarness> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness" };
  const db = new FakeDb();
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  const h: SpreadsheetHarness = {
    fetched: [],
    sheets: () => new Response("Title,Company,Description\nData engineer,Acme,Build pipelines\n", { status: 200 }),
    post: (body, headers = {}) => handler(new Request("https://harness.supabase.co/functions/v1/parse-spreadsheet", {
      method: "POST", headers: { "cf-connecting-ip": "198.51.100.7", ...headers }, body,
    })),
    multipart: (name, bytes) => {
      const fd = new FormData();
      fd.append("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name));
      return fd;
    },
  };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (fn: unknown) => { g.__edgeHandler = fn; } };
  g.__ssDb = db;
  g.fetch = async (url: string) => {
    h.fetched.push(String(url));
    if (String(url).startsWith("https://docs.google.com/")) return h.sheets(String(url));
    return new Response("{}", { status: 404 });
  };
  const handler: EdgeHandler = await loadEdgeHandler("parse-spreadsheet", {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export const createClient = () => globalThis.__ssDb;",
    [XLSX_SPECIFIER]: `export const read = () => ({ SheetNames: ["S"], Sheets: { S: {} } });
      export const utils = { sheet_to_json: () => [["Title", "Company", "Description"], ["Engineer", "Acme", "Pipelines"]] };`,
  });
  return h;
}
