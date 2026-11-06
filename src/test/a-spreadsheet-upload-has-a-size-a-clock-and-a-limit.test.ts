// @vitest-environment node
/**
 * A SPREADSHEET UPLOAD HAS A SIZE, A CLOCK AND A LIMIT (S13-066).
 *
 * WHAT WAS WRONG. parse-spreadsheet (verify_jwt off: the publishable key is
 * enough) read every upload whole, handed workbooks to SheetJS 0.18.5 (before
 * the prototype-pollution fix in 0.19.3 and the ReDoS fix in 0.20.2), fetched
 * any public Google Sheet with no timeout and no byte cap, and counted nobody.
 * parse-pdf and parse-docx had a 10 MB cap and a per-address limiter.
 *
 * WHAT HOLDS NOW, running the shipped handler with the network faked:
 *   - a body declared past MAX_UPLOAD_BYTES, a file past it, and JSON content
 *     past it are 413 before anything is parsed;
 *   - an address over PER_ADDRESS_PER_HOUR is 429, counted by check_rate_limit
 *     on the platform's address; a limiter that errors lets the request through
 *     (a broken counter never takes the import away);
 *   - a Google Sheets export is read under AbortSignal.timeout and refused once
 *     it passes the cap, without being read whole;
 *   - the workbook parser reads at most MAX_ROWS rows, values only;
 *   - (the fixer's review) a body that declares no length is still stopped
 *     at the cap, never buffered whole; and a zipped workbook whose entries
 *     unpack past MAX_UNZIPPED_BYTES is a 413 that never reaches SheetJS,
 *     measured by inflating, so a directory that understates a size is
 *     caught too;
 *   - an ordinary CSV still becomes jobs.
 *
 * STILL OPEN, FOR THE OWNER: the parser is still SheetJS 0.18.5. Later builds
 * are published only on SheetJS's own CDN, which Deno 2 does not import from
 * by default, so scripts/check-functions.sh fails on that import.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { buildIsAtLeast } from "./helpers/fn-build";
import { deflateRawSync } from "node:zlib";
import { MAX_ROWS, MAX_UNZIPPED_BYTES, MAX_UPLOAD_BYTES, PER_ADDRESS_PER_HOUR, SHEETS_FETCH_MS, TooLarge, readCapped, zipInflationRefusal } from "../../supabase/functions/parse-spreadsheet/limits";

/**
 * A zip of these entries, each deflated (or stored), with a real central
 * directory; `claim` overrides an entry's declared uncompressed size.
 */
function zipOf(entries: Array<{ name: string; data: Uint8Array; store?: boolean; claim?: number }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const packed = e.store ? Buffer.from(e.data) : deflateRawSync(e.data);
    const size = e.claim ?? e.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.store ? 0 : 8, 8);
    lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, packed);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.store ? 0 : 8, 10);
    ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const SMALL_BOOK = zipOf([
  { name: "[Content_Types].xml", data: new TextEncoder().encode("<Types/>") },
  { name: "xl/workbook.xml", data: new TextEncoder().encode("<workbook/>") },
  { name: "xl/sharedStrings.xml", data: new TextEncoder().encode("<sst>" + "<si><t>Engineer</t></si>".repeat(200) + "</sst>") },
]);
/** 60 MB of one byte deflates to about 60 KB: a workbook well under the upload cap that unpacks past the unzip cap. */
const BOMB_DATA = new Uint8Array(60 * 1024 * 1024).fill(0x41);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 180_000 });

const SRC = readFileSync(resolve(__dirname, "../../supabase/functions/parse-spreadsheet/index.ts"), "utf8");
const XLSX_URL = (/import \* as XLSX from "([^"]+)";/.exec(SRC) ?? [])[1] ?? "";

const CSV = "Title,Company,Description\nData engineer,Acme,Build pipelines\nNurse,City Hospital,Night shifts on the ward\n";

