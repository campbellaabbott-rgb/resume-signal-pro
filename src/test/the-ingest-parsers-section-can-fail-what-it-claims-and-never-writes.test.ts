// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process, and builds the published chunks with
// esbuild (which refuses jsdom's TextEncoder).
/**
 * THE INGEST-PARSERS SECTION CAN FAIL WHAT IT CLAIMS, NEVER FAILS BEFORE THE
 * PASTE, AND NEVER WRITES (scripts/verify-deploy.d/99zzzzzzz-bugs-ingest-parsers.sh).
 *
 * Run against a fake curl that answers from routes and logs every call:
 *   - before the paste (today's answers: the cost wave's parser builds, the
 *     scanner chunk's two-code refusal map, the résumé text reader that reads
 *     a .txt as UTF-8 only, no ingest-parsers shard) it prints INFO and no
 *     FAIL, and no PASS;
 *   - after the paste and the publish every claim passes, and later builds
 *     pass too. The published chunks are the lane's own modules minified by
 *     esbuild, and the shard chunks the repo's own files, so the marks the
 *     section looks for are the ones the build writes;
 *   - each claim fails on the state it exists to catch: a partial paste, a
 *     preflight with no build, another parser's build standing in, a layout
 *     the section cannot read, a lazy shard missing or a string not the
 *     repo's, a refusal code or a notice the map does not name, a reader
 *     that still reads UTF-8 only;
 *   - a stale answer left in its files by an earlier run is never read back;
 *   - the owner-gated line is INFO owner pending until the ledger names the
 *     key, then judges parse-pdf's and parse-docx's builds;
 *   - every call is a GET or an OPTIONS with no body, and the key is never
 *     printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildSync } from "esbuild";
import { PARSE_FAILURE_CODES } from "@/lib/parse-failure-copy";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-ingest-parsers.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_ingest_parsers";
const SHARD_DIR = resolve(ROOT, "src/i18n/shards/ingest-parsers");
const LAZY = ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"] as const;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; exit?: number };

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
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url+(data!==null?" "+data:"")))||{status:404,body:""};
if(r.exit){if(w)process.stdout.write(w.replace("%{http_code}","000"));process.exit(r.exit);}
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Run = { lines: string[]; calls: string[]; out: string };

function run(routes: Route[], opts: { ownerDecided?: Record<string, unknown>; stale?: Record<string, string> } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), "vdbugsip-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided: opts.ownerDecided ?? {} } } }));
  for (const [name, body] of Object.entries(opts.stale ?? {})) writeFileSync(join(dir, name), body);
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    VDIP_LEDGER: join(dir, "ledger.json"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

// ── The published chunks ────────────────────────────────────────────────────

/** A module as the production build writes it: bundled, minified, UTF-8. */
function minified(entry: string, external: string[] = []): string {
  const r = buildSync({ entryPoints: [resolve(ROOT, entry)], bundle: true, minify: true, format: "esm", charset: "utf8", write: false, external });
  return r.outputFiles[0].text;
}
/** A shard JSON as its lazy chunk: the object literal, minified. */
function shardChunk(json: string): string {
  const r = buildSync({ stdin: { contents: `export default ${json};`, loader: "js", resolveDir: SHARD_DIR }, minify: true, format: "esm", charset: "utf8", write: false });
  return r.outputFiles[0].text;
}
const shardFile = (lng: string) => readFileSync(join(SHARD_DIR, `${lng}.json`), "utf8");
/** How many strings the repo's English shard holds: the section counts the same file. */
const EN_STRING_COUNT = (() => { const n = (o: Record<string, unknown>): number => Object.values(o).reduce<number>((a, v) => a + (typeof v === "string" ? 1 : n(v as Record<string, unknown>)), 0); return n(JSON.parse(shardFile("en")).ingestParsers); })();

const NAMES = {
  entry: "index-6OaKujjA.js",
  idx: "Index-B6t8icuH.js",
  acc: "Account-CBCHYRxP.js",
  asb: "AgentStatusBand-CmeTEPRs.js",
  bell: "bell-D40uuGr7.js",
} as const;
const shardName = (lng: string) => `${lng}-ip${lng.replace("-", "")}Hash.js`;

