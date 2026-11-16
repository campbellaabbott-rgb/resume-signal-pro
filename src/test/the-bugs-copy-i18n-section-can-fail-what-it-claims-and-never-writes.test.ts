// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-copy-i18n CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, WAITS FOR THE OWNER, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-copy-i18n.sh judges the copy-i18n
 * lane of the 2026-11-08 bug round from the string chunks the entry names,
 * the edge-error module and /trust as a crawler reads it. Run here against a
 * fake curl and a ledger of the test's own, with every language's bundle
 * built from this branch's own locale files, printed the two ways the build
 * prints them (English as JSON.parse of a template literal or a bare object,
 * the rest as module consts exported by name):
 *   - production as it is today (the bundles before this lane) prints no
 *     FAIL, every claim says 'not yet published' and the owner lines say
 *     'owner pending';
 *   - this branch's bundles print PASS for every claim, and an owner answer
 *     whose half has not been published is a FAIL until it is;
 *   - each regression prints FAIL for its own claim, and a layout the section
 *     cannot read is a FAIL, not a quiet pass;
 *   - every request is a GET, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 90_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-copy-i18n.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bci";
const S = "https://site\\.test";

type Json = Record<string, unknown>;
type Route = { match: string; status?: number; body?: string; file?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url;
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.file?fs.readFileSync(r.file):Buffer.from(r.body??"");
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(Buffer.concat([Buffer.from(out),body]));
else process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

const LNGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lng = (typeof LNGS)[number];
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const readJson = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as Json;
const LANE: Record<Lng, Json> = Object.fromEntries(LNGS.map((l) => [l, readJson(`src/i18n/locales/${l}.json`)])) as Record<Lng, Json>;
const CHANGELOG: Record<Lng, Json> = Object.fromEntries(LNGS.map((l) => [l, readJson(`src/i18n/changelog/${l}.json`)])) as Record<Lng, Json>;

function at(o: Json, path: string): { holder: Json; leaf: string } {
  const parts = path.split(".");
  const leaf = parts.pop() as string;
  let h = o;
  for (const p of parts) { if (!h[p] || typeof h[p] !== "object") h[p] = {}; h = h[p] as Json; }
  return { holder: h, leaf };
}
const set = (o: Json, path: string, v: unknown) => { const { holder, leaf } = at(o, path); holder[leaf] = v; };
const del = (o: Json, path: string) => { const { holder, leaf } = at(o, path); delete holder[leaf]; };
const getS = (o: Json, path: string) => { const { holder, leaf } = at(clone(o), path); return holder[leaf] as string; };

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
/** A non-English chunk: one const per namespace, exported by name (one of them local 'as'). */
function moduleChunk(b: Json): string {
  const names = Object.keys(b);
  const local = (i: number) => (i === 1 ? "as" : "n" + i);
  return "const " + names.map((n, i) => `${local(i)}=${lit(b[n])}`).join(",") + ";export{" + names.map((n, i) => `${local(i)} as ${n}`).join(",") + "};";
}
const templ = (s: string) => "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
/** English: the big bundle and jobsPage as JSON.parse(`…`), format as a bare object. */
function englishChunks(b: Json): { all: string; jobs: string; format: string } {
  const rest = clone(b);
  const jobs = { jobsPage: rest.jobsPage };
  const format = { format: rest.format ?? { justNow: "just now" } };
  delete rest.jobsPage; delete rest.format;
  return {
    all: `import{a as e}from"./index-E1.js";e(JSON.parse(${templ(JSON.stringify(rest))}));`,
    jobs: `import{a as e}from"./index-E1.js";e(JSON.parse(${templ(JSON.stringify(jobs))}));`,
    format: `import{a as o}from"./index-E1.js";o(${lit(format)});`,
  };
}
const changelogChunk = (b: Json) => "const e=" + lit(b.changelogEntries) + ";export{e as changelogEntries,e as default};";

const H8 = (tag: string, l: string) => (tag + l.replace("-", "") + "0000000").slice(0, 8);
const MAIN_NAME = (l: Lng) => (l === "en" ? "" : `${l}-${H8("M", l)}.js`);
const CL_NAME = (l: Lng) => `${l}-${H8("C", l)}.js`;
const EN_ALL = "rb-en_all-Eall0000.js", EN_JOBS = "rb-en_ns_jobsPage-Ejob0000.js", EN_FORMAT = "rb-en_ns_format-Efmt0000.js";

const PAGE = '<html><head><script type="module" crossorigin src="/assets/index-E1.js"></script></head></html>';
function entry(): string {
  const loaders = (name: (l: Lng) => string) => "{" + LNGS.filter((l) => name(l)).map((l) => `${JSON.stringify(l)}:()=>O(()=>import("./${name(l)}"),[])`).join(",") + "}";
  return 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/check-Ck000000.js","assets/SellerIdentity-Si000000.js","assets/Footer-Ft000000.js"])))=>i.map(i=>d[i]);'
    + 'const r=[()=>O(()=>import("./Account-Ac000000.js"),__vite__mapDeps([0,1,2])),()=>O(()=>import("./Jobs-Jb000000.js"),__vite__mapDeps([1,2])),()=>O(()=>import("./Trust-Tr000000.js"),__vite__mapDeps([1])),()=>O(()=>import("./FixPlanConfirm-Fp000000.js"),[])];'
    + `const ML=${loaders(MAIN_NAME)};const CL=${loaders(CL_NAME)};`
    + `const ND=()=>O(()=>import("./${EN_ALL}"),[]);const NS={jobsPage:()=>O(()=>import("./${EN_JOBS}"),[]),format:()=>O(()=>import("./${EN_FORMAT}"),[])};`;
}

// The edge-error module: today's (no edgeErrors key, no 422, no ai_unavailable)
// and this branch's own source file, whose literals survive minification.
const EDGE_TODAY = 'const Ws={"Payment verification required.":{title:"Payment Required",description:"Payment verification required."}},Xs={400:{title:"Invalid Request"},429:{title:"Too Many Requests"},500:{title:"Server Error"}};async function Ys(e){await Fe.rpc("log_error_telemetry",{p_code:e})}export{Ws as P};';
const EDGE_BUILT = readFileSync(resolve(ROOT, "src/lib/edge-function-errors.ts"), "utf8");
const FPC_TODAY = 'e.jsx("p",{className:"text-sm text-foreground",children:t("fixPlanConfirm.done","Done. The first email arrives in two days.")});';
const FPC_WITHDRAWN = 'e.jsx("p",{"data-fix-plan":"withdrawn",children:t("mailPrefs.fixPlanWithdrawn","We no longer send the fix-plan emails, so this link starts nothing and no emails will follow from it.")});';

/** The Trust page's retention table as the prerender prints it, from an English bundle. */
function trustHtml(en: Json): string {
  const rows = (en.trustPage as Json & { retention: { rows: Record<string, Record<string, string>> } }).retention.rows;
  const cell = (s: string) => s.replace(/\{\{email\}\}/g, "privacy@example.test").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const tr = (r: Record<string, string>) => `<tr class="border-t border-border"><th scope="row" class="text-left p-2 font-medium">${cell(r.what)}</th><td class="p-2 text-muted-foreground">${cell(r.where)}</td><td class="p-2 text-muted-foreground">${cell(r.howLong)}</td></tr>`;
  return `<html><body><table><tbody>${Object.values(rows).map(tr).join("")}</tbody></table></body></html>`;
}

/** Production before this lane, rebuilt from the branch: each claim put back as it reads live. */
const OLD_AGENT_HOWLONG: Record<Lng, string> = {
  en: "The apply agent is switched off and sends it to no one. A CV given to it earlier is kept until you delete your account or ask for erasure: deleting your account erases the text; email {{email}} to have the file erased.",
  "en-GB": "The apply agent is switched off and sends it to no one. A CV given to it earlier is kept until you delete your account or ask for erasure: deleting your account erases the text; email {{email}} to have the file erased.",
  de: "Ein früher übergebener Lebenslauf bleibt, bis du dein Konto löschst; schreib an {{email}}, um die Datei löschen zu lassen.",
  es: "Un CV que le diste antes se conserva; escribe a {{email}} para que borremos el archivo.",
  fr: "Un CV confié auparavant est conservé ; écrivez à {{email}} pour faire effacer le fichier.",
  hi: "पहले दिया गया CV रखा जाता है; फ़ाइल मिटवाने के लिए {{email}} पर ईमेल करें।",
  nl: "Een eerder gegeven cv bewaren we; mail {{email}} om het bestand te laten wissen.",
  pt: "Um CV entregue antes fica guardado; escreva para {{email}} para apagar o ficheiro.",
  tl: "Itinatago ang CV na ibinigay dati; mag-email sa {{email}} para ipabura ang file.",
};
const OLD_DIGEST: Record<Lng, string> = {
  en: "Stop the morning shortlist emails. Your agent keeps running.", "en-GB": "Stop the morning shortlist emails. Your agent keeps running.",
  de: "Morgendliche Auswahl abbestellen. Ihr Agent läuft weiter.", es: "Deja de recibir la selección. Tu agente sigue funcionando.",
  fr: "Arrêter la sélection du matin. Votre agent continue de tourner.", hi: "सुबह की सूची बंद करें। आपका एजेंट चलता रहेगा।",
  nl: "Stop de ochtendselectie. Je agent blijft draaien.", pt: "Parar a seleção da manhã. O seu agente continua a funcionar.",
  tl: "Itigil ang shortlist sa umaga. Patuloy na tatakbo ang iyong agent.",
};
/**
 * The strings the four owner lines judge, as this lane leaves them: the owner
 * halves (bugs/a-copy-i18n-owner) change them, so a bundle "before the owner's
 * half" is built from these and never from whatever the branch's files hold.
 */
const BEFORE_OWNER: Record<Lng, { shortlist: string; done: string; badge: string; takedowns: string }> = {
  en: { shortlist: "Until the employer deletes them", done: "Done. The first email arrives in two days.", badge: "Writing tools", takedowns: "{{n}} roles filled or closed in the last 24 hours" },
  "en-GB": { shortlist: "Until the employer deletes them", done: "Done. The first email arrives in two days.", badge: "Writing tools", takedowns: "{{n}} roles filled or closed in the last 24 hours" },
  de: { shortlist: "Bis der Arbeitgeber sie löscht", done: "Erledigt. Die erste E-Mail kommt in zwei Tagen.", badge: "Schreibwerkzeuge", takedowns: "{{n}} Stellen in den letzten 24 Stunden besetzt oder geschlossen" },
  es: { shortlist: "Hasta que la empresa los elimine", done: "Listo. El primer correo llega en dos días.", badge: "Herramientas de redacción", takedowns: "{{n}} puestos cubiertos o cerrados en las últimas 24 horas" },
  fr: { shortlist: "Jusqu'à ce que l'employeur les supprime", done: "C'est fait. Le premier e-mail arrive dans deux jours.", badge: "Outils de rédaction", takedowns: "{{n}} postes pourvus ou fermés au cours des dernières 24 heures" },
  hi: { shortlist: "जब तक नियोक्ता उन्हें नहीं हटाता", done: "हो गया। पहला ईमेल दो दिन में आएगा।", badge: "लेखन टूल्स", takedowns: "पिछले 24 घंटों में {{n}} भूमिकाएँ भरी या बंद हुईं" },
  nl: { shortlist: "Tot de werkgever ze verwijdert", done: "Klaar. De eerste e-mail komt over twee dagen.", badge: "Schrijftools", takedowns: "{{n}} vacatures vervuld of gesloten in de afgelopen 24 uur" },
  pt: { shortlist: "Até o empregador os eliminar", done: "Pronto. O primeiro e-mail chega em dois dias.", badge: "Ferramentas de escrita", takedowns: "{{n}} vagas preenchidas ou fechadas nas últimas 24 horas" },
  tl: { shortlist: "Hanggang burahin ng employer ang mga ito", done: "Tapos na. Darating ang unang email sa loob ng dalawang araw.", badge: "Mga writing tool", takedowns: "{{n}} posisyon ang napunan o nagsara sa nakalipas na 24 oras" },
};
const BEFORE_OWNER_EMAIL_ROW = {
  what: "A report you email to yourself, the paid analysis we email you, and any fix-plan emails you opt into",
  where: "Your inbox, sent through our email provider; scheduled fix-plan emails wait in our send queue",
  howLong: "The queued emails go out over 14 days; unsubscribing cancels the rest",
};
function beforeOwner(bundles: Record<Lng, Json>): Record<Lng, Json> {
  const out = {} as Record<Lng, Json>;
  for (const l of LNGS) {
    const b = clone(bundles[l]);
    const v = BEFORE_OWNER[l];
    set(b, "trustPage.retention.rows.shortlist.howLong", v.shortlist);
    set(b, "fixPlanConfirm.done", v.done);
    set(b, "proPlan.badge", v.badge);
    set(b, "jobsPage.takedownsLast24h", v.takedowns);
    if (l.startsWith("en")) for (const [k, x] of Object.entries(BEFORE_OWNER_EMAIL_ROW)) set(b, `trustPage.retention.rows.email.${k}`, x);
    out[l] = b;
  }
  return out;
}
const PLURAL_KEYS = ["freeResults.actionBanner.issuesFound", "jobsPage.a11yResults", "freeResults.lockedInsights.kwDescWithStats", "homepage.toast.unreadCharactersDescription", "jobKeywordMatcher.topActions", "jobsPage.fuzzyExtraLine", "jobsPage.hiddenCount", "jobsPage.hiddenByViews", "accountPage.tracked"];
const NEW_KEYS = ["atsCoverage.stripHeading", "atsCoverage.stripSub", "atsCoverage.subCounted", "atsCoverage.eyebrow", "atsCoverage.asOf", "freeResults.matches.openBoard", "emailUnsubscribe.metaTitle", "emailUnsubscribe.metaDescription", "agentControls", "agentNight", "agent", "agentSetup", "receipt", "morningQueue", "agentQueue.countryAny", "accountPage.notifAgentEmail", "accountPage.notifAgentPaused"];
function today(): Record<Lng, Json> {
  const out = {} as Record<Lng, Json>;
  const pre = beforeOwner(LANE);
  for (const l of LNGS) {
    const b = pre[l];
    delete b.edgeErrors;
    for (const k of PLURAL_KEYS) {
      const { holder, leaf } = at(b, k);
      holder[leaf] = holder[`${leaf}_other`];
      for (const f of ["one", "other", "many"]) delete holder[`${leaf}_${f}`];
    }
    for (const k of NEW_KEYS) del(b, k);
    set(b, "trustPage.retention.rows.agent.howLong", OLD_AGENT_HOWLONG[l]);
    set(b, "trustPage.retention.rows.browserLocal.howLong", "Until it is cleared: the Clear Browser Data button on a paid results page clears all of it");
    set(b, "emailUnsubscribe.agentDigest", OLD_DIGEST[l]);
    if (l === "hi" || l === "tl") set(b, "jobsPage.dropRateLimited", "Too many scans from this network for now. Try again in a few minutes.");
    set(b, "accountPage.acFitTitle", l.startsWith("en") ? "Keyword fit {{pct}}%: {{pct}}% of the posting's recognized keywords are in your resume" : "{{pct}}%");
    set(b, "jobsPage.matchCoverage", l.startsWith("en") ? "{{pct}}% of this posting's recognized keywords are already in your resume" : "{{pct}}%");
    out[l] = b;
  }
  return out;
}

type Site = { bundles: Record<Lng, Json>; changelog?: Record<Lng, Json>; edge?: string | null; edgeIn?: "SellerIdentity" | "check"; fpc?: string; trust?: string | null; page?: string; drop?: string[] };
function routesFor(dir: string, site: Site): Route[] {
  const files = new Map<string, string>();
  for (const l of LNGS) {
    if (l === "en") {
      const c = englishChunks(site.bundles.en);
      files.set(EN_ALL, c.all); files.set(EN_JOBS, c.jobs); files.set(EN_FORMAT, c.format);
    } else files.set(MAIN_NAME(l), moduleChunk(site.bundles[l]));
    files.set(CL_NAME(l), changelogChunk((site.changelog ?? CHANGELOG)[l]));
  }
  const edge = site.edge === undefined ? EDGE_BUILT : site.edge;
  const shared = { SellerIdentity: "export const s=1;", check: "export const c=1;" };
  if (edge !== null) shared[site.edgeIn ?? "SellerIdentity"] = edge;
  files.set("SellerIdentity-Si000000.js", shared.SellerIdentity);
  files.set("check-Ck000000.js", shared.check);
  files.set("Footer-Ft000000.js", "export const f=1;");
  files.set("FixPlanConfirm-Fp000000.js", site.fpc ?? FPC_TODAY);
  mkdirSync(join(dir, "srv"), { recursive: true });
  const routes: Route[] = [
    { match: `^GET ${S}/$`, body: site.page ?? PAGE },
    { match: `^GET ${S}/trust$`, body: site.trust === null ? "" : site.trust ?? trustHtml(site.bundles.en) },
    { match: `^GET ${S}/assets/index-E1\\.js$`, body: entry() },
  ];
  for (const [name, text] of files) {
    if (site.drop?.includes(name)) continue;
    const p = join(dir, "srv", name);
    writeFileSync(p, text);
    routes.push({ match: `^GET ${S}/assets/${name.replace(/[.$]/g, "\\$&")}$`, file: p });
  }
  return routes;
}

function run(site: Site, ownerDecided: Json = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbci-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routesFor(dir, site)));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided } } }));
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDCI_LEDGER: join(dir, "ledger.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const CLAIMS = ["S14X-176", "S14X-232", "S14X-097", "S14X-253", "S14X-183", "S14X-109", "S14X-110", "S14X-225", "S14X-178", "S14X-291", "NEW-COPY-I18N-02", "NEW-COPY-I18N-01"];
const OWNER = ["O1", "O2", "O3", "O4"];
const line = (lines: string[], id: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${id.replace(/[-.]/g, "\\$&")} `).test(l));
const verdict = (lines: string[], id: string) => line(lines, id).map((l) => l.slice(0, 4));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const DECIDED = {
  "S14X-073": { choice: "A", rule: "an employer delete for a role or a candidate, plus a four-year purge (not option B)" },
  "S14X-012": { choice: "B", rule: "withdraw the promise rather than drain it" },
  "NB-11": { choice: "proposed wording", rule: "five packages a day" },
  "NB-47": { choice: "postings taken down in the last 24 hours" },
};
/**
 * The owner halves as bugs/a-copy-i18n-owner and its partners publish them:
 * this branch's own strings where it holds the half (the Trust Shortlist and
 * email rows, the withdrawn fix-plan strings), the rest as they will read.
 */
function ownerBuilt(): Record<Lng, Json> {
  const out = {} as Record<Lng, Json>;
  for (const l of LNGS) {
    const b = clone(LANE[l]);
    set(b, "proPlan.badge", "Pro");
    set(b, "jobsPage.takedownsLast24h", l.startsWith("en") ? "{{n}} postings taken down in the last 24 hours" : `{{n}} (${l})`);
    out[l] = b;
  }
  return out;
}

describe("verify section 99zzzzzzz-bugs-copy-i18n", () => {
  it("is named as the ledger's bug-round sections are, sorting after every 99zzzzzz- file", () => {
    expect(SECTION).toMatch(/^# shellcheck shell=bash/);
    expect(SECTION).toContain("== 99zzzzzzz-bugs-copy-i18n.");
  });

  it("today's production: no FAIL, every claim not yet published, every owner line pending", () => {
    const { lines } = run({ bundles: today(), edge: EDGE_TODAY });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L0"), show(lines)).toEqual(["INFO"]);
    expect(line(lines, "L1")[0], show(lines)).toMatch(/^INFO .*has not published/);
    for (const id of CLAIMS) expect(line(lines, id), `${id}\n${show(lines)}`).toEqual([expect.stringMatching(/^INFO .*not yet published/)]);
    for (const id of OWNER) expect(line(lines, id), `${id}\n${show(lines)}`).toEqual([expect.stringMatching(/^INFO .*owner pending$/)]);
  });

  it("the L0 line names every language's bundle, the module and the FixPlanConfirm chunk it read", () => {
    const { lines } = run({ bundles: today(), edge: EDGE_TODAY });
    const l0 = line(lines, "L0")[0] ?? "";
    for (const l of LNGS) expect(l0, show(lines)).toContain(`${l} ${l === "en" ? 3 : 1}`);
    expect(l0).toContain("changelogs 9");
    expect(l0).toContain("SellerIdentity-Si000000.js");
    expect(l0).toContain("FixPlanConfirm-Fp000000.js");
  });

  it("this branch's bundles: every claim passes, and the owner lines still wait for the ledger", () => {
    const { lines } = run({ bundles: LANE });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L1")).toEqual(["PASS"]);
    for (const id of CLAIMS) expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["PASS"]);
    for (const id of OWNER) expect(line(lines, id), id).toEqual([expect.stringMatching(/owner pending$/)]);
  });

  it("an owner answer whose half is not published yet is a FAIL, and the halves published pass", () => {
    const before = run({ bundles: beforeOwner(LANE) }, DECIDED).lines;
    for (const id of OWNER) expect(verdict(before, id), `${id}\n${show(before)}`).toEqual(["FAIL"]);
    const built = ownerBuilt();
    const after = run({ bundles: built, fpc: FPC_WITHDRAWN }, DECIDED).lines;
    expect(fails(after), show(after)).toEqual([]);
    for (const id of [...CLAIMS, ...OWNER]) expect(verdict(after, id), `${id}\n${show(after)}`).toEqual(["PASS"]);
  });

  it("an owner answer for the other option is judged by that option, or says nothing changes", () => {
    const { lines } = run({ bundles: beforeOwner(LANE) }, { "S14X-073": { choice: "B", rule: "copy only (not rule A)" }, "S14X-012": "A", "NB-11": "keep the card", "NB-47": "closed" });
    expect(line(lines, "O1")[0], show(lines)).toMatch(/^FAIL .*rule B.*still says it/);
    expect(line(lines, "O2")[0]).toMatch(/^INFO .*decided "A": .*nothing here changes/);
    expect(line(lines, "O3")[0]).toMatch(/^INFO .*decided "keep the card"/);
    expect(line(lines, "O4")[0]).toMatch(/^INFO .*decided "closed"/);
  });

  it("an owner line is still pending before the merge publishes, whatever the ledger says", () => {
    const { lines } = run({ bundles: today(), edge: EDGE_TODAY }, DECIDED);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const id of OWNER) expect(line(lines, id)[0], id).toMatch(/^INFO .*not yet published$/);
  });

  it("each string claim fails on its own regression, in the language that regressed", () => {
    const b = clone(LANE);
    del(b.de, "jobsPage.hiddenCount_one");
    del(b.tl, "atsCoverage.eyebrow");
    set(b.es, "emailUnsubscribe.agentDigest", OLD_DIGEST.es);
    del(b.pt, "receipt.title");
    set(b.tl, "jobsPage.dropRateLimited", "Too many scans from this network for now.");
    set(b.en, "jobsPage.matchCoverage", "{{pct}}% of this posting's recognized keywords are already in your resume");
    set(b.fr, "trustPage.retention.rows.agent.howLong", OLD_AGENT_HOWLONG.fr);
    set(b.nl, "trustPage.retention.rows.browserLocal.howLong", "Tot die wordt gewist met de knop");
    const { lines } = run({ bundles: b });
    const want: Record<string, RegExp> = {
      "S14X-176": /jobsPage\.hiddenCount \(de\)/,
      "S14X-253": /atsCoverage\.eyebrow is missing in tl/,
      "S14X-225": /keeps running, or is missing, in es/,
      "NEW-COPY-I18N-02": /receipt\.title is missing in pt/,
      "S14X-178": /missing, in tl/,
      "S14X-291": /an English bundle still says .*matchCoverage is still served in en|an English bundle still says/,
      "S14X-232": /old clause, or is missing, in fr/,
      "S14X-097": /names no signing out in nl/,
    };
    for (const [id, re] of Object.entries(want)) {
      expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["FAIL"]);
      expect(line(lines, id)[0]).toMatch(re);
    }
    for (const id of ["S14X-183", "S14X-109", "S14X-110"]) expect(verdict(lines, id), id).toEqual(["PASS"]);
  });

  it("the Trust claims fail on the page a crawler reads, and the edgeErrors claim on a language that dropped it", () => {
    const b = clone(LANE);
    delete b.hi.edgeErrors;
    const old = clone(LANE.en);
    set(old, "trustPage.retention.rows.agent.howLong", OLD_AGENT_HOWLONG.en);
    set(old, "trustPage.retention.rows.browserLocal.howLong", "Until it is cleared: the Clear Browser Data button on a paid results page clears all of it");
    const { lines } = run({ bundles: b, trust: trustHtml(old) });
    expect(line(lines, "S14X-232")[0], show(lines)).toMatch(/^FAIL .*to have the file erased.*erases both the text and the file/);
    expect(line(lines, "S14X-097")[0]).toMatch(/^FAIL .*\/trust's row reads 'Until it is cleared/);
    expect(line(lines, "S14X-183")[0]).toMatch(/^FAIL .*edgeErrors is not served in hi/);
    expect(verdict(lines, "L1")).toEqual(["PASS"]);
  });

  it("the module claims fail on a module that maps none of the new codes, and on one the section cannot find", () => {
    const bare = run({ bundles: LANE, edge: EDGE_TODAY }).lines;
    expect(line(bare, "S14X-183")[0], show(bare)).toMatch(/^FAIL .*reads no edgeErrors key.*no 422 entry/);
    expect(line(bare, "S14X-109")[0]).toMatch(/^FAIL .*no ai_unavailable code and no 'credits depleted' sentence/);
    expect(line(bare, "S14X-110")[0]).toMatch(/^FAIL .*model_busy and limiter_unavailable to nothing/);
    const gone = run({ bundles: LANE, edge: null }).lines;
    for (const id of ["S14X-183", "S14X-109", "S14X-110"]) expect(line(gone, id)[0], `${id}\n${show(gone)}`).toMatch(/^FAIL .*edge-error module .* could not be read/);
    // Found wherever the shared chunks put it, not by its name today.
    const moved = run({ bundles: LANE, edgeIn: "check" }).lines;
    for (const id of ["S14X-183", "S14X-109", "S14X-110"]) expect(verdict(moved, id), `${id}\n${show(moved)}`).toEqual(["PASS"]);
    expect(line(moved, "L0")[0]).toContain("check-Ck000000.js");
  });

  it("the changelog claim fails on a language that still serves an English entry, and on one whose changelog it cannot find", () => {
    const cl = clone(CHANGELOG);
    set(cl.es, "changelogEntries.dataAiIndustrySplit.title", "Data Engineering, Data Science, and AI/ML are now separate industries");
    set(cl.tl, "changelogEntries.phraseAwareKeywordMatching.title", "Fewer false 'missing keyword' reports");
    const stale = run({ bundles: LANE, changelog: cl }).lines;
    expect(line(stale, "NEW-COPY-I18N-01")[0], show(stale)).toMatch(/^FAIL .*an English title is still served in es, tl$/);
    const gone = run({ bundles: LANE, drop: [CL_NAME("hi")] }).lines;
    expect(line(gone, "NEW-COPY-I18N-01")[0], show(gone)).toMatch(/^FAIL .*no changelog chunk found for hi/);
  });

  it("a layout it cannot read is a FAIL that says so, never a quiet pass", () => {
    const noEntry = run({ bundles: LANE, page: "<html></html>" }).lines;
    expect(line(noEntry, "L0")[0], show(noEntry)).toMatch(/^FAIL .*the entry/);
    expect(noEntry.filter((l) => /^(PASS|FAIL) {2}S14X/.test(l))).toEqual([]);
    const noDe = run({ bundles: LANE, drop: [MAIN_NAME("de")] }).lines;
    expect(line(noDe, "L0")[0], show(noDe)).toMatch(/^FAIL .*main string bundle of de/);
    const broken = clone(LANE);
    del(broken.nl, "atsCoverage.heading");
    const ctl = run({ bundles: broken }).lines;
    expect(line(ctl, "L0")[0], show(ctl)).toMatch(/^FAIL .*atsCoverage\.heading in nl/);
  });

  it("asks only with GET, fetches every string chunk the entry names, and never prints the key", () => {
    const { calls, out } = run({ bundles: LANE });
    expect(calls.length).toBeGreaterThan(20);
    for (const c of calls) expect(c, c).toMatch(/^curl\tGET https:\/\/site\.test\//);
    for (const l of LNGS) expect(calls.some((c) => c.includes(`/assets/${l === "en" ? EN_ALL : MAIN_NAME(l)}`)), l).toBe(true);
    expect(calls.some((c) => c.includes(`/assets/${EN_FORMAT}`))).toBe(true);
    expect(out).not.toContain(KEY);
    expect(SECTION).not.toMatch(/-X\s*(POST|PATCH|PUT|DELETE)|--data|\s-d\s/);
  });
});
