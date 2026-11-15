// @vitest-environment node
/**
 * THE CHANGELOG OF 15 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Six entries for the deploy of 15 November: the hotfix round and the
 * seo-connect round went out in one message, and their frontend was published
 * the same day. Every claim was read against production that day, read-only:
 * the crawler copy of a posting page whose employer closed it, four company
 * pages, /agents and /pay-transparency, and the strings the browser loads for
 * the footer, the Ghost Job Index and the connect page in all nine languages.
 * Where the read covered less than a first wording said, the entry says only
 * what held. Those limits are held here:
 *   - the closed-posting entry gives no count and promises nothing about
 *     every closed posting;
 *   - the company-name entry is about company pages only (the read did not
 *     cover search suggestions or stored listings, which can still carry the
 *     short code), gives no count, and names only employers the site's own
 *     name list carries;
 *   - the connect-page entry gives no number and names no hiring system (the
 *     count and the list of systems that stay on the website both move), and
 *     names no AI host but Claude, ChatGPT and Claude Code;
 *   - the Ghost Job Index entry claims its takedown heading and explanation in
 *     each language, not the whole page, and quotes that heading as each
 *     language shows it;
 *   - the Pay Transparency entry is about the hiring-system column, whose
 *     names were read on the crawler copy, and names only systems the site's
 *     own vendor table spells that way;
 *   - the footer entry names the four links the browser's footer gained, by
 *     the label each language shows, and none of the crawler-only links.
 * In every language: no digit, no internal name, Portuguese that is
 * Brazilian, Hindi in Devanagari.
 *
 * Section 52e of the verifier judges the six on the crawler copy of
 * /changelog once the frontend publish carries them. It runs here in bash
 * against a fake curl, as section 52d does in the 6 and 8 November test.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { changelog } from "../data/changelog";
import { systemLabel } from "../lib/listing/apply-url";
import { employerName } from "../lib/company-display";
import { APP_FOOTER_LINKS, BAKED_FOOTER_EXTRA, DATA_PAGE_LINKS } from "../lib/site-links";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const SHARDS = Object.fromEntries(LOCALES.map((l) => [l, shard(l)])) as Record<Locale, Record<string, Text>>;
const locale = (l: string) => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as Record<string, Record<string, unknown>>;
const label = (l: string, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], locale(l)) as string;

const CLOSED = "aJobPageSaysWhenItsEmployerClosedThePosting";
const NAMES = "companyPagesUseTheNameTheEmployerUses";
const CONNECT = "theConnectPageSaysMoreAboutClaudeAndChatGpt";
const GHOST = "theGhostJobIndexNoLongerCallsATakedownFilled";
const PAY = "thePayTransparencyIndexNamesEachHiringSystem";
const FOOTER = "theFooterLinksOurDataPages";
const DATE = "2026-11-15";

/** Newest first, as changelog.ts lists them, with the tags each claims. */
const ENTRIES: Array<{ id: string; date: string; tags: string[] }> = [
  { id: CLOSED, date: DATE, tags: ["improved"] },
  { id: NAMES, date: DATE, tags: ["fixed"] },
  { id: CONNECT, date: DATE, tags: ["improved"] },
  { id: GHOST, date: DATE, tags: ["fixed"] },
  { id: PAY, date: DATE, tags: ["fixed"] },
  { id: FOOTER, date: DATE, tags: ["improved"] },
];
const IDS = ENTRIES.map((e) => e.id);
const AT = changelog.findIndex((e) => e.id === IDS[0]);
const EN = SHARDS.en;
const textOf = (l: Locale, id: string) => `${SHARDS[l][id].title} ${SHARDS[l][id].description}`;
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: textOf(l, id) })));

