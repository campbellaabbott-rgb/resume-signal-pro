// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process, and minifies the lane's own files with
// esbuild (which refuses jsdom's TextEncoder).
/**
 * VERIFY SECTION 99zzzzzzz-bugs-copy-i18n-b CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-copy-i18n-b.sh judges S14X-179 (the
 * changelog loads each language's release notes when the language changes)
 * and CW2-AI7 (no progress string names a model) from the changelog chunk,
 * the paid success page's chunk, the scanner's chunk and every language's
 * string chunks. Run here against a fake curl:
 *   - production as it is today (the chunks cut to their tells: the run-once
 *     effect, the overlay's typed English, the old strings in nine
 *     languages) prints no FAIL, and both claims say 'not yet published';
 *   - this branch's build (its Changelog.tsx and AIGenerationProgress.tsx
 *     minified by esbuild here, its own nine locale files) prints PASS;
 *   - each regression prints FAIL for its own line, a host name (ChatGPT)
 *     and a key name (gpt5Writing) are not taken for a model, and a layout
 *     the section cannot read is a FAIL, not a quiet pass;
 *   - every request is a GET, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { transformSync } from "esbuild";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-copy-i18n-b.sh"), "utf8");
const KEY = "pk_test_SECRET_marker_bcib";
const S = "https://site\\.test";

type Json = Record<string, unknown>;
type Route = { match: string; status?: number; body?: string; file?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")o=a[++i];else if(x==="-D")i++;
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const body=r.file?fs.readFileSync(r.file):Buffer.from(r.body??"");
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lng = (typeof LNGS)[number];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const readJson = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as Json;
const BRANCH: Record<Lng, Json> = Object.fromEntries(LNGS.map((l) => [l, readJson(`src/i18n/locales/${l}.json`)])) as Record<Lng, Json>;

function at(o: Json, path: string): { holder: Json; leaf: string } {
  const parts = path.split(".");
  const leaf = parts.pop() as string;
  let h = o;
  for (const p of parts) { if (!h[p] || typeof h[p] !== "object") h[p] = {}; h = h[p] as Json; }
  return { holder: h, leaf };
}
const set = (o: Json, path: string, v: unknown) => { const { holder, leaf } = at(o, path); holder[leaf] = v; };

/** The five strings as production serves them on 2026-11-17, before this lane. */
const OLD: Record<Lng, [string, string, string, string, string]> = {
  en: ["Using Gemini Pro for maximum accuracy", "GPT-5 is Working", "GPT-5 is reading your experience and skills", "Using GPT-5 for maximum quality", "GPT-5 is writing..."],
  "en-GB": ["Using Gemini Pro for maximum accuracy", "GPT-5 is Working", "GPT-5 is reading your experience and skills", "Using GPT-5 for maximum quality", "GPT-5 is writing..."],
  de: ["Gemini Pro für maximale Genauigkeit", "GPT-5 arbeitet", "GPT-5 liest deine Erfahrungen und Fähigkeiten", "GPT-5 für maximale Qualität", "GPT-5 schreibt..."],
  es: ["Usando Gemini Pro para máxima precisión", "GPT-5 está trabajando", "GPT-5 está leyendo tu experiencia y habilidades", "Usando GPT-5 para máxima calidad", "GPT-5 está escribiendo..."],
  fr: ["Gemini Pro pour une précision maximale", "GPT-5 travaille", "GPT-5 lit votre expérience et vos compétences", "Utilisation de GPT-5 pour une qualité maximale", "GPT-5 écrit..."],
  hi: ["अधिकतम सटीकता के लिए Gemini Pro का उपयोग", "GPT-5 काम कर रहा है", "GPT-5 आपके अनुभव और कौशल पढ़ रहा है", "अधिकतम गुणवत्ता के लिए GPT-5 का उपयोग", "GPT-5 लिख रहा है..."],
  nl: ["Gemini Pro voor maximale nauwkeurigheid", "GPT-5 werkt", "GPT-5 leest je ervaring en vaardigheden", "GPT-5 voor maximale kwaliteit", "GPT-5 schrijft..."],
  pt: ["Usando Gemini Pro para máxima precisão", "GPT-5 Está Trabalhando", "GPT-5 está lendo sua experiência e habilidades", "Usando GPT-5 para máxima qualidade", "GPT-5 está escrevendo..."],
  tl: ["Gumagamit ng Gemini Pro para sa pinakamataas na katumpakan", "Nagtatrabaho ang GPT-5", "Binabasa ng GPT-5 ang iyong karanasan at kasanayan", "Gumagamit ng GPT-5 para sa pinakamataas na kalidad", "Sumusulat ang GPT-5..."],
};
const PATHS = ["scanProgress.subtitle", "aiGenerationProgress.title", "aiGenerationProgress.steps.analyzingDesc", "aiGenerationProgress.quality", "streamingContent.gpt5Writing"];
function today(): Record<Lng, Json> {
  const out = {} as Record<Lng, Json>;
  for (const l of LNGS) { const b = clone(BRANCH[l]); PATHS.forEach((p, i) => set(b, p, OLD[l][i])); out[l] = b; }
  return out;
}

