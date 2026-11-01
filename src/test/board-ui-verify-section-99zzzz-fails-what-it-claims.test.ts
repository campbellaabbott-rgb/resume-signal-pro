// @vitest-environment node
/**
 * VERIFY SECTION 99zzzz (THE BOARD UI ROUND) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/99zzzz-board-ui.sh runs here in bash against a fake
 * curl, with the real build_ge cut from the verifier. The healthy site serves
 * a Jobs chunk made of the constructs a real build of this branch emitted
 * (fixtures/board-ui-round-chunk-snippets-2026-11-01.json, cut from that
 * build, where every U line matched, beside the same regions of the then-live
 * chunk, where none did). A healthy deploy prints no FAIL; each claim, broken
 * on its own (the live build's shape where the fixture has it, the construct
 * gone where it does not), prints its own FAIL and no other; a page whose
 * chunk cannot be read is a FAIL that says so; and the section only sends GET
 * and OPTIONS.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-board-ui.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const SNIPS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/board-ui-round-chunk-snippets-2026-11-01.json"), "utf8")) as {
  built: Record<string, string[]>; builtStrings: Record<string, string[]>; live: Record<string, string>;
};
const CLAIMS = ["U1a", "U1b", "U2a", "U2b", "U3", "U4", "U5", "U6", "U7", "U8", "U9"] as const;

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url;
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)out+=(r.body??"");
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
type Over = { build?: string | null; page?: string; entry?: string; chunk?: string; ns?: string };
const PAD = "var x=1;".repeat(3000);
const chunkOf = (built: Record<string, string[]>) => `${PAD};rpc("get_company_fill_curve");${Object.values(built).flat().join(";")};${PAD}`;
const nsOf = (strings: Record<string, string[]>) => `import{a as e}from"./index-X.js";e(JSON.parse(\`{"jobsPage":{${Object.values(strings).flat().map((s) => s.startsWith("\"") ? s : `"k":"${s}"`).join(",")}}}\`));`;
const PAGE = `<html><head><script type="module" src="/assets/index-AbC1.js"></script><link rel="modulepreload" href="/assets/Jobs-Qw3_x.js"><link rel="modulepreload" href="/assets/rb-en_ns_jobsPage-Zz9.js"></head><body></body></html>`;

function routes(over: Over): Route[] {
  const build = over.build === undefined ? "send-search-digest.2026-11-02.1" : over.build;
  return [
    { match: "^OPTIONS https://p\\.supabase\\.co/functions/v1/send-search-digest$", headers: build ? { "x-fn-build": build } : {} },
    { match: "^GET https://site\\.test/jobs$", body: over.page ?? PAGE },
    { match: "^GET https://site\\.test/assets/index-AbC1\\.js$", body: over.entry ?? `${PAD}"assets/Jobs-Qw3_x.js"` },
    { match: "^GET https://site\\.test/assets/Jobs-Qw3_x\\.js$", body: over.chunk ?? chunkOf(SNIPS.built) },
    { match: "^GET https://site\\.test/assets/rb-en_ns_jobsPage-Zz9\\.js$", body: over.ns ?? nsOf(SNIPS.builtStrings) },
  ];
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function run(over: Over = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-99zzzz-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes(over)));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n` + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l.slice(s.length + 2)));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

/** The built chunk with one claim's constructs swapped for the live build's shape, or removed. */
const broken = (id: string, which?: number) => {
  const built = { ...SNIPS.built };
  built[id] = built[id].map((s, i) => (which === undefined || which === i ? (i === 0 && SNIPS.live[id]) || "void 0" : s));
  return chunkOf(built);
};

