// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE COST CI-EDGE SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * DEPLOY, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzz-cost-ci-edge.sh).
 *
 * Run against a fake curl that answers from routes and logs every call:
 *   - before the deploy (every function on today's build, no Max-Age) it
 *     prints INFO for the builds and no FAIL;
 *   - a full deploy passes the builds and the Max-Age;
 *   - a partial deploy fails each function left behind, and a missing build
 *     header after the deploy fails;
 *   - a function on its new build whose preflight has no Max-Age, or another
 *     value, fails;
 *   - the build table is the code's: every function the lane stamped, at the
 *     build its source names;
 *   - every call is an OPTIONS, no body is sent, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-cost-ci-edge.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_cost_ci_edge";

/** The section's own table: function -> [date, sequence]. */
const WANT = new Map(
  [...(/VDCE_WANT="([^"]+)"/.exec(SECTION)?.[1] ?? "").matchAll(/([a-z0-9-]+):(\d{4}-\d{2}-\d{2}):(\d+)/g)]
    .map((m) => [m[1], [m[2], Number(m[3])] as const]),
);
const FNS = [...WANT.keys()];

/**
 * A fake curl in bash (fifty-five node start-ups per run took a minute): it
 * logs the method, the URL and any body, and answers a preflight with the
 * headers file the test wrote for that function, or a bare 404.
 */
const FAKE_CURL = `#!/bin/bash
method=GET; url=""; dump=""; body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2;;
    -D) dump="$2"; shift 2;;
    -d|--data|--data-binary) body="$2"; shift 2;;
    -o|-w|-H|-m|-A|--max-time) shift 2;;
    http*) url="$1"; shift;;
    *) shift;;
  esac
done
[ -n "$body" ] && [ "$method" = GET ] && method=POST
if [ -n "$body" ]; then printf 'curl\t%s %s\t%s\n' "$method" "$url" "$body" >> "$VD_CALLS"; else printf 'curl\t%s %s\n' "$method" "$url" >> "$VD_CALLS"; fi
fn="\${url##*/}"
f="$VD_HDRS/$method.$fn"
if [ "$dump" = "-" ]; then if [ -f "$f" ]; then cat "$f"; else printf 'HTTP/2 404\r\n\r\n'; fi; fi
exit 0
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** headers: function -> its preflight's response headers (absent function: 404). */
function run(headers: Record<string, Record<string, string>>): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdcostciedge-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "hdrs"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  for (const [fn, h] of Object.entries(headers)) {
    writeFileSync(join(dir, "hdrs", `OPTIONS.${fn}`), `HTTP/2 200\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join("")}\r\n`);
  }
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_HDRS: join(dir, "hdrs"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const want = (fn: string) => { const [d, n] = WANT.get(fn)!; return `${fn}.${d}.${n}`; };
/** Each function's preflight: its build header and its Max-Age, or none. */
const preflights = (of: (fn: string) => { build: string | null; age?: string | null }): Record<string, Record<string, string>> =>
  Object.fromEntries(FNS.map((fn) => {
    const { build, age } = of(fn);
    const headers: Record<string, string> = { "access-control-allow-origin": "*" };
    if (build) headers["x-fn-build"] = build;
    if (age) headers["access-control-max-age"] = age;
    return [fn, headers];
  }));
const deployed = (fn: string) => ({ build: want(fn), age: "7200" });
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("the cost ci-edge section", () => {
  it("names every function this lane stamped, at the build its source names or a later one", () => {
    expect(FNS.length).toBe(55);
    for (const fn of FNS) {
      const dir = resolve(ROOT, "supabase/functions", fn, "index.ts");
      const src = readFileSync(dir, "utf8");
      const [d, n] = WANT.get(fn)!;
      // A later round restamps the function (the bug round's 2026-11-12.1), and the section passes a later build.
      const named = [...src.matchAll(new RegExp(`(?:${fn}|\\$\\{FN_NAME\\})\\.(\\d{4}-\\d{2}-\\d{2})\\.(\\d+)\\b|BUILD_VERSION = ["'](\\d{4}-\\d{2}-\\d{2})\\.(\\d+)["']`, "g"))]
        .map((m) => [m[1] ?? m[3], Number(m[2] ?? m[4])] as const)
        .some(([bd, bn]) => bd > d || (bd === d && bn >= n));
      expect(named, `${fn} names no build at or after ${d}.${n}`).toBe(true);
    }
  });

  it("before the deploy says INFO for every build, judges no Max-Age, and fails nothing", () => {
    const { lines, out } = run(preflights((fn) => ({ build: `${fn}.2026-11-03.1` })));
    expect(fails(lines), out).toEqual([]);
    for (const fn of FNS) expect(lines.some((l) => l.startsWith(`INFO  B ${fn} preflight x-fn-build = ${fn}.2026-11-03.1: cost wave ci-edge is not deployed yet`)), `${fn}\n${out}`).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toEqual([]);
    expect(lines).toContain("INFO  M not judged: no function serves its cost-wave ci-edge build yet");
  });

  it("a full deploy passes the builds and the Max-Age", () => {
    const { lines, out } = run(preflights(deployed));
    expect(fails(lines), out).toEqual([]);
    expect(lines).toContain("PASS  B 55 of 55 functions serve their cost-wave ci-edge build or a later one");
    expect(lines).toContain("PASS  M 55 function(s) on their cost-wave build say Access-Control-Max-Age 7200 on the preflight");
  });

  it("a later build passes too", () => {
    const later = run(preflights((fn) => ({ build: `${fn}.2026-11-20.4`, age: "7200" })));
    expect(fails(later.lines), later.out).toEqual([]);
    expect(later.lines).toContain("PASS  B 55 of 55 functions serve their cost-wave ci-edge build or a later one");
  });

  it("a partial deploy fails each function left behind, and a missing build header fails once others serve theirs", () => {
    const { lines, out } = run(preflights((fn) =>
      fn === "parse-pdf" ? { build: "parse-pdf.2026-10-11.26" }
        : fn === "check-subscription" ? { build: null }
          : fn === "analyze-resume" ? { build: "analyze-resume.2026-11-10.2" }
            : deployed(fn)));
    expect(fails(lines), out).toEqual([
      "FAIL  B analyze-resume preflight x-fn-build = analyze-resume.2026-11-10.2 while others serve their cost-wave build: a partial deploy (want analyze-resume.2026-11-10.4 or later)",
      "FAIL  B check-subscription preflight carries no x-fn-build while others serve their cost-wave build (want check-subscription.2026-11-10.3 or later)",
      "FAIL  B parse-pdf preflight x-fn-build = parse-pdf.2026-10-11.26 while others serve their cost-wave build: a partial deploy (want parse-pdf.2026-11-09.1 or later)",
    ]);
    expect(lines).toContain("PASS  B 52 of 55 functions serve their cost-wave ci-edge build or a later one");
  });

  it("a function on its new build whose preflight says no Max-Age, or another value, fails; another function's build never stands in", () => {
    const { lines, out } = run(preflights((fn) =>
      fn === "track-ab-event" ? { build: want(fn), age: null }
        : fn === "get-account-data" ? { build: want(fn), age: "5" }
          : fn === "job-fit" ? { build: "fetch-job-posting.2026-11-09.1", age: "7200" }
            : deployed(fn)));
    expect(fails(lines), out).toEqual([
      "FAIL  B job-fit preflight x-fn-build = fetch-job-posting.2026-11-09.1 while others serve their cost-wave build: a partial deploy (want job-fit.2026-11-09.1 or later)",
      "FAIL  M get-account-data serves get-account-data.2026-11-09.1, whose preflight should say Access-Control-Max-Age 7200, and says 5 (a browser then asks before every call again)",
      "FAIL  M track-ab-event serves track-ab-event.2026-11-09.1, whose preflight should say Access-Control-Max-Age 7200, and says none (a browser then asks before every call again)",
    ]);
  });

  it("never writes: every call is an OPTIONS, no body is sent, and the key is never printed", () => {
    const { calls, out } = run(preflights(deployed));
    expect(calls.length).toBe(FNS.length);
    expect(calls.every((c) => /^curl\tOPTIONS /.test(c) && c.split("\t").length === 2), calls.join("\n")).toBe(true);
    expect(out).not.toContain(KEY);
  });
});