// esbuild's spellings: a bare key where it is a name, a string in double
// quotes, or in backticks when it holds a double quote.
const IDENT = /^[A-Za-z_$][\w$]*$/;
function lit(v: unknown): string {
  if (typeof v === "string") return v.includes('"') ? "`" + v.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`" : JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(lit).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => (IDENT.test(k) || /^\d+$/.test(k) ? k : JSON.stringify(k)) + ":" + lit(x)).join(",") + "}";
  if (v === true) return "!0";
  if (v === false) return "!1";
  return JSON.stringify(v);
}
/** A non-English main bundle: one const per namespace, exported by name. */
function moduleChunk(b: Json): string {
  const names = Object.keys(b);
  return "const " + names.map((n, i) => `n${i}=${lit(b[n])}`).join(",") + ";export{" + names.map((n, i) => `n${i} as ${n}`).join(",") + "};";
}
const templ = (s: string) => "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
/** English: the whole bundle as JSON.parse of a template literal. */
const englishAll = (b: Json) => `import{a as e}from"./index-E1.js";e(JSON.parse(${templ(JSON.stringify(b))}));`;

const H8 = (tag: string, l: string) => (tag + l.replace("-", "") + "0000000").slice(0, 8);
const MAIN_NAME = (l: Lng) => (l === "en" ? "rb-en_all-Eall0000.js" : `${l}-${H8("M", l)}.js`);

const minify = (code: string) => transformSync(code, { loader: "tsx", jsx: "automatic", minify: true, format: "esm" }).code;
const CHANGELOG_SRC = readFileSync(resolve(ROOT, "src/pages/Changelog.tsx"), "utf8");
const OVERLAY_SRC = readFileSync(resolve(ROOT, "src/components/AIGenerationProgress.tsx"), "utf8");
const swapOnce = (s: string, a: string, b: string) => { expect(s.split(a).length - 1, a).toBe(1); return s.replace(a, b); };

/** The chunks as production serves them today (2026-11-17), cut to their tells. */
const CL_TODAY = 'import{a as n,r as o,b1 as l,u as m,j as e}from"./index-E1.js";function q(){const[d,s]=o.useState(!1);o.useEffect(()=>{l().finally(()=>s(!0))},[]);const{t:a,i18n:g}=m();return e.jsx("div",{className:"space-y-10",children:d&&[0].map(r=>e.jsx("h2",{children:a(`changelogEntries.${r}.title`)}))})}export{q as default};';
const PS_TODAY = 'import{j as e}from"./index-E1.js";const st=[{id:"analyzing",label:"Analyzing Resume",description:"GPT-5 is reading your experience and skills",duration:3e3}];function O(){return e.jsxs("div",{children:[e.jsx("h3",{className:"text-2xl font-bold text-foreground",children:"GPT-5 is Working"}),e.jsx("p",{children:"⚡ Using GPT-5 for maximum quality"}),e.jsx("p",{children:"🔒 Your data is processed securely"})]})}export{O as default};';
const idxChunk = (en: Json) => `import{a as ae}from"./index-E1.js";ae({scanProgress:${lit(en.scanProgress)}});const F=()=>import("./rb-en_ns_freeResults-Efr00000.js");export const I=1;`;

/** This branch's build: its own files, minified. */
const CL_BUILT = minify(CHANGELOG_SRC);
const psBuilt = (en: Json, overlay = OVERLAY_SRC) => `import{a as ae}from"./index-E1.js";ae({aiGenerationProgress:${lit(en.aiGenerationProgress)}});` + minify(overlay);

type Site = { bundles: Record<Lng, Json>; cl: string | null; ps: string | null; idxEn?: Json; drop?: Lng[]; noIndex?: boolean };
function routesFor(dir: string, site: Site): Route[] {
  mkdirSync(join(dir, "srv"), { recursive: true });
  const loaders = LNGS.filter((l) => l !== "en").map((l) => `${JSON.stringify(l)}:()=>O(()=>import("./${MAIN_NAME(l)}"),[])`).join(",");
  const entry = `const ML={${loaders}};const ND=()=>O(()=>import("./${MAIN_NAME("en")}"),[]);`
    + 'const r=[()=>O(()=>import("./PublicChangelog-Pc000000.js"),[]),()=>O(()=>import("./Changelog-Cl000000.js"),[]),()=>O(()=>import("./ProductSuccess-Ps000000.js"),[]),()=>O(()=>import("./AtsVendorGuide-Gd000000.js"),[])];';
  const routes: Route[] = [
    { match: `^GET ${S}/$`, body: '<html><head><script type="module" crossorigin src="/assets/index-E1.js"></script></head></html>' },
    { match: `^GET ${S}/resume-checker$`, body: site.noIndex ? "<html></html>" : '<html><head><script type="module" crossorigin src="/assets/index-E1.js"></script><link rel="modulepreload" crossorigin href="/assets/Index-Ix000000.js"></head></html>' },
    { match: `^GET ${S}/assets/index-E1\\.js$`, body: entry },
    // A longer name that ends in the same word, and a chunk whose name ends
    // in a language code: neither may be read as the changelog or a bundle.
    { match: `^GET ${S}/assets/PublicChangelog-Pc000000\\.js$`, body: "export const p=1;" },
    { match: `^GET ${S}/assets/AtsVendorGuide-Gd000000\\.js$`, body: 'const g={subtitle:"Using Gemini Pro"};export{g as scanProgress};' },
    { match: `^GET ${S}/assets/Index-Ix000000\\.js$`, body: idxChunk(site.idxEn ?? site.bundles.en) },
    { match: `^GET ${S}/assets/rb-en_ns_freeResults-Efr00000\\.js$`, body: 'import{a as e}from"./index-E1.js";e({freeResults:{title:"Your results"}});' },
  ];
  if (site.cl !== null) routes.push({ match: `^GET ${S}/assets/Changelog-Cl000000\\.js$`, body: site.cl });
  if (site.ps !== null) routes.push({ match: `^GET ${S}/assets/ProductSuccess-Ps000000\\.js$`, body: site.ps });
  for (const l of LNGS) {
    if (site.drop?.includes(l)) continue;
    const name = MAIN_NAME(l);
    const p = join(dir, "srv", name);
    writeFileSync(p, l === "en" ? englishAll(site.bundles.en) : moduleChunk(site.bundles[l]));
    routes.push({ match: `^GET ${S}/assets/${name.replace(/[.$]/g, "\\$&")}$`, file: p });
  }
  return routes;
}

function run(site: Site): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbcib-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routesFor(dir, site)));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const line = (lines: string[], id: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${id.replace(/[-.]/g, "\\$&")} `).test(l));
const verdict = (lines: string[], id: string) => line(lines, id).map((l) => l.slice(0, 4));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const BUILT: Site = { bundles: BRANCH, cl: CL_BUILT, ps: psBuilt(BRANCH.en) };

