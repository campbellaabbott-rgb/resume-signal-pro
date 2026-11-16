/**
 * THE SHIPPED parse-pdf AND parse-docx HANDLERS, RUN UNDER NODE WITH THEIR
 * NETWORK FAKED.
 *
 * Each handler is bundled from its index.ts (helpers/edge-harness.ts) with
 * the npm builds of the libraries it imports from esm.sh: pdfjs-serverless
 * 0.4.1 for parse-pdf, mammoth and jszip for parse-docx. Both limiters answer
 * yes, log_parse_failure is recorded, every background task is kept so a test
 * can wait for it, and a fetch to the alert mailer is recorded and answered
 * without leaving the process.
 *
 * Use from a file marked `@vitest-environment node`: esbuild refuses jsdom's
 * TextEncoder, and pdfjs-serverless mistakes jsdom for a browser.
 */
import mammothNpm from "mammoth";
import JSZipNpm from "jszip";
import { resolvePDFJS } from "pdfjs-serverless";
import { FakeDb, loadEdgeHandler, type EdgeHandler } from "./edge-harness";

export type ParserRun = { status: number; body: Record<string, unknown> };
export type Mail = { url: string; body: string };

export type ParserHarness = {
  /** POST one file as multipart, from the address the platform names. */
  upload(name: string, bytes: Uint8Array | string, type?: string, headers?: Record<string, string>): Promise<ParserRun>;
  /** The database of the request in flight; a new one per upload. */
  db: FakeDb;
  /** Every log_parse_failure call, in order. */
  failures: Array<Record<string, unknown>>;
  /** Waits for every background task the handler started. */
  settle(): Promise<void>;
};

const g = globalThis as Record<string, unknown>;
/** Shared by both handlers: what Deno.env answers, and what the alert mailer was sent. */
export const parserEnv: Record<string, string> = { SUPABASE_URL: "https://harness.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service_harness_key" };
export const mailsSent: Mail[] = [];
const pending: Promise<unknown>[] = [];
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  g.Deno = { env: { get: (k: string) => parserEnv[k] } };
  g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { pending.push(Promise.resolve(p).catch(() => {})); } };
  g.__phMammoth = mammothNpm;
  g.__phJSZip = JSZipNpm;
  g.__phResolvePDFJS = resolvePDFJS;
  const real = g.fetch as typeof fetch;
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.resend.com/")) {
      mailsSent.push({ url, body: String(init?.body ?? "") });
      return new Response("{}", { status: 200 });
    }
    return real(input as RequestInfo, init);
  };
}

const COMMON = (client: string): Record<string, string> => ({
  "https://deno.land/std@0.168.0/http/server.ts": "export function serve(h) { globalThis.__edgeHandler = h; }",
  "https://esm.sh/@supabase/supabase-js@2": `export function createClient() { return globalThis.${client}; }`,
});

export async function parserHarness(fn: "parse-pdf" | "parse-docx"): Promise<ParserHarness> {
  install();
  const client = fn === "parse-pdf" ? "__phPdfClient" : "__phDocxClient";
  const stubs: Record<string, string> = fn === "parse-pdf"
    ? { ...COMMON(client), "https://esm.sh/pdfjs-serverless@0.4.1?target=deno": "export const resolvePDFJS = (...a) => globalThis.__phResolvePDFJS(...a);" }
    : { ...COMMON(client), "https://esm.sh/mammoth@1.12.3": "export default globalThis.__phMammoth;", "https://esm.sh/jszip@3.10.1": "export default globalThis.__phJSZip;" };
  const handler: EdgeHandler = await loadEdgeHandler(fn, stubs);
  const type = fn === "parse-pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const h: ParserHarness = {
    db: new FakeDb(),
    failures: [],
    settle: async () => { while (pending.length) await Promise.all(pending.splice(0)); },
    upload: async (name, bytes, fileType = type, headers = {}) => {
      const db = new FakeDb();
      db.rpcs.check_global_rate_limit = () => ({ data: true, error: null });
      db.rpcs.check_rate_limit = () => ({ data: true, error: null });
      db.rpcs.log_parse_failure = (a) => { h.failures.push(a); return { data: null, error: null }; };
      h.db = db;
      g[client] = { from: (t: string) => db.from(t), rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a) };
      const form = new FormData();
      form.append("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type: fileType }));
      const res = await handler(new Request(`https://harness.supabase.co/functions/v1/${fn}`, { method: "POST", headers, body: form }));
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
  return h;
}
