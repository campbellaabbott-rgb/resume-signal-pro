// @vitest-environment node
//
// Node, not jsdom: this file runs a verifier section in bash, with a fake curl
// and a fake gh on PATH, through child_process.
/**
 * THE CI-TOOLING BUG-ROUND SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-bugs-ci-tooling.sh).
 *
 * The section runs with R answering a census fixture, a fake curl answering
 * the one closed-table read, a fake gh answering run and file reads, and the
 * table sweep section 40 leaves on disk written as a fixture:
 *   - production as it answered on 2026-11-15, before the merge, fails nothing
 *     but the harness the data-pages lane converts (on this lone branch);
 *   - S14X-094: a section 40 that still prints INFO for the unlisted definers
 *     is a FAIL, and so is a census that answers no count;
 *   - S14X-140: the closed table answering 200 is a FAIL; a harness that makes
 *     bare roles and asserts a refusal is a FAIL, read through the guard's own
 *     scan or, with no tsx, through grep; CI on main failing the guard is a
 *     FAIL, and every state before main carries it is INFO;
 *   - NB-13: no sweep, a table the sweep did not read, a sweep left by an
 *     earlier run, and a parse that found too few tables are each a FAIL;
 *   - the only requests are the census read, one GET and GitHub reads, and the
 *     key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONVERTED_BY_ANOTHER_LANE } from "./helpers/bare-role-harnesses";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION_PATH = "scripts/verify-deploy.d/99zzzzzzz-bugs-ci-tooling.sh";
const SECTION = readFileSync(resolve(ROOT, SECTION_PATH), "utf8");
const S40 = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/40-db-exposure.sh"), "utf8");
const KEY = "pk_test_SECRET_marker_citooling";
const GUARD = "src/test/every-pglite-harness-that-creates-the-client-roles-starts-from-supabases-default-grants.test.ts";

const FAKE_CURL = `#!/usr/bin/env bash
url=""; method=GET; w=""
while [ $# -gt 0 ]; do
  case "$1" in -X) method=$2; shift;; -w) w=$2; shift;; -d|--data) method=POST; shift;; -o|-H|-m|-A) shift;; http*) url=$1;; esac
  shift
done
echo "curl $method $url" >> "$VD_CALLS"
[ -n "$w" ] && printf '%s' "\${VD_CODE:-401}"
exit 0
`;
const FAKE_GH = `#!/usr/bin/env bash
echo "gh $*" >> "$VD_CALLS"
case "$1 $2" in
  "auth status") exit "\${GH_AUTH:-0}";;
  "run list") cat "$GH_DIR/runs.json"; exit 0;;
  "run view") if [ "$3" = "--job" ]; then cat "$GH_DIR/log.txt"; else cat "$GH_DIR/jobs.json"; fi; exit 0;;
esac
if [ "$1" = api ]; then [ "\${GH_GUARD:-no}" = yes ] && { echo name; exit 0; }; echo '{"message":"Not Found"}' >&2; exit 1; fi
exit 1
`;
const FAKE_NPX = `#!/usr/bin/env bash
[ -n "\${NPX_OUT:-}" ] && { cat "$NPX_OUT"; exit 0; }
echo "npx: tsx not found" >&2; exit 1
`;

// client_callable_census as anon on 2026-11-15T22:12Z.
const LIVE = {
  closed: 56, definers: 294, allowlisted: 64, closed_missing: 0, client_callable: 66,
  closed_still_callable: [], request_address_source: "cf", allowlisted_not_callable: [],
  closed_tables_still_open: [], unlisted_client_callable: 2, signed_in_only_open_to_anon: [],
};

/** Section 40's sweep as it left /tmp on 2026-11-15: 72 refused, 70 empty, 2 aggregates, 1 not served. */
function sweep(n = 145, unread = 0): { txt: string; tsv: string } {
  const names = Array.from({ length: n }, (_, i) => `t${String(i).padStart(3, "0")}`);
  const row = (t: string, i: number) => {
    const [s, k] = i < 72 ? ["401", "42501"] : i < 142 ? ["200", "empty"] : i < 144 ? ["200", "rows"] : ["404", "PGRST205"];
    return `${t}\t20260101000000\t${s}\t${k}`;
  };
  return {
    txt: names.map((t) => `${t} id 20260101000000`).join("\n") + "\n",
    tsv: names.slice(0, n - unread).map(row).join("\n") + "\n",
  };
}