const PAGE = `<!doctype html><html><head><script type="module" crossorigin src="/assets/${NAMES.entry}"></script><link rel="modulepreload" crossorigin href="/assets/${NAMES.idx}"><link rel="modulepreload" crossorigin href="/assets/SEO-DNhWW0lo.js"></head><body><div id="root"></div></body></html>`;

// Today's chunks, as production served them on 2026-11-15 (the parts the section reads).
const ENTRY_BEFORE = `const m=["assets/Auth-DyeubsO9.js","assets/${NAMES.acc}","assets/${NAMES.asb}"];const g=Object.assign({"./shards/company/en.json":Xc,"./shards/listing/en.json":Xl});const z=Object.assign({"./shards/company/de.json":()=>O(()=>import("./de-Dq0d_wpy.js"),__vite__mapDeps([])),"./shards/company/hi.json":()=>O(()=>import("./hi-CAgdglVJ.js"),__vite__mapDeps([]))});`;
const IDX_BEFORE = `const ni={damaged_file:{title:"homepage.toast.fileDamaged",description:"homepage.toast.fileDamagedDescription"},garbled_text:{title:"homepage.toast.fontUnreadable",description:"homepage.toast.fontUnreadableDescription"}};function nr(t,s){const r=typeof(s==null?void 0:s.code)=="string"?s.code:"",n=ni[r];return n?{title:t(n.title),description:t(n.description)}:null}function ii(t,s){if((s==null?void 0:s.notice)!=="unread_characters")return null}const p="parse-pdf",d="parse-docx";`;
const ACC = `import{a as Ce}from"./${NAMES.asb}";import{B as Be}from"./${NAMES.bell}";import"./${NAMES.entry}";import"./rb-en_ns_jobsPage-DSqlX6kL.js";`;
const ASB_BEFORE = `async function Ce(a){try{if(a.type==="text/plain"||/\\.txt$/i.test(a.name))return await a.text();const e=a.type==="application/pdf"||/\\.pdf$/i.test(a.name)?"parse-pdf":"parse-docx",s=new FormData;s.append("file",a);const{data:n,error:m}=await U.functions.invoke(e,{body:s});if(m)return"";const u=n==null?void 0:n.text;return typeof u=="string"?u:""}catch{return""}}`;

// After the publish: the lane's modules, minified, and its shards.
const COPY_MODULE = minified("src/lib/parse-failure-copy.ts");
const READER_MODULE = minified("src/lib/resumeText.ts", ["@/integrations/supabase/client"]);
const lazyMap = (langs: readonly string[]) => langs.map((l) => `"./shards/ingest-parsers/${l}.json":()=>O(()=>import("./${shardName(l)}"),__vite__mapDeps([]))`).join(",");
/** The English strings as a minified object literal. */
const enLiteral = (en = shardFile("en")) => shardChunk(en).replace(/export\s*\{[^}]*\};?\s*$/, "");
/** The entry: the eight lazy shards, and (`en`, a build from before the bug round's review) the English strings beside them. */
const entryAfter = (langs: readonly string[] = LAZY, en: string | null = null) =>
  `${ENTRY_BEFORE}${en === null ? "" : `const Ip=${enLiteral(en)};const g2=Object.assign({"./shards/ingest-parsers/en.json":Ip});`}const z2=Object.assign({${lazyMap(langs)}});`;
const IDX_CODE = `${IDX_BEFORE.replace(/const ni=.*?function ii\(t,s\)\{[^}]*\}/, "")}${COPY_MODULE}`;
/** The scanner chunk with the English strings the namespace plugin registers there (a build of this branch). */
const idxAfter = (en: string | null = shardFile("en")) => `${IDX_CODE}${en === null ? "" : `const Ip=${enLiteral(en)};`}`;
const IDX_AFTER = idxAfter();
const ASB_AFTER = `${READER_MODULE}const p="parse-pdf",d="parse-docx";`;

