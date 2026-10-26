/**
 * PREVIEW DATA: what the preview pages answer instead of the live board.
 *
 * `?data=fixture` (the default) answers the page's four reads from a recorded
 * read of the live board, with every time stamp moved forward by the time
 * since capture, so a posting that was "posted today" at capture still is.
 * `?data=live` leaves the client alone: the page reads production exactly as
 * a visitor would (read-only calls the site already makes).
 *
 * This file is preview tooling. It patches the shared Supabase client object
 * in the preview page only; nothing in the app imports it.
 */
import { supabase } from "@/integrations/supabase/client";
import fixture from "./fixtures/home-board-2026-10-18.json";

type Json = Record<string, unknown>;

const STAMP_KEYS = new Set(["as_of", "computed_at", "postedAt", "recheckedAt", "refreshedAt"]);

/** Every stamp in the fixture, moved forward by `shiftMs`. */
export function rebase<T>(value: T, shiftMs: number): T {
  if (Array.isArray(value)) return value.map((v) => rebase(v, shiftMs)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) {
      out[k] = STAMP_KEYS.has(k) && typeof v === "string" && Number.isFinite(Date.parse(v))
        ? new Date(Date.parse(v) + shiftMs).toISOString()
        : rebase(v, shiftMs);
    }
    return out as T;
  }
  return value;
}

export type RowsMode = "fixture" | "loading" | "hidden" | "slow" | "worst";

/**
 * MEASUREMENT ONLY (rows=worst): the fixture's rows with every field the card
 * can print filled in at its longest, to measure the tallest card the list box
 * must reserve. Never shown anywhere but the preview.
 */
function worstCase(jobs: Json[]): Json[] {
  return jobs.map((j, i) => ({
    ...j,
    title: "Senior Registered Nurse, Cardiovascular Intensive Care Unit, Night Shift with Weekend Differential and Sign-On Bonus",
    company: `Northwestern Memorial HealthCare Corporation ${i + 1}`,
    location: "Lake Forest Hospital (North Shore Campus), Lake Forest, Illinois",
    country: "US",
    department: "Nursing Services and Patient Care Operations",
    salary: "$48.50 - $72.75 per hour",
    salaryMinAnnual: 100880,
    salaryMaxAnnual: 151320,
    salaryPeriod: "hour",
    salaryCurrency: "USD",
    workMode: "hybrid",
    employmentType: "full_time",
    locationCount: 4,
    otherLocations: ["Chicago, IL", "Evanston, IL", "Skokie, IL"],
  }));
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Answer the homepage's reads from the fixture. `rows` picks the list's state. */
export function installFixture(opts: { rows?: RowsMode; listDelayMs?: number } = {}): void {
  const shift = Date.now() - Date.parse(String(fixture.capturedAt));
  const data = rebase(fixture as unknown as Json, shift) as typeof fixture;
  type Invoke = (fn: string, o?: { body?: Json }) => Promise<{ data: unknown; error: unknown }>;
  const sb = supabase as unknown as {
    rpc: (fn: string, args?: Json) => Promise<{ data: unknown; error: unknown }>;
    functions: { invoke: Invoke };
  };
  const realRpc = sb.rpc.bind(sb);
  // `functions` is a getter that builds a new client on every read, so the
  // getter itself is replaced; patching one instance's invoke would miss.
  const realFunctions = sb.functions;
  const realInvoke: Invoke = realFunctions.invoke.bind(realFunctions);
  const fakeFunctions = { invoke: realInvoke };
  Object.defineProperty(supabase, "functions", { configurable: true, get: () => fakeFunctions });
  sb.rpc = async (fn, args) => {
    if (fn === "get_board_vendor_counts") return { data: data.get_board_vendor_counts, error: null };
    if (fn === "get_freshness_stats") return { data: data.get_freshness_stats, error: null };
    if (fn === "get_company_fill_curve") {
      const want = new Set(((args?.p_tokens as string[]) ?? []));
      return { data: data.get_company_fill_curve.filter((r) => want.has(r.company_token)), error: null };
    }
    return realRpc(fn, args);
  };
  fakeFunctions.invoke = async (fn, o) => {
    if (fn === "job-board" && (o?.body?.action ?? "list") === "list") {
      if (opts.rows === "loading") return new Promise(() => {});
      if (opts.rows === "hidden") return { data: null, error: { message: "preview: list refused" } };
      await wait(opts.rows === "slow" ? 2500 : opts.listDelayMs ?? 350);
      if (opts.rows === "worst") return { data: { ...data.job_board_list, jobs: worstCase(data.job_board_list.jobs as unknown as Json[]) }, error: null };
      return { data: data.job_board_list, error: null };
    }
    return realInvoke(fn, o);
  };
}