describe("section 99zzzz on a healthy deploy", () => {
  it("prints no FAIL, passes every claim, and only sends GET and OPTIONS", () => {
    expect(BUILD_GE, "build_ge was not found in verify-deploy.sh").toMatch(/^build_ge\(\)/);
    const { lines, calls } = run();
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /^D1 send-search-digest x-fn-build = send-search-digest\.2026-11-02\.1 /), show(lines)).toBe(true);
    for (const c of CLAIMS) expect(has(lines, "PASS", new RegExp(`^${c} `)), `${c}${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^U0 reading \/assets\/Jobs-Qw3_x\.js/), show(lines)).toBe(true);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
    expect(calls.length).toBe(4);
    for (const c of calls) expect(c, c).toMatch(/^(GET|OPTIONS) /);
  });

  it("a later digest build passes, and a page that names its chunk only in the entry is still read", () => {
    const later = run({ build: "send-search-digest.2026-11-05.2" });
    expect(has(later.lines, "PASS", /^D1 /), show(later.lines)).toBe(true);
    const viaEntry = run({ page: `<html><script type="module" src="/assets/index-AbC1.js"></script></html>`, entry: `${PAD}"assets/Jobs-Qw3_x.js";"assets/rb-en_ns_jobsPage-Zz9.js"` });
    expect(fails(viaEntry.lines), show(viaEntry.lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(viaEntry.lines, "PASS", new RegExp(`^${c} `)), `${c}${show(viaEntry.lines)}`).toBe(true);
  });
});

describe("each claim can FAIL, on its own", () => {
  for (const id of CLAIMS) {
    it(`${id}: the live build's shape (or the construct gone) fails ${id} and nothing else`, () => {
      const { lines } = run({ chunk: broken(id) });
      expect(has(lines, "FAIL", new RegExp(`^${id} .*: missing `)), show(lines)).toBe(true);
      expect(fails(lines).length, show(lines)).toBe(1);
      // and each construct the line names fails it alone
      for (let i = 0; i < SNIPS.built[id].length; i++) {
        const one = run({ chunk: broken(id, i) });
        expect(has(one.lines, "FAIL", new RegExp(`^${id} `)), `${id}[${i}]${show(one.lines)}`).toBe(true);
      }
    });
  }

  it("U5 and U8: the English strings gone from the jobsPage namespace fail them", () => {
    const u5 = run({ ns: nsOf({ U8: SNIPS.builtStrings.U8 }) });
    expect(has(u5.lines, "FAIL", /^U5 .*English: the title-match count; English: the notice$/), show(u5.lines)).toBe(true);
    expect(fails(u5.lines).length, show(u5.lines)).toBe(1);
    const u8 = run({ ns: nsOf({ U5: SNIPS.builtStrings.U5 }) });
    expect(has(u8.lines, "FAIL", /^U8 .*English: the watch name; English: the saved toast$/), show(u8.lines)).toBe(true);
    expect(fails(u8.lines).length, show(u8.lines)).toBe(1);
  });

  it("D1: an older digest build, or none, fails", () => {
    expect(has(run({ build: "send-search-digest.2026-10-25.1" }).lines, "FAIL", /^D1 .*want send-search-digest\.2026-11-02\.1 or later/)).toBe(true);
    expect(has(run({ build: null }).lines, "FAIL", /^D1 send-search-digest preflight carries no x-fn-build/)).toBe(true);
  });

  it("U0: a page that names no Jobs chunk, or a chunk that is not the board page, fails and judges nothing", () => {
    const none = run({ page: "<html></html>" });
    expect(has(none.lines, "FAIL", /^U0 the served \/jobs names no Jobs chunk/), show(none.lines)).toBe(true);
    expect(none.lines.some((l) => /^(PASS|FAIL) {2}U[1-9]/.test(l)), show(none.lines)).toBe(false);
    const gateway = run({ chunk: "<html>502 Bad Gateway</html>" });
    expect(has(gateway.lines, "FAIL", /^U0 \/assets\/Jobs-Qw3_x\.js answered 28 bytes that are not the board page/), show(gateway.lines)).toBe(true);
    expect(gateway.lines.some((l) => /^(PASS|FAIL) {2}U[1-9]/.test(l)), show(gateway.lines)).toBe(false);
  });

  it("the whole live build of 2026-11-01 fails every U line", () => {
    const live = { ...SNIPS.built };
    for (const id of CLAIMS) live[id] = [SNIPS.live[id] ?? "void 0"];
    const { lines } = run({ chunk: chunkOf(live), ns: nsOf({}) });
    for (const id of CLAIMS) expect(has(lines, "FAIL", new RegExp(`^${id} `)), `${id}${show(lines)}`).toBe(true);
  });
});