const SITE_RE = "https://site\\.test";
const MATCH = {
  pdf: "^OPTIONS https://p\\.supabase\\.co/functions/v1/parse-pdf$",
  docx: "^OPTIONS https://p\\.supabase\\.co/functions/v1/parse-docx$",
  sheet: "^OPTIONS https://p\\.supabase\\.co/functions/v1/parse-spreadsheet$",
  page: `^GET ${SITE_RE}/resume-checker$`,
  entry: `^GET ${SITE_RE}/assets/${NAMES.entry.replace(/\./g, "\\.")}$`,
  idx: `^GET ${SITE_RE}/assets/${NAMES.idx.replace(/\./g, "\\.")}$`,
  acc: `^GET ${SITE_RE}/assets/${NAMES.acc.replace(/\./g, "\\.")}$`,
  asb: `^GET ${SITE_RE}/assets/${NAMES.asb.replace(/\./g, "\\.")}$`,
  ...Object.fromEntries(LAZY.map((l) => [`shard_${l}`, `^GET ${SITE_RE}/assets/${shardName(l).replace(/\./g, "\\.")}$`])),
} as Record<string, string>;
type Answer = Omit<Route, "match">;
type World = Record<string, Answer>;

const build = (b: string | null): Answer => ({ headers: b ? { "x-fn-build": b } : {} });

/** Production as it answers today, before the round's paste and publish. */
const BEFORE: World = {
  pdf: build("parse-pdf.2026-11-09.1"),
  docx: build("parse-docx.2026-11-09.1"),
  sheet: build("parse-spreadsheet.2026-11-09.1"),
  page: { body: PAGE },
  entry: { body: ENTRY_BEFORE },
  idx: { body: IDX_BEFORE },
  acc: { body: ACC },
  asb: { body: ASB_BEFORE },
};

/** Production once the three parsers are pasted and the merge published. */
const AFTER: World = {
  pdf: build("parse-pdf.2026-11-12.1"),
  docx: build("parse-docx.2026-11-12.1"),
  sheet: build("parse-spreadsheet.2026-11-12.1"),
  page: { body: PAGE },
  entry: { body: entryAfter() },
  idx: { body: IDX_AFTER },
  acc: { body: ACC },
  asb: { body: ASB_AFTER },
  ...Object.fromEntries(LAZY.map((l) => [`shard_${l}`, { body: shardChunk(shardFile(l)) }])),
};

const routes = (world: World, over: World = {}): Route[] =>
  Object.keys(MATCH).filter((n) => n in world || n in over).map((n) => ({ match: MATCH[n], ...(over[n] ?? world[n]) }));
const verdicts = (lines: string[], v: "PASS" | "FAIL" | "INFO") => lines.filter((l) => l.startsWith(v));
const fails = (r: Run) => verdicts(r.lines, "FAIL");

