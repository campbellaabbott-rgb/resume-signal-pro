// @vitest-environment node
/**
 * EVERY CALLER THAT READS THE BOARD NAMES ITS BUDGET.
 *
 * Since .85 job-board counts anonymous reads per address (anon-budget.ts). A
 * caller of ours that reads it with the publishable key and says nothing is
 * counted as a browser -- and several of ours are one address making hundreds
 * of calls: the prerender bake (~709 per bake from Lovable's build server),
 * verify-deploy (~200 a run), the probe scripts, the botwall sweep and the
 * board-health monitor on GitHub runners. So:
 *
 *   - every file under scripts/, worker/src/ and .github/workflows/ whose CODE
 *     calls the board names x-rb-budget: the bake 'build' at both of its fetch
 *     sites, everything else 'probe'. The walk is fs only (the worktree path
 *     has spaces; a shell walk once answered "found nothing" about code it
 *     never read), throws on a missing directory, and carries a positive
 *     control of at least twelve files;
 *   - the build allowance holds 50 full bakes, each term read from the bake's
 *     own constants, so the bake cannot be capped by the bucket it lives in;
 *   - agent-mcp, public-api and send-search-digest send the reader proof
 *     derived from the service key, and keep the ANON bearer: the proof
 *     skips the browser meter and grants no search power;
 *   - verify-deploy's section 7j judges correctly, run against fixtures.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { BUDGETED_ACTIONS, BUILD_DAILY_CAP, PROBE_DAILY_CAP } from "../../supabase/functions/job-board/anon-budget";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Code without comments: `#` lines for shell and YAML, the shared stripper for JS/TS. */
const codeOfFile = (rel: string, text: string) =>
  /\.(sh|ya?ml)$/.test(rel) ? text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n") : codeOf(text);

