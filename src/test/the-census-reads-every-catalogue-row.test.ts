/**
 * THE CENSUS READS EVERY CATALOGUE ROW.
 *
 * Twelve census and merge scripts each read sources.ts with a regex of their
 * own. The catalogue was packed into u() literals on 2026-09-06, and on
 * 2026-11-08 those regexes saw 496 of its 44,523 boards: verify-all
 * re-probed boards we already carry, merge-all judged name collisions against
 * a twentieth of the names, and the dedupes kept agreeing that nothing was
 * carried twice.
 *
 * scripts/catalogue-reader.mjs now imports JOB_SOURCES, the array the bundle
 * builds: native type stripping where Node has it, tsx's ESM tsImport where it
 * does not (CI's Node 20), never a CJS require (it cannot load a top-level
 * await) and never a regex. This file holds it to the bundle, row for row, by
 * both routes, and holds every other script to it by a ratchet: a script that
 * reads catalogue fields with a regex must be on a named list that says why.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { CATALOG, PACKED_VENDOR_ORDER } from "./helpers/catalog";

const ROOT = resolve(__dirname, "../..");
const READER = resolve(ROOT, "scripts/catalogue-reader.mjs");
const SOURCES = resolve(ROOT, "supabase/functions/job-board/sources.ts");
const ROUTE_BUDGET_MS = 60_000;

type Row = [source: string, token: string, name: string, agency: boolean];

/** The reader, run as the census runs it: a Node child, from a directory that is not the repo. */
function readThrough(route: "native" | "tsx", path = SOURCES) {
  const code = [
    `const { readCatalogue } = await import(${JSON.stringify(pathToFileURL(READER).href)});`,
    `const rows = await readCatalogue(process.argv[1], { log: (m) => process.stderr.write(m + "\\n") });`,
    `process.stdout.write(JSON.stringify(rows.map((r) => [r.source, r.token, r.name, r.agency === true])));`,
  ].join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code, path], {
    cwd: tmpdir(),
    env: { ...process.env, CATALOGUE_READER_ROUTE: route },
    encoding: "utf8",
    maxBuffer: 64 << 20,
    timeout: ROUTE_BUDGET_MS - 5_000,
  });
  if (r.status !== 0) throw new Error(`the ${route} route failed (${r.status}): ${r.stderr}`);
  return { rows: JSON.parse(r.stdout) as Row[], log: r.stderr };
}

const bundle: Row[] = JOB_SOURCES.map((e) => [e.source, e.token, e.name, (e as { agency?: boolean }).agency === true]);

describe("the reader returns the array the bundle builds", () => {
  const native = readThrough("native");

  it("every row, in the bundle's order, with the agency flag", () => {
    expect(native.rows.length).toBe(JOB_SOURCES.length);
    expect(native.rows.length, "the test helper's parser disagrees on the count").toBe(CATALOG.length);
    expect(native.rows).toEqual(bundle);
    expect(native.rows.map((r) => r[1])).toEqual(CATALOG.map((e) => e.token));
  });

  it("sees every vendor of the packed index, each as often as the bundle does", () => {
    const count = (rows: Row[]) => rows.reduce((m, r) => m.set(r[0], (m.get(r[0]) ?? 0) + 1), new Map<string, number>());
    const mine = count(native.rows);
    for (const v of PACKED_VENDOR_ORDER) expect(mine.get(v) ?? 0, v).toBe(count(bundle).get(v) ?? 0);
    expect(PACKED_VENDOR_ORDER.filter((v) => (mine.get(v) ?? 0) > 0).length, "the packed vendors read as empty").toBeGreaterThan(10);
  });

  it("prints the absolute path it read and the route it read by", () => {
    expect(native.log).toContain(`catalogue: ${JOB_SOURCES.length} boards from ${SOURCES} (native)`);
  });

  it("reads the same rows by tsx, the route a Node without type stripping takes", () => {
    const tsx = readThrough("tsx");
    expect(tsx.rows).toEqual(native.rows);
    expect(tsx.log).toContain(`from ${SOURCES} (tsx)`);
  }, ROUTE_BUDGET_MS);

  it("answers --count with the bundle's length, the number section 90 compares", () => {
    const r = spawnSync(process.execPath, [READER, "--count"], { cwd: tmpdir(), encoding: "utf8", timeout: ROUTE_BUDGET_MS - 5_000 });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(String(JOB_SOURCES.length));
    expect(r.stderr).toContain(SOURCES);
  });
});

