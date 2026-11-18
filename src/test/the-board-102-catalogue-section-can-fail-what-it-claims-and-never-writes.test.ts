// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BOARD .102 CATALOGUE SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-board-102-catalogue.sh).
 *
 * The section runs against a fake curl that answers from routes and logs every
 * call:
 *   - a good deploy prints no FAIL, and the build live today (.101, with
 *     today's counts) prints no FAIL either: every .102 line is INFO before
 *     the paste, and that run saves the counts the paste is judged against;
 *   - each claim fails alone when only its own fix is missing: the builds, the
 *     high-water, a retired token still carried, a retired board's rows still
 *     served after the prune, pinpoint:helsing, a twin's rows, the LCC twin
 *     under 90% of its saved count, a labelled board's unflagged rows, a
 *     repoint or Convergint not carried or serving nothing;
 *   - the retired tokens go five to a list call, and the stub answers each
 *     call the way the board does (company-names.ts): it looks up
 *     NAMES_PER_CALL names the catalogue lacks, resolving a name to another
 *     board or not, and lists the rest under companiesNotLookedUp; a token
 *     named by any of those four fields is uncarried;
 *   - the high-water judges the size against 44,499 only while exactly .102
 *     serves: a later build may change the catalogue;
 *   - the rows are judged only after a pass-end serve step that followed the
 *     first sighting of the migration as applied (or VD102C_MIGRATED_AT);
 *   - every POST is job-board status or list with the probe header, or the
 *     anon get_company_fill_curve read, and the publishable key is never
 *     printed;
 *   - the section's keys are the catalogue's: 44,499 is the size .102
 *     shipped (board .103's prune shrank JOB_SOURCES after it), its retired keys are absent and their tokens carried by no vendor, its
 *     kept, labelled and repointed keys present.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { NAMES_PER_CALL } from "../../supabase/functions/job-board/company-names";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-board-102-catalogue.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_FN = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const R_FN = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_102c";

const words = (name: string) => (new RegExp(`^${name}="([^"]*)"$`, "m").exec(SECTION)?.[1] ?? "").split(/\s+/).filter(Boolean);
const GONE = words("VD102C_GONE");
const KEPT = words("VD102C_KEPT");
const LABELLED = words("VD102C_LABELLED");
const SERVED = words("VD102C_SERVED");
const tok = (k: string) => k.slice(k.indexOf(":") + 1);
const vendor = (k: string) => k.slice(0, k.indexOf(":"));
const LCC = "oracle:fa-esms-saasfaukgovprod1~ocs~CX_1";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

/**
 * A fake curl in bash, not node: the section makes about thirty calls a run,
 * and a node start per call made one run take 7-18 s on this machine. Each
 * route is a file set (N.re, N.status, N.headers, N.body); the first whose
 * extended regex matches "METHOD URL [DATA]" answers.
 */
const FAKE_CURL = String.raw`#!/bin/bash
method=GET; url=; D=; o=; w=; data=; has=0; probe=noprobe
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method=$2; shift 2;;
    -D) D=$2; shift 2;;
    -o) o=$2; shift 2;;
    -w) w=$2; shift 2;;
    -d|--data|--data-binary) data=$2; has=1; shift 2;;
    -H) shopt -s nocasematch; [[ $2 == "x-rb-budget: probe" ]] && probe=probe; shopt -u nocasematch; shift 2;;
    -m|-A|--max-time) shift 2;;
    http:*|https:*) url=$1; shift;;
    *) shift;;
  esac
done
if [ $has = 1 ]; then
  [ "$method" = GET ] && method=POST
  key="$method $url $data"; printf 'curl	%s %s	%s	%s
' "$method" "$url" "$data" "$probe" >> "$VD_CALLS"
else
  key="$method $url"; printf 'curl	%s %s	%s
' "$method" "$url" "$probe" >> "$VD_CALLS"
fi
R=$VD_ROUTES; i=0; hit=
while [ -f "$R/$i.re" ]; do re=$(<"$R/$i.re"); if [[ $key =~ $re ]]; then hit=$i; break; fi; i=$((i+1)); done
if [ -n "$hit" ]; then st=$(<"$R/$hit.status"); else st=404; fi
hdr() { printf 'HTTP/2 %s
' "$st"; if [ -n "$hit" ]; then cat "$R/$hit.headers"; fi; printf '
'; }
if [ "$D" = - ]; then hdr; elif [ -n "$D" ]; then hdr > "$D"; fi
if [ -n "$o" ] && [ "$o" != /dev/null ]; then
  if [ -n "$hit" ]; then cat "$R/$hit.body" > "$o"; else : > "$o"; fi
elif [ -z "$o" ] && [ -n "$hit" ]; then cat "$R/$hit.body"; fi
if [ -n "$w" ]; then printf '%s' "$w" | sed "s/%{http_code}/$st/"; fi
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });
const newState = () => { const d = mkdtempSync(join(tmpdir(), "vd102c-state-")); dirs.push(d); return join(d, "verify-state", "board-102-catalogue.json"); };

function run(routes: Route[], env: Record<string, string> = {}, state = newState()): { lines: string[]; calls: string[]; out: string; state: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd102c-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  mkdirSync(join(dir, "routes"));
  routes.forEach((r, i) => {
    writeFileSync(join(dir, "routes", `${i}.re`), r.match);
    writeFileSync(join(dir, "routes", `${i}.status`), String(r.status ?? 200));
    writeFileSync(join(dir, "routes", `${i}.headers`), Object.entries(r.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join(""));
    writeFileSync(join(dir, "routes", `${i}.body`), r.body ?? "");
  });
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_FN}\n${R_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes"), VD_CALLS: join(dir, "calls.log"),
    VD102C_STATE: state, VD102C_MIGRATED_AT: "", VD102C_LCC_PRE: "",
    ...env,
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env: e, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (err) { out = String((err as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out, state };
}

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FN = (fn: string) => `https://p\\.supabase\\.co/functions/v1/${fn}`;
const LIST = `^POST ${FN("job-board")} \\{"action":"list"`;
const preflight = (fn: string, build: string | null): Route => ({ match: `^OPTIONS ${FN(fn)}$`, headers: build ? { "x-fn-build": build } : {} });
const H = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

type World = {
  jb: string | null; lf: string | null;
  size: number; mark: number | null; build: string; buildSince: string;
  serveAt: string | null; serveBuild: string;
  carried: string[]; // retired tokens the catalogue still carries
  gone: Record<string, number>; // open rows of each retired token
  curveDrops: string[]; // tokens the fill curve leaves out
  helsing: number | "uncarried";
  kept: Record<string, number>;
  labelled: Record<string, { total: number; unflagged: number; rechecked?: string }>;
  served: Record<string, number | "uncarried">;
  lookUp?: number; // names the board looks up a call (NAMES_PER_CALL)
  byName?: Record<string, string[]>; // a retired token a name lookup resolves to another board's tokens
};
const uncarriedReply = (tokens: string[]) => JSON.stringify({ jobs: [], total: 0, hasMore: false, nextOffset: 0, unknownCompanies: tokens, companies: [], companiesCount: 0, companiesUnresolved: tokens.map((asked) => ({ asked, candidates: [] })) });

function routes(w: World): Route[] {
  const ss = { build: w.build, buildSince: w.buildSince };
  const passEnd = { build: w.serveBuild, startedAt: w.serveAt, steps: { serve: w.serveAt ? { ok: true, doneAt: w.serveAt, detail: "corpus 1009849 postings from 31314 boards" } : undefined }, next: null };
  // One list call per five retired tokens, answered as the board answers a scope naming tokens it lacks.
  const batches = Array.from({ length: Math.ceil(GONE.length / 5) }, (_, i) => GONE.slice(i * 5, i * 5 + 5).map(tok));
  const goneReply = (batch: string[]) => {
    const lacked = batch.filter((t) => !w.carried.includes(t)), looked = lacked.slice(0, w.lookUp ?? NAMES_PER_CALL), skipped = lacked.slice(looked.length);
    const resolved = looked.filter((t) => w.byName?.[t]), unresolved = looked.filter((t) => !w.byName?.[t]);
    if (lacked.length === batch.length && !resolved.length && !skipped.length) return uncarriedReply(batch);
    return JSON.stringify({
      total: batch.filter((t) => w.carried.includes(t)).reduce((n, t) => n + (w.gone[t] ?? 0), 0) + resolved.length * 7,
      ...(resolved.length ? { companiesResolved: resolved.map((asked) => ({ asked, name: asked, tokens: w.byName![asked] })) } : {}),
      ...(unresolved.length ? { companiesUnresolved: unresolved.map((asked) => ({ asked, candidates: [] })) } : {}),
      ...(skipped.length ? { companiesNotLookedUp: skipped } : {}),
    });
  };
  const r: Route[] = [
    preflight("job-board", w.jb), preflight("layoff-filings", w.lf),
    { match: `^POST ${FN("job-board")} \\{"action":"status"\\}`, body: JSON.stringify({ version: w.build, catalogSize: w.size, catalogHighwater: w.mark, orphanPruneBlocked: w.mark !== null && w.size < w.mark, sliceStats: ss, passEnd }) },
    ...batches.map((b): Route => ({ match: `${LIST},"companies":\\[${b.map((t) => `"${esc(t)}"`).join(",")}\\],"countOnly":true`, body: goneReply(b) })),
    { match: `${LIST},"companies":\\["helsing"\\],"vendor":\\["pinpoint"\\]`, body: w.helsing === "uncarried" ? uncarriedReply(["helsing"]) : JSON.stringify({ total: w.helsing }) },
    { match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_company_fill_curve", body: JSON.stringify(GONE.map(tok).filter((t) => !w.curveDrops.includes(t)).map((t) => ({ company_token: t, open_roles: w.gone[t] ?? 0, fills_90d: 0 }))) },
  ];
  for (const k of KEPT) r.push({ match: `${LIST},"companies":\\["${esc(tok(k))}"\\],"vendor":\\["${vendor(k)}"\\],"countOnly":true`, body: JSON.stringify({ total: w.kept[k] ?? 0 }) });
  for (const k of LABELLED) {
    const L = w.labelled[k];
    const rows = Array.from({ length: Math.min(L.unflagged, 60) }, (_, i) => ({ id: `${k}:${i}`, source: vendor(k), token: tok(k), agency: false, recheckedAt: L.rechecked ?? H(30) }));
    r.push({ match: `${LIST},"companies":\\["${esc(tok(k))}"\\],"vendor":\\["${vendor(k)}"\\],"excludeAgencies":true`, body: JSON.stringify({ jobs: rows, total: L.unflagged }) });
    r.push({ match: `${LIST},"companies":\\["${esc(tok(k))}"\\],"vendor":\\["${vendor(k)}"\\],"countOnly":true`, body: JSON.stringify({ total: L.total }) });
  }
  for (const k of SERVED) {
    const s = w.served[k];
    r.push({ match: `${LIST},"companies":\\["${esc(tok(k))}"\\],"vendor":\\["${vendor(k)}"\\],"countOnly":true`, body: s === "uncarried" ? uncarriedReply([tok(k)]) : JSON.stringify({ total: s }) });
  }
  return r;
}

const SERVED_SINCE = H(30);
const TODAY_GONE: Record<string, number> = Object.fromEntries(GONE.map((k) => [tok(k), 0]));
Object.assign(TODAY_GONE, { eutalents: 3269, JobsForHumanity: 143, "login-esms-saasfaukgovprod1~ocs~CX_1": 149, "careers.spglobal.com": 233, boggimilano: 34 });
const KEPT_TODAY: Record<string, number> = Object.fromEntries(KEPT.map((k) => [k, 20]));
KEPT_TODAY[LCC] = 149;
const LAB_BEFORE = Object.fromEntries(LABELLED.map((k) => [k, { total: 12, unflagged: 12 }]));
const LAB_AFTER = Object.fromEntries(LABELLED.map((k) => [k, { total: 12, unflagged: 0 }]));

/** .101 serving today: the retired boards carried, with their rows. */
const today = (): World => ({
  jb: "job-board.2026-09-09.101", lf: "layoff-filings.2026-10-26.1",
  size: 44523, mark: 44523, build: "2026-09-09.101", buildSince: H(200),
  serveAt: H(0.5), serveBuild: "2026-09-09.101",
  carried: GONE.map(tok), gone: { ...TODAY_GONE }, curveDrops: [], helsing: 0,
  kept: { ...KEPT_TODAY }, labelled: LAB_BEFORE,
  served: { "ashby:wayve": 0, "ashby:clickhouse": 0, "greenhouse:machindustries": "uncarried", "workday:convergint~wd501~Gbl": "uncarried" },
});
/** .102 serving 30 h, the migration applied, a pass end after it: every claim true. */
const good = (over: Partial<World> = {}): World => ({
  jb: "job-board.2026-09-09.102", lf: "layoff-filings.2026-11-11.1",
  size: 44499, mark: 44499, build: "2026-09-09.102", buildSince: SERVED_SINCE,
  serveAt: H(1), serveBuild: "2026-09-09.102",
  carried: [], gone: Object.fromEntries(GONE.map((k) => [tok(k), 0])), curveDrops: [], helsing: 0,
  kept: { ...KEPT_TODAY, [LCC]: 148 }, labelled: LAB_AFTER,
  served: { "ashby:wayve": 160, "ashby:clickhouse": 200, "greenhouse:machindustries": 180, "workday:convergint~wd501~Gbl": 90 },
  ...over,
});
const SEEN = { VD102C_MIGRATED_AT: H(5), VD102C_LCC_PRE: "149" };
const only = (w: World, env: Record<string, string> = SEEN) => fails(run(routes(w), env).lines);

describe("the section's keys are the catalogue's", () => {
  it("names 24 retired keys absent from the catalogue whose tokens no vendor carries, and nine kept twins, six labelled boards and four new keys it carries", () => {
    const keys = new Set(JOB_SOURCES.map((s) => `${s.source}:${s.token}`));
    const tokens = new Set(JOB_SOURCES.map((s) => s.token));
    expect(GONE).toHaveLength(24);
    expect(GONE.filter((k) => keys.has(k))).toEqual([]);
    expect(GONE.filter((k) => tokens.has(tok(k))), "a retired token another vendor carries is not counted by token").toEqual([]);
    expect(GONE).not.toContain("pinpoint:helsing");
    expect(KEPT).toHaveLength(9);
    expect(KEPT.filter((k) => !keys.has(k))).toEqual([]);
    expect(GONE.slice(6, 15), "each kept twin sits beside its retired twin").toEqual([
      "oracle:login-esms-saasfaukgovprod1~ocs~CX_1", "adp:1da67361-03ef-4aa2-8925-9ef512ba7c42", "adp:48d65e3f-dbfc-44b9-996a-65283fbdcee9",
      "adp:ba397985-19df-4126-90de-3220631304e5", "recruitee:boggimilano", "recruitee:easyapplyrimutee", "breezy:cdpdoctor",
      "paylocity:0c4c3299-d50f-40e2-aca1-0de562ac280d", "paylocity:b8c553b7-79ad-4da0-a8b2-3ce8e842324a",
    ]);
    expect(KEPT[0]).toBe(LCC);
    expect(LABELLED.filter((k) => !keys.has(k))).toEqual([]);
    for (const k of LABELLED) expect((JOB_SOURCES.find((s) => `${s.source}:${s.token}` === k) as { agency?: boolean }).agency, k).toBe(true);
    expect(SERVED).toEqual(["ashby:wayve", "ashby:clickhouse", "greenhouse:machindustries", "workday:convergint~wd501~Gbl"]);
    expect(SERVED.filter((k) => !keys.has(k))).toEqual([]);
  });

  it("its high-water is the size .102 shipped, which board .103's prune shrank: a build after .102 is section 49's to judge", () => {
    const f103 = JSON.parse(readFileSync(resolve(ROOT, "src/test/fixtures/board-103-catalogue-2026-11-17.json"), "utf8")) as { catalogue: { before: number; after: number } };
    expect(/const CATALOGUE=(\d+),/.exec(SECTION)?.[1]).toBe(String(f103.catalogue.before));
    expect(f103.catalogue.after).toBe(JOB_SOURCES.length);
  });
});

describe("the board .102 catalogue section", () => {
  it("a good deploy passes every claim and fails none", () => {
    const { lines, out } = run(routes(good()), SEEN);
    expect(fails(lines), out).toEqual([]);
    for (const claim of [/^PASS {2}B1 /, /^PASS {2}B2 /, /^PASS {2}H /, /^PASS {2}R1 /, /^PASS {2}R2 the 24 retired tokens serve 0 open rows/, /^PASS {2}T oracle:fa-esms.* keeps 148 row\(s\) of the 149/]) {
      expect(lines.some((l) => claim.test(l)), `${claim}\n${out}`).toBe(true);
    }
    expect(passes(lines).filter((l) => /^PASS {2}T .* serves 0 open rows/.test(l)), out).toHaveLength(9);
    expect(passes(lines).filter((l) => /^PASS {2}A /.test(l)), out).toHaveLength(6);
    expect(passes(lines).filter((l) => /^PASS {2}[DC] /.test(l)), out).toHaveLength(4);
    expect(lines.some((l) => /^INFO {2}R3 pinpoint:helsing serves 0 rows by its vendor; it served 0 before the paste too/.test(l)), out).toBe(true);
  });

  it("the build live today fails nothing, judges nothing of .102, and saves the counts the paste is judged against", () => {
    const state = newState();
    const { lines, out } = run(routes(today()), {}, state);
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toEqual([]);
    expect(lines.some((l) => /^INFO {2}R2 the 24 retired tokens serve 3828 open row\(s\) on 5 board\(s\) \(teamtailor:eutalents 3269/.test(l)), out).toBe(true);
    expect(lines.some((l) => /^INFO {2}H catalogSize 44523, catalogHighwater 44523, orphanPruneBlocked false/.test(l)), out).toBe(true);
    const saved = JSON.parse(readFileSync(state, "utf8"));
    expect(saved.prePaste.kept[LCC]).toBe(149);
    expect(saved.prePaste.gone["teamtailor:eutalents"]).toBe(3269);
    expect(saved.migratedSeenAt).toBeUndefined();
  });

  it("the saved count is what the LCC twin is judged against after the paste", () => {
    const state = newState();
    run(routes(today()), {}, state);
    const kept = (n: number) => run(routes(good({ kept: { ...KEPT_TODAY, [LCC]: n } })), { VD102C_MIGRATED_AT: H(5) }, state);
    expect(fails(kept(135).lines)).toEqual([]);
    expect(fails(kept(120).lines)).toEqual([expect.stringMatching(/^FAIL {2}T oracle:fa-esms-saasfaukgovprod1~ocs~CX_1 \(LCC\) serves 120 row\(s\), under 90% of the 149 saved before the paste/)]);
    // The save is made only before the paste: a .102 run never overwrites it.
    expect(JSON.parse(readFileSync(state, "utf8")).prePaste.kept[LCC]).toBe(149);
    const none = run(routes(good()), { VD102C_MIGRATED_AT: H(5) });
    expect(fails(none.lines)).toEqual([]);
    expect(none.lines.some((l) => /^INFO {2}T .*\(LCC\) serves 148 row\(s\), and no count was saved before the paste/.test(l)), none.out).toBe(true);
  });

  it("the rows are judged only after a pass-end serve step that followed the first sighting of the migration", () => {
    const state = newState();
    // .102 serving, the mark lowered, the last serve step before this run: the sighting is recorded and the rows wait.
    const first = run(routes(good({ serveAt: H(2), gone: { ...TODAY_GONE } })), { VD102C_LCC_PRE: "149" }, state);
    expect(fails(first.lines), first.out).toEqual([]);
    expect(first.lines.some((l) => /^INFO {2}R2 the 24 retired tokens serve 3828 open row\(s\).*no pass-end serve step of 2026-09-09\.102 has finished since/.test(l)), first.out).toBe(true);
    const seenAt = JSON.parse(readFileSync(state, "utf8")).migratedSeenAt;
    expect(Date.parse(seenAt)).toBeGreaterThan(Date.now() - 60_000);
    // A serve step finishes after the sighting and the rows are still there: FAIL.
    const later = new Date(Date.parse(seenAt) + 1000).toISOString();
    const after = run(routes(good({ serveAt: later, gone: { ...TODAY_GONE } })), { VD102C_LCC_PRE: "149" }, state);
    expect(fails(after.lines).filter((l) => /^FAIL {2}R2 /.test(l)), after.out).toEqual([expect.stringMatching(/^FAIL {2}R2 3828 open row\(s\) of 5 retired board\(s\) still serve after the pass-end serve step of/)]);
    // The sighting is kept, never moved by a later run.
    expect(JSON.parse(readFileSync(state, "utf8")).migratedSeenAt).toBe(seenAt);
    // VD102C_MIGRATED_AT states the apply time instead.
    expect(fails(run(routes(good({ serveAt: H(1), gone: { ...TODAY_GONE } })), { VD102C_MIGRATED_AT: H(3), VD102C_LCC_PRE: "149" }).lines).some((l) => /^FAIL {2}R2 /.test(l))).toBe(true);
    expect(fails(run(routes(good({ serveAt: H(4), gone: { ...TODAY_GONE } })), { VD102C_MIGRATED_AT: H(3), VD102C_LCC_PRE: "149" }).lines).some((l) => /^FAIL {2}R2 /.test(l))).toBe(false);
  });

  it("each build fails alone: a missing header, or one function shipped without the other", () => {
    expect(only(good({ jb: null }))).toEqual(expect.arrayContaining([expect.stringMatching(/^FAIL {2}B1 job-board preflight carries no x-fn-build/)]));
    expect(only(good({ lf: null }))).toEqual([expect.stringMatching(/^FAIL {2}B2 layoff-filings preflight carries no x-fn-build/)]);
    expect(only(good({ lf: "layoff-filings.2026-10-26.1" }))).toEqual([expect.stringMatching(/^FAIL {2}B2 layoff-filings x-fn-build = layoff-filings\.2026-10-26\.1, older than 2026-11-11\.1, while job-board \.102 serves/)]);
    expect(only({ ...today(), lf: "layoff-filings.2026-11-11.1" }, {})).toEqual([expect.stringMatching(/^FAIL {2}B1 job-board x-fn-build = job-board\.2026-09-09\.101, older than \.102, while layoff-filings serves/)]);
    expect(fails(run(routes(good({ jb: "job-board.2026-09-09.140", lf: "layoff-filings.2026-12-01.2" })), SEEN).lines)).toEqual([]);
  });

  it("the high-water fails 24 h after .102 first sliced while it blocks the prune, at once on another catalogue size, and waits before", () => {
    expect(only(good({ mark: 44523 }))).toEqual(expect.arrayContaining([expect.stringMatching(/^FAIL {2}H catalogSize 44499, catalogHighwater 44523, orphanPruneBlocked true 3\d\.\d h after \.102 first sliced: the prune is blocked/)]));
    const young = run(routes(good({ mark: 44523, buildSince: H(3) })), SEEN);
    expect(fails(young.lines).filter((l) => /^FAIL {2}H /.test(l)), young.out).toEqual([]);
    expect(young.lines.some((l) => /^INFO {2}H .*20261111120000 has not applied yet/.test(l)), young.out).toBe(true);
    expect(only(good({ size: 44523, mark: 44523 }))).toEqual([expect.stringMatching(/^FAIL {2}H the serving bundle carries 44523 boards, not the 44499 of \.102/)]);
    // A later build may carry another catalogue: its size is not asked to be 44,499, and a mark off it is INFO.
    const later = (o: Partial<World>) => run(routes(good({ jb: "job-board.2026-09-09.103", build: "2026-09-09.103", ...o })), SEEN);
    const grown = later({ size: 44612, mark: 44612 });
    expect(fails(grown.lines), grown.out).toEqual([]);
    expect(grown.lines.some((l) => /^PASS {2}H catalogSize 44612, catalogHighwater 44612, orphanPruneBlocked false/.test(l)), grown.out).toBe(true);
    const off = later({ size: 44612, mark: 44700 });
    expect(fails(off.lines).filter((l) => /^FAIL {2}H /.test(l)), off.out).toEqual([]);
    expect(off.lines.some((l) => /^INFO {2}H catalogSize 44612, catalogHighwater 44700, orphanPruneBlocked true on 2026-09-09\.103, a build after \.102/.test(l)), off.out).toBe(true);
    const noRow = run(routes(good({ mark: null })), SEEN);
    expect(fails(noRow.lines)).toEqual([]);
    expect(noRow.lines.some((l) => /^INFO {2}H .*no high-water row/.test(l))).toBe(true);
  });

  it("a retired token still carried fails", () => {
    expect(only(good({ carried: ["eutalents", "corgi"] }))).toEqual([expect.stringMatching(/^FAIL {2}R1 the serving catalogue still carries 2 retired key\(s\): teamtailor:eutalents, ashby:corgi/)]);
  });

  it("a retired token the board resolved to another board by name, or did not look up, is uncarried, and the tokens go five to a call", () => {
    const named = run(routes(good({ byName: { deepmind: ["google-deepmind"], "careers.spglobal.com": ["spglobal"], boggimilano: ["boggimilano1"] } })), SEEN);
    expect(fails(named.lines), named.out).toEqual([]);
    expect(named.lines.some((l) => /^PASS {2}R1 /.test(l)), named.out).toBe(true);
    const fewer = run(routes(good({ lookUp: 2 })), SEEN);
    expect(fails(fewer.lines), fewer.out).toEqual([]);
    expect(fewer.lines.some((l) => /^PASS {2}R1 /.test(l)), fewer.out).toBe(true);
    const lists = named.calls.map((c) => c.split("\t")[2] ?? "").filter((a) => a.startsWith("{") && JSON.parse(a).action === "list" && !JSON.parse(a).vendor);
    expect(lists.map((a) => JSON.parse(a).companies.length)).toEqual([5, 5, 5, 5, 4]);
    expect(lists.flatMap((a) => JSON.parse(a).companies)).toEqual(GONE.map(tok));
  });

  it("a retired board's rows after the prune fail, and a fill curve that drops a token fails rather than hiding it", () => {
    expect(only(good({ gone: { ...good().gone, eutalents: 12 } }))).toEqual([expect.stringMatching(/^FAIL {2}R2 12 open row\(s\) of 1 retired board\(s\) still serve .*teamtailor:eutalents 12/)]);
    expect(only(good({ curveDrops: ["eutalents"] }))).toEqual([expect.stringMatching(/^FAIL {2}R2 get_company_fill_curve answered 23 row\(s\) for the 24 retired tokens and none \(or no open_roles\) for: teamtailor:eutalents/)]);
  });

  it("pinpoint:helsing's rows after the prune fail, and a catalogue with no helsing board at all fails", () => {
    expect(only(good({ helsing: 3 }))).toEqual([expect.stringMatching(/^FAIL {2}R3 pinpoint:helsing still serves 3 row\(s\) by its vendor/)]);
    expect(only(good({ helsing: "uncarried" }))).toEqual([expect.stringMatching(/^FAIL {2}R3 the serving catalogue carries no helsing board at all/)]);
  });

  it("a retired twin's rows after the prune fail as postings listed twice", () => {
    const f = only(good({ gone: { ...good().gone, cdpdoctor: 27 } }));
    expect(f).toEqual(expect.arrayContaining([expect.stringMatching(/^FAIL {2}T breezy:cdpdoctor still serves 27 open row\(s\) .*listed twice beside its twin breezy:community-dental-partners/)]));
    expect(f.every((l) => /^FAIL {2}(R2|T) /.test(l))).toBe(true);
  });

  it("a labelled board's unflagged rows fail once this build read the board or 24 h after the first slice, wait before, and an empty board is INFO", () => {
    const k = "workable:pavago";
    expect(only(good({ labelled: { ...LAB_AFTER, [k]: { total: 12, unflagged: 4, rechecked: H(2) } } }))).toEqual([expect.stringMatching(/^FAIL {2}A workable:pavago: 4 of 12 served row\(s\) carry no agency flag though this build read the board/)]);
    expect(only(good({ labelled: { ...LAB_AFTER, [k]: { total: 12, unflagged: 4, rechecked: H(40) } } }))).toEqual([expect.stringMatching(/^FAIL {2}A workable:pavago: 4 of 12 .* 24 h after \.102 first sliced/)]);
    const young = run(routes(good({ buildSince: H(3), labelled: { ...LAB_AFTER, [k]: { total: 12, unflagged: 4, rechecked: H(40) } } })), SEEN);
    expect(fails(young.lines).filter((l) => /^FAIL {2}A /.test(l)), young.out).toEqual([]);
    expect(young.lines.some((l) => /^INFO {2}A workable:pavago: 4 of 12 row\(s\) carry no agency flag yet/.test(l)), young.out).toBe(true);
    const empty = run(routes(good({ labelled: { ...LAB_AFTER, [k]: { total: 0, unflagged: 0 } } })), SEEN);
    expect(fails(empty.lines)).toEqual([]);
    expect(empty.lines.some((l) => /^INFO {2}A workable:pavago serves no row, so its label is not judged/.test(l))).toBe(true);
  });

  it("a repoint or Convergint not carried fails at once, and one serving nothing fails after 24 h", () => {
    expect(only(good({ served: { ...good().served, "greenhouse:machindustries": "uncarried" } }))).toEqual([expect.stringMatching(/^FAIL {2}D greenhouse:machindustries: the serving catalogue does not carry it/)]);
    expect(only(good({ served: { ...good().served, "workday:convergint~wd501~Gbl": "uncarried" } }))).toEqual([expect.stringMatching(/^FAIL {2}C workday:convergint~wd501~Gbl: the serving catalogue does not carry it/)]);
    expect(only(good({ served: { ...good().served, "ashby:wayve": 0 } }))).toEqual([expect.stringMatching(/^FAIL {2}D ashby:wayve serves no row 24 h after \.102 first sliced/)]);
    const young = run(routes(good({ buildSince: H(3), served: { ...good().served, "workday:convergint~wd501~Gbl": 0 } })), SEEN);
    expect(fails(young.lines)).toEqual([]);
    expect(young.lines.some((l) => /^INFO {2}C workday:convergint~wd501~Gbl serves no row yet/.test(l))).toBe(true);
  });

  it("unreadable answers fail and name what came back", () => {
    const broken = routes(good()).map((r) => (/action":"status/.test(r.match) ? { ...r, body: "<html>gateway</html>" } : r));
    expect(fails(run(broken, SEEN).lines)).toEqual(expect.arrayContaining([expect.stringMatching(/^FAIL {2}H status is unreadable: <html>gateway<\/html>/)]));
    const noCurve = routes(good()).map((r) => (/get_company_fill_curve/.test(r.match) ? { ...r, body: '{"message":"timeout"}' } : r));
    expect(fails(run(noCurve, SEEN).lines)).toEqual([expect.stringMatching(/^FAIL {2}R2 get_company_fill_curve is unreadable/)]);
  });

  it("every call is a preflight, a job-board status or list read with the probe header, or the anon fill-curve read; nothing else is sent and the key is never printed", () => {
    for (const w of [good(), today()]) {
      const { calls, out } = run(routes(w), SEEN);
      expect(calls.length).toBeGreaterThan(20);
      for (const c of calls) {
        const [, req, a, b] = c.split("\t");
        if (req.startsWith("OPTIONS ")) { expect(req, c).toMatch(/^OPTIONS https:\/\/p\.supabase\.co\/functions\/v1\/(job-board|layoff-filings)$/); continue; }
        if (req === "POST https://p.supabase.co/rest/v1/rpc/get_company_fill_curve") { expect(JSON.parse(a).p_tokens, c).toHaveLength(24); continue; }
        expect(req, c).toBe("POST https://p.supabase.co/functions/v1/job-board");
        expect(b, c).toBe("probe");
        expect(["status", "list"], c).toContain(JSON.parse(a).action);
      }
      expect(out).not.toContain(KEY);
    }
  });

  it("every line it prints is a verdict, and the state file is the only thing it writes", () => {
    const state = newState();
    const { out } = run(routes(today()), {}, state);
    for (const l of out.split("\n").filter(Boolean)) expect(l, l).toMatch(/^(PASS|FAIL|INFO) |^== 99zzzzzzz\. /);
    expect(existsSync(state)).toBe(true);
    const bodies = SECTION.replace(/\\"/g, '"');
    expect(bodies.match(/"action":"[a-z-]+"/g)?.length).toBeGreaterThan(5);
    expect(bodies).not.toMatch(/"action":"(?!status"|list")[a-z-]+"/);
  });
});
