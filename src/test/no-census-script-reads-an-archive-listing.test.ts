// NO CENSUS SCRIPT READS AN ARCHIVE LISTING, AND A HOST THAT SAYS STOP IS LEFT.
//
// OD-CC (owner, 2026-11-17): new boards come from open registers and employers'
// own sites, never from Common Crawl host lists. The W2 census branch still
// carried ten scripts whose discovery was a Common Crawl index or the Wayback
// CDX listing; each now stops at refuseArchiveListing() before its first
// request. The guard below finds such scripts by what their CODE names, with
// comments stripped (a host named only in a comment is history, not a read),
// so a new script on one of those bases fails here until it carries the call.
//
// The same branch's mill screen read a robots.txt that answered 401, 403 or 429
// as "the site sets no rules", and kept reading a host after it answered 429.
// Owner rule 2026-11-17: a 429 or a bot challenge is a stop, never a reason to
// retry or switch clients. A robots.txt refusal now disallows the host, and any
// read answered 429 or with a challenge closes the host for the run.
//
// And the census reader's job-board reads now say who they are
// (x-rb-caller: maintenance), so they are not counted as visitors' searches.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const SCRIPTS = resolve(ROOT, "scripts");
/**
 * Comments that START a line, removed. A mid-line "/*" or "//" is left alone,
 * because it is as often inside a string or URL ("https://", "/*.pdf") as it
 * is a comment, and a stripper that guesses eats code.
 */
const strip = (s: string) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");

/** Hosts whose listings OD-CC refuses, as they appear in code. */
const ARCHIVE_LISTING = /\b(?:index|data)\.commoncrawl\.org\b|\bweb\.archive\.org\/cdx\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(mjs|cjs|js|ts)$/.test(f) ? [p] : [];
  });
}
const archiveReaders = () =>
  walk(SCRIPTS).filter((p) => !p.endsWith("od-cc.mjs") && ARCHIVE_LISTING.test(strip(readFileSync(p, "utf8"))));

/** The first top-level statement after the import block, comments stripped. */
function firstStatementAfterImports(code: string): string {
  const body = code.replace(/^#![^\n]*\n/, "");
  const re = /^import\s[\s\S]*?(?:from\s*)?["'][^"']+["'];?\s*$/gm;
  let end = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) end = m.index + m[0].length;
  return body.slice(end).trim().split("\n")[0].trim();
}

describe("OD-CC: every script built on an archive listing refuses before it reads", () => {
  it("the scripts that name one are the ten the W2 branch carried, and no other", () => {
    expect(archiveReaders().map((p) => relative(SCRIPTS, p)).sort()).toEqual([
      "census-all.mjs", "census-cluster-all.mjs", "census-gh-embed.mjs", "census-jazzhr.mjs", "census-oracle.mjs",
      "census-pinpoint.mjs", "census-rippling.mjs", "census-rung3.mjs", "census-workday-cluster.mjs", "census-workday.mjs",
    ]);
  });

  for (const f of ["census-all.mjs", "census-cluster-all.mjs", "census-gh-embed.mjs", "census-jazzhr.mjs", "census-oracle.mjs",
    "census-pinpoint.mjs", "census-rippling.mjs", "census-rung3.mjs", "census-workday-cluster.mjs", "census-workday.mjs"]) {
    it(`${f} imports the refusal and calls it before anything else runs`, () => {
      const code = strip(readFileSync(resolve(SCRIPTS, f), "utf8"));
      expect(code).toMatch(/^import \{ refuseArchiveListing \} from "\.\/od-cc\.mjs";$/m);
      expect(firstStatementAfterImports(code)).toBe("refuseArchiveListing(import.meta.url);");
    });
  }

  it("a refused script exits 2, names the decision, and prints nothing it read", () => {
    const r = spawnSync(process.execPath, [resolve(SCRIPTS, "census-rippling.mjs")], { cwd: tmpdir(), encoding: "utf8", timeout: 20_000 });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toMatch(/^census-rippling\.mjs: refused by owner decision OD-CC \(2026-11-17\): .*Nothing was read\.$/m);
    expect(r.stdout).toBe("");
  });

  it("TEETH: the detector reads code, not comments", () => {
    expect(ARCHIVE_LISTING.test(strip('const CDX = "https://index.commoncrawl.org";'))).toBe(true);
    expect(ARCHIVE_LISTING.test(strip("const u = `https://web.archive.org/cdx/search/cdx?url=${d}`;"))).toBe(true);
    expect(ARCHIVE_LISTING.test(strip("// the CDX API host (index.commoncrawl.org) blocked us\nconst x = 1;"))).toBe(false);
    expect(ARCHIVE_LISTING.test(strip('const A = "https://web.archive.org/web/2020/https://example.com";'))).toBe(false);
    expect(firstStatementAfterImports('import fs from "node:fs";\nimport {\n  a,\n} from "./b.mjs";\n\nconst x = 1;')).toBe("const x = 1;");
    expect(strip('const glob = "https://*.example.com/*";\nconst CDX = "https://index.commoncrawl.org";'), "a mid-line /* is not a comment").toContain("index.commoncrawl.org");
  });
});

