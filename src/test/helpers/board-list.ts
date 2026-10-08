/**
 * THE BOARD'S list, RUN: the shipped job-board handler bundled by edge-harness
 * with only the Supabase client faked by ProxyDb, called with the service key
 * so the anonymous budgets stay out of the way. A test answers the queries it
 * cares about (search_jobs, a buildQuery read, count_jobs_capped) and reads the
 * response the page would render. Every other query answers empty.
 */
import { loadEdgeHandler, type EdgeHandler } from "./edge-harness";
import { ProxyDb, type Answer, type Query } from "./proxy-db";

export const SVC = "svc-key-for-tests";

export interface BoardList {
  db: ProxyDb;
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  answer: (fn: (q: Query) => Answer | undefined) => void;
  reset: () => void;
}

export async function bootBoardList(): Promise<BoardList> {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SVC };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.EdgeRuntime = { waitUntil: (_p: Promise<unknown>) => {} };
  globalThis.fetch = (async () => new Response("no network in tests", { status: 503 })) as typeof fetch;
  const handler: EdgeHandler = await loadEdgeHandler("job-board", {
    "https://esm.sh/@supabase/supabase-js@2": "export function createClient() { return globalThis.__jbDb; }",
  });
  let answers: Array<(q: Query) => Answer | undefined> = [];
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
  return {
    db,
    answer: (fn) => { answers.push(fn); },
    reset: () => { answers = []; db.queries = []; },
    post: async (body) => {
      const res = await handler(new Request("https://h.supabase.co/functions/v1/job-board", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SVC}`, origin: "https://resumebooster.work" },
        body: JSON.stringify(body),
      }));
      return await res.json() as Record<string, unknown>;
    },
  };
}

/** A posting row as search_jobs / buildQuery return it. */
export function row(id: string, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, source: "greenhouse", company_token: id.split(":")[1] ?? "acme", company: "Acme", title,
    location: "London, United Kingdom", country: "GB", remote: false, work_mode: null, employment_type: null,
    department: null, category: "healthcare", posted_at: new Date().toISOString(), apply_url: `https://x/${id}`,
    salary: null, salary_min_annual: null, salary_max_annual: null, salary_period: null, salary_currency: null,
    experience_band: "unspecified", min_years: null, last_seen: new Date().toISOString(), agency: false,
    missing_since: null, effective_posted: new Date().toISOString(), ...extra,
  };
}

/** Does this query call `method` with first argument `a0` (and, if given, second `a1`)? */
export const calls = (q: Query, method: string, a0?: unknown, a1?: unknown): boolean =>
  q.calls.some(([m, a]) => m === method && (a0 === undefined || a[0] === a0) && (a1 === undefined || a[1] === a1));
