// Shared per-company context loader for the board's decision surfaces (detail
// panel, compare modal). One promise-cached fetch per EMPLOYER bundles the
// three sourced RPCs — headcount intel, SEC financials, H-1B declared wages —
// so arrowing through postings never refires them. Every field is optional:
// callers render only what exists (absent data shows nothing, never a guess).
//
// ONE EMPLOYER IS ITS HIRING SYSTEM PLUS ITS BOARD (employer_key, migration
// 20261012100000; mirror src/lib/employer-key.ts). The cache is keyed the way
// the readers pool: two career sites of one Workday tenant or one UKG client
// share an entry, and the Workable board "blackstone" never shares one with
// the Workday tenant blackstone~wd1~... A caller that does not pass the
// posting's source gets an entry for that token alone. A token two hiring
// systems carry (src/lib/board-collisions.ts) gets no facts and no request:
// every reader answers it for both boards at once.

import { supabase } from "@/integrations/supabase/client";
import { H1B_DATA_AVAILABLE } from "@/lib/h1b-availability";
import { boardIdentity } from "@/lib/employer-key";
import { isCollidedToken } from "@/lib/board-collisions";

export interface EmployerCtx {
  employees?: number | null;
  employeeBasis?: string | null;
  ticker?: string | null;
  exchange?: string | null;
  fyYear?: number | null;
  revenue?: number | null;
  netIncome?: number | null;
  currency?: string | null;
  h1bFy?: string | null;
  h1bTotal?: number | null;
  h1bMedian?: number | null;
  h1bRoles?: Array<{ title: string; n: number; median: number }>;
}

const rpc = (f: string, a?: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }> }).rpc(f, a);

const cache = new Map<string, Promise<EmployerCtx>>();

/** The key getEmployerCtx caches a board's facts under; callers index their own maps by it. */
export function employerCtxKey(companyToken: string, source?: string | null): string {
  return boardIdentity(source, companyToken);
}

export function getEmployerCtx(companyToken: string, source?: string | null): Promise<EmployerCtx> {
  if (isCollidedToken(companyToken)) return Promise.resolve({});
  const key = employerCtxKey(companyToken, source);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<EmployerCtx> => {
    // Promise.resolve first: the supabase query builder is a thenable without
    // .catch — chaining it directly throws synchronously (established pattern
    // across the codebase).
    const [intel, fin, h1b] = await Promise.all([
      Promise.resolve(rpc("get_company_intel", { p_token: companyToken })).catch(() => ({ data: null })),
      Promise.resolve(rpc("get_company_financials", { p_token: companyToken })).catch(() => ({ data: null })),
      // Defined by no migration — see h1b-availability.ts.
      H1B_DATA_AVAILABLE
        ? Promise.resolve(rpc("get_company_h1b", { p_token: companyToken })).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
    ]);
    const ctx: EmployerCtx = {};
    const i = intel.data as { employees?: number; employee_basis?: string } | null;
    if (i && typeof i === "object") {
      ctx.employees = i.employees ?? null;
      ctx.employeeBasis = i.employee_basis ?? null;
    }
    const f = fin.data as { ticker?: string; exchange?: string; currency?: string; series?: Array<{ fy: number; revenue: number | null; net_income: number | null }> } | null;
    if (f && typeof f === "object" && f.ticker && Array.isArray(f.series) && f.series.length) {
      ctx.ticker = f.ticker; ctx.exchange = f.exchange ?? null; ctx.currency = f.currency ?? "USD";
      ctx.fyYear = f.series[0].fy; ctx.revenue = f.series[0].revenue; ctx.netIncome = f.series[0].net_income;
    }
    const h = h1b.data as { fiscal_year?: string; total_certified?: number; median_annual?: number; roles?: Array<{ title: string; n: number; median: number }> } | null;
    if (h && typeof h === "object" && h.total_certified) {
      ctx.h1bFy = h.fiscal_year ?? null; ctx.h1bTotal = h.total_certified;
      ctx.h1bMedian = h.median_annual ?? null; ctx.h1bRoles = h.roles ?? [];
    }
    return ctx;
  })();
  cache.set(key, p);
  return p;
}

// Role matching for the declared-wages line: a posting title and an SOC title
// share a load-bearing word ("engineer", "analyst"...). Conservative: generic
// tokens don't count, and no match means the line simply doesn't render.
const GENERIC = new Set(["senior", "junior", "staff", "lead", "principal", "associate", "assistant", "specialist", "the", "and", "of", "ii", "iii", "iv", "sr", "jr"]);
export function matchDeclaredRole(postingTitle: string, roles?: Array<{ title: string; n: number; median: number }>): { title: string; n: number; median: number } | null {
  if (!roles?.length) return null;
  const words = new Set(postingTitle.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !GENERIC.has(w)));
  if (!words.size) return null;
  for (const r of roles) {
    const rw = r.title.toLowerCase().split(/[^a-z]+/);
    if (rw.some((w) => words.has(w))) return r;
  }
  return null;
}