describe("the ingest-parsers section", () => {
  it("prints its header, so the tally files its lines under it", () => {
    expect(run(routes(AFTER)).out).toMatch(/^== 99zzzzzzz-bugs-ingest-parsers\. bug round, ingest-parsers lane: .* ==$/m);
  });

  it("before the paste says INFO and fails nothing", () => {
    const r = run(routes(BEFORE));
    expect(fails(r), r.out).toEqual([]);
    expect(verdicts(r.lines, "PASS"), r.out).toEqual([]);
    for (const f of ["parse-pdf", "parse-docx", "parse-spreadsheet"]) {
      expect(r.lines, r.out).toContain(`INFO  B ${f} preflight x-fn-build = ${f}.2026-11-09.1: bug round A's ingest-parsers (2026-11-12.1) is not pasted yet`);
    }
    expect(r.lines, r.out).toContain(`INFO  L0 chunks read: ${NAMES.entry}, ${NAMES.idx}, ${NAMES.asb}`);
    expect(r.lines, r.out).toContain("INFO  S1 the entry carries no ingest-parsers shard yet: the merge carrying the round has not published, so S1, R1, R2 and T1 are INFO");
    expect(r.lines, r.out).toContain(`INFO  R1 S14X-183 the scanner chunk ${NAMES.idx} maps 0 of the 10 refusal codes the round adds: not published yet`);
    expect(r.lines, r.out).toContain("INFO  R2 S14X-044 S14X-282 the scanner chunk says 0 of the 2 new notices: not published yet");
    expect(r.lines, r.out).toContain(`INFO  T1 S14X-283 S14X-280 the résumé text reader ${NAMES.asb} lacks 4 of its 4 marks: not published yet`);
    expect(r.lines, r.out).toContain("INFO  S14X-101 owner pending: parse-pdf's and parse-docx's failure alerts still carry the uploader's address until the owner's answer is recorded");
  });

  it("the functions pasted before the publish pass their builds and fail nothing; the publish before the paste passes the page and fails nothing", () => {
    const fnFirst = run(routes(BEFORE, { pdf: AFTER.pdf, docx: AFTER.docx, sheet: AFTER.sheet }));
    expect(fails(fnFirst), fnFirst.out).toEqual([]);
    expect(verdicts(fnFirst.lines, "PASS").filter((l) => l.startsWith("PASS  B ")), fnFirst.out).toHaveLength(3);
    const pageFirst = run(routes(AFTER, { pdf: BEFORE.pdf, docx: BEFORE.docx, sheet: BEFORE.sheet }));
    expect(fails(pageFirst), pageFirst.out).toEqual([]);
    expect(verdicts(pageFirst.lines, "PASS").map((l) => l.split(" ")[2]), pageFirst.out).toEqual(["S1", "R1", "R2", "T1"]);
  });

  it("after the paste and the publish every claim passes, and a later build passes too", () => {
    for (const [p, d, s] of [["parse-pdf.2026-11-12.1", "parse-docx.2026-11-12.1", "parse-spreadsheet.2026-11-12.1"], ["parse-pdf.2026-12-01.3", "parse-docx.2026-11-12.4", "parse-spreadsheet.2026-11-20.1"]]) {
      const r = run(routes(AFTER, { pdf: build(p), docx: build(d), sheet: build(s) }));
      expect(fails(r), r.out).toEqual([]);
      const pass = verdicts(r.lines, "PASS");
      expect(pass, r.out).toContain(`PASS  B parse-pdf preflight x-fn-build = ${p} (2026-11-12.1 or later: the round's parser, carrying S14X-044 S14X-123 S14X-146 S14X-147 S14X-280 S14X-282 S14X-183)`);
      expect(pass, r.out).toContain(`PASS  B parse-docx preflight x-fn-build = ${d} (2026-11-12.1 or later: the round's parser, carrying S14X-124 S14X-125 S14X-126 S14X-281 RC-S13-037 RC-S13-036 S14X-147 S14X-280 S14X-183)`);
      expect(pass, r.out).toContain(`PASS  B parse-spreadsheet preflight x-fn-build = ${s} (2026-11-12.1 or later: the round's parser, carrying S14X-148 S14X-284 RC-S13-066)`);
      expect(pass, r.out).toContain(`PASS  S1 S14X-183 the English ingest-parsers strings ride with the scanner (${NAMES.idx}, a chunk it imports, or the entry) and the entry names 8 more languages (de, en-GB, es, fr, hi, nl, pt, tl), each holding all ${EN_STRING_COUNT} refusal and notice strings in the repo's own words`);
      expect(EN_STRING_COUNT, "the English shard lost its refusal and notice strings").toBeGreaterThanOrEqual(24);
      expect(pass.filter((l) => l.startsWith(`PASS  R1 S14X-183 the scanner chunk ${NAMES.idx} maps every refusal code`)), r.out).toHaveLength(1);
      expect(pass, r.out).toContain("PASS  R2 S14X-044 S14X-282 the scanner chunk says an Arabic PDF may read out of order (rtl_unreliable) and how many pages had no text (image_pages_skipped)");
      expect(pass.filter((l) => l.startsWith(`PASS  T1 S14X-283 S14X-280 the résumé text reader ${NAMES.asb} decodes a .txt by its byte-order mark`)), r.out).toHaveLength(1);
      expect(pass, r.out).toHaveLength(7);
    }
  });

  it("the refusal codes it looks for are the copy module's own, less the two the page already knew", () => {
    const listed = /^VDIP_CODES="([^"]*)"$/m.exec(SECTION)?.[1].split(" ") ?? [];
    expect(listed).toEqual(PARSE_FAILURE_CODES.filter((c) => c !== "damaged_file" && c !== "garbled_text"));
  });
});

