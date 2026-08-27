import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE API SELLS THE SAME CLAIM THE PAGE MAKES, OR IT SELLS THE OPPOSITE.
 *
 * "No ghost jobs" is this product's central promise, and it rests on two
 * predicates: `missing_since IS NULL` (the employer has not withdrawn it) and a
 * 30-day freshness window. The board has had to patch those into query shapes
 * that were missed FOUR separate times — buildQuery, both search RPCs, the
 * detail action, and the semantic tier — each time after a path was found
 * serving postings that were already gone.
 *
 * An API is the worst place for that to happen again, because the caller is a
 * machine that cannot see the difference and is often reselling the data
 * onward. So every read here carries both fences, and this test counts them
 * rather than trusting a reviewer to.
 *
 * It also pins the two things a key store gets wrong: storing the raw key, and
 * sharing a limiter with the front door. The second is not hypothetical here —
 * board browsing once silently 429'd résumé upload and Stripe checkout through
 * a shared budget, and an API serving machine traffic is the most effective
 * possible way to do that again.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/public-api/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
/** Newest migration containing `needle`. Function and table definitions stop
 *  living in the same file the moment a function is re-issued, and conflating
 *  the two is how these assertions started reading the wrong migration. */
const newestWith = (needle: string) => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .filter((x) => readFileSync(resolve(dir, x), "utf8").includes(needle)).sort().pop();
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
};
/** The live definition of the checker. */
const MIG = newestWith("FUNCTION public.api_key_check(");
/** Where the tables and their RLS actually live. */
const MIG_TBL = newestWith("CREATE TABLE IF NOT EXISTS public.api_keys");

describe("a public API is a promise to someone else's code", () => {
  it("every posting read is fenced BOTH ways, counted per read path", () => {
    // COUNTED IN PAIRS NOW, because checking that "a fence" exists is what let
    // /v1/jobs/{id} ship with one. It bound missing_since and stopped, so it
    // served postings past the 30-day window that /v1/jobs — and the board
    // itself — both refuse. That was the FIFTH query shape in this codebase to
    // miss a fence, and the previous four were all caught the same way: by
    // someone noticing, not by a guard.
    // AND TIED TO THE NUMBER OF READ SITES, not to a floor. Counting only
    // "at least two of each, and equal to each other" passes just as happily
    // with three read paths and two fenced ones — the sixth unfenced read would
    // have sailed through the guard that exists to catch exactly that. The
    // count of corpus reads is the thing the fences must keep up with.
    const sites = (CODE.match(/from\("job_board_postings"\)/g) ?? []).length;
    const withdrawn = (CODE.match(/\.is\("missing_since", null\)/g) ?? []).length;
    const aged = (CODE.match(/\.gte\("effective_posted", freshCutoff\(\)\)/g) ?? []).length;
    expect(sites, "no posting reads found — the assertions below would be vacuous")
      .toBeGreaterThanOrEqual(2);
    expect(withdrawn, `${sites} posting reads but only ${withdrawn} exclude withdrawn rows`)
      .toBe(sites);
    expect(aged, `${sites} posting reads but only ${aged} exclude rows past the serving window`)
      .toBe(sites);
  });

  it("/v1/stats publishes the FENCED count, not the inflated corpus total", () => {
    // It published `v.total` as livePostings — the field job-board's own comment
    // calls inflated ("includes just-pruned orphans until the next pass
    // recomputes") — overstating the API by ~150,000 postings against what
    // /v1/jobs can actually return.
    expect(CODE).toMatch(/livePostings: open,/);
    expect(CODE).toMatch(/trackedPostings: tracked,/);
    expect(CODE, "livePostings falls back to the inflated total when the fenced count is absent")
      .not.toMatch(/livePostings:[^,]*v\.total/);
  });

  it("the listing is fenced to the freshness window", () => {
    expect(CODE).toMatch(/\.gte\("effective_posted", freshCutoff\(\)\)/);
    expect(CODE).toMatch(/const FRESH_WINDOW_DAYS = 30;/);
  });

  it("a withdrawn posting is 404, never a stale 200", () => {
    // The distinction IS the product: a caller must be able to tell "gone"
    // from "we stopped looking".
    expect(CODE).toMatch(/return fail\(404, "not_found"/);
  });

  it("columns are listed explicitly, never select(*)", () => {
    // select("*") would publish every column added to the table later.
    expect(CODE).not.toMatch(/\.select\("\*"/);
    expect(CODE).toMatch(/const JOB_FIELDS = \[/);
  });

  it("the raw key is never stored — only its hash is looked up", () => {
    expect(CODE, "the raw key is sent to the database").toMatch(/p_key_hash: await sha256Hex\(raw\)/);
    expect(MIG_TBL).toMatch(/key_hash text NOT NULL UNIQUE/);
    expect(MIG_TBL, "a column that would hold the raw secret").not.toMatch(/\bkey_raw\b|\bsecret text\b|\bkey text NOT NULL\b/);
  });

  it("it does NOT share the front door's rate budget", () => {
    // check_global_rate_limit sums rate_limits rows per IP; 20260803170000 had
    // to scope that sum after board browsing starved upload and checkout.
    expect(CODE, "the API writes to the shared rate_limits table")
      .not.toMatch(/check_rate_limit|rate_limits/);
    expect(MIG_TBL).toMatch(/CREATE TABLE IF NOT EXISTS public\.api_rate/);
    // Keyed on the API key, not the IP — two callers behind one NAT are two
    // budgets, which is the right answer for an API.
    expect(MIG_TBL).toMatch(/PRIMARY KEY \(key_id, minute\)/);
  });

  it("the limiter increments atomically, so two callers cannot both pass", () => {
    // The upsert IS the increment; a read-then-write would let concurrent calls
    // both observe the last allowed value.
    expect(MIG).toMatch(/ON CONFLICT \(key_id, minute\) DO UPDATE SET calls = (?:public\.api_rate|r)\.calls \+ 1/);
    expect(MIG).toMatch(/RETURNING (?:r\.)?calls INTO v_rate/);
  });

  it("the key tables are not readable by anon", () => {
    for (const t of ["api_keys", "api_usage", "api_rate"]) {
      expect(MIG_TBL, `${t} has no RLS`).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    }
    // Definer function that reads keys and mutates counters: locked down the
    // same way the rest of this schema's definer functions are.
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION public\.api_key_check\(text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION public\.api_key_check\(text, text\) TO service_role;/);
  });

  it("refusals carry a machine-readable code and the numbers behind them", () => {
    for (const code of ["rate_limited", "quota_exceeded", "key_revoked", "invalid_key", "missing_key"]) {
      expect(CODE, `no ${code} refusal`).toMatch(new RegExp(`"${code}"`));
    }
    expect(CODE).toMatch(/"Retry-After": "60"/);
    expect(CODE).toMatch(/X-RateLimit-Remaining/);
  });

  it("counts and cached figures say what they are", () => {
    // A number whose basis is not stated gets read as exact — the mistake this
    // repo has made with stat provenance more than once.
    expect(CODE).toMatch(/basis: "estimated"/);
    expect(CODE).toMatch(/asOf/);
    expect(CODE).toMatch(/statedPayShare/);
  });

  it("is read-only", () => {
    expect(CODE).toMatch(/if \(req\.method !== "GET"\) return fail\(405/);
    for (const w of [".insert(", ".update(", ".delete(", ".upsert("]) {
      expect(CODE, `the API performs a ${w} write`).not.toContain(w);
    }
  });
});