type Gh = { auth?: number; guard?: boolean; runs?: unknown; jobs?: unknown; log?: string };
type Opts = {
  census?: unknown;
  code?: string;
  /** JSON a fake npx prints; null = a fake npx that cannot run tsx; undefined = the real npx. */
  npx?: unknown;
  gh?: Gh;
  tables?: { txt: string; tsv: string; ageHours?: number } | null;
  cwd?: string;
};
const RUN_IN_PROGRESS = [{ databaseId: 101, headSha: "d69e3fa8aaaabbbbccccddddeeeeffff00001111", conclusion: "", status: "in_progress" }];
const jobsWith = (conclusion: string, id = 101) => ({ databaseId: id, jobs: [
  { name: "deno-tests", databaseId: 7, steps: [] },
  { name: "test", databaseId: 9, steps: [{ name: "Install deps", conclusion: "success" }, { name: "Tests (includes golden detection corpus)", conclusion, status: conclusion ? "completed" : "in_progress" }] },
] });

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

function run(o: Opts = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = tmp("vdbct-");
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "gh"));
  for (const [n, body] of [["curl", FAKE_CURL], ["gh", FAKE_GH]] as const) {
    writeFileSync(join(dir, "bin", n), body);
    chmodSync(join(dir, "bin", n), 0o755);
  }
  if (o.npx !== undefined) {
    writeFileSync(join(dir, "bin", "npx"), FAKE_NPX);
    chmodSync(join(dir, "bin", "npx"), 0o755);
    if (o.npx !== null) writeFileSync(join(dir, "npx.json"), JSON.stringify(o.npx));
  }
  const gh = o.gh ?? {};
  writeFileSync(join(dir, "gh", "runs.json"), JSON.stringify(gh.runs ?? RUN_IN_PROGRESS));
  writeFileSync(join(dir, "gh", "jobs.json"), JSON.stringify(gh.jobs ?? jobsWith("")));
  writeFileSync(join(dir, "gh", "log.txt"), gh.log ?? "");
  const census = o.census ?? LIVE;
  writeFileSync(join(dir, "census.json"), typeof census === "string" ? census : JSON.stringify(census));
  const tables: Opts["tables"] = o.tables === undefined ? sweep() : o.tables;
  if (tables) {
    writeFileSync(join(dir, "vd_40_tables.txt"), tables.txt);
    writeFileSync(join(dir, "vd_40_tables.tsv"), tables.tsv);
    if (tables.ageHours) { const t = (Date.now() - tables.ageHours * 3600_000) / 1000; utimesSync(join(dir, "vd_40_tables.tsv"), t, t); }
  }
  writeFileSync(join(dir, "calls.log"), "");
  // The section's own files move to this directory; the sed pattern that names
  // section 40's census file stays, so the cut block is rewritten as it is live.
  const body = SECTION.split("/tmp/vd_bct_").join(`${dir}/vd_bct_`).split("/tmp/vd_40_tables").join(`${dir}/vd_40_tables`);
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co\nR() { echo "R $*" >> "$VD_CALLS"; cat "${join(dir, "census.json")}"; }\n`;
  writeFileSync(join(dir, "run.sh"), prelude + body);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_CALLS: join(dir, "calls.log"), VD_CODE: o.code ?? "401",
    GH_DIR: join(dir, "gh"), GH_AUTH: String(gh.auth ?? 0), GH_GUARD: gh.guard ? "yes" : "no",
    NPX_OUT: o.npx !== undefined && o.npx !== null ? join(dir, "npx.json") : "",
  };
  const out = execFileSync("bash", [join(dir, "run.sh")], { cwd: o.cwd ?? ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] });
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}
const show = (lines: string[]) => lines.join("\n");
const tagged = (lines: string[], tag: string) => lines.filter((l) => l.includes(` ${tag} `));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

/** A checkout carrying section 40 as it was before this round: the unlisted count as INFO. */
function checkoutWithOldSection40(): string {
  const old = S40.replace('else ok(false,c.unlisted_client_callable+" client-callable', 'else info(c.unlisted_client_callable+" client-callable');
  expect(old, "section 40's S14X-094 line could not be put back as it was").not.toBe(S40);
  const cwd = tmp("vdbct-old-");
  mkdirSync(join(cwd, "scripts/verify-deploy.d"), { recursive: true });
  writeFileSync(join(cwd, "scripts/verify-deploy.d/40-db-exposure.sh"), old);
  return cwd;
}
/** A checkout of two harnesses, read by grep: one makes the roles holding nothing and asserts a refusal. */
function checkoutForGrep(): string {
  const cwd = tmp("vdbct-grep-");
  mkdirSync(join(cwd, "scripts/verify-deploy.d"), { recursive: true });
  mkdirSync(join(cwd, "src/test"), { recursive: true });
  copyFileSync(resolve(ROOT, "scripts/verify-deploy.d/40-db-exposure.sh"), join(cwd, "scripts/verify-deploy.d/40-db-exposure.sh"));
  // Built from parts, so this file never reads as a harness itself.
  const roles = ["CREATE", "ROLE", "anon;"].join(" ");
  const refusal = ["permission", "denied"].join(" ");
  writeFileSync(join(cwd, "src/test/bare.test.ts"), `await db.exec("${roles}");\nawait expect(q).rejects.toThrow(/${refusal}/);\n`);
  writeFileSync(join(cwd, "src/test/converted.test.ts"), `import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";\nawait db.exec(\`\${SUPABASE_DEFAULTS} ${roles}\`);\nawait expect(q).rejects.toThrow(/${refusal}/);\n`);
  return cwd;
}

