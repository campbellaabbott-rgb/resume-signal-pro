// @vitest-environment node
/**
 * THE CHANGELOG OF 2 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Seven entries for the deploy whose functions went live on 2 November, written
 * after it verified, each claim read against the live site on 5 November. The
 * review of that deploy set limits on them, because some of what its notes said
 * was false or was never observed. Those limits are held here in all nine
 * languages, along with what the entries owe the reader: the correction of the
 * 31 October sentence that became false, and Portuguese that is Brazilian.
 *
 * It also holds what publishing them must not break in the verifier. The crawler
 * copy of /changelog lists only the newest 30 entries, so seven new ones push
 * section 52's titles off that page. Section 52 read that as a prerender that did
 * not rebuild and printed twelve FAILs on a healthy site. It now passes a title
 * only when the page really lists 30 entries that are all at least as new, so a
 * stale bake and a lost title still FAIL. Section 52c judges the seven themselves.
 * Sections run here in bash against a fake curl, as section 52b's test does.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { changelog } from "../data/changelog";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const IDS = [
  "truistGeicoAndNordstromJoinTheBoard",
  "takenDownJobsLeaveOurBiggestBoards",
  "searchesThatReadWhatYouTyped",
  "jobDetailsFromWhatTheEmployerStated",
  "searchResultsCarryTheEmployersNewNames",
  "theBoardStaysPutWhileYouRead",
  "theFreeReportsNumbersNowAgree",
];
const NAMES = "searchResultsCarryTheEmployersNewNames";
const SEARCH = "searchesThatReadWhatYouTyped";
const EN = shard("en");
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: `${shard(l)[id].title} ${shard(l)[id].description}` })));

describe("the seven entries", () => {
  it("sit on top of the changelog, in this order, dated the day the functions went live", () => {
    expect(changelog.slice(0, 7).map((e) => e.id)).toEqual(IDS);
    for (const e of changelog.slice(0, 7)) expect(e.date, e.id).toBe("2026-11-02");
    expect(changelog[7].date <= "2026-11-02").toBe(true);
  });

  it("carry text in all nine languages, with no placeholder, and no translation is the English copied", () => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(/\{\{|DATE_OF_DEPLOY/);
    for (const l of LOCALES.filter((x) => x !== "en" && x !== "en-GB")) {
      for (const id of IDS) {
        expect(shard(l)[id].title, `${l} ${id} title`).not.toBe(EN[id].title);
        expect(shard(l)[id].description, `${l} ${id} description`).not.toBe(EN[id].description);
      }
    }
  });

  it("British English says CV and colour on the free report, and US English says résumé and color", () => {
    const report = "theFreeReportsNumbersNowAgree";
    expect(shard("en-GB")[report].description).toMatch(/\bCV\b/);
    expect(shard("en-GB")[report].description).toMatch(/colour/);
    expect(shard("en-GB")[report].description).not.toMatch(/résumé|\bcolor\b/);
    expect(EN[report].description).toMatch(/résumé/);
    expect(EN[report].description).toMatch(/\bcolor\b/);
  });
});

describe("the limits the review of this deploy set, in every language", () => {
  // Each of these was false, or was never observed, when the entries were written.
  const REFUSED: Array<[string, RegExp]> = [
    ["a city the fix does not hold for", /Firenze|Florenz|Florencia|Florence|Warszawa|Geneve|Napoli/i],
    ["a counter that did not step", /fills_90d|fills 90/i],
    ["a product no delivery of which has been observed", /Full Analysis|Análisis completo|Analyse complète|Vollanalyse/i],
    ["pay annualised, which holds only for most rows", /annuali[sz]|annualisé|hochgerechnet/i],
    ["routing the review found dead", /\bHP\b|\bWM\b/],
    ["keyed behaviour nobody exercised", /\bAPI\b/],
    ["a claim about search rankings", /back in search results/i],
    ["an audit id", /\bS\d{1,2}-\d{2,3}\b|\b(?:FA|PD)-\d{2}\b/],
    ["an internal name", /job-board\.|job_board_|lap_backfill|\bTDZ\b|c4a29736/],
  ];
  it.each(REFUSED)("no entry states %s", (_what, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  it("the search entry says remote is judged by the title, and names the limit", () => {
    expect(EN[SEARCH].description).toMatch(/leaves out titles that say remote, but a remote job whose title does not say remote still appears/);
  });

  it("no entry calls the report translated: it names the parts and says the rest is still in English", () => {
    expect(EN.theFreeReportsNumbersNowAgree.description).toMatch(/Other parts of the report, such as industry labels, are still in English\./);
    for (const { where, text } of texts()) expect(text, where).not.toMatch(/the report is translated|whole report|entire report/i);
  });

  it("the sentence about Personalized Tips stays beside the one about Industry & Role Keywords, because only one was fixed", () => {
    expect(EN.theFreeReportsNumbersNowAgree.description).toMatch(/“Personalized Tips” section can still do this/);
  });

  it("Martin Brower is open to search engines again, which is what we can prove", () => {
    expect(EN[NAMES].description).toMatch(/open to search engines again/);
  });

  it("the search phrases stay as typed in every language, since those are what the board reads", () => {
    const LITERALS = ["Austin, TX 78701", "New York NY", "teacher in Spanish", "nurse in Northern Ireland", "nurse 94105", "ISO 13485", "jobs near me", 'supervisor -"team lead"', "nurse not requiring travel", "no remote nurse", "remote-first engineer", "remote engineer", "Wien"];
    for (const l of LOCALES) for (const q of LITERALS) expect(shard(l)[SEARCH].description, `${l}: ${q}`).toContain(q);
  });
});

describe("what the entries owe the reader", () => {
  it("every language corrects the 31 October sentence and names all four employers", () => {
    for (const l of LOCALES) {
      const d = shard(l)[NAMES].description;
      for (const name of ["Honeywell Aerospace", "LCS", "Axia Women's Health", "Hong Kong Baptist University"]) expect(d, `${l}: ${name}`).toContain(name);
      expect(d, `${l}: the old entry's date`).toMatch(/\b31\b/);
      expect(d, `${l}: the count read`).toContain("840");
    }
  });

  it("the old entry keeps what was true on its date: a changelog entry is a dated record", () => {
    expect(EN.employersNamedByALogoFile.description).toMatch(/those results still show the old label/);
    expect(changelog.find((e) => e.id === "employersNamedByALogoFile")?.date).toBe("2026-10-31");
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => `${shard("pt")[id].title} ${shard("pt")[id].description}`).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|logótipo|pesquisámos|lemos a |\ba 5 de novembro\b|\ba 31 de outubro\b|«|»/i);
    expect(pt).toMatch(/em 5 de novembro|Em 5 de novembro/);
    expect(pt).toMatch(/celular/);
    expect(pt).toMatch(/você/);
  });
});

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url;
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)process.stdout.write(r.body??"");
if(w)process.stdout.write(w.replace("%{http_code}",String(r.status??200)));
`;

const TREE_EN = EN;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const article = (date: string, title: string) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${date} · Fixed</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(title)}</h2><p class="text-sm text-muted-foreground">x</p></article>`;
/** The crawler /changelog as the bake writes it, from { date, title } rows. */
const crawler = (rows: Array<{ date: string; title: string }>) => `<html><head><meta name="description" content="What changed and when, newest first — including honest postmortems. Latest (${rows[0]?.date}): ${esc(rows[0]?.title ?? "")}."></head><body><main><h1>Changelog</h1><div class="space-y-4">${rows.map((r) => article(r.date, r.title)).join("")}</div></main></body></html>`;
const rowsOf = (from: number, to: number) => changelog.slice(from, to).map((e) => ({ date: e.date, title: TREE_EN[e.id].title }));
/** The site once these entries are published: the newest 30, as the bake lists them. */
const HEALTHY = crawler(rowsOf(0, 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(TREE_EN);
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(TREE_EN).filter(([k]) => !IDS.includes(k))));
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),()=>import("./en-GB-GBCL0001.js")];export{lazy as a};`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: { changelog?: string; chunk?: string } = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52-nov-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify([
    { match: "^GET https://site\\.test/changelog$", body: over.changelog ?? HEALTHY },
    { match: "^GET https://site\\.test/$", body: `<html><head><script type="module" crossorigin src="/assets/index-ENTRY001.js"></script></head><body></body></html>` },
    { match: "^GET https://site\\.test/assets/index-ENTRY001\\.js$", body: ENTRY },
    { match: "^GET https://site\\.test/assets/rb-en_all-ALL00001\\.js$", body: `const s={header:{jobs:"Jobs"}};` },
    { match: "^GET https://site\\.test/assets/en-CHLG0001\\.js$", body: over.chunk ?? PUBLISHED },
    // The British chunk carries every key too; the sections must never read it.
    { match: "^GET https://site\\.test/assets/en-GB-GBCL0001\\.js$", body: PUBLISHED },
  ]));
  writeFileSync(join(dir, "calls.log"), "");
  const text = readFileSync(resolve(ROOT, "scripts/verify-deploy.d", section), "utf8");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n` + text.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const S52 = "52-changelog-oct17-25.sh";
