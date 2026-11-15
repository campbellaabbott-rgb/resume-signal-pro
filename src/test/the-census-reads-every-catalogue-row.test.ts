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
