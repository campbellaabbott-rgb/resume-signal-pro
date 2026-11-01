// @vitest-environment node
//
// Node, not jsdom: this file runs a verifier block in bash, with the RPC
// helper stubbed, through child_process.
/**
 * THE LEADERBOARD CACHE LINE JUDGES THE GATE, NOT A COUNT OF TWENTY
 * (live verify after the 2026-10-31 deploy, f8d72a9b).
 *
 * Section 5i of scripts/verify-deploy.sh is the post-deploy proof that the
 * Ghost Job Index leaderboard answers from the hourly cache
 * (20260909228000), not from the live 25-second aggregation. It printed
 * "FAIL  cache.actively_hiring carries 19 rows" because it wanted exactly
 * twenty. Twenty is a ceiling, not a promise: get_actively_hiring_companies
 * lists at most p_limit employers, and only those whose fill curve is
 * sufficient ("SAMPLE-SIZE GATE, HONOURED AS A GATE ... there is no fallback
 * ordering", 20260909201000). Live the same evening the cache held 19 rows at
 * 18:27Z and 23:27Z and 20 at 20:27Z, each ranked by fill_incidence_14d, and
 * the page prints no "twenty" anywhere. So the line failed the gate doing
 * its job.
 *
 * What the line must still FAIL, each proved below: the cache part missing,
 * an answer that is not the cache, rows that are empty or not a list (the
 * page then waits on the live call), more rows than the page asks for, a row
 * naming no employer, and rows out of the function's order (the page lists
 * them in the RPC's own order until its curve guard answers).
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");

/** Section 5i: from its echo line up to the next section's echo line. */
function section5i(script: string): string {
  const open = /^echo "== 5i\. /m.exec(script);
  if (!open) throw new Error("no section 5i in the verifier");
  const rest = script.slice(open.index + 1);
  const next = /^echo "(?:== |done\.)/m.exec(rest);
  return script.slice(open.index, next ? open.index + 1 + next.index : undefined);
}
const SECTION = section5i(SCRIPT);

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Row = Record<string, unknown>;
/** A leaderboard row as get_actively_hiring_companies(20) returns it, ranked by rank (0 = top). */
const row = (i: number, over: Row = {}): Row => ({
  company: `Employer ${i}`, company_token: `tok${i}`, closed_90d: 400, open_roles: 150, tracking_days: 80,
  fill_incidence_14d: Number((0.83 - i * 0.035).toFixed(4)), fill_incidence_14d_lo: 0.1, fill_incidence_14d_hi: 0.9,
  filled_roles_ceiling: 400, dated_share: 0.9, ...over,
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));
const cache = (part: unknown, stale: string[] = []) => ({
  computed_at: "2026-10-31T23:27:20Z", stale_parts: stale, ghost_stats: {}, fill_curve: {},
  ...(part === undefined ? {} : { actively_hiring: part }),
});
const part = (r: unknown, at: string | null = "2026-10-31T23:27:20.269589+00:00") => ({ computed_at: at, rows: r });

