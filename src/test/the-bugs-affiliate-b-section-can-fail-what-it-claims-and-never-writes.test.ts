// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND AFFILIATE-B SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * BEFORE THE PUBLISH, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-bugs-affiliate-b.sh, S14X-213).
 *
 * Run against a fake curl that answers from routes (binary bodies included)
 * and logs every call:
 *   - before the publish (the old kit in the Affiliates chunk, every banner
 *     address a 404) it prints INFO for the kit and the six files, and no FAIL;
 *   - after the publish, with this branch's six files served, every line
 *     passes;
 *   - after the publish, a banner answered by the SPA's text/html fallback or
 *     a 404 fails, naming the address;
 *   - a served banner of the wrong size, a JPEG under a .png address, an SVG
 *     with a script, an outside reference or no text, each fails even before
 *     the publish;
 *   - a kit that is half old and half new fails; a chunk that carries
 *     neither kit, or an entry that names none, fails;
 *   - every call is a GET, no body is sent, and the key is never printed;
 *   - every string the section looks for in the chunk is one this branch's
 *     kit writes, and the old kit's strings are ones it no longer writes.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-affiliate-b.sh"), "utf8");
const KIT = readFileSync(resolve(ROOT, "src/components/affiliate/MarketingKit.tsx"), "utf8");
const KEY = "pk_test_SECRET_marker_bugs_affiliate_b";
const BANNERS = resolve(ROOT, "public/affiliate");
const SIZES = ["728x90", "300x250", "160x600"];

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; bodyB64?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url+(data!==null?" "+data:"")))||{status:404,headers:{"content-type":"text/plain; charset=UTF-8"},body:"Not found"};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.bodyB64!==undefined?Buffer.from(r.bodyB64,"base64"):Buffer.from(r.body??"");
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(out),process.stdout.write(body),out="";
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbugsaffiliateb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GET = (url: string) => `^GET ${esc(url)}$`;
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));
const infos = (lines: string[]) => lines.filter((l) => l.startsWith("INFO"));