describe("a catalogue with a top-level await loads by both routes", () => {
  // A compressed catalogue decodes before it exports: a top-level await. A CJS
  // require cannot load that module at all, which is why neither route uses one.
  const TLA = [
    'type JobSourceKind = "lever";',
    'const rows: { name: string; source: JobSourceKind; token: string }[] = await Promise.resolve([{ name: "Acme", source: "lever", token: "acme" }]);',
    "export const JOB_SOURCES = rows;",
    "",
  ].join("\n");
  const inDir = (withPackage: boolean, fn: (file: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "catalogue-tla-"));
    try {
      if (withPackage) writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
      writeFileSync(join(dir, "sources.ts"), TLA);
      fn(join(dir, "sources.ts"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("natively, with no package.json beside it", () => {
    inDir(false, (file) => expect(readThrough("native", file).rows).toEqual([["lever", "acme", "Acme", false]]));
  });

  it("by tsx, under a package.json that says module, as the repo's does", () => {
    expect(JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).type).toBe("module");
    inDir(true, (file) => expect(readThrough("tsx", file).rows).toEqual([["lever", "acme", "Acme", false]]));
  }, ROUTE_BUDGET_MS);

  it("tsx is a devDependency in package.json and both text lockfiles, so CI's install carries the route", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(pkg.devDependencies?.tsx).toMatch(/^\^4\./);
    const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
    expect(lock.packages[""].devDependencies?.tsx).toBe(pkg.devDependencies.tsx);
    expect(lock.packages["node_modules/tsx"]?.version).toMatch(/^4\./);
    expect(readFileSync(resolve(ROOT, "bun.lock"), "utf8")).toContain(`"tsx": "${pkg.devDependencies.tsx}",`);
  });
});

describe("a merge sees a packed row", () => {
  it("merge-all counts a packed token as carried and a packed name as a collision", () => {
    // The regex merge-all read with saw object literals and s() calls only: a
    // packed board was neither a dupe nor a name, so it could merge twice.
    // realpath: the merge resolves its cwd-relative catalogue, and macOS's tmpdir is a link.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "merge-packed-")));
    try {
      mkdirSync(join(dir, "supabase/functions/job-board"), { recursive: true });
      writeFileSync(join(dir, "supabase/functions/job-board/sources.ts"), [
        'type JobSourceKind = "greenhouse" | "workday" | "lever";',
        'const V: JobSourceKind[] = ["greenhouse", "workday"];',
        'const u = (packed: string) => packed.split("\\n").map((r) => { const p = r.split("\\v"); return { name: p[0], source: V[+p[1]], token: p[2] }; });',
        "export const JOB_SOURCES = [",
        '  ...u("Acme Widgets\\v0\\vacme\\nBeta Foods\\v1\\vbeta~wd1~Careers"),',
        '  { name: "Gamma", source: "lever" as JobSourceKind, token: "gamma" },',
        "];",
        "",
      ].join("\n"));
      writeFileSync(join(dir, "verified.json"), JSON.stringify({
        greenhouse: [{ token: "ACME", name: "Acme Again", count: 9 }],
        lever: [{ token: "betafoods", name: "Beta Foods", count: 9, inWindow30: 9, dateBasis: "createdAt" }],
      }));
      writeFileSync(join(dir, "counts.json"), JSON.stringify({ "beta~wd1~careers": 40 }));
      const r = spawnSync(process.execPath, [resolve(ROOT, "scripts/merge-all.mjs"), "verified.json", "--carrier-counts", "counts.json"], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain(`catalogue: 3 boards from ${join(dir, "supabase/functions/job-board/sources.ts")}`);
      expect(r.stdout).toMatch(/"dupe":1/);
      expect(r.stdout).toMatch(/"nameCollision":1/);
      expect(r.stdout).toContain("workday:beta~wd1~Careers serves 40");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── the ratchet: who still reads catalogue fields with a regex ──────────────

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** A regex that captures a catalogue field: name:/source:/token: then a quote and a group, the s(" helper, or the packed \v separator. */
const FIELD_READ = /(?:source|token|name):(?:\\s[*+])? ?"\(|s\\\("|\\\\v\d?\\\\v\(/;

/**
 * Each still reads by regex, and each says why it may until its follow-up.
 * Removing a name here is the follow-up landing; adding one needs a reason.
 */
const STILL_BY_REGEX = new Map([
  ["tag-agencies.mjs", "rewrites object-literal lines in place; its re-point follows the catalogue lane's merge"],
  ["prerender-agency.mjs", "the bake's own reader, outside the census lane"],
  ["census-jazzhr.mjs", "a-career-page-with-no-feed-behind-it.test.ts pins its regex; re-pointed with that pin"],
  ["census-drivable-yield.mjs", "drivable-yield-census.test.ts and an-agency-is-disclosed-not-hidden.test.ts pin its regex; re-pointed with those pins"],
]);

describe("no script reads the catalogue by regex but the named few", () => {
  it("the scripts that do are exactly the named list", () => {
    const dir = resolve(ROOT, "scripts");
    const readers = readdirSync(dir)
      .filter((f) => /\.(mjs|cjs|js|ts)$/.test(f))
      .filter((f) => FIELD_READ.test(strip(readFileSync(join(dir, f), "utf8"))))
      .sort();
    expect(readers).toEqual([...STILL_BY_REGEX.keys()].sort());
  });

  it("TEETH: the detector catches each shape the twelve readers used", () => {
    for (const shape of [
      String.raw`src.matchAll(/source:\s*"(\w+)",\s*token:\s*"([^"]+)"/g)`,
      String.raw`catalog.matchAll(/token: "([^"]+)"/g)`,
      String.raw`src.matchAll(/name:\s*"((?:[^"\\]|\\.)*)"/g)`,
      String.raw`src.matchAll(/s\("(?:[^"\\]|\\.)*",\s*"workday",\s*"([^"]+)"/g)`,
      String.raw`SOURCES_TEXT.matchAll(/\\v0\\v([^"\\]+)/g)`,
      String.raw`const t = /token:\s*"([^"]+)"/.exec(b);`,
    ]) expect(FIELD_READ.test(shape), shape).toBe(true);
    expect(FIELD_READ.test("const rows = await readCatalogue(REPO_SOURCES);")).toBe(false);
    expect(FIELD_READ.test(strip('// matchAll(/token: "([^"]+)"/g) in a comment is no read\nconst x = 1;'))).toBe(false);
  });

  it("the sweden script's parser agrees with the reader, so the parser can retire", async () => {
    const { parseCatalog } = await import("../../scripts/sweden-jobtech-yield.mjs");
    const parsed = (parseCatalog(readFileSync(SOURCES, "utf8")) as { source: string; token: string; name: string }[]).map((e) => [e.source, e.token, e.name]);
    expect(parsed).toEqual(bundle.map((r) => [r[0], r[1], r[2]]));
  });
});

// ── OD8 and OD2 (2026-11-08) ────────────────────────────────────────────────

const SCRATCH_CATALOGUE = [
  "export const JOB_SOURCES = [",
  '  { name: "Visa", source: "smartrecruiters", token: "visa" },',
  "];",
  "",
].join("\n");

describe("OD8: the SmartRecruiters role-mix rule is retired", () => {
  const verify = strip(readFileSync(resolve(ROOT, "scripts/verify-all.mjs"), "utf8"));

  it("verify-all carries no professional or retail word list and no role-mix gate", () => {
    expect(verify).not.toMatch(/\broleMixOk\b/);
    expect(verify).not.toMatch(/\bconst (PRO|RETAIL)\b/);
  });

  it("the SmartRecruiters verifier still requires the posting floor every vendor meets", () => {
    const sr = /smartrecruiters: async \(t\) => \{[\s\S]*?\n {2}\},/.exec(verify)?.[0] ?? "";
    expect(sr, "the SR verifier was not found").not.toBe("");
    expect(sr).toMatch(/total < MIN_POSTINGS\) return null/);
  });

  it("no census script still prints the corporate-only rule, which the 2026-08-31 charter retired", () => {
    for (const f of ["census-custom-domains.mjs", "census-drivable-yield.mjs", "resolve-teamtailor-tokens.mjs", "merge-all.mjs", "verify-all.mjs"]) {
      const text = readFileSync(resolve(ROOT, "scripts", f), "utf8");
      expect(text, f).not.toMatch(/corporate-only/i);
    }
  });
});

describe("OD2: no new SmartRecruiters board is read or merged", () => {
  it("verify-all holds SmartRecruiters candidates unprobed without --allow-sr", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "od2-verify-")));
    try {
      writeFileSync(join(dir, "census.json"), JSON.stringify({ smartrecruiters: ["acmewidgets"], greenhouse: [] }));
      const r = spawnSync(process.execPath, [resolve(ROOT, "scripts/verify-all.mjs"), "census.json", "out.json"], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("smartrecruiters: 1 candidates HELD, not probed");
      expect(JSON.parse(readFileSync(join(dir, "out.json"), "utf8")).smartrecruiters).toEqual([]);
      expect(readFileSync(resolve(ROOT, "scripts/verify-all.mjs"), "utf8")).toMatch(/vendor === "smartrecruiters" && !ALLOW_SR/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merge-all --apply appends no SmartRecruiters row while SR_MERGE_HELD is set, and says so", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "od2-merge-")));
    try {
      mkdirSync(join(dir, "supabase/functions/job-board"), { recursive: true });
      writeFileSync(join(dir, "supabase/functions/job-board/sources.ts"), SCRATCH_CATALOGUE);
      writeFileSync(join(dir, "verified.json"), JSON.stringify({
        smartrecruiters: [{ token: "acmewidgets", name: "Acme Widgets", count: 12 }],
        lever: [{ token: "betafoods", name: "Beta Foods", count: 12 }],
      }));
      const r = spawnSync(process.execPath, [resolve(ROOT, "scripts/merge-all.mjs"), "verified.json", "--apply"], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/Held, smartrecruiters \(OD2, SR_MERGE_HELD 2026-11-08\): 1 not merged/);
      const after = readFileSync(join(dir, "supabase/functions/job-board/sources.ts"), "utf8");
      expect(after).not.toContain("acmewidgets");
      expect(after, "the other vendors still merge").toContain('{ name: "Beta Foods", source: "lever", token: "betafoods" }');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── the merge gates (2026-11-08) ────────────────────────────────────────────

/** One script run in a scratch checkout holding `catalogue`; returns its log and the catalogue it left. */
function scratchRun(script: string, catalogue: string, input: unknown, args: string[] = [], files: Record<string, unknown> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "census-gate-")));
  try {
    mkdirSync(join(dir, "supabase/functions/job-board"), { recursive: true });
    writeFileSync(join(dir, "supabase/functions/job-board/sources.ts"), catalogue);
    writeFileSync(join(dir, "in.json"), JSON.stringify(input));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(body));
    const r = spawnSync(process.execPath, [resolve(ROOT, "scripts", script), "in.json", ...args], {
      cwd: dir, encoding: "utf8", env: { ...process.env, VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    });
    return { status: r.status, log: r.stdout + r.stderr, after: readFileSync(join(dir, "supabase/functions/job-board/sources.ts"), "utf8"), dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("a board merges only with at least 3 postings dated within 30 days", () => {
  it("merge-all judges a dated hit by its in-window count and an undated one by its count, tallied apart", () => {
    const r = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, {
      lever: [
        { token: "stalecorp", name: "Stale Corp", count: 50, inWindow30: 2, dateBasis: "createdAt" },
        { token: "livecorp", name: "Live Corp", count: 50, inWindow30: 3, dateBasis: "createdAt" },
      ],
      bamboohr: [
        { token: "quietco", name: "Quiet Co", count: 5, inWindow30: null, dateBasis: "none" },
        { token: "tinyco", name: "Tiny Co", count: 2, inWindow30: null, dateBasis: "none" },
      ],
    }, ["--apply"]);
    expect(r.status, r.log).toBe(0);
    expect(r.log).toMatch(/"underThreeInWindow":1/);
    expect(r.log).toMatch(/"underThreePostings":1/);
    expect(r.log).toContain("1 kept boards state no date and were judged by posting count");
    expect(r.after).toContain('token: "livecorp"');
    expect(r.after).toContain('token: "quietco"');
    expect(r.after).not.toContain("stalecorp");
    expect(r.after).not.toContain("tinyco");
  });

  it("census-workday and its cluster twin read the size from the response's total and gate on fresh postings", () => {
    for (const f of ["census-workday.mjs", "census-workday-cluster.mjs"]) {
      const code = strip(readFileSync(resolve(ROOT, "scripts", f), "utf8"));
      expect(code, f).toMatch(/const total = Number\((body|parsed)\.total\);/);
      expect(code, f).toMatch(/if \(fresh\.length >= (MIN_POSTINGS|3)\) verified\.push\(\{ token: tok, name: prettify\(tenant\), count, inWindow30: fresh\.length, dateBasis: "postedOn, first page only"/);
      expect(code, f).not.toMatch(/items\.length >= (MIN_POSTINGS|3)\) verified\.push/);
    }
  });
});

describe("merge-oracle admits a new site of a carried tenant only when it lists requisitions the carried site does not", () => {
  const ORACLE = [
    "export const JOB_SOURCES = [",
    '  { name: "Acme Group", source: "oracle", token: "abcd~us2~CX_1" },',
    "];",
    "",
  ].join("\n");

  it("drops a mirror, holds an unread list, and passes a site with its own requisitions to the collision rule", () => {
    const r = scratchRun("merge-oracle.mjs", ORACLE, { resolved: [
      { name: "Acme Outlet", token: "abcd~us2~CX_2", count: 40 },
      { name: "Acme Pro", token: "abcd~us2~CX_3", count: 40 },
      { name: "Acme Labs", token: "abcd~us2~CX_4", count: 40 },
    ] }, ["--req-ids", "ids.json", "--cap", "0"], { "ids.json": { "abcd~us2~CX_1": [1, 2, 3], "abcd~us2~CX_2": [1, 2], "abcd~us2~CX_3": [1, 9] } });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toContain("dropped subSiteMirror: 1 — Acme Outlet (abcd~us2~CX_2): all 2 of its requisitions are listed by abcd~us2~CX_1");
    expect(r.log).toContain("held for review subSiteHeld: 1 — Acme Labs (abcd~us2~CX_4): its requisition ids could not be read in full");
    expect(r.log).toContain("sub-site: Acme Pro (abcd~us2~CX_3): 1 of its 2 requisitions are not listed by abcd~us2~CX_1");
  });

  it("dedupes the vendor-qualified token, and every Oracle host waits 1.1 s between requests", () => {
    const code = strip(readFileSync(resolve(ROOT, "scripts/merge-oracle.mjs"), "utf8"));
    expect(code).toMatch(/existingTokens\.has\(boardKey\("oracle", b\.token\)\)/);
    expect(code).toMatch(/\(lastRequestAt\.get\(host\) \?\? 0\) \+ 1100 - Date\.now\(\)/);
  });
});

describe("both --apply paths run the generated-module checks", () => {
  const reader = pathToFileURL(READER).href;
  const run = (code: string) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: tmpdir(), encoding: "utf8", timeout: ROUTE_BUDGET_MS - 5_000 });

  it("on this checkout's catalogue, both modules are checked", () => {
    const r = run(`const { REPO_SOURCES, runGeneratedChecks } = await import(${JSON.stringify(reader)}); const x = runGeneratedChecks(REPO_SOURCES); console.log(JSON.stringify(x));`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("src/lib/board-collisions.ts matches the catalogue");
    expect(r.stdout).toContain("src/lib/company/workday-multi-site-tenants.ts matches the catalogue");
    expect(r.stdout).toContain('{"ran":true,"stale":[]}');
  }, ROUTE_BUDGET_MS);

  it("a stale module is named with the command that regenerates it", () => {
    const r = run(`const { REPO_SOURCES, runGeneratedChecks } = await import(${JSON.stringify(reader)}); const exec = () => { const e = new Error("exit 1"); e.stdout = "stale: 2 rows differ"; throw e; }; console.log(JSON.stringify(runGeneratedChecks(REPO_SOURCES, { exec })));`);
    expect(r.stdout).toContain("scripts/board-collisions.ts --check FAILED: stale: 2 rows differ");
    expect(r.stdout).toContain("regenerate: npx tsx scripts/workday-multi-site-tenants.ts");
    expect(r.stdout).toContain('"stale":["scripts/board-collisions.ts","scripts/workday-multi-site-tenants.ts"]');
  });

  it("a scratch catalogue says the checks were skipped, and both merges call them after writing", () => {
    const r = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, { lever: [{ token: "livecorp", name: "Live Corp", count: 9 }] }, ["--apply"]);
    expect(r.log).toMatch(/generated-module checks skipped: .* is not this checkout's catalogue/);
    for (const f of ["merge-all.mjs", "merge-oracle.mjs"]) {
      const code = strip(readFileSync(resolve(ROOT, "scripts", f), "utf8"));
      expect(code, f).toMatch(/writeFileSync\(SOURCES, [\s\S]*?const checks = runGeneratedChecks\(SOURCES\);\nif \(checks\.stale\.length\) \{[^\n]*process\.exit\(1\); \}/);
    }
  });
});

// ── CAP-6 / CAP-11: what a batch would cost (2026-11-08) ───────────────────

describe("a merge prints what its batch would cost before it writes", () => {
  const BATCH = {
    lever: [{ token: "alphaone", name: "Alpha One", count: 300, inWindow30: 40, dateBasis: "createdAt" }],
    workday: [{ token: "beta~wd1~Careers", name: "Beta Two", count: 900, inWindow30: 120, dateBasis: "postedOn, first page only" }],
  };
  const CLEARED = [{ vendor: "lever", token: "alphaone" }, { vendor: "workday", token: "beta~wd1~Careers" }];

  it("prints fetched volume, lap growth, the room guard and bytes per posting", () => {
    const r = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, BATCH, ["--status", "st.json"], { "st.json": { totalPostings: 1_000_000 } });
    expect(r.status, r.log).toBe(0);
    expect(r.log).toContain("lever                1 boards, fetched per lap 250, in-window rows 40");
    expect(r.log).toContain("workday              1 boards, fetched per lap 500, in-window rows 120");
    expect(r.log).toContain("all                  2 boards, fetched per lap 750, in-window rows 160");
    expect(r.log).toMatch(/lap: \+0\.016 min on a 357-minute lap \(0\.0%; from section 90's reference lap/);
    expect(r.log).toContain("room: 150000 under the 1150000 target against 1.5 x 160 = 240 needed: fits");
    expect(r.log).toMatch(/catalogue bytes: \d+ \(\d+\.\d\d per projected posting\)/);
  });

  it("--apply is refused above 10% lap growth unless --tranche-ok", () => {
    const refused = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, BATCH, ["--apply", "--lap-min", "0.1"], { "round3-mill-cleared.json": CLEARED });
    expect(refused.status).toBe(1);
    expect(refused.log).toContain("REFUSING to apply: the lap grows 16.0% (> 10%): pass --tranche-ok to accept it");
    expect(refused.after).not.toContain("alphaone");
    const accepted = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, BATCH, ["--apply", "--lap-min", "0.1", "--tranche-ok"], { "round3-mill-cleared.json": CLEARED });
    expect(accepted.status, accepted.log).toBe(0);
    expect(accepted.after).toContain('token: "alphaone"');
  });

  it("--apply is refused when the room does not hold 1.5x the batch's in-window rows, whatever the flags", () => {
    const r = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, BATCH, ["--apply", "--tranche-ok", "--status", "st.json"], { "st.json": { totalPostings: 1_149_900 }, "round3-mill-cleared.json": CLEARED });
    expect(r.status).toBe(1);
    expect(r.log).toContain("REFUSING to apply: the room under the corpus target (100) does not hold 1.5 x 160 in-window rows");
    expect(r.after).not.toContain("alphaone");
  });

  it("merge-oracle sizes its tranche by the room guard, and refuses --apply with neither a room read nor a cap", () => {
    const resolved = { resolved: [{ name: "Gamma Three", token: "gggg~us2~CX_1", count: 100 }] };
    const sized = scratchRun("merge-oracle.mjs", SCRATCH_CATALOGUE, resolved, ["--status", "st.json"], { "st.json": { totalPostings: 1_149_940 } });
    expect(sized.status, sized.log).toBe(0);
    expect(sized.log).toContain("tranche budget: 40 in-window rows (room 60 under 1150000 / 1.5 = 40)");
    expect(sized.log).toContain("kept 0 boards");
    const refused = scratchRun("merge-oracle.mjs", SCRATCH_CATALOGUE, resolved, ["--apply"]);
    expect(refused.status).toBe(1);
    expect(refused.log).toContain("REFUSING to apply: the room under the corpus target was not read");
    expect(strip(readFileSync(resolve(ROOT, "scripts/merge-oracle.mjs"), "utf8"))).not.toMatch(/85_000|85000/);
  });

  it("the corpus target the guard reads is job-board's own", () => {
    const index = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
    const live = /const CORPUS_TARGET = ([\d_]+);/.exec(index)?.[1];
    expect(live, "CORPUS_TARGET not found in index.ts").toBeTruthy();
    const mine = /export const CORPUS_TARGET = ([\d_]+);/.exec(readFileSync(READER, "utf8"))?.[1];
    expect(Number(mine?.replace(/_/g, ""))).toBe(Number(live!.replace(/_/g, "")));
  });
});

// ── the repeated-title flag (2026-11-08): printed for review, excludes nothing ─

describe("the repeated-title flag is printed for a person and excludes nothing", () => {
  const flagOf = (sample: unknown) => {
    const code = `const { repeatedTitleFlag } = await import(${JSON.stringify(pathToFileURL(READER).href)}); console.log(JSON.stringify(repeatedTitleFlag(${JSON.stringify(sample)})));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: tmpdir(), encoding: "utf8" });
    return JSON.parse(r.stdout) as string | null;
  };
  const titles = ["Nurse", "Welder", "Driver", "Chef", "Cleaner", "Porter"];

  it("flags six distinct titles across sixty postings (the EUTALENTS shape)", () => {
    expect(flagOf(Array.from({ length: 60 }, (_, i) => ({ t: titles[i % 6] })))).toBe("6 distinct titles in 60 sampled");
  });
  it("flags one title posted in five cities, and one posted in two stated languages", () => {
    expect(flagOf(["Leeds", "York", "Hull", "Bath", "Kent"].map((c) => ({ t: "Care Assistant", c })))).toBe('"care assistant" in 5 cities');
    expect(flagOf([{ t: "Nurse", l: "en" }, { t: "Nurse", l: "de" }, { t: "Chef", l: "en" }])).toBe('"nurse" in 2 languages');
  });
  it("leaves an ordinary board alone, and an empty sample unjudged", () => {
    expect(flagOf(Array.from({ length: 20 }, (_, i) => ({ t: `Role ${i}`, c: ["Paris", "Lyon", "Nice"][i % 3] })))).toBeNull();
    expect(flagOf(Array.from({ length: 4 }, () => ({ t: "Nurse", c: "Leeds" })))).toBeNull();
    expect(flagOf([])).toBeNull();
  });

  it("merge-all prints the flag and still merges the board", () => {
    const sample = Array.from({ length: 60 }, (_, i) => ({ t: titles[i % 6], c: "Madrid" }));
    const r = scratchRun("merge-all.mjs", SCRATCH_CATALOGUE, { lever: [{ token: "eutalents", name: "Eutalents", count: 60, inWindow30: 60, dateBasis: "createdAt", sample }] }, ["--apply"]);
    expect(r.status, r.log).toBe(0);
    expect(r.log).toContain('Repeated-title flag (printed for review, excludes nothing): 1 kept boards');
    expect(r.log).toContain('lever:eutalents "Eutalents" (60p): 6 distinct titles in 60 sampled');
    expect(r.after).toContain('token: "eutalents"');
  });
});

// ── the mill screen reads a third party's site on its terms (2026-11-08) ────

describe("the mill screen reads robots.txt first, paces each host, and sends no POST unasked", () => {
  const SCREEN = resolve(ROOT, "scripts/mill-screen-all.mjs");
  const robots = (text: string, paths: string[], agent?: string) => {
    const code = `const { parseRobots, robotsAllow } = await import(${JSON.stringify(pathToFileURL(SCREEN).href)}); const p = parseRobots(${JSON.stringify(text)}${agent ? `, ${JSON.stringify(agent)}` : ""}); console.log(JSON.stringify(${JSON.stringify(paths)}.map((x) => robotsAllow(p, x))));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: tmpdir(), encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as boolean[];
  };

  it("the longest matching rule wins, Allow on a tie, with * and a trailing $", () => {
    const text = "User-agent: *\nDisallow: /api/\nAllow: /api/v1/widget/\nDisallow: /*.pdf$\n";
    expect(robots(text, ["/api/v1/widget/accounts/cxg?details=false", "/api/v2/jobs", "/jobs/a.pdf", "/jobs/a.pdfx", "/"])).toEqual([true, false, false, true, true]);
  });
  it("a group naming this agent overrides the * group, and an empty Disallow allows everything", () => {
    expect(robots("User-agent: resumebooster\nDisallow: /\n\nUser-agent: *\nAllow: /\n", ["/jobs"])).toEqual([false]);
    expect(robots("User-agent: LinkedInBot\nAllow: /\n\nUser-agent: *\nDisallow: /companies/\n", ["/companies/acme/postings", "/jobs"])).toEqual([false, true]);
    expect(robots("User-agent: *\nDisallow:\n", ["/anything"])).toEqual([true]);
  });

  it("every GET asks robots.txt, then waits its host's 1.1 s slot; a POST is refused without --allow-post", () => {
    const code = strip(readFileSync(SCREEN, "utf8"));
    expect(code).toMatch(/export const HOST_SPACING_MS = 1100;/);
    const get = /async function get\(url, asText = false\) \{[\s\S]*?\n\}/.exec(code)?.[0] ?? "";
    expect(get).toMatch(/const robots = await robotsFor\(u\);\s*if \(!robotsAllow\(robots\.parsed, u\.pathname \+ u\.search\)\) \{[^\n]*return null; \}\s*await paced\(u\.host\);\s*try \{\s*const res = await fetch\(url/);
    const post = /async function postJson\(url, body\) \{[\s\S]*?\n\}/.exec(code)?.[0] ?? "";
    expect(post).toMatch(/if \(!ALLOW_POST\) \{ refusedReads\.push\([^\n]*return null; \}[\s\S]*await paced\(u\.host\);[\s\S]*await fetch\(url/);
    expect(code).toMatch(/robotsFor\(u\) \{[\s\S]*?await paced\(u\.host\);[\s\S]*?\/robots\.txt/);
  });

  it("a board it cannot read HOLDs, and --out records every verdict with the flag", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "mill-out-")));
    try {
      writeFileSync(join(dir, "work.json"), JSON.stringify([{ vendor: "nosuchvendor", token: "acme", name: "Acme", count: 120 }]));
      const r = spawnSync(process.execPath, [SCREEN, "work.json", "--out", "verdicts.json"], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^HOLD {4}nosuchvendor:acme "Acme" \(120p\) — only 0 postings readable; NOT cleared/m);
      const v = JSON.parse(readFileSync(join(dir, "verdicts.json"), "utf8"));
      expect(v.hostSpacingMs).toBe(1100);
      expect(v.postsAllowed).toBe(false);
      expect(v.boards).toEqual([expect.objectContaining({ vendor: "nosuchvendor", token: "acme", verdict: "HOLD", sampled: 0, repeatedTitle: null })]);
      expect(JSON.parse(readFileSync(join(dir, "round3-mill-cleared.json"), "utf8"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