describe("production as it answered on 2026-11-15, before the merge", () => {
  const today = run();
  it("fails nothing but the harness the data-pages lane converts, and passes the census, the closed table and the sweep", () => {
    const { lines } = today;
    expect(lines.some((l) => /^PASS {2}S14X-094 section 40 FAILs on the 2 client-callable definer/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO {2}S14X-094 the owner names them with admin-ops client_callable_unlisted_names/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^PASS {2}S14X-140a checkout_resume_refs refuses the publishable key \(401\)/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO {2}S14X-140c the latest CI run on main \(101, d69e3fa8\) predates the guard/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^PASS {2}NB-13 section 40 read every one of the 145 tables/.test(l)), show(lines)).toBe(true);
    expect(lines.some((l) => /^INFO {2}NB-13 the sweep: 72 refused, 70 open with no row visible.*2 serving rows, 1 not served/.test(l)), show(lines)).toBe(true);
    const elsewhere = Object.keys(CONVERTED_BY_ANOTHER_LANE);
    for (const f of fails(lines)) {
      expect(f, "only S14X-140b may fail before data-pages lands").toMatch(/^FAIL {2}S14X-140b \d+ pglite harness\(es\)/);
      const named = f.slice(f.lastIndexOf(": ") + 2).split(", ");
      for (const n of named) expect(elsewhere, `${n} is not a harness another lane converts`).toContain(n);
    }
    const harness = tagged(lines, "S14X-140b");
    expect(harness.length, show(lines)).toBeGreaterThanOrEqual(2);
  });

  it("reads the census once, sends one GET, reads GitHub only, and never prints the key", () => {
    const { calls, out } = today;
    expect(calls.filter((c) => c.startsWith("R "))).toEqual(["R client_callable_census"]);
    expect(calls.filter((c) => c.startsWith("curl "))).toEqual(["curl GET https://p.supabase.co/rest/v1/checkout_resume_refs?select=stripe_session_id&limit=1"]);
    const gh = calls.filter((c) => c.startsWith("gh "));
    expect(gh.length).toBeGreaterThanOrEqual(3);
    for (const c of gh) {
      expect(c, c).toMatch(/^gh (auth status|run list --workflow ci\.yml --branch main |api repos\/\{owner\}\/\{repo\}\/contents\/|run view )/);
      expect(c, c).not.toMatch(/ (-X|--method|-f|-F|--field|--raw-field|--input) /);
    }
    expect(out).not.toContain(KEY);
  });
});