let db: FakeDb;
let limiterAsked: Array<Record<string, unknown>>;
let limiterSays: () => { data: unknown; error: { message: string } | null };
let handler: EdgeHandler;
let xlsxReads: Array<Record<string, unknown>>;
let sheetsFetch: (init?: RequestInit) => Response;
let sheetsSignals: Array<AbortSignal | undefined>;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.fetch = async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://docs.google.com/spreadsheets/")) { sheetsSignals.push(init?.signal ?? undefined); return sheetsFetch(init); }
    return new Response("{}", { status: 404 });
  };
  const stubs: Record<string, string> = {
    "https://esm.sh/@supabase/supabase-js@2.45.0": "export const createClient = () => globalThis.__ssDb;",
  };
  // The workbook parser is stubbed to record how it is asked: SheetJS itself
  // is not installed in this repository.
  stubs[XLSX_URL] = `export const read = (buf, opts) => { globalThis.__ssXlsx.push(opts); return { SheetNames: ["S"], Sheets: { S: {} } }; };
    export const utils = { sheet_to_json: () => [["Title", "Company", "Description"], ["Engineer", "Acme", "Pipelines"]] };`;
  handler = await loadEdgeHandler("parse-spreadsheet", stubs);
}, 180_000);

beforeEach(() => {
  db = new FakeDb();
  limiterAsked = [];
  limiterSays = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = (a) => { limiterAsked.push(a); return limiterSays(); };
  (globalThis as Record<string, unknown>).__ssDb = db;
  (globalThis as Record<string, unknown>).__ssXlsx = xlsxReads = [];
  sheetsSignals = [];
  sheetsFetch = () => new Response(CSV, { status: 200 });
});

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  handler(new Request("https://harness.supabase.co/functions/v1/parse-spreadsheet", {
    method: "POST", headers: { "cf-connecting-ip": "198.51.100.7", ...headers }, body,
  }));
const multipart = (name: string, bytes: Uint8Array | string) => {
  const fd = new FormData();
  fd.append("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name));
  return fd;
};

describe("an ordinary upload still becomes jobs", () => {
  it("a CSV file, counted once on the platform's address", async () => {
    const res = await post(multipart("jobs.csv", CSV));
    expect(res.status).toBe(200);
    expect(buildIsAtLeast(res.headers.get("x-fn-build"), "parse-spreadsheet", "2026-11-03"), String(res.headers.get("x-fn-build"))).toBe(true);
    const body = await res.json() as { jobs: Array<{ title: string }> };
    expect(body.jobs.map((j) => j.title)).toEqual(["Data engineer", "Nurse"]);
    expect(limiterAsked).toEqual([
      expect.objectContaining({ p_function: "parse-spreadsheet", p_ip: "198.51.100.7", p_max_requests: PER_ADDRESS_PER_HOUR, p_window_minutes: 60 }),
    ]);
  });

  it("a workbook is read with the row cap and values only", async () => {
    const res = await post(multipart("jobs.xlsx", SMALL_BOOK));
    expect(res.status).toBe(200);
    expect(xlsxReads).toEqual([expect.objectContaining({ type: "array", sheetRows: MAX_ROWS + 1, cellFormula: false, cellHTML: false, cellStyles: false })]);
  });
});

describe("the size", () => {
  it("a body declared past the cap is a 413 before it is read or counted", async () => {
    const res = await post("x", { "content-length": String(MAX_UPLOAD_BYTES * 3), "content-type": "application/json" });
    expect(res.status).toBe(413);
    expect((await res.json() as { code: string }).code).toBe("too_large");
    expect(limiterAsked).toEqual([]);
  });

  it("a file past the cap is a 413 and never reaches the parser", async () => {
    const res = await post(multipart("big.xlsx", new Uint8Array(MAX_UPLOAD_BYTES + 10)));
    expect(res.status).toBe(413);
    expect(xlsxReads).toEqual([]);
  });

  it("JSON content past the cap is a 413", async () => {
    const res = await post(JSON.stringify({ content: "a,b\n".repeat(MAX_UPLOAD_BYTES / 4 + 10), fileName: "x.csv" }), { "content-type": "application/json" });
    expect(res.status).toBe(413);
  });
});

describe("the body read and the unzip (the fixer's review)", () => {
  it("a body that declares no length is stopped at the cap, never buffered whole", async () => {
    let pulled = 0;
    // Finite (40 MB), so a reader with no cap ends instead of eating the machine.
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulled++; if (pulled > 40) c.close(); else c.enqueue(new Uint8Array(1024 * 1024)); } });
    const res = await handler(new Request("https://harness.supabase.co/functions/v1/parse-spreadsheet", {
      method: "POST", headers: { "cf-connecting-ip": "198.51.100.7", "content-type": "multipart/form-data; boundary=x" },
      body: stream, duplex: "half",
    } as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(MAX_UPLOAD_BYTES / (1024 * 1024) + 4);
    expect(xlsxReads).toEqual([]);
  });

  it("a small workbook that unpacks past the unzip cap is a 413 that never reaches SheetJS", async () => {
    const bomb = zipOf([{ name: "xl/sharedStrings.xml", data: BOMB_DATA }]);
    expect(bomb.length).toBeLessThan(MAX_UPLOAD_BYTES / 10);
    const res = await post(multipart("jobs.xlsx", bomb));
    expect(res.status).toBe(413);
    expect((await res.json() as { code: string }).code).toBe("too_large");
    expect(xlsxReads).toEqual([]);
  });

  it("a directory that understates an entry's size is caught by inflating it", async () => {
    const liar = zipOf([{ name: "xl/sharedStrings.xml", data: BOMB_DATA, claim: 120 }]);
    expect(await zipInflationRefusal(liar)).toBe("too_large");
    expect(await zipInflationRefusal(liar, MAX_UNZIPPED_BYTES)).toBe("too_large");
  });

  it("a .xls name on zip bytes is measured too", async () => {
    const res = await post(multipart("jobs.xls", zipOf([{ name: "a.xml", data: BOMB_DATA }])));
    expect(res.status).toBe(413);
    expect(xlsxReads).toEqual([]);
  });

  it("an ordinary workbook and stored entries pass; a zip with no directory is refused as unreadable", async () => {
    expect(await zipInflationRefusal(SMALL_BOOK)).toBeNull();
    expect(await zipInflationRefusal(zipOf([{ name: "a.xml", data: new Uint8Array(1000), store: true }]))).toBeNull();
    expect(await zipInflationRefusal(new Uint8Array([80, 75, 3, 4]))).toBe("corrupt");
    const res = await post(multipart("jobs.xlsx", new Uint8Array([80, 75, 3, 4])));
    expect(res.status).toBe(400);
    expect(xlsxReads).toEqual([]);
  });
});