describe("verify section 99zzzzzzz-bugs-copy-i18n-b", () => {
  it("is named as the ledger's bug-round sections are, and bash can parse it", () => {
    expect(SECTION).toMatch(/^# shellcheck shell=bash/);
    expect(SECTION).toContain("== 99zzzzzzz-bugs-copy-i18n-b.");
    execFileSync("bash", ["-n", resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-copy-i18n-b.sh")]);
  });

  it("today's production: no FAIL, the stage and both claims INFO, and each says what is still there", () => {
    const { lines } = run({ bundles: today(), cl: CL_TODAY, ps: PS_TODAY });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L0"), show(lines)).toEqual(["INFO"]);
    expect(line(lines, "L0")[0]).toContain("Changelog-Cl000000.js");
    expect(line(lines, "L1")[0], show(lines)).toMatch(/^INFO .*has not published/);
    expect(line(lines, "S14X-179")[0], show(lines)).toMatch(/^INFO .*not yet published \(today: 0 keyed, 1 run once/);
    // 9 languages x 5 strings, the scanner's inline English subtitle and the overlay's 3 typed literals.
    expect(line(lines, "CW2-AI7")[0], show(lines)).toMatch(/^INFO .*not yet published \(today: 49 name one: /);
    expect(verdict(lines, "X1")).toEqual(["INFO"]);
  });

  it("this branch's build: the stage and both claims pass, and the key named gpt5Writing is not taken for a model", () => {
    expect(JSON.stringify(BRANCH.de)).toContain("gpt5Writing");
    const { lines } = run(BUILT);
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L1"), show(lines)).toEqual(["PASS"]);
    expect(line(lines, "S14X-179")[0], show(lines)).toMatch(/^PASS .*1 keyed \(deps \[\w+\]\), 0 run once/);
    expect(line(lines, "CW2-AI7")[0], show(lines)).toMatch(/^PASS .*none names one/);
  });

  it("a host's name is not a model: ChatGPT in a progress string still passes", () => {
    const b = clone(BRANCH);
    set(b.es, "streamingContent.waiting", "Esperando a ChatGPT...");
    const { lines } = run({ ...BUILT, bundles: b });
    expect(verdict(lines, "CW2-AI7"), show(lines)).toEqual(["PASS"]);
  });

  it("a changelog that keeps the mark but loads its notes once fails S14X-179, and so does one with no deps at all", () => {
    const once = minify(swapOnce(CHANGELOG_SRC, "}, [lng]);", "}, []);"));
    const a = run({ ...BUILT, cl: once }).lines;
    expect(line(a, "S14X-179")[0], show(a)).toMatch(/^FAIL .*0 keyed, 1 run once/);
    expect(verdict(a, "CW2-AI7")).toEqual(["PASS"]);
    const every = minify(swapOnce(CHANGELOG_SRC, "}, [lng]);", "});"));
    const b = run({ ...BUILT, cl: every }).lines;
    expect(line(b, "S14X-179")[0], show(b)).toMatch(/^FAIL .*no hook in the chunk waits on a load/);
  });

  it("a model named in one language, in the scanner's English or in the overlay's own literal fails CW2-AI7 and names where", () => {
    const b = clone(BRANCH);
    set(b.tl, "aiGenerationProgress.quality", OLD.tl[3]);
    const lang = run({ ...BUILT, bundles: b }).lines;
    expect(line(lang, "CW2-AI7")[0], show(lang)).toMatch(/^FAIL .*1 name one: tl-Mtl00000\.js aiGenerationProgress: "Gumagamit ng GPT-5/);

    const en = clone(BRANCH.en);
    set(en, "scanProgress.subtitle", OLD.en[0]);
    const idx = run({ ...BUILT, idxEn: en }).lines;
    expect(line(idx, "CW2-AI7")[0], show(idx)).toMatch(/^FAIL .*Index-Ix000000\.js scanProgress: "Using Gemini Pro/);

    const typed = psBuilt(BRANCH.en, swapOnce(OVERLAY_SRC, "{t('aiGenerationProgress.secure')}", "{\"Gemini 3 Flash keeps it safe\"}"));
    const lit7 = run({ ...BUILT, ps: typed }).lines;
    expect(line(lit7, "CW2-AI7")[0], show(lit7)).toMatch(/^FAIL .*ProductSuccess-Ps000000\.js literal: "Gemini 3 Flash/);
  });

  it("one half published without the other fails the stage, and each claim is judged by its own mark", () => {
    const a = run({ bundles: today(), cl: CL_BUILT, ps: PS_TODAY }).lines;
    expect(line(a, "L1")[0], show(a)).toMatch(/^FAIL .*only the changelog's mark is published/);
    expect(verdict(a, "S14X-179")).toEqual(["PASS"]);
    expect(line(a, "CW2-AI7")[0]).toMatch(/^INFO .*not yet published/);
    const b = run({ bundles: BRANCH, cl: CL_TODAY, ps: psBuilt(BRANCH.en) }).lines;
    expect(line(b, "L1")[0], show(b)).toMatch(/^FAIL .*only the overlay's keys are published/);
    expect(line(b, "S14X-179")[0]).toMatch(/^INFO .*not yet published/);
    expect(verdict(b, "CW2-AI7")).toEqual(["PASS"]);
  });

  it("a layout it cannot read is a FAIL that names what is missing, never a quiet pass", () => {
    const noCl = run({ ...BUILT, cl: null }).lines;
    expect(line(noCl, "L0")[0], show(noCl)).toMatch(/^FAIL .*the changelog chunk Changelog-Cl000000\.js \(it reads no changelogEntries\. key\)/);
    expect(verdict(noCl, "S14X-179")).toEqual([]);
    const noDe = run({ ...BUILT, drop: ["de"] }).lines;
    expect(line(noDe, "L0")[0], show(noDe)).toMatch(/^FAIL .*scanProgress in de; aiGenerationProgress in de/);
    const noIdx = run({ ...BUILT, noIndex: true }).lines;
    expect(line(noIdx, "L0")[0], show(noIdx)).toMatch(/^FAIL .*the scanner chunk/);
    const noPs = run({ ...BUILT, ps: null }).lines;
    expect(line(noPs, "L0")[0], show(noPs)).toMatch(/^FAIL .*the overlay chunk/);
  });

  it("every request is a GET, and the key is never printed", () => {
    const { calls, out } = run(BUILT);
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(c, c).toMatch(/^curl\tGET https:\/\/site\.test\//);
    expect(out).not.toContain(KEY);
    expect(calls.join("\n")).not.toContain(KEY);
  });
});