describe("S14X-094, the census line", () => {
  it("is a FAIL while section 40 still prints the unlisted definers as INFO", () => {
    const { lines } = run({ cwd: checkoutWithOldSection40(), npx: null });
    const l = tagged(lines, "S14X-094");
    expect(l, show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-094 the live census counts 2 unlisted client-callable definer\(s\) and section 40 printed: INFO {2}2 client-callable definer function\(s\) appear in no list/)]);
  });
  it("is a FAIL when the census answers no count", () => {
    const { lines } = run({ census: '{"code":"PGRST202","message":"Could not find the function"}' });
    expect(tagged(lines, "S14X-094"), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-094 client_callable_census did not answer a count as anon: \{"code":"PGRST202"/)]);
  });
  it("passes when the census counts none outside the lists (the positive control)", () => {
    const { lines } = run({ census: { ...LIVE, unlisted_client_callable: 0 } });
    expect(tagged(lines, "S14X-094"), show(lines)).toEqual(["PASS  S14X-094 the live census counts no client-callable definer outside the lists"]);
  });
});

describe("S14X-140, the harnesses and the table they guard", () => {
  it("is a FAIL when checkout_resume_refs answers the publishable key, or answers nothing", () => {
    for (const code of ["200", "000"]) {
      const { lines } = run({ code, npx: { via: "tsx", refusing: [], bare: 30, overHelper: 15, seen: 154 } });
      expect(tagged(lines, "S14X-140a"), show(lines)).toEqual([`FAIL  S14X-140a checkout_resume_refs answered the publishable key ${code} (want 401: its REVOKE is missing live)`]);
    }
  });

  it("is a FAIL naming a harness the guard's scan finds making bare roles and asserting a refusal", () => {
    const { lines } = run({ npx: { via: "tsx", refusing: ["src/test/a-new-harness.test.ts"], bare: 30, overHelper: 15, seen: 155 } });
    expect(tagged(lines, "S14X-140b")[0], show(lines)).toBe("FAIL  S14X-140b 1 pglite harness(es) create the client roles holding nothing and assert a refusal, which then holds with the REVOKE deleted: src/test/a-new-harness.test.ts");
  });

  it("passes when the scan finds none, and fails a scan that read too few files to be this checkout", () => {
    const pass = run({ npx: { via: "tsx", refusing: [], bare: 30, overHelper: 15, seen: 154 } }).lines;
    expect(tagged(pass, "S14X-140b"), show(pass)).toEqual([
      "PASS  S14X-140b no pglite harness creates the client roles holding nothing and asserts a refusal (tsx, 154 files read)",
      "INFO  S14X-140b still bare and named, asserting no refusal: 30 file(s); asserting a refusal over a bare helper (another workstream's helpers): 15 file(s); both lists only shrink",
    ]);
    const thin = run({ npx: { via: "tsx", refusing: [], bare: 0, overHelper: 0, seen: 3 } }).lines;
    expect(tagged(thin, "S14X-140b"), show(thin)).toEqual([expect.stringMatching(/^FAIL {2}S14X-140b the harness scan saw 3 files .*it read the wrong tree/)]);
  });

  it("with no tsx, reads the checkout with grep and still fails the bare harness, not the converted one", () => {
    const { lines } = run({ cwd: checkoutForGrep(), npx: null });
    expect(tagged(lines, "S14X-140b"), show(lines)).toEqual([
      "FAIL  S14X-140b 1 pglite harness(es) create the client roles holding nothing and assert a refusal, which then holds with the REVOKE deleted: src/test/bare.test.ts",
      expect.stringMatching(/^INFO {2}S14X-140b read with grep \(no tsx\)/),
    ]);
  });

  it("is a FAIL only when CI on main carries the guard and its failing Tests step names it", () => {
    const at = (gh: Gh) => tagged(run({ npx: { via: "tsx", refusing: [], bare: 30, overHelper: 15, seen: 154 }, gh }).lines, "S14X-140c");
    expect(at({ guard: true, jobs: jobsWith("success") })).toEqual(["PASS  S14X-140c CI run 101 on main (d69e3fa8) carries the guard and its Tests step passed"]);
    expect(at({ guard: true, jobs: jobsWith("failure"), log: `test\tTests\t FAIL  ${GUARD} > the checkout > has no harness that creates the client roles holding nothing\n` }))
      .toEqual(["FAIL  S14X-140c CI run 101 on main (d69e3fa8): the default-grants guard failed"]);
    expect(at({ guard: true, jobs: jobsWith("failure"), log: "test\tTests\t FAIL  src/test/some-other-thing.test.ts > breaks\n" }))
      .toEqual([expect.stringMatching(/^INFO {2}S14X-140c .*the Tests step failed, and its log does not name the guard/)]);
    expect(at({ guard: true, jobs: jobsWith("") })).toEqual([expect.stringMatching(/^INFO {2}S14X-140c .*has not finished its Tests step/)]);
    expect(at({ guard: true, jobs: jobsWith("success", 999) })).toEqual([expect.stringMatching(/^INFO {2}S14X-140c .*could not be read \(unread\)/)]);
    expect(at({ auth: 1 })).toEqual([expect.stringMatching(/^INFO {2}S14X-140c gh is not installed or not signed in/)]);
    expect(at({ runs: [] })).toEqual(["INFO  S14X-140c the CI runs on main could not be listed"]);
  });
});