/** Section 5i, run in bash; R answers get_stats_cache with `answer` (a string is sent verbatim). */
function run(answer: unknown): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd5i-"));
  dirs.push(dir);
  writeFileSync(join(dir, "cache.json"), typeof answer === "string" ? answer : JSON.stringify(answer));
  const prelude = `set -u
D=${JSON.stringify(dir)}
R() { printf '%s\\n' "$1" >> "$D/calls.log"; case "$1" in
  get_stats_cache) cat "$D/cache.json" ;;
  *) printf '{"code":"PGRST202","message":"stub: unknown rpc"}' ;;
esac; }
`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  writeFileSync(join(dir, "calls.log"), "");
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { env, encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("5i: the leaderboard answers from the hourly cache", () => {
  it("reads the cache once, through the RPC the page reads", () => {
    const { calls } = run(cache(part(rows(20))));
    expect(calls).toEqual(["get_stats_cache"]);
  });

  it("the production shape: 19 ranked rows (the gate admitted 19) PASS, with the part's own stamp", () => {
    const { lines } = run(cache(part(rows(19))));
    expect(has(lines, "PASS", /cache\.actively_hiring carries 19 rows/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /every row names an employer and the list is ranked by fill_incidence_14d/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /own computed_at = 2026-10-31T23:27:20/), show(lines)).toBe(true);
    expect(fails(lines), show(lines)).toEqual([]);
  });

  it("twenty rows, and a single row, PASS: the line bounds the list, it does not demand a length the gate decides", () => {
    for (const n of [20, 1]) {
      const { lines } = run(cache(part(rows(n))));
      expect(has(lines, "PASS", new RegExp(`cache\\.actively_hiring carries ${n} rows`)), show(lines)).toBe(true);
      expect(fails(lines), show(lines)).toEqual([]);
    }
  });

  it("ties in the rate are still the function's order", () => {
    const r = rows(5).map((x, i) => (i >= 2 ? { ...x, fill_incidence_14d: 0.5 } : x));
    const { lines } = run(cache(part(r)));
    expect(fails(lines), show(lines)).toEqual([]);
  });

  it("a carried part is named in stale_parts, which is INFO, never a PASS", () => {
    const { lines } = run(cache(part(rows(19)), ["actively_hiring"]));
    expect(has(lines, "INFO", /stale_parts=\["actively_hiring"\]/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /stale_parts=/), show(lines)).toBe(false);
  });
});

describe("5i TEETH: what the line must still FAIL", () => {
  it("an empty list FAILs: the page reads no leaderboard from the cache and waits on the live call", () => {
    const { lines } = run(cache(part([])));
    expect(has(lines, "FAIL", /cache\.actively_hiring carries 0 rows/), show(lines)).toBe(true);
  });

  it("rows that are not a list FAIL", () => {
    for (const r of [null, {}, "rows"]) {
      const { lines } = run(cache(part(r)));
      expect(has(lines, "FAIL", /cache\.actively_hiring carries null rows/), show(lines)).toBe(true);
    }
  });

  it("more rows than the page asks for FAIL", () => {
    const { lines } = run(cache(part(rows(21))));
    expect(has(lines, "FAIL", /cache\.actively_hiring carries 21 rows/), show(lines)).toBe(true);
  });

  it("a cache with no leaderboard part FAILs (20260909228000 has been applied since September; this was an INFO)", () => {
    const { lines } = run(cache(undefined));
    expect(has(lines, "FAIL", /the cache carries no actively_hiring part/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
  });

  it("an answer that is not the cache FAILs: an error object, and a body that is not JSON", () => {
    const err = run({ code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" });
    expect(has(err.lines, "FAIL", /the cache carries no actively_hiring part/), show(err.lines)).toBe(true);
    const html = run("<html>upstream request timeout</html>");
    expect(has(html.lines, "FAIL", /get_stats_cache answered no JSON/), show(html.lines)).toBe(true);
    expect(html.lines.some((l) => l.startsWith("PASS")), show(html.lines)).toBe(false);
  });

  it("a row naming no employer FAILs", () => {
    const r = rows(19);
    r[7] = row(7, { company_token: null });
    const { lines } = run(cache(part(r)));
    expect(has(lines, "FAIL", /18 of 19 rows name an employer/), show(lines)).toBe(true);
  });

  it("rows out of the function's order FAIL, and so does a row with no rate to rank on", () => {
    const swapped = rows(19);
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    const out = run(cache(part(swapped)));
    expect(has(out.lines, "FAIL", /not ranked by fill_incidence_14d/), show(out.lines)).toBe(true);
    const unrated = rows(19);
    unrated[0] = row(0, { fill_incidence_14d: null });
    const none = run(cache(part(unrated)));
    expect(has(none.lines, "FAIL", /not ranked by fill_incidence_14d/), show(none.lines)).toBe(true);
  });

  it("a part with no stamp of its own FAILs", () => {
    const { lines } = run(cache(part(rows(19), null)));
    expect(has(lines, "FAIL", /own computed_at = null/), show(lines)).toBe(true);
  });
});