function walk(dir: string): string[] {
  const abs = resolve(ROOT, dir);
  let st;
  try { st = statSync(abs); } catch { throw new Error(`the walk could not read ${dir} — the GUARD is broken, not the code`); }
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory — the GUARD is broken`);
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".") && e.name !== ".github") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) go(p);
      else if (/\.(mjs|cjs|js|ts|sh|ya?ml)$/.test(e.name)) out.push(relative(ROOT, p));
    }
  };
  go(abs);
  return out;
}

const CALLERS = ["scripts", "worker/src", ".github/workflows"]
  .flatMap(walk)
  .map((rel) => ({ rel, code: codeOfFile(rel, read(rel)) }))
  .filter((f) => f.code.includes("functions/v1/job-board"));

describe("every caller that reads the board names its budget", () => {
  it("positive control: the walk finds the callers it is meant to police", () => {
    const names = CALLERS.map((c) => c.rel);
    expect(names.length, `found only: ${names.join(", ")}`).toBeGreaterThanOrEqual(12);
    for (const must of ["scripts/verify-deploy.sh", ".github/workflows/board-health.yml", "scripts/prerender-seo.mjs", "worker/src/botwall-sweep.ts"]) {
      expect(names, `${must} is a known caller the walk did not find`).toContain(must);
    }
  });

  it("each one names x-rb-budget in code, once per place it calls the board", () => {
    const silent = CALLERS.filter((c) => !/x-rb-budget/.test(c.code)).map((c) => c.rel);
    expect(silent, "these read the board as if they were a browser; send x-rb-budget: probe (or build for the bake)").toEqual([]);
    // PER SITE, not per file: a file that declares itself at one call and not
    // at another passes a per-file check while the undeclared call is counted
    // as a browser. verify-deploy is checked by its helpers instead, because
    // section 7j makes two undeclared board calls ON PURPOSE (it needs one
    // read counted as kind address) and one GET of the retired sitemap.
    for (const c of CALLERS.filter((x) => x.rel !== "scripts/verify-deploy.sh")) {
      const sites = (c.code.match(/functions\/v1\/job-board/g) ?? []).length;
      const headers = (c.code.match(/x-rb-budget/g) ?? []).length;
      expect(headers, `${c.rel}: ${sites} board call site(s), ${headers} declaration(s)`).toBeGreaterThanOrEqual(sites);
    }
    const vd = CALLERS.find((x) => x.rel === "scripts/verify-deploy.sh")!.code;
    const jLine = vd.split("\n").find((l) => /^J\(\) \{/.test(l)) ?? "";
    expect(jLine, "verify-deploy's J() — every section's board read goes through it").toMatch(/-H "x-rb-budget: probe"/);
    const nodeJs = vd.split("\n").filter((l) => /const J=async\(b\)=>/.test(l));
    expect(nodeJs.length, "verify-deploy's node J helpers moved — re-count").toBeGreaterThanOrEqual(2);
    for (const l of nodeJs) expect(l).toMatch(/"x-rb-budget":"probe"/);
  });

  it("the bake says build at both of its fetch sites, and nothing else says build", () => {
    const bake = CALLERS.find((c) => c.rel === "scripts/prerender-seo.mjs")!;
    expect((bake.code.match(/functions\/v1\/job-board/g) ?? []).length, "the bake's fetch sites moved — re-count").toBe(2);
    expect((bake.code.match(/"x-rb-budget": "build"/g) ?? []).length).toBe(2);
    expect(bake.code).not.toMatch(/x-rb-budget"?:?\s*"?probe/);
    for (const c of CALLERS.filter((x) => x.rel !== "scripts/prerender-seo.mjs")) {
      expect(c.code, `${c.rel} must declare probe`).toMatch(/x-rb-budget"?\s*[:=]\s*"?probe|x-rb-budget: probe/);
      expect(c.code, `${c.rel} must not borrow the bake's allowance`).not.toMatch(/x-rb-budget"?\s*[:=]?\s*"?build/);
    }
  });

  it("the build allowance holds fifty full bakes, read from the bake's own constants", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    const num = (name: string) => {
      const all = [...bake.matchAll(new RegExp(`const ${name} = (\\d+);`, "g"))].map((m) => Number(m[1]));
      expect(all.length, `${name} not found in prerender-seo.mjs`).toBeGreaterThan(0);
      return Math.max(...all);
    };
    const perBake = 1 + num("POSTING_LIST_PAGES") + num("POSTING_PAGE_CARRY_MAX") + num("POSTING_PAGE_CAP");
    expect(perBake, "the bake's own call ceiling (facets head + list pages + carried + fresh details)").toBe(709);
    expect(BUILD_DAILY_CAP).toBeGreaterThanOrEqual(50 * perBake);
    // verify-deploy's own J() calls (~200 a run) fit many runs in a day.
    expect(PROBE_DAILY_CAP).toBeGreaterThanOrEqual(5_000);
  });

  it("our three edge callers send the reader proof and keep the anon bearer", () => {
    for (const fn of ["agent-mcp", "public-api"]) {
      const src = codeOf(read(`supabase/functions/${fn}/index.ts`));
      expect(src, fn).toMatch(/import \{ boardReaderHeader \} from "\.\.\/_shared\/board-reader-key\.ts";/);
      const at = src.indexOf("async function board(");
      const board = src.slice(at, src.indexOf("\n}\n", at));
      expect(at, `${fn} board() not found`).toBeGreaterThan(0);
      expect(board).toMatch(/\.\.\.\(await boardReaderHeader\(Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\) \?\? ""\)\)/);
      expect(board, "the bearer stays the anon key: the proof grants no search power").toMatch(/Authorization: `Bearer \$\{anon\}`/);
      expect(board).toMatch(/Deno\.env\.get\("SUPABASE_ANON_KEY"\)/);
    }
    const dig = codeOf(read("supabase/functions/send-search-digest/index.ts"));
    expect(dig).toMatch(/const readerProof = await boardReaderHeader\(Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\) \?\? ""\);/);
    expect(dig).toMatch(/Authorization: `Bearer \$\{anonKey\}`[^\n]*\.\.\.readerProof/);
    expect(codeOf(read("supabase/functions/agent-mcp/index.ts"))).toMatch(/version: "2026-09-04\.11"/);
  });

  it("the uncounted calls our monitors make stay uncounted", () => {
    for (const a of ["status", "vendor-health", "click", "report", "budget-echo", "refresh", "fit-batch", "fit-terms", "searchQuality"]) {
      expect(BUDGETED_ACTIONS.has(a), a).toBe(false);
    }
  });
});