describe("NB-13, every table read as a stranger", () => {
  const nb13 = (tables: Opts["tables"]) => tagged(run({ tables, npx: { via: "tsx", refusing: [], bare: 30, overHelper: 15, seen: 154 } }).lines, "NB-13").filter((l) => !l.startsWith("INFO"));
  it("is a FAIL when section 40 left no sweep in this run", () => {
    expect(nb13(null)).toEqual([expect.stringMatching(/^FAIL {2}NB-13 section 40 left no table sweep in this run/)]);
  });
  it("is a FAIL naming a table the sweep did not read", () => {
    expect(nb13(sweep(145, 3))).toEqual(["FAIL  NB-13 section 40 left 3 table(s) unread: t142, t143, t144"]);
  });
  it("is a FAIL when the sweep on disk was left by an earlier run", () => {
    expect(nb13({ ...sweep(), ageHours: 7 })).toEqual([expect.stringMatching(/^FAIL {2}NB-13 the table sweep on disk is 7\.\d h old/)]);
  });
  it("is a FAIL when the parse found too few tables to be the migrations", () => {
    expect(nb13(sweep(40))).toEqual(["FAIL  NB-13 section 40 parsed only 40 tables from the migrations"]);
  });
});

describe("the section file", () => {
  it("is named to sort after every 99zzzzzz section and carries no write", () => {
    expect(SECTION_PATH.split("/").pop()! > "99zzzzzz-zzzz").toBe(true);
    const code = SECTION.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(code).not.toMatch(/curl[^\n]*(-X *(POST|PUT|PATCH|DELETE)|--data|\s-d\s)/);
    expect(code).not.toMatch(/gh [^\n]*(--method|-X |\s-f\s|\s-F\s)/);
    expect(code).not.toMatch(/\bgh (pr|issue|release|workflow run|run rerun|run cancel)\b/);
  });
});