describe("the mill screen stops at a host that refuses it", () => {
  type Verdict = { parsed: { rules: { allow: boolean; path: string }[] }; said: string } | null;
  const load = async () => (await import("../../scripts/mill-screen-all.mjs")) as unknown as {
    robotsVerdict: (r: Response) => Verdict; isRefusal: (r: Response) => boolean;
  };
  const res = (status: number, headers: Record<string, string> = {}) => new Response(status === 204 ? null : "", { status, headers });

  it("a robots.txt answered 401, 403, 429 or with a challenge disallows the host; 404 and 410 set no rules", async () => {
    const { robotsVerdict } = await load();
    for (const s of [401, 403, 429]) {
      expect(robotsVerdict(res(s))?.parsed.rules, String(s)).toEqual([{ allow: false, path: "/" }]);
    }
    expect(robotsVerdict(res(200, { "cf-mitigated": "challenge" }))?.parsed.rules).toEqual([{ allow: false, path: "/" }]);
    expect(robotsVerdict(res(503))?.parsed.rules).toEqual([{ allow: false, path: "/" }]);
    for (const s of [404, 410]) expect(robotsVerdict(res(s))?.parsed.rules, String(s)).toEqual([]);
    expect(robotsVerdict(res(200)), "a 200 robots.txt is parsed, not judged by status").toBeNull();
  });

  it("a 429 or a challenge is a refusal; a 403 without the challenge header and a 404 are not", async () => {
    const { isRefusal } = await load();
    expect(isRefusal(res(429))).toBe(true);
    expect(isRefusal(res(403, { "cf-mitigated": "challenge" }))).toBe(true);
    expect(isRefusal(res(403))).toBe(false);
    expect(isRefusal(res(404))).toBe(false);
  });

  it("every read checks the closed list before and after robots.txt, and a refusal closes the host", () => {
    const code = strip(readFileSync(resolve(SCRIPTS, "mill-screen-all.mjs"), "utf8"));
    expect(code).toMatch(/\br = robotsVerdict\(res\);\s*if \(isRefusal\(res\)\) closeHost\(u\.host, res\.status\);/);
    for (const fn of ["async function get(url, asText = false) {", "async function postJson(url, body) {"]) {
      const at = code.indexOf(fn);
      expect(at, fn).toBeGreaterThan(-1);
      const body = code.slice(at, code.indexOf("\n}", at));
      expect(body.match(/if \(hostClosed\(u\)\) return null;/g)?.length, fn).toBe(2);
      expect(body, fn).toMatch(/if \(isRefusal\(res\)\) \{ closeHost\(u\.host, res\.status\); hostClosed\(u\); return null; \}\s*if \(!res\.ok\) return null;/);
    }
  });
});

describe("the census reader's job-board reads say they are maintenance", () => {
  const env = { url: "https://example.invalid", key: "anon" };
  const capture = () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = async (_u: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    };
    return { seen, fetchImpl };
  };

  it("status and list reads both send x-rb-caller: maintenance", async () => {
    const { readBoardStatus, readCarrierRows } = await import("../../scripts/catalogue-reader.mjs") as unknown as {
      readBoardStatus: (o: object) => Promise<unknown>; readCarrierRows: (b: object, o: object) => Promise<unknown>;
    };
    const { seen, fetchImpl } = capture();
    await readBoardStatus({ env, fetchImpl });
    await readCarrierRows({ source: "greenhouse", token: "acme" }, { env, fetchImpl });
    expect(seen).toHaveLength(2);
    for (const h of seen) expect(h["x-rb-caller"]).toBe("maintenance");
  });

  it("maintenance is a caller job-board accepts as declared", () => {
    const fn = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
    const callers = /const SEARCH_CALLERS = new Set\(\[([^\]]*)\]\)/.exec(fn)?.[1] ?? "";
    expect(callers).toMatch(/"maintenance"/);
    expect(fn).toMatch(/req\.headers\.get\("x-rb-caller"\)/);
  });
});
