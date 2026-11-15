// @vitest-environment node
//
// Node, not jsdom: this file runs a verifier block in bash, with a fake curl
// on PATH, through child_process.
/**
 * A TABLE A STRANGER CAN READ OUTSIDE THE KNOWN SET FAILS THE DEPLOY CHECK
 * (NB-13).
 *
 * On 2026-11-15, 72 of the 145 tables the migrations create answered the
 * publishable key 200, 70 of them with no row only because row level security
 * hid it (affiliate sessions and API keys among them), and section 40 probed
 * two tables by name. The sweep it now carries reads every table the
 * checkout's migrations create, as a stranger. Run here in bash against a
 * fake curl:
 *   - production as it answered on 2026-11-15 prints no FAIL: the leak and
 *     new-table lines PASS, the 70 are named as INFO, the one pending table
 *     is INFO;
 *   - a row from a table that is not a public aggregate is a FAIL naming the
 *     table, and the row's values are never printed;
 *   - a table outside the 72 answering 200 is a FAIL naming the table and the
 *     migration that created it;
 *   - a table whose created-with column is gone (42703) is read again with *;
 *   - a gateway page or a refusal that is not 42501 is a FAIL (not judged);
 *   - a checkout whose migrations cannot be parsed is a FAIL, never a PASS
 *     over nothing;
 *   - every request is one GET with limit=1, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/40-db-exposure.sh"), "utf8");
const BLOCK = (() => {
  const start = SECTION.indexOf("# EVERY TABLE, READ AS A STRANGER");
  const end = SECTION.indexOf("# admin-ops: the build", start);
  if (start < 0 || end < 0) throw new Error("section 40 carries no table sweep");
  return SECTION.slice(start, end);
})();
const KEY = "pk_test_SECRET_marker_nb13";

// A bash curl: one awk lookup per request (145 of them a case), logging each.
const FAKE_CURL = `#!/usr/bin/env bash
url=""; method=GET; w=""; o=""
while [ $# -gt 0 ]; do
  case "$1" in -X) method=$2; shift;; -w) w=$2; shift;; -o) o=$2; shift;; -d|--data) method=POST; shift;; -H|-m|-A) shift;; http*) url=$1;; esac
  shift
done
echo "$method $url" >> "$VD_CALLS"
path=\${url#*/rest/v1/}; t=\${path%%\\?*}; q=\${path#*select=}; sel=\${q%%&*}
line=$(awk -F'\\t' -v t="$t" -v s="$sel" '$1==t && ($2==s || $2=="any") {print; exit}' "$VD_ROUTES")
if [ -n "$line" ]; then st=$(printf '%s' "$line" | cut -f3); body=$(printf '%s' "$line" | cut -f4-)
else st=401; body='{"code":"42501","details":null,"hint":null,"message":"permission denied for table '"$t"'"}'; fi
if [ -n "$o" ] && [ "$o" != /dev/null ]; then printf '%s' "$body" > "$o"; elif [ -z "$o" ]; then printf '%s' "$body"; fi
if [ -n "$w" ]; then w=\${w//\\\\n/$'\\n'}; printf '%s' "\${w//%\\{http_code\\}/$st}"; fi
`;

// The 72 that answered 200 on 2026-11-15; the two aggregates answered rows.
const OPEN_72 = "ab_test_events affiliate_clicks affiliate_conversions affiliate_sessions affiliates agent_learned_answers agent_mandates agent_pending_questions agent_queue agent_searches agent_submissions agent_subscribers agent_worker_heartbeat ai_response_cache alert_log api_keys api_quota api_rate api_usage cohort_weekly_reports company_claims daily_scan_stats detection_telemetry email_logs email_send_log email_send_state email_unsubscribe_tokens free_scan_leads job_board_board_state job_board_board_watch job_board_click_rollup job_board_closures job_board_company_dim_snapshots job_board_company_flow job_board_embeddings job_board_exit_rollup job_board_exits job_board_field_changes job_board_pool_samples job_board_posting_reports job_board_search_clicks job_board_search_events job_board_search_misses job_board_search_rollup job_board_stats_rollup parse_failures payment_failures pro_grants pro_subscribers product_deliveries purchased_content rate_limits resume_analyses scan_feedback scan_industry_pins scan_metrics scan_outcomes scan_report_cache scan_slots shortlist_decisions shortlist_demographics shortlist_notices shortlist_roles suppressed_emails temp_resume_storage used_stripe_sessions user_applications user_job_searches user_profiles user_scan_credits user_scans webhook_events".split(" ");
type Route = [table: string, select: string, status: number, body: string];
function production(): Route[] {
  const r: Route[] = OPEN_72.map((t) => [t, "any", 200, "[]"]);
  for (const t of ["daily_scan_stats", "job_board_stats_rollup"]) r.unshift([t, "any", 200, '[{"k":"aggregate"}]']);
  r.push(["job_board_embed_requeue", "any", 404, '{"code":"PGRST205","message":"Could not find the table"}']);
  return r;
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function run(routes: Route[], cwd = ROOT): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd40t-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.tsv"), routes.map((r) => r.join("\t")).join("\n") + "\n");
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=${KEY}; B=https://p.supabase.co\n` + BLOCK.split("/tmp/").join(`${dir}/`));
  const env = { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.tsv"), VD_CALLS: join(dir, "calls.log") };
  const out = execFileSync("bash", [join(dir, "run.sh")], { cwd, env, encoding: "utf8", timeout: 110_000 });
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("production as it answered on 2026-11-15", () => {
  const { lines, calls, out } = run(production());
  it("prints no FAIL, and PASSes the two claims a stranger could break", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^PASS {2}NB-13 no table but the public aggregates answers a stranger with a row \(2 aggregate/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^PASS {2}NB-13 every table that answers a stranger is one of the 72 known/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^PASS {2}NB-13 every one of the \d+ tables the migrations create answered/.test(l)), show(lines)).toBe(true);
  });
  it("names the seventy private only by row level security, and the pending table, as INFO", () => {
    const rls = lines.find((l) => /^INFO {2}NB-13 70 table\(s\) show a stranger no row only because row level security hides it/.test(l));
    expect(rls, show(lines)).toBeTruthy();
    expect(rls).toMatch(/affiliate_sessions/);
    expect(rls).toMatch(/api_keys/);
    expect(lines.some((l) => /^INFO {2}NB-13 1 table\(s\) the migrations create are not served.*job_board_embed_requeue/.test(l)), show(lines)).toBe(true);
  });
  it("reads every table the migrations create, once each, with a GET for one row, and never prints the key", () => {
    expect(calls.length).toBeGreaterThanOrEqual(140);
    for (const c of calls) expect(c, c).toMatch(/^GET https:\/\/p\.supabase\.co\/rest\/v1\/\w+\?select=[\w*]+&limit=1$/);
    expect(calls.some((c) => /\/affiliate_sessions\?select=id&limit=1$/.test(c)), "the created-with column is selected").toBe(true);
    expect(new Set(calls.map((c) => c.split("?")[0])).size).toBe(calls.length);
    expect(out).not.toContain(KEY);
  });
});