describe("the six entries", () => {
  it("sit together, newest first, dated the day their deploy went live, with nothing older above them and the 8 November entry next", () => {
    expect(AT, `${IDS[0]} is missing from changelog.ts`).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(AT, AT + ENTRIES.length)).toEqual(ENTRIES);
    for (const e of changelog.slice(0, AT)) expect(e.date >= DATE, `${e.id} (${e.date}) sits above the 15 November entries but is older`).toBe(true);
    expect(changelog[AT + ENTRIES.length].id, "the 6 and 8 November entries come next").toBe("theBoardChecksEveryMinuteForAStoppedRefresh");
  });

  it("carry text in all nine languages, with no placeholder, and no translation is the English copied", () => {
    for (const { where, text } of texts()) {
      expect(text, where).not.toMatch(/\{\{|DATE_OF_DEPLOY/);
      expect(text.length, where).toBeGreaterThan(40);
    }
    for (const l of LOCALES.filter((x) => x !== "en" && x !== "en-GB")) {
      for (const id of IDS) {
        expect(SHARDS[l][id].title, `${l} ${id} title`).not.toBe(EN[id].title);
        expect(SHARDS[l][id].description, `${l} ${id} description`).not.toBe(EN[id].description);
      }
    }
  });

  it("wait in no pending file: the changelog step applied them and emptied the queue", () => {
    const dir = resolve(ROOT, "docs/changelog-pending");
    const pending = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
    for (const f of pending) {
      const keys = (JSON.parse(readFileSync(resolve(dir, f), "utf8")).entries ?? []).map((e: { key: string }) => e.key);
      for (const id of IDS) expect(keys, `${f} still carries ${id}`).not.toContain(id);
    }
  });
});

describe("each English description carries the limit the live read set, and not a wording it did not hold", () => {
  const LIMITS: Record<string, { must: string[]; mustNot: Array<[string, RegExp]> }> = {
    [CLOSED]: {
      must: [
        "When the employer's own hiring system has answered that it no longer serves a posting",
        "gives the day the page was built, and states nothing more about the job",
        "Before, it said only that the posting was no longer listed on our board.",
        "which is a statement about our board, not about the employer",
      ],
      mustNot: [
        ["a count of closed postings", /\d/],
        ["a promise about every closed posting", /every (?:closed )?posting|all (?:closed )?postings|always/i],
        ["a reason the employer's answer does not give", /filled|hired|a hire/i],
      ],
    },
    [NAMES]: {
      must: ["by the short code its hiring system files it under", "in the page title and heading"],
      mustNot: [
        ["places the read did not cover, which can still carry the short code", /search|suggestion|listing|everywhere|every page|across the site/i],
        ["a count of renamed boards nobody read", /\d/],
      ],
    },
    [CONNECT]: {
      must: [
        "how many of the board's open postings your AI can search, which ones stay on this website, and when they were counted",
        "it quotes what the pricing page says about the Free plan, with the day we read it",
        "Claude's free plan, which can add one custom connector",
        "once in your phone's browser, not in the app",
        "is there in Claude Code when you sign in with the same account",
      ],
      mustNot: [
        ["a count that moves", /\d/],
        ["a list of systems that moves", /USAJOBS|SmartRecruiters|Workday|Oracle/i],
        ["a phone note the page gives only for Claude, said of ChatGPT", /ChatGPT app|ChatGPT on (?:a|your) phone/i],
      ],
    },
    [GHOST]: {
      must: [
        "did not put back up under the same title",
        "The page used to call those roles filled.",
        "says a takedown is never called a hire",
        "That heading and its explanation now come in the language you use on the site.",
      ],
      mustNot: [
        ["a figure or a day count", /\d/],
        ["a whole page translated, where the read covered its takedown heading and explanation", /whole page|entire page|every part/i],
      ],
    },
    [PAY]: {
      must: ["such as iCIMS, UKG Pro Recruiting or ADP Workforce Now, instead of a short code", "The copy of the page that search engines read uses the same names."],
      mustNot: [
        ["employer names, which this entry did not claim", /employer/i],
        ["a figure", /\d/],
      ],
    },
    [FOOTER]: {
      must: ["now also links the Ghost Job Index, Weekly Hiring Trends, the Entry-Level Index and ATS score benchmarks", "next to the Pay Transparency Index it already linked"],
      mustNot: [["a link only the crawler's footer carries", /CV standards|Affiliates|\bAbout\b/]],
    },
  };

  it("covers every entry", () => {
    expect(Object.keys(LIMITS).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)("%s", (id) => {
    const { must, mustNot } = LIMITS[id];
    for (const s of must) expect(EN[id].description, s).toContain(s);
    for (const l of ["en", "en-GB"] as const) {
      for (const [why, re] of mustNot) expect(textOf(l, id), `${l}: ${why}`).not.toMatch(re);
    }
  });
});

describe("what the entries name is what the site itself carries", () => {
  it("every employer the company-name entry names is the name the site prints for a company page read live", () => {
    // The four company pages read on 15 November, by the token in their URL.
    const READ: Record<string, string> = {
      "papajohns~wd1~PapaJohnsCareers": "Papa John's",
      "nyuhs~wd12~nyuhscareers1": "United Health Services",
      "ssctech~wd1~ssctechnologies": "SS&C Technologies",
      "hubinternational~wd1~HUBInternational": "HUB International",
    };
    for (const [token, name] of Object.entries(READ)) {
      expect(employerName(token, token.split("~")[0]), token).toBe(name);
      for (const l of LOCALES) expect(SHARDS[l][NAMES].description, `${l} ${name}`).toContain(name);
    }
    for (const l of LOCALES) expect(SHARDS[l][NAMES].description, l).toMatch(/papajohns/);
  });

  it("every hiring system the Pay Transparency entry names is the vendor table's own spelling, in every language", () => {
    expect(["icims", "ukg", "adp"].map((k) => systemLabel(k))).toEqual(["iCIMS", "UKG Pro Recruiting", "ADP Workforce Now"]);
    for (const l of LOCALES) for (const s of ["iCIMS", "UKG Pro Recruiting", "ADP Workforce Now"]) expect(SHARDS[l][PAY].description, `${l} ${s}`).toContain(s);
  });

  it("the footer entry names the four data and benchmark links the app's footer renders, and none the crawler's footer alone carries", () => {
    const app = APP_FOOTER_LINKS.map((x) => x.key);
    const NAMED = ["footer.links.ghostJobIndex", "footer.links.hiringTrends", "footer.links.entryLevelIndex", "footer.links.atsBenchmarks", "footer.links.payTransparency"];
    for (const k of NAMED) expect(app, k).toContain(k);
    expect(DATA_PAGE_LINKS.map((x) => x.key).sort()).toEqual(NAMED.filter((k) => k !== "footer.links.atsBenchmarks").sort());
    for (const l of LOCALES) {
      for (const k of NAMED) expect(SHARDS[l][FOOTER].description, `${l}: ${k} = ${label(l, k)}`).toContain(label(l, k));
      for (const x of BAKED_FOOTER_EXTRA) expect(textOf(l, FOOTER), `${l}: ${x.key}`).not.toContain(label(l, x.key));
    }
  });

  it("each page is named by the label its language's site shows", () => {
    for (const l of LOCALES) {
      expect(SHARDS[l][CONNECT].title, `${l}: footer.links.agents`).toContain(label(l, "footer.links.agents"));
      expect(SHARDS[l][GHOST].title, `${l}: footer.links.ghostJobIndex`).toContain(label(l, "footer.links.ghostJobIndex"));
      expect(SHARDS[l][GHOST].description, `${l}: ghostIndex.fillTerm`).toContain(label(l, "ghostIndex.fillTerm"));
      expect(SHARDS[l][PAY].title, `${l}: footer.links.payTransparency`).toContain(label(l, "footer.links.payTransparency"));
    }
  });
});

describe("the same limits in every language", () => {
  it("no entry carries a digit in any language: every count the pages print moves", () => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(/\d/);
  });

  const REFUSED: Array<[string, RegExp]> = [
    ["a claim the board cannot prove", /verified openings|zero ghost/i],
    ["an audit id", /\bS\d{1,2}-\d{2,3}\b/],
    ["an internal name", /job-board\.|x-fn-build|drizzle|pg_cron|\bcron\b|\bRPC\b|\bMCP\b|company_name_overrides|employer-names|site-links|prerender|x-rb-/i],
    ["a commit or migration id", /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\b20\d{12}\b/],
    ["a retired product", /\$\s?99|\$\s?29|\$\s?7\b|Premium|Apply Assistant|applies for you|apply for you/i],
    ["an AI host seekers are not shown", /Cursor|Copilot|Gemini|Windsurf|Perplexity|VS Code/i],
    ["a claim that we send applications", /we (?:send|submit) (?:your )?applications?/i],
  ];
  it.each(REFUSED)("no entry states %s", (_why, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  it("the connect entry names Claude, ChatGPT and Claude Code in every language, and nothing on it names a host by any other name", () => {
    for (const l of LOCALES) {
      const t = textOf(l, CONNECT);
      for (const host of ["Claude", "ChatGPT", "Claude Code"]) expect(t, `${l} ${host}`).toContain(host);
      expect(t, l).not.toMatch(/OpenAI|Anthropic/);
    }
  });

  it("British English says CV wherever US English says résumé", () => {
    for (const id of IDS) {
      const gb = textOf("en-GB", id);
      expect(gb, id).not.toMatch(/résumé|resume/i);
      if (/résumé/.test(textOf("en", id))) expect(gb, id).toMatch(/\bCV\b/);
    }
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => textOf("pt", id)).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|separador|utilizador|\bestá a [a-z]+r\b|«|»/i);
    expect(pt).toMatch(/você/);
    expect(pt).toMatch(/\bcelular\b/);
  });

  it("the Hindi is in Devanagari", () => {
    for (const id of IDS) expect(textOf("hi", id), id).toMatch(/[ऀ-ॿ]{3}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 52e, run in bash against a fake curl that answers from a route table
// and logs every call, as the 6 and 8 November test runs section 52d.
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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const article = (date: string, title: string) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${date} · Improved · Fixed</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(title)}</h2><p class="text-sm text-muted-foreground">x</p></article>`;
/** The crawler /changelog as the bake writes it, from { date, title } rows, newest first. */
const crawler = (rows: Array<{ date: string; title: string }>) => `<html><head><meta name="description" content="What changed and when, newest first — including honest postmortems. Latest (${rows[0]?.date}): ${esc(rows[0]?.title ?? "")}."></head><body><main><h1>Changelog</h1><div class="space-y-4">${rows.map((r) => article(r.date, r.title)).join("")}</div></main></body></html>`;
const rowsOf = (from: number, to: number) => changelog.slice(from, to).map((e) => ({ date: e.date, title: EN[e.id].title }));
/** The page this batch published: the six on top of the 24 entries before them. */
const PUBLISHED_PAGE = crawler(rowsOf(AT, AT + 30));
/** The page before the publish: the 30 entries before the six. */
const BEFORE_PAGE = crawler(rowsOf(AT + IDS.length, AT + IDS.length + 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(EN);
/** The strings before the publish: neither the six nor anything newer than them. */
const NOT_YET = new Set(changelog.slice(0, AT + IDS.length).map((e) => e.id));
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => !NOT_YET.has(k))));
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),()=>import("./en-GB-GBCL0001.js")];export{lazy as a};`;
const filler = (n: number, date: string, what: string) => Array.from({ length: n }, (_, i) => ({ date, title: `${what} ${i}` }));

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: { changelog?: string; chunk?: string } = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52e-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify([
    { match: "^GET https://site\\.test/changelog$", body: over.changelog ?? PUBLISHED_PAGE },
    { match: "^GET https://site\\.test/$", body: `<html><head><script type="module" crossorigin src="/assets/index-ENTRY001.js"></script></head><body></body></html>` },
    { match: "^GET https://site\\.test/assets/index-ENTRY001\\.js$", body: ENTRY },
    { match: "^GET https://site\\.test/assets/rb-en_all-ALL00001\\.js$", body: `const s={header:{jobs:"Jobs"}};` },
    { match: "^GET https://site\\.test/assets/en-CHLG0001\\.js$", body: over.chunk ?? PUBLISHED },
    // The British chunk carries every key too; the section must never read it.
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

const S52E = "52e-changelog-nov-15.sh";
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;

describe("section 52e judges the six entries on the crawler page", () => {
  it("lists exactly their titles, in order, each with the date their deploy went live", () => {
    const listed = /<<'VD52E_TITLES'\n([\s\S]*?)\nVD52E_TITLES/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52E), "utf8"))?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("before the publish every line is INFO, and only GETs are sent, never to the British chunk", () => {
    const { lines, calls } = run(S52E, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 15 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });

  it("after the publish each title passes on the crawler page with its date, and the page describes an entry of 15 November as newest", () => {
    const { lines } = run(S52E);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    expect(lines, show(lines)).toContain(`PASS  /changelog's description names an entry of 2026-11-15 as the newest, no older than this batch's 2026-11-15`);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("a wrong date FAILs", () => {
    const moved = crawler(rowsOf(AT, AT + 30).map((r) => (r.title === TITLES[2].title ? { ...r, date: "2026-11-08" } : r)));
    const { lines } = run(S52E, { changelog: moved });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog dates "${TITLES[2].title}" 2026-11-08, want 2026-11-15, the day its deploy went live`]);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52E, { changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[4].title)) }).lines;
    expect(lost, show(lost)).toContain(notRebuilt(TITLES[4]));
    const without = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== IDS[3])));
    const gone = run(S52E, { chunk: without, changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[3].title)) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 15 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[3].title}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not, title or description", () => {
    const pushed = run(S52E, { changelog: crawler(filler(30, "2026-12-01", "A newer entry")) }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(pastPage(t));
    const stale = run(S52E, { changelog: BEFORE_PAGE }).lines;
    for (const t of TITLES) expect(stale, show(stale)).toContain(notRebuilt(t));
    expect(stale, show(stale)).toContain(`FAIL  /changelog's description names an entry of 2026-11-08 as the newest, older than this batch's 2026-11-15 (the prerender did not rebuild)`);
  });

  it("thirty entries older than the batch cannot have pushed it off, nor can fewer than thirty newer ones: FAIL", () => {
    const older = run(S52E, { changelog: crawler(filler(30, "2026-11-14", "An entry of 14 November")) }).lines;
    for (const t of TITLES) expect(older, show(older)).toContain(notRebuilt(t));
    const few = run(S52E, { changelog: crawler(filler(29, "2026-12-01", "A newer entry")) }).lines;
    for (const t of TITLES) expect(few, show(few)).toContain(notRebuilt(t));
  });

  it("a description the bake left on an older newest entry FAILs, though every title is listed", () => {
    const page = PUBLISHED_PAGE.replace(/Latest \(2026-11-15\): [^"]*\./, `Latest (2026-11-08): ${esc(EN.theBoardChecksEveryMinuteForAStoppedRefresh.title)}.`);
    expect(page).not.toBe(PUBLISHED_PAGE);
    const { lines } = run(S52E, { changelog: page });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog's description names an entry of 2026-11-08 as the newest, older than this batch's 2026-11-15 (the prerender did not rebuild)`]);
    const none = run(S52E, { changelog: PUBLISHED_PAGE.replace(/Latest \([^"]*\./, "No entries yet.") }).lines;
    expect(none.some((l) => /^FAIL {2}\/changelog's description names no newest entry/.test(l)), show(none)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52E, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL {2}no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