const S52_TITLES = [...readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52), "utf8").matchAll(/^(\d{4}-\d{2}-\d{2})\|(.+)$/gm)].map((m) => ({ date: m[1], title: m[2] }));

describe("section 52 once these entries push its titles past the newest 30", () => {
  it("names twelve titles, each with its own date", () => {
    expect(S52_TITLES).toHaveLength(12);
    for (const t of S52_TITLES) {
      const e = changelog.find((x) => TREE_EN[x.id].title.includes(t.title));
      expect(e, t.title).toBeTruthy();
      expect(e!.date, t.title).toBe(t.date);
    }
  });

  it("the healthy site prints no FAIL: the titles still listed pass as listed, the rest as past the newest 30", () => {
    const { lines, calls } = run(S52);
    expect(fails(lines), show(lines)).toEqual([]);
    const on = S52_TITLES.filter((t) => HEALTHY.includes(t.title));
    const past = S52_TITLES.filter((t) => !HEALTHY.includes(t.title));
    expect(on.length, "some titles must still be on the page").toBeGreaterThan(0);
    expect(past.length, "this batch must push some off, or this case proves nothing").toBeGreaterThan(0);
    for (const t of on) expect(lines, show(lines)).toContain(`PASS  /changelog serves crawlers "${t.title}"`);
    for (const t of past) expect(lines, show(lines)).toContain(`PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the English changelog strings the browser loads carry it`);
    expect(calls.some((c) => c.includes("en-GB-")), "the section read the British chunk").toBe(false);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
  });

  it("a bake from before these titles FAILs each one: thirty older entries pushed nothing off", () => {
    const stale = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-10-11", title: `An older entry ${i}` })));
    const { lines } = run(S52, { changelog: stale });
    for (const t of S52_TITLES) expect(lines, show(lines)).toContain(`FAIL  the English changelog strings the browser loads carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
    expect(lines.some((l) => /is past the newest 30/.test(l)), show(lines)).toBe(false);
  });

  it("a title lost from the middle of the page FAILs: entries older than it are still listed", () => {
    const lost = "What a company page says when it lists no roles";
    const { lines } = run(S52, { changelog: crawler(rowsOf(0, 31).filter((r) => r.title !== lost)) });
    expect(lines, show(lines)).toContain(`FAIL  the English changelog strings the browser loads carry "${lost}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
  });

  it("fewer than thirty entries cannot have pushed anything off: FAIL", () => {
    const short = crawler(Array.from({ length: 29 }, (_, i) => ({ date: "2026-12-01", title: `A newer entry ${i}` })));
    const { lines } = run(S52, { changelog: short });
    expect(lines.some((l) => /is past the newest 30/.test(l)), show(lines)).toBe(false);
    expect(fails(lines), show(lines)).toHaveLength(12);
  });

  it("a title in neither place FAILs as not published, however new the page is", () => {
    const newer = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-12-01", title: `A newer entry ${i}` })));
    const gone = "A lighter tab icon and share picture";
    const without = chunkOf(Object.fromEntries(Object.entries(TREE_EN).filter(([, v]) => v.title !== gone)));
    const { lines } = run(S52, { changelog: newer, chunk: without });
    expect(lines, show(lines)).toContain(`FAIL  /changelog does not serve "${gone}" (the frontend has not been published since the changelog for 17 to 25 October merged)`);
  });
});

const S52C = "52c-changelog-nov-02.sh";
const TITLES = IDS.map((id) => TREE_EN[id].title);

describe("section 52c judges the seven entries", () => {
  it("lists exactly their titles, in order", () => {
    const listed = /<<'VD52C_TITLES'\n([\s\S]*?)\nVD52C_TITLES/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52C), "utf8"))?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES);
  });

  it("before the publish every line is INFO, and only GETs are sent", () => {
    const { lines, calls } = run(S52C, { changelog: crawler(rowsOf(7, 37)), chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 2 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });

  it("after the publish each title passes on the crawler page, dated 2 November, and the correction is served", () => {
    const { lines } = run(S52C);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(`PASS  /changelog serves crawlers "${t}", dated 2026-11-02`);
    expect(lines.some((l) => /^PASS .*now carry the new name/.test(l)), show(lines)).toBe(true);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("a wrong date FAILs: an entry is dated the day its functions went live", () => {
    const { lines } = run(S52C, { changelog: crawler(rowsOf(0, 30).map((r) => (TITLES.includes(r.title) ? { ...r, date: "2026-11-05" } : r))) });
    expect(lines.some((l) => new RegExp(`^FAIL  /changelog dates "${rx(TITLES[0])}" 2026-11-05, want 2026-11-02`).test(l)), show(lines)).toBe(true);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52C, { changelog: crawler(rowsOf(0, 30).filter((r) => r.title !== TITLES[3])) }).lines;
    expect(lost, show(lost)).toContain(`FAIL  the US English changelog strings carry "${TITLES[3]}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
    const without = chunkOf(Object.fromEntries(Object.entries(TREE_EN).filter(([k]) => k !== IDS[2])));
    const gone = run(S52C, { chunk: without, changelog: crawler(rowsOf(0, 30).filter((r) => r.title !== TITLES[2])) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 2 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[2]}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not", () => {
    const newer = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-12-01", title: `A newer entry ${i}` })));
    const pushed = run(S52C, { changelog: newer }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(`PASS  "${t}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`);
    const stale = crawler(Array.from({ length: 30 }, (_, i) => ({ date: "2026-10-11", title: `An older entry ${i}` })));
    const old = run(S52C, { changelog: stale }).lines;
    for (const t of TITLES) expect(old, show(old)).toContain(`FAIL  the US English changelog strings carry "${t}", but the crawler copy of /changelog does not (the prerender did not rebuild)`);
  });

  it("a names entry that lost its correction FAILs", () => {
    const blunted = chunkOf({ ...TREE_EN, [NAMES]: { ...TREE_EN[NAMES], description: "Search results for some employers changed." } });
    const { lines } = run(S52C, { chunk: blunted });
    expect(lines.some((l) => /^FAIL .*does not say those results now carry the new name/.test(l)), show(lines)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52C, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL  no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