describe("the limit", () => {
  it("an address over the hour's allowance is a 429", async () => {
    limiterSays = () => ({ data: false, error: null });
    const res = await post(multipart("jobs.csv", CSV));
    expect(res.status).toBe(429);
    expect((await res.json() as { code: string }).code).toBe("rate_limited_function");
  });

  it("a limiter that errors lets the request through", async () => {
    limiterSays = () => ({ data: null, error: { message: "limiter down" } });
    const res = await post(multipart("jobs.csv", CSV));
    expect(res.status).toBe(200);
  });
});

describe("the Google Sheets read", () => {
  const sheet = () => post(JSON.stringify({ googleSheetsUrl: "https://docs.google.com/spreadsheets/d/abc123/edit" }), { "content-type": "application/json" });

  it("is read under a timeout", async () => {
    const res = await sheet();
    expect(res.status).toBe(200);
    expect(sheetsSignals).toHaveLength(1);
    expect(sheetsSignals[0], "the export fetch carries no AbortSignal").toBeInstanceOf(AbortSignal);
    expect(SHEETS_FETCH_MS).toBeLessThanOrEqual(20_000);
  });

  it("an export past the cap is refused without being read whole", async () => {
    let pulled = 0;
    sheetsFetch = () => new Response(new ReadableStream({
      pull(c) { pulled++; c.enqueue(new Uint8Array(1024 * 1024)); },
    }), { status: 200 });
    const res = await sheet();
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(MAX_UPLOAD_BYTES / (1024 * 1024) + 4);
  });

  it("the capped reader refuses a declared length past the cap before reading", async () => {
    const res = new Response("small", { headers: { "content-length": String(MAX_UPLOAD_BYTES + 1) } });
    await expect(readCapped(res)).rejects.toBeInstanceOf(TooLarge);
    expect(await readCapped(new Response("a,b\n1,2\n"))).toBe("a,b\n1,2\n");
  });
});
