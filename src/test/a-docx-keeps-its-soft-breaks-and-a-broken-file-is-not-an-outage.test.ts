// @vitest-environment node
//
// Node, not jsdom: the handler half bundles parse-docx with esbuild, which
// refuses jsdom's TextEncoder (see helpers/edge-harness.ts).
/**
 * A .DOCX KEEPS ITS SOFT LINE BREAKS, AND A BROKEN FILE IS NOT AN OUTAGE.
 *
 *  S11-010  mammoth's raw-text converter dropped every Shift+Enter break, so
 *           "Jane Doe↵jane@example.com" arrived as "Jane Doejane@example.com"
 *           and the contact reader saved "doejane@example.comexperiencesenior"
 *           as the address at high confidence.
 *  S11-033  An RTF renamed .docx (and a document mammoth could not walk) fell
 *           to the catch-all 500. The browser's parse caller retried every
 *           500 and 429 twice, so one bad file was uploaded three times,
 *           spent three of the visitor's twenty hourly parse slots, opened
 *           the parse circuit ("Document Parser Unavailable... Auto-retry in
 *           30s") and refused the next, valid file without sending it.
 *
 * The handler is the shipped index.ts with only its network faked; mammoth and
 * jszip are the npm packages (the Deno test docx_test.ts runs the esm.sh
 * builds production imports).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mammothNpm from "mammoth";
import mammothPkg from "mammoth/package.json";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZipNpm from "jszip";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";
import { RESUME_LINES, RTF_RENAMED, softBreaksDocx, strictDocx, type ZipClass } from "../../supabase/functions/parse-docx/docx-fixtures";
import { softBreaksAsNewlines } from "../../supabase/functions/parse-docx/docx-text";
import { deriveContact } from "@/lib/resumeContact";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, rpc: vi.fn(async () => ({ data: null, error: null })) },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { resilientCallers, shouldRetryParse } from "@/lib/resilient-edge-function";
import { canAttemptService, resetServiceCircuit } from "@/hooks/use-circuit-breaker";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const Zip = JSZipNpm as unknown as ZipClass;
const env: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_key" };
let handler: EdgeHandler;
let db: FakeDb;

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  g.Deno = { env: { get: (k: string) => env[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { void p.catch(() => {}); } };
  g.__docxMammoth = mammothNpm;
  g.__docxJSZip = JSZipNpm;
  handler = await loadEdgeHandler("parse-docx", {
    "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__docxClient; }",
    "https://esm.sh/mammoth@1.12.3": "export default globalThis.__docxMammoth;",
    "https://esm.sh/jszip@3.10.1": "export default globalThis.__docxJSZip;",
  });
});

beforeEach(() => {
  db = new FakeDb();
  db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
  db.rpcs.check_rate_limit = () => ({ data: true, error: null });
  db.rpcs.log_parse_failure = () => ({ data: null, error: null });
  (globalThis as Record<string, unknown>).__docxClient = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
  invoke.mockReset();
  resetServiceCircuit("parse-pdf");
  resetServiceCircuit("parse-docx");
});

async function upload(bytes: Uint8Array, name = "resume.docx"): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", new File([bytes as Uint8Array<ArrayBuffer>], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const res = await handler(new Request("https://harness.supabase.co/functions/v1/parse-docx", { method: "POST", body: form }));
  return { status: res.status, body: await res.json() };
}

describe("S11-010: a soft line break is a line", () => {
  it("the contact block and the role header written with Shift+Enter come back as their own lines", async () => {
    const r = await upload(await softBreaksDocx(Zip));
    expect(r.status).toBe(200);
    const lines = String(r.body.text).split("\n").map((l) => l.trim()).filter(Boolean);
    const L = RESUME_LINES;
    expect(lines).toEqual([L.name, L.email, L.heading, L.role, L.dates, L.bullet]);
    const contact = deriveContact(String(r.body.text));
    expect(contact.email?.value).toBe("jane@example.com");
  });

  it("every break form becomes a newline run, and nothing else is touched", () => {
    const xml = '<w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:br w:type="textWrapping"/><w:t>C</w:t><w:cr/><w:t>D</w:t><w:br w:type="page"></w:br></w:r><w:bookmarkStart w:id="0"/>';
    const out = softBreaksAsNewlines(xml);
    expect(out.count).toBe(4);
    expect(out.xml).not.toMatch(/<w:(br|cr)\b/);
    expect(out.xml).toContain('<w:bookmarkStart w:id="0"/>');
  });
});

describe("S11-033: a broken file is the file's problem", () => {
  it("an RTF renamed .docx is a 422 that names the file, never a 500", async () => {
    const r = await upload(RTF_RENAMED);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("damaged_file");
  });

  it("a document this mammoth cannot walk is never a 500 either", async () => {
    // npm mammoth 1.6.0 throws on Strict Open XML; the deployed 1.12.3 reads it
    // (docx_test.ts). Either way the answer is about the file. CI installs the
    // version production imports (S12-167), and there the answer is the text.
    const r = await upload(await strictDocx(Zip));
    const deployed = /esm\.sh\/mammoth@(\d+\.\d+\.\d+)/.exec(readFileSync(resolve(__dirname, "../../supabase/functions/parse-docx/libs.ts"), "utf8"))?.[1];
    if ((mammothPkg as { version: string }).version === deployed) expect(r.status, `mammoth ${deployed} reads Strict Open XML`).toBe(200);
    else expect([200, 422]).toContain(r.status);
    if (r.status === 422) expect(r.body.code).toBe("damaged_file");
  });

  it("the parse callers retry only a request that never got an answer", () => {
    const http = (status: number) => new FunctionsHttpError(new Response("{}", { status }));
    expect(shouldRetryParse(new FunctionsFetchError(new Error("Failed to fetch")))).toBe(true);
    for (const s of [422, 429, 500, 503]) expect(shouldRetryParse(http(s)), String(s)).toBe(false);
  });

  it("one bad file is uploaded once, three never open the circuit, and the next valid file is sent", async () => {
    const refusal = () => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ success: false, code: "damaged_file", error: "This file looks damaged" }), { status: 422 })) });
    invoke.mockImplementation(async () => refusal());
    for (let i = 0; i < 3; i++) {
      const r = await resilientCallers.parseDocx(new FormData(), { enableTelemetry: false });
      expect(r.attempts).toBe(1);
      expect(r.errorBody?.code).toBe("damaged_file");
    }
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(canAttemptService("parse-docx")).toBe(true);

    invoke.mockImplementation(async () => ({ data: { success: true, text: "Jane Doe" }, error: null }));
    const ok = await resilientCallers.parseDocx(new FormData(), { enableTelemetry: false });
    expect(ok.data).toEqual({ success: true, text: "Jane Doe" });
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("a 500 is answered once, not three times", async () => {
    invoke.mockImplementation(async () => ({ data: null, error: new FunctionsHttpError(new Response("{}", { status: 500 })) }));
    const r = await resilientCallers.parsePdf(new FormData(), { enableTelemetry: false, initialDelay: 1 });
    expect(r.attempts).toBe(1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
