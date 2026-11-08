// @vitest-environment node
/**
 * THE CHANGELOG OF 6 AND 8 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Nine entries, written after each deploy verified: eight for the deploy whose
 * frontend and functions went live on 6 November, and one for the upkeep deploy
 * of 8 November, whose only change was migration 20261107100000. Every claim was
 * re-read against production on 8 November, read-only, by two reviewers. Where
 * one found that the first wording said more than the live site does, the entry
 * says only what held. Those limits are held here.
 *
 * In English, each description must carry the phrases that state its limit and
 * must not carry the wording the review refused. These are the ones that could
 * drift back in:
 *   - the fonts entry says nothing about the Privacy page, which still names
 *     Google for fonts in its list of outside services, and nothing about speed,
 *     which nobody measured (the font files carry no cache header);
 *   - the delete entry names no product, since no paid delivery has been
 *     observed, and promises no absolute about who can delete. It names no
 *     email link either: a purchase email carries the buyer's own link only
 *     from 6 November, and an older one carries the share link this change
 *     stops from deleting. What it lists is what the shared page lists;
 *   - the purchase-link entry says "usually", names the purchases it covers and
 *     says the Full Analysis page is unchanged;
 *   - the drafts entry keeps a draft only while the page stays open, for 20
 *     jobs, and its allowance sentence covers the cover letter and the tailored
 *     résumé only;
 *   - the email entry lists exactly the four acts that give an older search its
 *     language;
 *   - the One-click apply entry is about Explore and saved searches, not the
 *     connector or the API, which still narrow to the same hiring systems. It
 *     gives no date: the board's list stopped narrowing with the frontend of
 *     PR #36 (merged 18 October; the Jobs page has read an old ?agentOnly=1
 *     link as nothing since), not on 31 October, which the first wording
 *     named. It names Explore by the label each language's site header shows;
 *   - the refresh entry gives no number (the threshold read live moved between
 *     237 and 244 seconds) and says we have not yet seen a restart.
 * In every language: the same digits as the English, the site's own button
 * labels where an entry quotes one, no internal name, Portuguese that is
 * Brazilian, and British English that says CV.
 *
 * Section 52d of the verifier judges the nine on the crawler copy of
 * /changelog once the frontend publish carries them, each with its own date.
 * It runs here in bash against a fake curl, as section 52c does in the
 * 2 November test.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { changelog } from "../data/changelog";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const SHARDS = Object.fromEntries(LOCALES.map((l) => [l, shard(l)])) as Record<Locale, Record<string, Text>>;
const locale = (l: string) => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as Record<string, Record<string, unknown>>;
const label = (l: string, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], locale(l)) as string;

const FONTS = "ourFontsComeFromOurOwnSite";
const DELETE = "aSharedLinkCanNoLongerDeleteAPaidAnalysis";
const PURCHASE = "aPurchaseLinkThatDoesNotOpenSaysWhy";
const DRAFTS = "draftsForAJobReopenWithoutBeingWrittenAgain";
const COACH = "theInterviewCoachKeepsEachAnswerApart";
const MAIL = "searchAndReportEmailsInYourLanguage";
const CADENCE = "yourAccountSaysWhichSearchEmailsComeDaily";
const ONE_CLICK = "theOneClickApplyFilterIsGone";
const REFRESH = "theBoardChecksEveryMinuteForAStoppedRefresh";

/** Newest first, as changelog.ts lists them, with the tags each claims. */
const ENTRIES: Array<{ id: string; date: string; tags: string[] }> = [
  { id: REFRESH, date: "2026-11-08", tags: ["improved"] },
  { id: FONTS, date: "2026-11-06", tags: ["improved"] },
  { id: DELETE, date: "2026-11-06", tags: ["fixed"] },
  { id: PURCHASE, date: "2026-11-06", tags: ["improved"] },
  { id: DRAFTS, date: "2026-11-06", tags: ["improved"] },
  { id: COACH, date: "2026-11-06", tags: ["fixed"] },
  { id: MAIL, date: "2026-11-06", tags: ["improved"] },
  { id: CADENCE, date: "2026-11-06", tags: ["fixed"] },
  { id: ONE_CLICK, date: "2026-11-06", tags: ["fixed"] },
];
const IDS = ENTRIES.map((e) => e.id);
const AT = changelog.findIndex((e) => e.id === IDS[0]);
const EN = SHARDS.en;
const GB = SHARDS["en-GB"];
const textOf = (l: Locale, id: string) => `${SHARDS[l][id].title} ${SHARDS[l][id].description}`;
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: textOf(l, id) })));