describe("each claim can fail", () => {
  it("B: a partial paste fails the parser left behind", () => {
    const r = run(routes(AFTER, { sheet: BEFORE.sheet }));
    expect(fails(r), r.out).toEqual([
      "FAIL  B parse-spreadsheet preflight x-fn-build = parse-spreadsheet.2026-11-09.1 while another parser serves the round's build: a partial paste (want parse-spreadsheet.2026-11-12.1 or later, carrying S14X-148 S14X-284 RC-S13-066)",
    ]);
  });

  it("B: a preflight with no x-fn-build fails, before the paste too", () => {
    const r = run(routes(BEFORE, { docx: build(null) }));
    expect(fails(r), r.out).toEqual([
      "FAIL  B parse-docx preflight carries no x-fn-build (not deployed, or its preflight does not answer; want parse-docx.2026-11-12.1 or later)",
    ]);
  });

  it("B: another parser's build never stands in for this one's", () => {
    const r = run(routes(AFTER, { pdf: build("parse-docx.2026-11-12.1") }));
    expect(fails(r).filter((l) => l.startsWith("FAIL  B parse-pdf preflight x-fn-build = parse-docx.2026-11-12.1 while another parser serves the round's build")), r.out).toHaveLength(1);
    expect(verdicts(r.lines, "PASS").filter((l) => l.startsWith("PASS  B parse-pdf ")), r.out).toEqual([]);
  });

  it("L0: a layout the section cannot read fails, before the publish too, and judges nothing it could not read", () => {
    const noMap = run(routes(BEFORE, { idx: { body: "const x=1;" } }));
    expect(fails(noMap), noMap.out).toEqual([`FAIL  L0 the scanner chunk ${NAMES.idx} holds no parse-refusal map (homepage.toast.fileDamaged): the bundle layout moved, so R1 and R2 cannot be judged`]);
    expect(noMap.lines.filter((l) => /^(PASS|FAIL|INFO) {2}R[12] /.test(l)), noMap.out).toEqual([]);
    const noReader = run(routes(AFTER, { asb: { body: "const nothing=1;" } }));
    expect(fails(noReader), noReader.out).toEqual([`FAIL  L0 neither the Account chunk (${NAMES.acc}) nor a chunk it imports holds the résumé text reader (it calls parse-pdf and parse-docx and tests a .txt name): the bundle layout moved, so T1 cannot be judged`]);
    expect(noReader.lines.filter((l) => /^(PASS|FAIL|INFO) {2}T1 /.test(l)), noReader.out).toEqual([]);
    const noEntry = run(routes(BEFORE, { page: { body: "<html>maintenance</html>" } }));
    expect(fails(noEntry).filter((l) => l.startsWith("FAIL  L0 /resume-checker names no readable /assets/index-*.js entry")), noEntry.out).toHaveLength(1);
  });

  it("L0: the reader is found in a chunk the Account chunk imports after the component chunks", () => {
    const moved = run(routes(AFTER, { asb: { body: "const nothing=1;" } }).concat([{ match: MATCH.asb.replace(NAMES.asb.replace(/\./g, "\\."), NAMES.bell.replace(/\./g, "\\.")), body: ASB_AFTER }]));
    expect(fails(moved), moved.out).toEqual([]);
    expect(verdicts(moved.lines, "PASS").filter((l) => l.startsWith(`PASS  T1 S14X-283 S14X-280 the résumé text reader ${NAMES.bell} `)), moved.out).toHaveLength(1);
  });

  it("S1: a lazy shard the entry does not name fails", () => {
    const r = run(routes(AFTER, { entry: { body: entryAfter(LAZY.filter((l) => l !== "hi")) } }));
    expect(fails(r), r.out).toEqual(["FAIL  S1 S14X-183 the entry names no lazy ingest-parsers shard for hi: those readers see keys where the refusals should be"]);
  });

  it("S1: the English strings may ride with the scanner or, as a build from before the review carried them, in the entry", () => {
    const old = run(routes(AFTER, { entry: { body: entryAfter(LAZY, shardFile("en")) }, idx: { body: idxAfter(null) } }));
    expect(fails(old), old.out).toEqual([]);
    expect(verdicts(old.lines, "PASS").some((l) => l.startsWith("PASS  S1 S14X-183 ")), old.out).toBe(true);
    const nowhere = run(routes(AFTER, { idx: { body: idxAfter(null) } }));
    expect(fails(nowhere).some((l) => l.startsWith("FAIL  S1 S14X-183 ingest-parsers strings missing from the published shards: en:")), nowhere.out).toBe(true);
  });

  it("S1: a string that is not the repo's own fails, in a lazy shard or in the English strings", () => {
    const de = JSON.parse(shardFile("de"));
    de.ingestParsers.refusal.webExport = "This document was saved as web content";
    const lazy = run(routes(AFTER, { shard_de: { body: shardChunk(JSON.stringify(de)) } }));
    expect(fails(lazy), lazy.out).toEqual(["FAIL  S1 S14X-183 ingest-parsers strings missing from the published shards: de:refusal.webExport"]);
    const en = JSON.parse(shardFile("en"));
    delete en.ingestParsers.notice.imagePagesSkippedDescription;
    const entry = run(routes(AFTER, { idx: { body: idxAfter(JSON.stringify(en)) } }));
    expect(fails(entry), entry.out).toEqual(["FAIL  S1 S14X-183 ingest-parsers strings missing from the published shards: en:notice.imagePagesSkippedDescription"]);
    const empty = run(routes(AFTER, { shard_tl: { status: 404, body: "" } }));
    expect(fails(empty).filter((l) => l.startsWith("FAIL  S1 S14X-183 ingest-parsers strings missing from the published shards: tl:refusal.emptyFile, tl:refusal.emptyFileDescription")), empty.out).toHaveLength(1);
  });

  it("R1: a published refusal map without a code, the shard keys or the Word title fails", () => {
    const noCode = run(routes(AFTER, { idx: { body: IDX_AFTER.replace("web_export:", "web_exported:") } }));
    expect(fails(noCode), noCode.out).toEqual([`FAIL  R1 S14X-183 the scanner chunk ${NAMES.idx} is the published round but its refusal map lacks web_export: that refusal shows the page's English fallback`]);
    const oldMap = run(routes(AFTER, { idx: BEFORE.idx }));
    expect(fails(oldMap).filter((l) => l.startsWith(`FAIL  R1 S14X-183 the scanner chunk ${NAMES.idx} is the published round but its refusal map lacks empty_file, password_protected`) && l.includes("the ingestParsers.refusal keys, a Word title for garbled text (docxGarbled)")), oldMap.out).toHaveLength(1);
  });

  it("R2: a published scanner chunk without a notice fails", () => {
    const r = run(routes(AFTER, { idx: { body: IDX_AFTER.split("\"image_pages_skipped\"").join("\"image_pages\"") } }));
    expect(fails(r), r.out).toEqual([`FAIL  R2 S14X-044 S14X-282 the scanner chunk ${NAMES.idx} is the published round but says no image_pages_skipped notice: an accepted upload that lost order or skipped pages says nothing`]);
  });

  it("T1: a published reader that still reads UTF-8 only fails, and one without the intake cleanup fails", () => {
    const old = run(routes(AFTER, { asb: BEFORE.asb }));
    expect(fails(old), old.out).toEqual([`FAIL  T1 S14X-283 S14X-280 the résumé text reader ${NAMES.asb} is the published round but does not decode UTF-16 LE by its byte-order mark, UTF-16 BE by its byte-order mark, windows-1252 for bytes that are not UTF-8, the intake cleanup of hyphens and invisible marks: a Notepad Unicode .txt still reads as NULs between letters`]);
    expect(ASB_AFTER).toContain("\\u2010-\\u2012");
    const noClean = run(routes(AFTER, { asb: { body: ASB_AFTER.split("\\u2010-\\u2012").join("\\u2013") } }));
    expect(fails(noClean), noClean.out).toEqual([`FAIL  T1 S14X-283 S14X-280 the résumé text reader ${NAMES.asb} is the published round but does not decode the intake cleanup of hyphens and invisible marks: a Notepad Unicode .txt still reads as NULs between letters`]);
  });
});

