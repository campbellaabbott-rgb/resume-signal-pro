// @vitest-environment node
//
// Node, not jsdom: this file runs verifier sections in bash, with a fake curl
// on PATH, through child_process.
/**
 * THE VERIFIER READ THE BRITISH STRINGS FOR THE US COPY (the SEO round's
 * merge review, 2026-10-25).
 *
 * Sections 50, 62, 65, 72 and 74 judge copy in the bundle the browser loads.
 * Each took the first './en-*.js' chunk the entry names that held its key
 * (72 tried the entry first). Once SEO-040 split en.json out of the entry
 * (enNamespaces in vite.config.ts), the only en-* chunk holding those keys
 * was the en-GB locale file, so:
 *   - a correct page FAILed: 72's "Re-analyze to scan again" line, because
 *     en-GB spells it "Re-analyse";
 *   - the other English-copy lines PASSed on the British copy, so a
 *     regression made only in en.json (a Lovable edit) would have passed.
 * 62, 65 and 74 never tried the entry, so they read en-GB on the live
 * publish already.
 *
 * Each section now takes its candidates from scripts/verify-us-english.sh:
 * the rb-en_all chunk the entry names (the whole of en.json), then the entry
 * (en.json rode there before SEO-040), then the US en-* shards, and never an
 * en-GB-* chunk. Each is run here on the chunk layout of a real build of the
 * split, on the live publish's layout, and on a layout where the US strings
 * left every chunk the entry names: there every section FAILs, and none
 * falls back to en-GB.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SITE = "https://site.test";
type Layout = { entry: string; carries?: string; chunks: Record<string, string | null> };
const LAYOUTS = (JSON.parse(readFileSync(resolve(__dirname, "fixtures/verify-us-english-layouts-2026-10-25.json"), "utf8")) as { layouts: Record<string, Layout> }).layouts;
const i18n = (p: string) => JSON.parse(readFileSync(resolve(ROOT, "src/i18n", p), "utf8"));
const SECTIONS = ["50-changelog-and-mail-links.sh", "52-changelog-oct17-25.sh", "62-wave2-frontend-board.sh", "65-wave2-entitlements.sh", "72-wave3-scan-ai.sh", "74-wave3-payments-account.sh", "94-r1-mail.sh"];

/** A chunk's body as the build writes it: JSON.parse of a string for rb-en_all, an object literal for a lazy locale file. */
function chunkBody(source: string | null, entry: string): string {
  if (source === null) return `const e="a page chunk";export{e as default};`;
  if (source === "locales/en.json:all") return `import{a as e}from"./${entry}";e(JSON.parse(${JSON.stringify(JSON.stringify(i18n("locales/en.json")))}));`;
  return `const e=${JSON.stringify(i18n(source))};export{e as default};`;
}
function entryBody(l: Layout): string {
  const named = Object.keys(l.chunks).map((n) => `()=>import("./${n}")`).join(",");
  return `const lazy=[${named}];${l.carries ? `const en=${JSON.stringify(i18n(l.carries))};` : ""}export{lazy as a};`;
}

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);let url="",o=null,w=null,D=null;
for(let i=0;i<a.length;i++){const x=a[i];if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];else if(x==="-D")D=a[++i];else if(["-H","-m","-A","-X","-d","--data","--max-time"].includes(x))i++;else if(/^https?:/.test(x))url=x;}
fs.appendFileSync(process.env.VD_CALLS,url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const file=routes[url];const body=file?fs.readFileSync(file,"utf8"):"";
let out="";if(D==="-")out+="HTTP/2 "+(file?200:404)+"\\r\\n\\r\\n";
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",file?"200":"404").replace(/\\\\n/g,"\\n");
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

/** Serve `layout` at SITE (plus any `pages`, path -> body) and run `script` in bash from the repository root; returns the printed lines and the URLs fetched. */
function serve(layout: Layout, script: string, pages: Record<string, string> = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-usen-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  // Section 50 reads git history; nothing here may fetch.
  writeFileSync(join(dir, "bin", "git"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "git"), 0o755);
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const routes: Record<string, string> = {};
  const put = (path: string, body: string) => { const f = join(dir, "assets", path.replace(/[^A-Za-z0-9_.-]/g, "_") || "root"); writeFileSync(f, body); routes[`${SITE}${path}`] = f; };
  put("/", `<!doctype html><html><head><script type="module" crossorigin src="/assets/${layout.entry}"></script></head><body><div id="root"></div></body></html>`);
  put(`/assets/${layout.entry}`, entryBody(layout));
  for (const [name, source] of Object.entries(layout.chunks)) put(`/assets/${name}`, chunkBody(source, layout.entry));
  for (const [path, body] of Object.entries(pages)) put(path, body);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u
K=pk_test; RB=""; B=https://p.supabase.test; SITE=${SITE}; UA=ua
J() { echo '{}'; }
R() { echo '{}'; }
MC() { echo '{}'; }
probe() { echo "INFO  probe $1 (stubbed)"; }
title() { :; }
build_ge() { return 1; }
`;
  writeFileSync(join(dir, "run.sh"), prelude + script.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 26,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), NODE_OPTIONS: `--require ${join(dir, "nofetch.cjs")}` },
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const section = (n: string) => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", n), "utf8");
/** A section's shell lines with its whole-line comments gone (a guard must not read a comment). */
const shellCode = (src: string) => src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const show = (lines: string[]) => lines.join("\n");
const lister = (l: Layout) => serve(l, `bash scripts/verify-us-english.sh "$SITE/assets/${l.entry}"\n`).lines;

describe("scripts/verify-us-english.sh lists the US English chunks and never an en-GB one", () => {
  it("the split build: rb-en_all first, then the entry, then the US shards", () => {
    expect(lister(LAYOUTS.split)).toEqual(["rb-en_all-Bm5_P613.js", "index-DWvXg-wU.js", "en-BgrSJevg.js", "en-TEXb77yQ.js"]);
  });

  it("the live publish: the entry that carries en.json, then the US shards", () => {
    expect(lister(LAYOUTS.entryCarried)).toEqual(["index-CVlj-9LZ.js", "en-BgrSJevg.js", "en-TEXb77yQ.js"]);
  });

  it("the moved layout lists no British chunk, though only British chunks hold the keys", () => {
    const names = lister(LAYOUTS.moved);
    expect(names).toEqual(["index-DWvXg-wU.js", "en-TEXb77yQ.js"]);
    expect(names.some((n) => n.startsWith("en-GB-"))).toBe(false);
  });

  it("prints nothing for an address that names no entry", () => {
    expect(serve(LAYOUTS.split, `bash scripts/verify-us-english.sh "$SITE"\nbash scripts/verify-us-english.sh ""\n`).lines).toEqual([]);
  });
});

describe("every section that judges served copy takes its chunks from the lister", () => {
  it.each(SECTIONS)("%s builds no candidate list of its own from the en-* chunk names", (n) => {
    const code = shellCode(section(n));
    expect(code, `${n} no longer calls the lister`).toMatch(/\$\(bash scripts\/verify-us-english\.sh "\$SITE\$[A-Z0-9_]+"\)/);
    expect(code, `${n} still greps the entry for en-* chunks itself, which reads en-GB`).not.toMatch(/\\\.\/en-/);
  });
});

describe("72 judges the scan copy in US English", () => {
  it("the split build: Re-analyze, the US spelling, PASSes", () => {
    const { lines } = serve(LAYOUTS.split, section("72-wave3-scan-ai.sh"));
    expect(lines, show(lines)).toContain("PASS  English strings carry Re-analyze to scan again: the crash notice offers Re-analyze past the saved report (review of S8-117)");
    expect(lines.filter((l) => /^FAIL {2}English strings lack/.test(l)), show(lines)).toEqual([]);
    expect(lines.some((l) => /could not find the English strings/.test(l)), show(lines)).toBe(false);
  });

  it("the live publish: read from the entry, as before", () => {
    const { lines } = serve(LAYOUTS.entryCarried, section("72-wave3-scan-ai.sh"));
    expect(lines, show(lines)).toContain("PASS  English strings carry Re-analyze to scan again: the crash notice offers Re-analyze past the saved report (review of S8-117)");
  });

  it("the moved layout FAILs: it says it could not find the strings, and passes nothing read from en-GB", () => {
    const { lines } = serve(LAYOUTS.moved, section("72-wave3-scan-ai.sh"));
    expect(lines, show(lines)).toContain("FAIL  could not find the English strings the browser loads (frontend not published, or the bundle layout moved)");
    expect(lines.filter((l) => /^PASS {2}English strings carry/.test(l)), show(lines)).toEqual([]);
  });
});

describe("65 and 74 judge the account and payment copy in US English", () => {
  for (const [n, missing, carried] of [
    ["65-wave2-entitlements.sh", "FAIL  could not find the English strings chunk the browser loads (frontend not published, or the bundle layout moved)", /^PASS {2}English strings carry "perkMorningQueue"/],
    ["74-wave3-payments-account.sh", "FAIL  could not find the English strings chunk the browser loads (frontend not published, or the bundle layout moved)", /^PASS {2}English strings carry "By continuing you agree to the"/],
  ] as const) {
    it(`${n}: the split build and the live publish find the US strings`, () => {
      for (const l of [LAYOUTS.split, LAYOUTS.entryCarried]) {
        const { lines } = serve(l, section(n));
        expect(lines, show(lines)).not.toContain(missing);
        expect(lines.some((x) => carried.test(x)), show(lines)).toBe(true);
      }
    });

    it(`${n}: the moved layout FAILs and passes nothing read from en-GB`, () => {
      const { lines } = serve(LAYOUTS.moved, section(n));
      expect(lines, show(lines)).toContain(missing);
      expect(lines.filter((x) => /^PASS {2}English strings carry/.test(x)), show(lines)).toEqual([]);
    });
  }
});

describe("62 judges the board's sort copy in US English", () => {
  it("the split build and the live publish find sortDiscovered2 and PASS both lines", () => {
    for (const l of [LAYOUTS.split, LAYOUTS.entryCarried]) {
      const { lines } = serve(l, section("62-wave2-frontend-board.sh"));
      expect(lines, show(lines)).toContain("PASS  the English strings name the discovery order truthfully ('Newest, undated by our date')");
      expect(lines, show(lines)).toContain("PASS  the exact-word tier's order sentence names its two blocks (title matches first, then employer-name matches)");
    }
  });

  it("the moved layout FAILs on finding no US strings, and passes nothing read from en-GB", () => {
    const { lines } = serve(LAYOUTS.moved, section("62-wave2-frontend-board.sh"));
    expect(lines, show(lines)).toContain("FAIL  could not find the US English strings the browser loads (no chunk the entry names carries sortDiscovered2; frontend not published, or the bundle layout moved)");
    expect(lines.some((x) => /^PASS {2}the English strings name the discovery order|^PASS {2}the exact-word tier/.test(x)), show(lines)).toBe(false);
  });
});

describe("50 counts the changelog's corrections in the US English changelog", () => {
  it("the split build and the live publish read the US changelog shard", () => {
    for (const l of [LAYOUTS.split, LAYOUTS.entryCarried]) {
      const { lines } = serve(l, section("50-changelog-and-mail-links.sh"));
      expect(lines, show(lines)).toContain("PASS  the changelog strings the browser loads carry both dated corrections (2)");
    }
  });

  it("the moved layout, with only the British changelog left, FAILs", () => {
    const { lines } = serve(LAYOUTS.moved, section("50-changelog-and-mail-links.sh"));
    expect(lines, show(lines)).toContain("FAIL  the changelog strings the browser loads carry 0 of the 2 dated corrections (freeAccounts, savedVersions)");
  });
});

// Main's changelog sections for 17 to 25 October (PR #45) judged the titles
// the crawler page no longer lists in a chunk list of their own; on the SEO
// round's merge they take it from the lister too.
const BRITISH = (calls: string[]) => calls.filter((u) => /\/assets\/en-GB-/.test(u));
const crawlerPage = (titles: string[]) => `<!doctype html><html><body><main>${titles.map((t) => `<h2>${t}</h2>`).join("")}</main></body></html>`;

describe("50 judges the titles the crawler page no longer lists in the US English changelog", () => {
  const TITLES50 = [
    "Big Workday employers were missing many of their jobs",
    "A PDF résumé reached our scanner as one long line",
    "What we keep, for how long, and an address that reaches us",
    "Paid tools that took payment and delivered nothing",
    "Nine employers whose job lists were too big for us to read",
  ];

  it("the split build and the live publish find every title in the US changelog shard, and fetch no British chunk", () => {
    for (const l of [LAYOUTS.split, LAYOUTS.entryCarried]) {
      const { lines, calls } = serve(l, section("50-changelog-and-mail-links.sh"), { "/changelog": crawlerPage([]) });
      for (const t of TITLES50) expect(lines, show(lines)).toContain(`PASS  "${t}" is past the newest 30 entries the crawler page lists, and the English changelog strings the browser loads carry it`);
      expect(BRITISH(calls)).toEqual([]);
    }
  });

  it("the crawler page that lists a title passes it there", () => {
    const { lines } = serve(LAYOUTS.split, section("50-changelog-and-mail-links.sh"), { "/changelog": crawlerPage(TITLES50) });
    for (const t of TITLES50) expect(lines, show(lines)).toContain(`PASS  /changelog serves crawlers "${t}"`);
  });

  it("the moved layout, with only the British changelog left, FAILs every title", () => {
    const { lines, calls } = serve(LAYOUTS.moved, section("50-changelog-and-mail-links.sh"), { "/changelog": crawlerPage([]) });
    for (const t of TITLES50) expect(lines, show(lines)).toContain(`FAIL  /changelog does not serve "${t}" (frontend not published, or the prerender did not rebuild)`);
    expect(BRITISH(calls)).toEqual([]);
  });
});

describe("52 tells a prerender that did not rebuild from no publish, in the US English changelog", () => {
  const TITLES52 = [
    "Workday company pages were missing their facts for a week",
    "A calmer design, in one dark color scheme",
    "Sign-in and reset emails have a second sender",
    "A lighter tab icon and share picture",
  ];

  it("the crawler page that lists the titles passes them", () => {
    const { lines } = serve(LAYOUTS.split, section("52-changelog-oct17-25.sh"), { "/changelog": crawlerPage(TITLES52) });
    for (const t of TITLES52) expect(lines, show(lines)).toContain(`PASS  /changelog serves crawlers "${t}"`);
  });

  it("the split build and the live publish read the US shard: the strings are there and the crawler copy is not", () => {
    for (const l of [LAYOUTS.split, LAYOUTS.entryCarried]) {
      const { lines, calls } = serve(l, section("52-changelog-oct17-25.sh"), { "/changelog": crawlerPage([]) });
      for (const t of TITLES52) expect(lines, show(lines)).toContain(`FAIL  the English changelog strings the browser loads carry "${t}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
      expect(BRITISH(calls)).toEqual([]);
    }
  });

  it("the moved layout reads no British chunk, so it says the frontend was not published, \"colour\" or not", () => {
    const { lines, calls } = serve(LAYOUTS.moved, section("52-changelog-oct17-25.sh"), { "/changelog": crawlerPage([]) });
    for (const t of TITLES52) expect(lines, show(lines)).toContain(`FAIL  /changelog does not serve "${t}" (the frontend has not been published since the changelog for 17 to 25 October merged)`);
    expect(BRITISH(calls)).toEqual([]);
  });
});
