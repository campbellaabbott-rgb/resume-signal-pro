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
 *   - the build cap holds twice the busiest day of bakes, each bake's calls
 *     read from its own constants, and the largest cap -- all a header anyone
 *     can read can claim, since one address is one day row -- stays below the
 *     harvest it exists to stop;
 *   - agent-mcp, public-api and send-search-digest send the reader proof
 *     derived from the service key, and keep the ANON bearer: the proof
 *     skips the browser meter and grants no search power;
 *   - verify-deploy's section 7j judges correctly, run against fixtures --
 *     including the FORGERY lines: a caller that writes cf-connecting-ip,
 *     x-forwarded-for or cf-ipcountry through to the function fails them.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { ADDRESS_DAILY_CAP, BUDGETED_ACTIONS, BUILD_DAILY_CAP, PROBE_DAILY_CAP } from "../../supabase/functions/job-board/anon-budget";

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

  it("the build cap holds twice the busiest day of bakes, and stays below the harvest it exists to stop", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    const num = (name: string) => {
      const all = [...bake.matchAll(new RegExp(`const ${name} = (\\d+);`, "g"))].map((m) => Number(m[1]));
      expect(all.length, `${name} not found in prerender-seo.mjs`).toBeGreaterThan(0);
      return Math.max(...all);
    };
    const perBake = 1 + num("POSTING_LIST_PAGES") + num("POSTING_PAGE_CARRY_MAX") + num("POSTING_PAGE_CAP");
    expect(perBake, "the bake's own call ceiling (facets head + list pages + carried + fresh details)").toBe(709);
    // Pushes to main per UTC day since the frontend began publishing from
    // main (2026-09-16): the busiest was 10, on 2026-09-27. The command is in
    // the .85 deploy note; the live answer is kind build in the telemetry.
    const BUSIEST_BAKE_DAY = 10;
    // The harvest this release meters: ~5,800 deep-link loads a day at 5
    // counted calls each (the page-load ceiling the paused-board guard pins).
    const HARVEST_DAILY_CALLS = 29_000;
    expect(BUILD_DAILY_CAP).toBeGreaterThanOrEqual(2 * BUSIEST_BAKE_DAY * perBake);
    // One day row per address: a declared kind claims the LARGEST cap at
    // most, so that is the ceiling anyone reading this public repo can claim.
    expect(Math.max(ADDRESS_DAILY_CAP, BUILD_DAILY_CAP, PROBE_DAILY_CAP), "the public header must not buy a harvester's day").toBeLessThan(HARVEST_DAILY_CALLS);
    // verify-deploy's own J() calls (~200 a run) share the owner's row with
    // the owner's browser; a probe cap under the browser's would refuse them first.
    expect(PROBE_DAILY_CAP).toBeGreaterThanOrEqual(ADDRESS_DAILY_CAP);
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
  status: { version: "2026-09-09.85", anonBudget: { settingPresent: true, enforce: false, countriesListed: 0, countryCap: null, overrides: {}, defaults: { address: 10000, build: 15000, probe: 10000 } } },
  trace: "fl=1\nip=203.0.113.9\nloc=US\n",
  plain: { address: "203.0.113.9", source: "cf", country: "US", kind: "address", exempt: false },
  probe: { address: "203.0.113.9", source: "cf", country: "US", kind: "probe", exempt: false },
  mcp: { address: "203.0.113.9", source: "cf", country: "US", kind: "unproven_mcp", exempt: false },
  // The forged requests, answered as a platform that overwrites what the caller wrote.
  forged: { address: "203.0.113.9", source: "cf", country: "US", kind: "address", exempt: false } as Record<string, unknown> | string,
  forgedCode: "200",
  forgedXff: { address: "203.0.113.9", source: "cf", country: "US", kind: "address", exempt: false } as Record<string, unknown> | string,
  forgedXffCode: "200",
  forgedCc: "AQ",
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
    // A raw string is a body that is not the function's JSON (a platform refusal page).
    "/tmp/vd_7j_echo_forged.json": typeof f.forged === "string" ? f.forged : JSON.stringify(f.forged),
    "/tmp/vd_7j_echo_forged_code.txt": f.forgedCode,
    "/tmp/vd_7j_echo_forged_xff.json": typeof f.forgedXff === "string" ? f.forgedXff : JSON.stringify(f.forgedXff),
    "/tmp/vd_7j_echo_forged_xff_code.txt": f.forgedXffCode,
    "/tmp/vd_7j_forged_cc.txt": f.forgedCc,
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

  it("FORGERY: a caller that writes the platform's address or country headers through is a FAIL", () => {
    const echo = GOOD.forged as Record<string, unknown>;
    const all = /^FAIL {2}FORGERY: a request writing cf-connecting-ip/;
    const xff = /^FAIL {2}FORGERY: a request writing x-forwarded-for/;
    expect(fails(run7j({ forged: { ...echo, address: "192.0.2.77" } })).some((l) => all.test(l)), "its own cf-connecting-ip picked its bucket").toBe(true);
    expect(fails(run7j({ forged: { ...echo, address: "192.0.2.78", source: "xff" } })).some((l) => all.test(l)), "its own first x-forwarded-for hop").toBe(true);
    expect(fails(run7j({ forged: { ...echo, address: "", source: "none", kind: "unknown_address" } })).some((l) => all.test(l)), "the never-refused unknown bucket").toBe(true);
    expect(fails(run7j({ forged: { ...echo, country: "AQ" } })).some((l) => all.test(l)), "its own country").toBe(true);
    expect(fails(run7j({ forgedXff: { ...echo, address: "192.0.2.78", source: "xff" } })).some((l) => xff.test(l))).toBe(true);
    expect(fails(run7j({ forgedXff: { ...echo, country: "AQ" } })).some((l) => xff.test(l))).toBe(true);
    // The platform refusing any request that carries cf-connecting-ip is a
    // safe answer -- it never reaches the gate -- and the second line still
    // measures the other two forgeries.
    const refused = run7j({ forged: "<html>403 Forbidden</html>", forgedCode: "403" });
    expect(fails(refused), refused.join("\n")).toEqual([]);
    expect(refused.some((l) => /^PASS {2}FORGERY: .*refused by the platform before the function \(HTTP 403\)/.test(l))).toBe(true);
    // ...but only while the function demonstrably answers the echo: a bundle
    // without budget-echo answers 4xx too, and that is no proof of anything.
    expect(fails(run7j({ forged: "{\"error\":\"Unknown action\"}", forgedCode: "400", plain: { ...GOOD.plain, source: undefined as unknown as string } })).some((l) => all.test(l))).toBe(true);
    // The request without cf-connecting-ip has no refusal escape at all.
    expect(fails(run7j({ forgedXff: "<html>403 Forbidden</html>", forgedXffCode: "403" })).some((l) => xff.test(l))).toBe(true);
  });

  it("FORGERY: the two requests the lines judge really carry the forged headers, to the uncounted echo", () => {
    const bash = s7j.split("\n").filter((l) => !/^\s*#/.test(l));
    const sent = (out: string) => bash.find((l) => l.includes(`-o /tmp/${out} `)) ?? "";
    const all = sent("vd_7j_echo_forged.json"), xff = sent("vd_7j_echo_forged_xff.json");
    for (const [name, line] of [["all", all], ["xff", xff]] as const) {
      expect(line, `the ${name} forgery request is missing`).toMatch(/functions\/v1\/job-board/);
      expect(line, "to budget-echo, which counts nothing and reads no database").toMatch(/-d '\{"action":"budget-echo"\}'/);
      expect(line).toMatch(/-H "x-forwarded-for: 192\.0\.2\.78"/);
      expect(line, "a country the trace did not report").toMatch(/-H "cf-ipcountry: \$FCC7J"/);
      expect(line, "the status code is what lets a platform refusal be read as one").toMatch(/-w '%\{http_code\}'/);
    }
    expect(all).toMatch(/-H "cf-connecting-ip: 192\.0\.2\.77"/);
    expect(xff, "the second request exists to be measured if the platform refuses cf-connecting-ip").not.toMatch(/cf-connecting-ip/);
    expect(bash.join("\n"), "the forged country is never the machine's own").toMatch(/FCC7J=AQ; \[ "\$LOC7J" = "AQ" \] && FCC7J=TV/);
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

describe("verify-deploy 7j judges a .86 country, read from the address because no header arrives", () => {
  // .86: on this platform cf-ipcountry never reaches the function, so a
  // machine outside mainland China reads XX with source none, and the right
  // answer for this machine is XX -- not the trace's loc, which only a cf
  // source could ever have matched.
  const v86 = (country: string, countrySource: string) => ({ address: "203.0.113.9", source: "cf", country, countrySource, kind: "address", exempt: false });
  const status86 = { ...GOOD.status, version: "2026-09-09.86" };
  const xx = [r("probe", "ALL", 11), r("address", "ALL", 120), r("address", "XX", 100), r("address", "CN", 20)];

  it("a US machine reading XX from the registry path is all PASS, and the CN share is printed, not judged", () => {
    const out = run7j({ status: status86, plain: v86("XX", "none"), forged: v86("XX", "none"), forgedXff: v86("XX", "none"), after: xx, before: GOOD.before.slice(0, 2) });
    expect(fails(out), out.join("\n")).toEqual([]);
    expect(out.some((l) => /^INFO {2}address requests read as a real country: 20 of 120/.test(l))).toBe(true);
  });

  it("a US machine read as CN, or a forged country written through, is still a FAIL", () => {
    expect(fails(run7j({ status: status86, plain: v86("CN", "registry") })).some((l) => /the country the function reads = CN/.test(l))).toBe(true);
    const xffLine = /^FAIL {2}FORGERY: a request writing x-forwarded-for/;
    expect(fails(run7j({ status: status86, plain: v86("XX", "none"), forgedXff: v86("AQ", "cf") })).some((l) => xffLine.test(l))).toBe(true);
  });

  it("where the registry and Cloudflare disagree about this machine, the country line says so and the FORGERY lines do not", () => {
    const sg = run7j({ status: status86, trace: "ip=203.0.113.9\nloc=SG\n", plain: v86("CN", "registry"), forged: v86("CN", "registry"), forgedXff: v86("CN", "registry") });
    expect(fails(sg).some((l) => /the country the function reads = CN/.test(l)), sg.join("\n")).toBe(true);
    expect(fails(sg).some((l) => /FORGERY/.test(l)), "no header got through: the forged echo equals the unforged one").toBe(false);
  });

  it("a cf source, where a platform does send one, is judged against the trace as before", () => {
    expect(fails(run7j({ status: status86, plain: v86("US", "cf"), forged: v86("US", "cf"), forgedXff: v86("US", "cf") }))).toEqual([]);
    expect(fails(run7j({ status: status86, plain: v86("XX", "cf") })).some((l) => /the country the function reads/.test(l))).toBe(true);
  });
});