describe("the section reads only what it asked for", () => {
  it("a stale answer an earlier run left in its files is never read back: a dead network passes nothing", () => {
    const dead: Route[] = Object.keys(MATCH).map((n) => ({ match: MATCH[n], exit: 7 }));
    const r = run(dead, {
      stale: {
        vd_ip_hdr: "HTTP/2 200\r\nx-fn-build: parse-pdf.2026-11-12.1\r\n\r\n",
        "vd_ip_entry.js": entryAfter(),
        "vd_ip_idx.js": IDX_AFTER,
        "vd_ip_reader.js": ASB_AFTER,
        "vd_ip_shard_de.js": shardChunk(shardFile("de")),
      },
    });
    expect(verdicts(r.lines, "PASS"), r.out).toEqual([]);
    expect(fails(r).filter((l) => l.startsWith("FAIL  B ") && l.includes("carries no x-fn-build")), r.out).toHaveLength(3);
    expect(fails(r).filter((l) => l.startsWith("FAIL  L0 /resume-checker names no readable /assets/index-*.js entry")), r.out).toHaveLength(1);
  });
});

describe("the owner-gated line", () => {
  it("prints owner pending while the ledger does not name S14X-101, and reads the repo's ledger by default", () => {
    const r = run(routes(AFTER));
    expect(r.lines, r.out).toContain("INFO  S14X-101 owner pending: parse-pdf's and parse-docx's failure alerts still carry the uploader's address until the owner's answer is recorded");
    expect(SECTION).toMatch(/^VDIP_LEDGER="\$\{VDIP_LEDGER:-docs\/deploy-ledger\.json\}"$/m);
  });

  it("once decided, judges parse-pdf's and parse-docx's builds: PASS when both serve the round's, FAIL when one lags another, INFO before the paste", () => {
    const decided = { "S14X-101": { choice: "remove", date: "2026-11-15" } };
    const live = run(routes(AFTER), { ownerDecided: decided });
    expect(verdicts(live.lines, "PASS"), live.out).toContain("PASS  S14X-101 decided (remove): parse-pdf and parse-docx, whose failure alerts no longer carry the uploader's address, serve the round's build (the alert body is proven in the suite: a live alert needs a failing upload)");
    const half = run(routes(AFTER, { docx: BEFORE.docx }), { ownerDecided: decided });
    expect(fails(half), half.out).toContain("FAIL  S14X-101 decided (remove), but parse-docx does not serve the round's build while another parser does");
    const before = run(routes(BEFORE), { ownerDecided: { "S14X-101": "remove" } });
    expect(fails(before), before.out).toEqual([]);
    expect(before.lines, before.out).toContain("INFO  S14X-101 decided (remove); parse-pdf and parse-docx do not serve the round's build yet");
  });
});