/** The six fixed addresses, as this branch's kit writes them (string literals in its code). */
const KIT_PATHS = Array.from(codeOf(KIT).matchAll(/["'`](\/affiliate\/banner-\d+x\d+\.(?:png|svg))["'`]/g), (m) => m[1]);
const OLD_PROMISES = ["real ATS algorithms", "cause rejection"];

/** The old kit as it is published today: the two promises and a hashed banner. */
const CHUNK_OLD = `const n=[{id:"leaderboard",src:"/assets/banner-leaderboard-7wRFqWjL.png"}];const b="- Analyzes your resume against ${OLD_PROMISES[0]}\\n- Identifies formatting issues that ${OLD_PROMISES[1]}";rpc("get_affiliate_clicks");`;
/** This round's kit: the six addresses this branch's kit writes, and none of the old strings. */
const CHUNK_NEW = `const n=[${KIT_PATHS.map((p) => JSON.stringify(p)).join(",")}];const b="- Lists the keywords your resume is missing";rpc("get_affiliate_clicks");`;

const site = (chunk: string | null, entry?: string): Route[] => [
  { match: GET("https://site.test/"), body: '<script type="module" crossorigin src="/assets/index-AbC123.js"></script>' },
  { match: GET("https://site.test/assets/index-AbC123.js"), body: entry ?? 'const p=()=>import("./Affiliates-Af1x.js");' },
  ...(chunk === null ? [] : [{ match: GET("https://site.test/assets/Affiliates-Af1x.js"), body: chunk }]),
];

const fileBytes = (name: string) => readFileSync(resolve(BANNERS, name));
const served = (path: string, bytes: Buffer, type: string): Route => ({ match: GET(`https://site.test${path}`), headers: { "content-type": type }, bodyB64: bytes.toString("base64") });
const svgAt = (wh: string, bytes = fileBytes(`banner-${wh}.svg`), type = "image/svg+xml"): Route => served(`/affiliate/banner-${wh}.svg`, bytes, type);
const pngAt = (wh: string, bytes = fileBytes(`banner-${wh}.png`), type = "image/png"): Route => served(`/affiliate/banner-${wh}.png`, bytes, type);
const allFiles = (): Route[] => SIZES.flatMap((wh) => [svgAt(wh), pngAt(wh)]);
const SPA = (path: string): Route => ({ match: GET(`https://site.test${path}`), headers: { "content-type": "text/html; charset=utf-8" }, body: "<!doctype html><div id=root></div>" });
const NOT_FOUND = (path: string): Route => ({ match: GET(`https://site.test${path}`), status: 404, headers: { "content-type": "text/plain; charset=UTF-8" }, body: "Not found" });

const before = (): Route[] => [...site(CHUNK_OLD)];
const after = (over: Route[] = []): Route[] => [...over, ...site(CHUNK_NEW), ...allFiles()];

describe("the bug round affiliate-b section", () => {
  it("before the publish says INFO for the old kit and each banner address, and fails nothing", () => {
    const { lines, out } = run(before());
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toEqual([]);
    expect(lines[0], out).toBe("INFO  K1 the published kit (Affiliates-Af1x.js) is the old one (it carries 'real ATS algorithms' 'cause rejection' banner-leaderboard-7wRFqWjL.png): the publish carrying part B has not happened");
    for (const [c, path] of [["S1", "/affiliate/banner-728x90.svg"], ["S2", "/affiliate/banner-300x250.svg"], ["S3", "/affiliate/banner-160x600.svg"], ["P1", "/affiliate/banner-728x90.png"], ["P2", "/affiliate/banner-300x250.png"], ["P3", "/affiliate/banner-160x600.png"]]) {
      expect(lines, out).toContain(`INFO  ${c} ${path} answers 404 text/plain; charset=utf-8: the publish carrying part B has not happened`);
    }
    expect(infos(lines), out).toHaveLength(7);
  });

  it("after the publish passes the kit and the six banners this branch serves", () => {
    const { lines, out } = run(after());
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines).map((l) => l.slice(0, 8)), out).toEqual(["PASS  K1", "PASS  S1", "PASS  S2", "PASS  S3", "PASS  P1", "PASS  P2", "PASS  P3"]);
    expect(lines, out).toContain("PASS  S1 /affiliate/banner-728x90.svg answers 200 image/svg+xml at 728x90, lettered in text with no script or outside reference: the size its label says, at an address no rebuild moves (S14X-213)");
  });

  it("an SVG served with a charset in its content type still passes", () => {
    const { lines, out } = run(after([svgAt("728x90", fileBytes("banner-728x90.svg"), "image/svg+xml; charset=utf-8")]));
    expect(fails(lines), out).toEqual([]);
    expect(passes(lines), out).toHaveLength(7);
  });

  it("after the publish, the SPA fallback or a 404 at a banner address fails, naming it", () => {
    const { lines, out } = run(after([SPA("/affiliate/banner-728x90.svg"), NOT_FOUND("/affiliate/banner-300x250.png")]));
    expect(fails(lines), out).toEqual([
      "FAIL  S1 /affiliate/banner-728x90.svg answers 200 text/html; charset=utf-8 though the kit that names it is published (want 200 image/svg+xml): an embedded banner shows nothing",
      "FAIL  P2 /affiliate/banner-300x250.png answers 404 text/plain; charset=utf-8 though the kit that names it is published (want 200 image/png): an embedded banner shows nothing",
    ]);
  });

  it("a served banner of the wrong size fails even before the publish", () => {
    const svg = run([...before(), svgAt("300x250", fileBytes("banner-728x90.svg"))]);
    expect(fails(svg.lines), svg.out).toEqual([
      'FAIL  S2 /affiliate/banner-300x250.svg is served as image/svg+xml but its viewBox is "0 0 728 90", not 0 0 300 250; it is 728x90, not 300x250 (S14X-213)',
    ]);
    const png = run([...before(), pngAt("728x90", fileBytes("banner-300x250.png"))]);
    expect(fails(png.lines), png.out).toEqual([
      "FAIL  P1 /affiliate/banner-728x90.png is served as image/png but it is 300x250, not 728x90 (S14X-213)",
    ]);
  });

  it("JPEG bytes under a .png address fail, as the old banners were", () => {
    const jpeg = Buffer.concat([Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex"), Buffer.alloc(64)]);
    const { lines, out } = run(after([pngAt("160x600", jpeg)]));
    expect(fails(lines), out).toEqual([
      "FAIL  P3 /affiliate/banner-160x600.png is served as image/png but its bytes are not a PNG (they begin ffd8ffe0) (S14X-213)",
    ]);
  });

  it("an SVG with a script, an outside reference, or no text fails", () => {
    const base = fileBytes("banner-160x600.svg").toString("utf8");
    const withScript = Buffer.from(base.replace("</svg>", "<script>alert(1)</script></svg>"));
    const withHandler = Buffer.from(base.replace("<rect ", '<rect onclick="x()" '));
    const withOutside = Buffer.from(base.replace("</svg>", '<use href="https://elsewhere.example/a.svg#x"/></svg>'));
    const noText = Buffer.from(base.replace(/<text[\s\S]*?<\/text>/g, ""));
    for (const [bytes, why] of [
      [withScript, "it carries a script, a handler or an outside reference"],
      [withHandler, "it carries a script, a handler or an outside reference"],
      [withOutside, "it carries a script, a handler or an outside reference"],
      [noText, "its lettering is not text"],
    ] as const) {
      const { lines, out } = run(after([svgAt("160x600", bytes)]));
      expect(fails(lines), out).toEqual([`FAIL  S3 /affiliate/banner-160x600.svg is served as image/svg+xml but ${why} (S14X-213)`]);
    }
  });

  it("a kit that is half old and half new fails, and so does one missing an address", () => {
    const mixed = run(after([{ match: GET("https://site.test/assets/Affiliates-Af1x.js"), body: CHUNK_NEW + `const z="${OLD_PROMISES[0]}";` }]));
    expect(fails(mixed.lines), mixed.out).toEqual([
      "FAIL  K1 the published kit (Affiliates-Af1x.js) is neither the old one nor this round's: it still carries 'real ATS algorithms'",
    ]);
    // The six files still judge as published: they PASS.
    expect(passes(mixed.lines), mixed.out).toHaveLength(6);
    const short = run(after([{ match: GET("https://site.test/assets/Affiliates-Af1x.js"), body: CHUNK_NEW.replace('"/affiliate/banner-160x600.svg"', '"x"') }]));
    expect(fails(short.lines), short.out).toEqual([
      "FAIL  K1 the published kit (Affiliates-Af1x.js) is neither the old one nor this round's: it does not name /affiliate/banner-160x600.svg",
    ]);
  });

  it("a chunk that carries neither kit fails, and the files it cannot place are INFO", () => {
    const { lines, out } = run(site('rpc("get_affiliate_clicks");'));
    expect(fails(lines), out).toEqual([
      "FAIL  K1 the Affiliates chunk (Affiliates-Af1x.js) carries neither the old kit nor the new one: the kit moved out of the chunk, so it cannot be judged",
    ]);
    expect(infos(lines).every((l) => l.endsWith(": K1 could not tell whether the kit is published")), out).toBe(true);
    expect(infos(lines), out).toHaveLength(6);
  });

  it("an entry that names no Affiliates chunk, or a homepage with no entry, fails", () => {
    const noChunk = run(site(null, "const p=1;"));
    expect(fails(noChunk.lines)[0], noChunk.out).toBe("FAIL  K1 the entry /assets/index-AbC123.js names no readable Affiliates chunk (none named): the bundle layout moved, so the kit cannot be judged");
    const noEntry = run([{ match: GET("https://site.test/"), body: "<html></html>" }]);
    expect(fails(noEntry.lines)[0], noEntry.out).toBe("FAIL  K1 the homepage names no /assets/index-*.js entry: the published kit cannot be read");
  });

  it("only reads: every call is a GET with no body, and the key is never printed", () => {
    for (const r of [run(before()), run(after()), run(after([SPA("/affiliate/banner-728x90.svg")]))]) {
      expect(r.calls.length, r.out).toBeGreaterThan(0);
      for (const c of r.calls) expect(c, r.out).toMatch(/^curl\tGET https:\/\/site\.test\/\S*$/);
      expect(r.out).not.toContain(KEY);
    }
  });
});

describe("what the section looks for is what this branch writes", () => {
  it("the kit writes the six fixed addresses the section looks for, one per file in public/affiliate", () => {
    const files = readdirSync(BANNERS).sort();
    expect(KIT_PATHS.slice().sort()).toEqual(files.map((f) => `/affiliate/${f}`));
    expect(SECTION).toContain(`VDAFB_SIZES="${SIZES.join(" ")}"`);
    expect(files).toEqual(SIZES.flatMap((wh) => [`banner-${wh}.png`, `banner-${wh}.svg`]).sort());
  });

  it("the kit no longer writes the strings the section reads as the old kit", () => {
    for (const s of OLD_PROMISES) {
      expect(SECTION).toContain(`grep -qF '${s}'`);
      expect(KIT).not.toContain(s);
    }
    expect(KIT).not.toMatch(/banner-(leaderboard|square|skyscraper)\.png/);
  });
});