describe("each exposure prints FAIL", () => {
  it("a row from a table that is not a public aggregate, named, with no value printed", () => {
    const routes = production();
    routes.unshift(["affiliate_sessions", "any", 200, '[{"id":"7","session_token":"SECRET_session_value"}]']);
    const { lines, out } = run(routes);
    expect(lines.some((l) => /^FAIL {2}NB-13 a stranger reads rows of 1 table\(s\) that are not public aggregates: affiliate_sessions/.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain("SECRET_session_value");
  });

  it("a table outside the 72 answering 200, named with the migration that created it", () => {
    const routes = production();
    routes.unshift(["checkout_resume_refs", "any", 200, "[]"]);
    const { lines } = run(routes);
    expect(lines.some((l) => /^FAIL {2}NB-13 1 table\(s\) outside the 72 known on 2026-11-15 answer a stranger 200: checkout_resume_refs \(created 20261004150000\)/.test(l)), show(lines)).toBe(true);
  });

  it("a gateway page, or a refusal that is not 42501, leaves the table unjudged", () => {
    const routes = production();
    routes.unshift(["api_keys", "any", 502, "<html>Bad gateway</html>"]);
    routes.unshift(["checkout_starts", "any", 401, '{"code":"PGRST301","message":"JWT expired"}']);
    const { lines } = run(routes);
    const l = lines.find((x) => /^FAIL {2}NB-13 2 table\(s\) were not judged/.test(x));
    expect(l, show(lines)).toBeTruthy();
    expect(l).toMatch(/api_keys \(502 none\)/);
    expect(l).toMatch(/checkout_starts \(401 PGRST301\)/);
  });

  it("a checkout whose migrations cannot be read is a FAIL, never a PASS over nothing", () => {
    const empty = mkdtempSync(join(tmpdir(), "vd40e-"));
    dirs.push(empty);
    mkdirSync(join(empty, "supabase/migrations"), { recursive: true });
    const { lines, calls } = run(production(), empty);
    expect(lines, show(lines)).toEqual([expect.stringMatching(/^FAIL {2}NB-13 the table sweep parsed 0 tables from supabase\/migrations/)]);
    expect(calls).toEqual([]);
  });
});

describe("a column that is gone", () => {
  it("is read again with *, and judged on that answer", () => {
    const routes = production().filter((r) => r[0] !== "affiliate_sessions");
    routes.unshift(["affiliate_sessions", "id", 400, '{"code":"42703","message":"column affiliate_sessions.id does not exist"}']);
    routes.unshift(["affiliate_sessions", "*", 200, "[]"]);
    const { lines, calls } = run(routes);
    expect(calls.filter((c) => /\/affiliate_sessions\?/.test(c))).toEqual([
      "GET https://p.supabase.co/rest/v1/affiliate_sessions?select=id&limit=1",
      "GET https://p.supabase.co/rest/v1/affiliate_sessions?select=*&limit=1",
    ]);
    expect(fails(lines), show(lines)).toEqual([]);
  });
});