// ── verify-deploy 7j, judged against fixtures ───────────────────────────────

const SCRIPT = read("scripts/verify-deploy.sh");
const s7j = SCRIPT.slice(SCRIPT.indexOf('echo "== 7j.'), SCRIPT.indexOf('echo "done."'));
const body7j = /node -e '([^']*)'/.exec(s7j)?.[1] ?? "";

type Row = { bh_hour: string; bh_kind: string; bh_country: string; bh_requests: number; bh_over_cap?: number; bh_addresses?: number; bh_addresses_over_cap?: number; bh_top_address_requests?: number; bh_bare_requests?: number };
const r = (kind: string, country: string, n: number, hour = "2026-10-02T14:00:00Z"): Row =>
  ({ bh_hour: hour, bh_kind: kind, bh_country: country, bh_requests: n, bh_over_cap: 0, bh_addresses: 1, bh_addresses_over_cap: 0, bh_top_address_requests: n, bh_bare_requests: 0 });
const GOOD = {
  status: { version: "2026-09-09.85", anonBudget: { settingPresent: true, enforce: false, countriesListed: 0, countryCap: null, overrides: {}, defaults: { address: 10000, build: 40000, probe: 5000 } } },
  trace: "fl=1\nip=203.0.113.9\nloc=US\n",
  plain: { address: "203.0.113.9", source: "cf", country: "US", kind: "address", exempt: false },
  probe: { address: "203.0.113.9", source: "cf", country: "US", kind: "probe", exempt: false },
  mcp: { address: "203.0.113.9", source: "cf", country: "US", kind: "unproven_mcp", exempt: false },
  init: { result: { serverInfo: { version: "2026-09-04.11" } } },
  mcpCall: { result: { content: [] } },
  v1: "200",
  before: [r("probe", "ALL", 10), r("probe", "US", 10), r("address", "ALL", 100), r("address", "CN", 80), r("address", "US", 20)],
  after: [
    r("probe", "ALL", 10), r("probe", "US", 10), r("address", "ALL", 100), r("address", "CN", 80), r("address", "US", 20),
    r("probe", "ALL", 1, "2026-10-02T15:00:00Z"), r("probe", "US", 1, "2026-10-02T15:00:00Z"),
    r("address", "ALL", 3, "2026-10-02T15:00:00Z"), r("address", "US", 3, "2026-10-02T15:00:00Z"),
  ] as Row[],
};
type Fixture = typeof GOOD;
function run7j(patch: Partial<Fixture> = {}): string[] {
  const f = { ...GOOD, ...patch };
  const dir = mkdtempSync(join(tmpdir(), "vd7j-"));
  const files: Record<string, string> = {
    "/tmp/vd_7j_status.json": JSON.stringify(f.status), "/tmp/vd_7j_trace.txt": f.trace,
    "/tmp/vd_7j_echo_plain.json": JSON.stringify(f.plain), "/tmp/vd_7j_echo_probe.json": JSON.stringify(f.probe),
    "/tmp/vd_7j_echo_mcp.json": JSON.stringify(f.mcp), "/tmp/vd_7j_mcp_init.json": JSON.stringify(f.init),
    "/tmp/vd_7j_mcp_call.json": JSON.stringify(f.mcpCall), "/tmp/vd_7j_v1.txt": f.v1,
    "/tmp/vd_7j_before.json": JSON.stringify(f.before), "/tmp/vd_7j_after.json": JSON.stringify(f.after),
  };
  let js = body7j;
  for (const [tmp, content] of Object.entries(files)) {
    const local = join(dir, tmp.slice("/tmp/".length));
    writeFileSync(local, content);
    js = js.split(tmp).join(local);
  }
  return execFileSync(process.execPath, ["-e", js], { encoding: "utf8" }).split("\n").filter(Boolean);
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("verify-deploy 7j judges the budget correctly", () => {
  it("the section exists after 7i, and its first block reads its own files", () => {
    expect(SCRIPT.indexOf('echo "== 7j.'), "no section 7j").toBeGreaterThan(SCRIPT.indexOf('echo "== 7i.'));
    expect(body7j).toContain("/tmp/vd_7j_status.json");
    expect(body7j).toContain("/tmp/vd_7j_after.json");
  });

  it("a good observe-first deploy is all PASS, and says the switch is OFF", () => {
    const out = run7j();
    expect(fails(out), out.join("\n")).toEqual([]);
    expect(out.some((l) => /^PASS {2}country switch OFF/.test(l))).toBe(true);
    expect(out.some((l) => /^PASS .*kind probe grew by 1/.test(l)), "a delta summed across an hour rollover").toBe(true);
  });

  it("a switch that is on, or malformed, is a FAIL", () => {
    expect(fails(run7j({ status: { ...GOOD.status, anonBudget: { ...GOOD.status.anonBudget, countriesListed: 1 } } })).some((l) => /switch is ON/.test(l))).toBe(true);
    expect(fails(run7j({ status: { ...GOOD.status, anonBudget: { ...GOOD.status.anonBudget, countriesListed: "invalid" as unknown as number } } })).length).toBeGreaterThan(0);
  });

  it("a stale bundle, a stale agent-mcp, or an address that does not match Cloudflare's is a FAIL", () => {
    expect(fails(run7j({ status: { version: "2026-09-09.84" } as Fixture["status"] })).some((l) => /2026-09-09\.85/.test(l))).toBe(true);
    expect(fails(run7j({ init: { result: { serverInfo: { version: "2026-09-04.10" } } } })).some((l) => /serverInfo/.test(l))).toBe(true);
    expect(fails(run7j({ trace: "ip=198.51.100.1\nloc=US\n" })).some((l) => /trace ip/.test(l))).toBe(true);
    expect(fails(run7j({ plain: { ...GOOD.plain, source: "none" } })).some((l) => /source/.test(l))).toBe(true);
  });

  it("an internal caller arriving without its proof is a FAIL; without the control call it is only INFO", () => {
    const leak = [...GOOD.after, r("unproven_mcp", "ALL", 1, "2026-10-02T15:00:00Z")];
    expect(fails(run7j({ after: leak })).some((l) => /unproven_mcp/.test(l))).toBe(true);
    const apiLeak = [...GOOD.after, r("unproven_api", "ALL", 1, "2026-10-02T15:00:00Z")];
    expect(fails(run7j({ after: apiLeak })).some((l) => /unproven_api/.test(l))).toBe(true);
    expect(fails(run7j({ after: apiLeak, v1: "none" })).some((l) => /unproven_api/.test(l)), "no key, no proof either way").toBe(false);
  });

  it("an unknown_address bucket, an inert country header, or no counting at all is a FAIL", () => {
    expect(fails(run7j({ after: [...GOOD.after, r("unknown_address", "ALL", 4)] })).some((l) => /unknown_address/.test(l))).toBe(true);
    const inert = [r("probe", "ALL", 11), r("address", "ALL", 120), r("address", "XX", 120)];
    expect(fails(run7j({ before: [r("probe", "ALL", 10), r("address", "ALL", 100), r("address", "XX", 100)], after: inert })).some((l) => /country switch inert/.test(l))).toBe(true);
    expect(fails(run7j({ after: GOOD.before })).some((l) => /kind probe grew by 0/.test(l)), "a gate that is not wired counts nothing").toBe(true);
    expect(fails(run7j({ after: { code: "PGRST202" } as unknown as Row[] })).some((l) => /PGRST202/.test(l))).toBe(true);
  });
});