describe("it never writes", () => {
  it("every call is an OPTIONS or a GET with no body, in this order, and the key is never printed", () => {
    const r = run(routes(AFTER));
    expect(r.calls).toEqual([
      "curl\tOPTIONS https://p.supabase.co/functions/v1/parse-pdf",
      "curl\tOPTIONS https://p.supabase.co/functions/v1/parse-docx",
      "curl\tOPTIONS https://p.supabase.co/functions/v1/parse-spreadsheet",
      "curl\tGET https://site.test/resume-checker",
      `curl\tGET https://site.test/assets/${NAMES.entry}`,
      `curl\tGET https://site.test/assets/${NAMES.idx}`,
      `curl\tGET https://site.test/assets/${NAMES.acc}`,
      `curl\tGET https://site.test/assets/${NAMES.asb}`,
      ...LAZY.map((l) => `curl\tGET https://site.test/assets/${shardName(l)}`),
    ]);
    for (const res of [r, run(routes(BEFORE))]) expect(res.out).not.toContain(KEY);
  });

  it("every line it prints is a verdict", () => {
    for (const r of [run(routes(BEFORE)), run(routes(AFTER))]) {
      const body = r.out.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("== "));
      expect(body.filter((l) => !/^(PASS|FAIL|INFO) {2}/.test(l)), r.out).toEqual([]);
    }
  });
});