describe("the nine entries", () => {
  it("sit together, newest first, each dated the day its deploy went live, with only newer entries above them", () => {
    expect(AT, `${IDS[0]} is missing from changelog.ts`).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(AT, AT + ENTRIES.length)).toEqual(ENTRIES);
    for (const e of changelog.slice(0, AT)) expect(e.date > "2026-11-08", `${e.id} (${e.date}) sits above the 8 November entry but is not newer`).toBe(true);
    expect(changelog[AT + ENTRIES.length].id, "the 2 November entries come next").toBe("truistGeicoAndNordstromJoinTheBoard");
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

describe("each English description carries the limit the review set, and not the wording it refused", () => {
  const LIMITS: Record<string, { must: string[]; mustNot: Array<[string, RegExp]> }> = {
    [FONTS]: {
      must: ["Our pages no longer load their fonts from Google.", "so opening a page sends no request to Google's font servers"],
      mustNot: [
        ["the Privacy page, which still names Google for fonts further down", /privacy/i],
        ["a speed nobody measured", /faster|speed|quick|cache/i],
      ],
    },
    [DELETE]: {
      must: [
        "Before, anyone who had the share link to a paid analysis could delete it.",
        "Now the share link can still open the analysis but cannot delete it.",
        "Deleting also needs the original purchase",
        "(the page their payment opened or the order in their account)",
        "or by writing to us from the address they paid with",
        "The shared page says so.",
      ],
      mustNot: [
        ["an email link: a purchase email before 6 November carries the share link itself", /e-?mail/i],
        ["a purchase that buys itself", /the purchase the analysis was bought with/i],
        ["a product no delivery of which has been observed", /Full Analysis/],
        ["an absolute about who can delete", /only the buyer can delete|only you can delete/i],
        ["a language count nobody read", /every language|nine languages/i],
      ],
    },
    [PURCHASE]: {
      must: ["the page now usually says why", "(tools and scan packs bought one at a time, and tools a Pro plan includes)", "The Full Analysis page is unchanged."],
      mustNot: [["a reason on every link", /always says why|every purchase link|any purchase link/i]],
    },
    [DRAFTS]: {
      must: [
        "so reopening a cover letter or tailored résumé doesn't use your daily writing allowance a second time",
        "This works while the page stays open, for the last 20 jobs you prepared for",
        "as long as your résumé, the posting and your language are unchanged; a reload or a new tab starts fresh",
        "busy for everyone",
      ],
      mustNot: [
        ["a draft kept past the page", /saved to your account|in your account|across devices|any device|after a reload|survives? a reload/i],
        ["answers spared an allowance they never used", /answers? (?:don't|do not|never) (?:use|count)/i],
        ["a busy notice the review did not read", /busy for your network/i],
        ["20 jobs a reader can take for the jobs they held, or the newest postings", /your 20 most recent jobs/i],
      ],
    },
    [COACH]: {
      must: ["each question now keeps its own answer", "only when it has a job title or posting to tailor to", "Before, it could make up a job title from your industry."],
      mustNot: [["a coach offered without an account", /without (?:an account|signing in)|signed[- ]out/i]],
    },
    [MAIL]: {
      must: [
        "now come in the language you were using on the site",
        "that is the language of the page where you pressed the button that started them",
        "until you open it from your saved searches, switch its email on or off, change its alert threshold, or turn alerts on for it again from the job board",
        "Your scan's own findings stay in the language the scan wrote them in.",
      ],
      mustNot: [
        ["every email we send", /every email|all (?:our|your) emails/i],
        ["a count of languages no send was read in", /nine languages/i],
        ["a write the live board does not make", /renam|edit(?:ing)? (?:it|the search)|Explore|chang(?:e|ing) (?:the site's|your) language/i],
      ],
    },
    [CADENCE]: {
      must: ["(the 20 newest)", "alerts and company watches daily, other searches weekly", "Before, it called every one weekly.", "the core keywords for your field from our curated keyword guide, not a count of this month's postings"],
      mustNot: [["every saved search, where the page lists 20", /every saved search|all (?:of )?your saved searches/i]],
    },
    [ONE_CLICK]: {
      must: [
        "covered only jobs on four hiring systems",
        "though choosing it already showed every job",
        "Saved searches that still had this filter on now count and email new jobs from the whole board",
        "opening one already showed every job",
      ],
      mustNot: [
        // The list stopped narrowing with the frontend of 18 October; nothing changed for it on 31 October.
        ["a day the board's list did not change on", /\d|October|November/i],
        ["wording a job seeker cannot follow", /the board it opened|carried (?:that|this) narrowing/i],
        ["the connector or the API, which still narrow to the same systems", /Claude|ChatGPT|connector|\bAPI\b|\bMCP\b|agent/i],
        ["a vendor list that moves", /Breezy|Personio|Pinpoint|Teamtailor/i],
      ],
    },
    [REFRESH]: {
      must: ["checks every minute whether its listings refresh has stopped", "once it has been quiet for a few minutes", "We have not yet seen it restart a stopped refresh."],
      mustNot: [
        ["a threshold that moved while it was read", /\d/],
        ["a restart nobody has seen", /restarts? (?:it|the refresh|a stopped refresh) (?:automatically|by itself|on its own)/i],
        ["a promise about freshness", /never stops|no longer stops|fresher|faster/i],
      ],
    },
  };

  it("covers every entry", () => {
    expect(Object.keys(LIMITS).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)("%s", (id) => {
    const { must, mustNot } = LIMITS[id];
    for (const s of must) expect(EN[id].description, s).toContain(s);
    for (const l of ["en", "en-GB"] as const) {
      for (const [why, re] of mustNot) expect(`${SHARDS[l][id].title} ${SHARDS[l][id].description}`, `${l}: ${why}`).not.toMatch(re);
    }
  });
});

describe("the same limits in every language", () => {
  const digits = (s: string) => (s.match(/\d(?:[\d., \u00a0\u202f]*\d)?/g) ?? []).map((x) => x.replace(/[., \u00a0\u202f]/g, "")).sort();

  it("every language carries the same digits as the English, and the refresh entry carries none", () => {
    for (const id of IDS) for (const l of LOCALES) expect(digits(SHARDS[l][id].description), `${l} ${id}`).toEqual(digits(EN[id].description));
    for (const l of LOCALES) expect(textOf(l, REFRESH), l).not.toMatch(/\d/);
  });

  const REFUSED: Array<[string, RegExp]> = [
    ["a claim the board cannot prove", /verified openings|zero ghost/i],
    ["an audit id", /\bS\d{1,2}-\d{2,3}\b/],
    ["an internal name", /job-board\.|x-fn-build|sendableOnly|agentReadyOnly|agent_ready|drizzle|pg_cron|\bcron\b|chainWatchdog|dead-chain|keptLetters|KEPT_WRITING|delete_analysis|verify-product-purchase|send-search-digest|send-scan-report|share_id|\bRPC\b/i],
    ["a commit or migration id", /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\b20\d{12}\b/],
    ["a retired product", /\$\s?99|\$\s?29|\$\s?7\b|Premium|Apply Assistant|applies for you|apply for you/i],
    ["an AI host seekers are not shown", /Cursor|Copilot|Gemini|Windsurf|Perplexity|VS Code/i],
    ["a claim that we send applications", /we (?:send|submit) (?:your )?applications?/i],
  ];
  it.each(REFUSED)("no entry states %s", (_why, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  const FULL_ANALYSIS: Record<Locale, string> = {
    en: "Full Analysis", "en-GB": "Full Analysis", de: "Vollanalyse", es: "Análisis Completo", fr: "Analyse Complète",
    hi: "पूर्ण विश्लेषण", nl: "Volledige Analyse", pt: "Análise Completa", tl: "Full Analysis",
  };
  it("the Full Analysis is named only where its page is said to be unchanged: the delete entry names no product", () => {
    for (const l of LOCALES) {
      expect(SHARDS[l][PURCHASE].description, l).toContain(FULL_ANALYSIS[l]);
      for (const id of IDS.filter((x) => x !== PURCHASE)) expect(textOf(l, id), `${l} ${id}`).not.toContain(FULL_ANALYSIS[l]);
      expect(textOf(l, DELETE), l).not.toMatch(/Full Analysis|Análisis Completo|Analyse Complète|Vollanalyse|Volledige Analyse|Análise Completa|पूर्ण विश्लेषण/i);
    }
  });

  it("the fonts entry says nothing about the Privacy page or speed in any language", () => {
    for (const l of LOCALES) {
      const t = textOf(l, FONTS);
      expect(t, l).toContain("Google");
      expect(t, l).not.toMatch(/privac|Datenschutz|Confidentialit|प्राइवेसी|गोपनीयता/i);
      expect(t, l).not.toMatch(/faster|schneller|más rápid|plus rapide|sneller|mais rápid|तेज़|mas mabilis|cache/i);
    }
  });

  it("an entry that quotes a button quotes the site's own label, in each language", () => {
    for (const l of LOCALES) {
      const drafts = SHARDS[l][DRAFTS].description;
      for (const key of ["jobsPage.prepTitle", "jobsPage.tailorResumeAgain", "applyAnswers.draftAgain"]) {
        const want = label(l, key);
        expect(typeof want, `${l} ${key}`).toBe("string");
        expect(drafts, `${l}: ${key} = ${want}`).toContain(want);
      }
      expect(SHARDS[l][PURCHASE].description, `${l}: productSuccess.tryAgain`).toContain(label(l, "productSuccess.tryAgain"));
      expect(SHARDS[l][COACH].description, `${l}: interviewCoach.tryAgain`).toContain(label(l, "interviewCoach.tryAgain"));
    }
  });

  it("the One-click apply entry names the filter as each language showed it, and no live string still offers it", () => {
    // The labels c747f40c removed from every locale.
    const REMOVED: Record<Locale, string> = {
      en: "One-click apply", "en-GB": "One-click apply", de: "Bewerbung mit einem Klick", es: "Postulación en un clic", fr: "Candidature en un clic",
      hi: "एक-क्लिक आवेदन", nl: "Solliciteren met één klik", pt: "Candidatura num clique", tl: "One-click na pag-apply",
    };
    for (const l of LOCALES) {
      expect(SHARDS[l][ONE_CLICK].title, l).toContain(REMOVED[l]);
      expect(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8"), `${l} still offers the filter`).not.toContain(REMOVED[l]);
    }
  });

  it("the One-click apply entry names Explore by the label the site header shows, and gives no date in any language", () => {
    for (const l of LOCALES) {
      const explore = label(l, "header.explore");
      expect(typeof explore, `${l} header.explore`).toBe("string");
      expect(SHARDS[l][ONE_CLICK].title, `${l}: header.explore = ${explore}`).toContain(explore);
      expect(textOf(l, ONE_CLICK), `${l}: the list stopped narrowing in October, not on a day this entry can name`).not.toMatch(/\d/);
    }
  });

  it("the delete entry names no email link in any language: the list is the shared page's own", () => {
    for (const l of LOCALES) expect(SHARDS[l][DELETE].description, l).not.toMatch(/mail|correo|ईमेल/i);
  });

  it("British English says CV wherever US English says résumé", () => {
    for (const id of IDS) {
      const gb = `${GB[id].title} ${GB[id].description}`;
      expect(gb, id).not.toMatch(/résumé|resume/i);
      if (/résumé/.test(`${EN[id].title} ${EN[id].description}`)) expect(gb, id).toMatch(/\bCV\b/);
    }
    expect(GB[CADENCE].description).toContain("this month's job adverts");
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => textOf("pt", id)).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|separador|utilizador|\bestá a [a-z]+r\b|«|»/i);
    expect(pt).toMatch(/você/);
    expect(pt).toMatch(/\bnova aba\b/);
  });

  it("the Hindi is in Devanagari", () => {
    for (const id of IDS) expect(textOf("hi", id), id).toMatch(/[ऀ-ॿ]{3}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 52d, run in bash against a fake curl that answers from a route table
// and logs every call, as the 2 November test runs section 52c.
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
const article = (date: string, title: string) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${date} · Fixed</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(title)}</h2><p class="text-sm text-muted-foreground">x</p></article>`;
/** The crawler /changelog as the bake writes it, from { date, title } rows, newest first. */
const crawler = (rows: Array<{ date: string; title: string }>) => `<html><head><meta name="description" content="What changed and when, newest first — including honest postmortems. Latest (${rows[0]?.date}): ${esc(rows[0]?.title ?? "")}."></head><body><main><h1>Changelog</h1><div class="space-y-4">${rows.map((r) => article(r.date, r.title)).join("")}</div></main></body></html>`;
const rowsOf = (from: number, to: number) => changelog.slice(from, to).map((e) => ({ date: e.date, title: EN[e.id].title }));
/** The page this batch published: the nine on top of the 21 entries before them. */
const PUBLISHED_PAGE = crawler(rowsOf(AT, AT + 30));
/** The page before the publish: the 30 entries before the nine. */
const BEFORE_PAGE = crawler(rowsOf(AT + IDS.length, AT + IDS.length + 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(EN);
/** The strings before the publish: neither the nine nor anything newer than them. */
const NOT_YET = new Set(changelog.slice(0, AT + IDS.length).map((e) => e.id));
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => !NOT_YET.has(k))));
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),()=>import("./en-GB-GBCL0001.js")];export{lazy as a};`;
const filler = (n: number, date: string, what: string) => Array.from({ length: n }, (_, i) => ({ date, title: `${what} ${i}` }));

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: { changelog?: string; chunk?: string } = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52d-"));
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

const S52D = "52d-changelog-nov-06-08.sh";
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;

describe("section 52d judges the nine entries on the crawler page", () => {
  it("lists exactly their titles, in order, each with the date its deploy went live", () => {
    const listed = /<<'VD52D_TITLES'\n([\s\S]*?)\nVD52D_TITLES/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52D), "utf8"))?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("before the publish every line is INFO, and only GETs are sent, never to the British chunk", () => {
    const { lines, calls } = run(S52D, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 6 and 8 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });

  it("after the publish each title passes on the crawler page with its own date, and the page describes an entry of 8 November as newest", () => {
    const { lines } = run(S52D);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    expect(lines, show(lines)).toContain(`PASS  /changelog's description names an entry of 2026-11-08 as the newest, no older than this batch's 2026-11-08`);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("a wrong date FAILs, in either direction", () => {
    const swapped = crawler(rowsOf(AT, AT + 30).map((r) => (r.title === TITLES[0].title ? { ...r, date: "2026-11-06" } : r.title === TITLES[1].title ? { ...r, date: "2026-11-08" } : r)));
    const { lines } = run(S52D, { changelog: swapped });
    expect(lines, show(lines)).toContain(`FAIL  /changelog dates "${TITLES[0].title}" 2026-11-06, want 2026-11-08, the day its deploy went live`);
    expect(lines, show(lines)).toContain(`FAIL  /changelog dates "${TITLES[1].title}" 2026-11-08, want 2026-11-06, the day its deploy went live`);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52D, { changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[4].title)) }).lines;
    expect(lost, show(lost)).toContain(notRebuilt(TITLES[4]));
    const without = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== IDS[2])));
    const gone = run(S52D, { chunk: without, changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[2].title)) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 6 and 8 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[2].title}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not, title or description", () => {
    const pushed = run(S52D, { changelog: crawler(filler(30, "2026-12-01", "A newer entry")) }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(pastPage(t));
    const stale = run(S52D, { changelog: crawler(filler(30, "2026-10-11", "An older entry")) }).lines;
    for (const t of TITLES) expect(stale, show(stale)).toContain(notRebuilt(t));
    expect(stale, show(stale)).toContain(`FAIL  /changelog's description names an entry of 2026-10-11 as the newest, older than this batch's 2026-11-08 (the prerender did not rebuild)`);
  });

  it("each title is judged by its own date: thirty entries of 7 November push the 6 November titles off, not the 8 November one", () => {
    const { lines } = run(S52D, { changelog: crawler(filler(30, "2026-11-07", "An entry of 7 November")) });
    expect(lines, show(lines)).toContain(notRebuilt(TITLES[0]));
    for (const t of TITLES.slice(1)) expect(lines, show(lines)).toContain(pastPage(t));
  });

  it("fewer than thirty entries cannot have pushed anything off: FAIL", () => {
    const { lines } = run(S52D, { changelog: crawler(filler(29, "2026-12-01", "A newer entry")) });
    for (const t of TITLES) expect(lines, show(lines)).toContain(notRebuilt(t));
  });

  it("a description the bake left on an older newest entry FAILs, though every title is listed", () => {
    const page = PUBLISHED_PAGE.replace(/Latest \(2026-11-08\): [^"]*\./, `Latest (2026-11-02): ${esc(EN.truistGeicoAndNordstromJoinTheBoard.title)}.`);
    expect(page).not.toBe(PUBLISHED_PAGE);
    const { lines } = run(S52D, { changelog: page });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog's description names an entry of 2026-11-02 as the newest, older than this batch's 2026-11-08 (the prerender did not rebuild)`]);
    const none = run(S52D, { changelog: PUBLISHED_PAGE.replace(/Latest \([^"]*\./, "No entries yet.") }).lines;
    expect(none.some((l) => /^FAIL {2}\/changelog's description names no newest entry/.test(l)), show(none)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52D, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL {2}no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
