/**
 * THE SHIPPED job-board HANDLER WITH THE CALLER'S OWN HEADERS.
 *
 * board-list.ts posts every request with the service key, which is exactly
 * the credential that can never show what an anonymous caller or one of our
 * servers (the reader proof) is allowed. This boots the same bundle the same
 * way, with only the Supabase client faked by ProxyDb, and lets a test choose
 * the headers per request.
 */
import { loadEdgeHandler, type EdgeHandler } from "./edge-harness";
import { ProxyDb, type Answer, type Query } from "./proxy-db";
import { boardReaderKey } from "../../../supabase/functions/_shared/board-reader-key";

export const SVC = "svc-key-for-tests";
export const ANON = "anon-key-for-tests";

export interface BoardHandler {
  db: ProxyDb;
  /** The headers our own servers send: the anon bearer plus the reader proof. */
  readerHeaders: () => Promise<Record<string, string>>;
  post: (body: Record<string, unknown>, headers?: Record<string, string>) => Promise<Record<string, unknown>>;
  answer: (fn: (q: Query) => Answer | Promise<Answer | undefined> | undefined) => void;
  reset: () => void;
}

export async function bootBoardHandler(): Promise<BoardHandler> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  globalThis.fetch = (async () => new Response("no network in tests", { status: 503 })) as typeof fetch;
  const handler: EdgeHandler = await loadEdgeHandler("job-board", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
  });
  let answers: Array<(q: Query) => Answer | Promise<Answer | undefined> | undefined> = [];
  const db = new ProxyDb();
  const isMeta = (q: Query, k: string) => q.table === "job_board_meta" && q.calls.some(([m, a]) => m === "eq" && a[0] === "k" && a[1] === k);
  db.answer = (q) => {
    for (const a of answers) { const r = a(q); if (r) return r; }
    if (isMeta(q, "refresh_head")) {
      return { data: { v: { companiesCount: 10, total: 100000, coverage: { open: 100000 } }, updated_at: new Date().toISOString() }, error: null };
    }
    return undefined;
  };
  g.__jbDb = db;
  const proof = await boardReaderKey(SVC);
  return {
    db,
    readerHeaders: async () => ({ authorization: `Bearer ${ANON}`, apikey: ANON, "x-rb-reader": proof }),
    answer: (fn) => { answers.push(fn); },
    reset: () => { answers = []; db.queries = []; },
    post: async (body, headers = { authorization: `Bearer ${SVC}` }) => {
      const res = await handler(new Request("https://h.supabase.co/functions/v1/job-board", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }));
      return await res.json() as Record<string, unknown>;
    },
  };
}
