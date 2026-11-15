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
 *   - the closed-posting entry gives no count, promises nothing about every
 *     closed posting, says nothing of what those pages showed before (no live
 *     read can show that now), and gives the day only for the copy search
 *     engines read: the page a visitor is left with names no day;
 *   - the company-name entry is about company pages only (the read did not
 *     cover search suggestions or stored listings, which can still carry the
 *     short code), gives no count, and names only employers the site's own
 *     name list carries;
 *   - the connect-page entry gives no number and names no hiring system (the
 *     count and the list of systems that stay on the website both move),
 *     names no AI host but Claude, ChatGPT and Claude Code, says the pricing
 *     page it quotes is ChatGPT's, and keeps Claude's free plan to one custom
 *     connector in every language;
 *   - the Ghost Job Index entry claims its takedown heading and explanation in
 *     each language, not the whole page, and quotes that heading as each
 *     language shows it;
 *   - the Pay Transparency entry is about the hiring-system column, whose
 *     names were read on the crawler copy, and names only systems the site's
 *     own vendor table spells that way;
 *   - the footer entry names the four links the browser's footer gained, by
 *     the label each language shows, and none of the crawler-only links.
 * In every language: no digit, no internal name, Portuguese that is
 * Brazilian, Hindi in Devanagari. British English is the US text itself (none
 * of the six says résumé), each other language carries its own words for the
 * limits above, and every translation is pinned by a hash of its reviewed
 * text, so a reworded one fails until it is read again.
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
import { createHash } from "node:crypto";
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
        "the posting's page on our site now says so and states nothing more about the job",
        "The copy of the page that search engines read also gives the day it was built.",
        "which is a statement about our board, not about the employer",
      ],
      mustNot: [
        ["a count of closed postings", /\d/],
        ["a promise about every closed posting", /every (?:closed )?posting|all (?:closed )?postings|always/i],
        ["a reason the employer's answer does not give", /filled|hired|a hire/i],
        // These pages kept a live page until this bake asked the employer, so
        // they never said "no longer listed"; what they showed before is not
        // something a live read can show now.
        ["what these pages showed before the change", /\bbefore\b|\bused to\b|\bpreviously\b/i],
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
        "it quotes what ChatGPT's pricing page says about the Free plan, with the day we read it",
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

  it("British English is the US text itself, word for word (none of the six says résumé)", () => {
    for (const id of IDS) expect(SHARDS["en-GB"][id], id).toEqual(EN[id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME LIMITS IN EACH LANGUAGE'S OWN WORDS. The English limits above read
// only English, so a translation reworded into the claim English refuses (a
// takedown "filled", any number of connectors, every employer's real name)
// passed while its English stayed right. Each language carries the words its
// own text uses for the limit, and the words it would use to break it.
type Other = Exclude<Locale, "en" | "en-GB">;
const OTHERS = LOCALES.filter((l): l is Other => l !== "en" && l !== "en-GB");
const LOCAL: Record<string, Record<Other, { must?: string[]; mustNot: RegExp }>> = {
  // a reason the employer's answer does not give, or what the pages showed before
  [CLOSED]: {
    de: { mustNot: /besetzt|eingestellt|Einstellung|\bVorher\b|\bbisher\b|\bfrüher\b/i },
    es: { mustNot: /cubiert|contratad|\bAntes\b|anteriormente/i },
    fr: { mustNot: /pourvu|embauch|\bAuparavant\b|\bavant\b/i },
    hi: { mustNot: /भर|पहले/ },
    nl: { mustNot: /vervuld|aangenomen|aanname|\bEerder\b|\bvoorheen\b|\bvroeger\b/i },
    pt: { mustNot: /preenchid|contratad|\bAntes\b|anteriormente/i },
    tl: { mustNot: /napunan|na-hire|pag-hire|\bDati\b/i },
  },
  // one custom connector on Claude's free plan, and the pricing page is ChatGPT's
  [CONNECT]: {
    de: { must: ["nur einen eigenen Connector", "Preisseite von ChatGPT"], mustNot: /beliebig|unbegrenzt|mehrere/i },
    es: { must: ["solo un conector personalizado", "página de precios de ChatGPT"], mustNot: /cualquier número|ilimitad|varios conectores/i },
    fr: { must: ["un seul connecteur personnalisé", "page des tarifs de ChatGPT"], mustNot: /illimit|plusieurs connecteurs|autant de/i },
    hi: { must: ["एक कस्टम कनेक्टर", "ChatGPT का प्राइसिंग पेज"], mustNot: /असीमित|कितने भी|कई कस्टम/ },
    nl: { must: ["één eigen connector", "prijspagina van ChatGPT"], mustNot: /onbeperkt|meerdere|zoveel/i },
    pt: { must: ["apenas um conector personalizado", "página de preços do ChatGPT"], mustNot: /ilimitad|vários conectores|quantos quiser/i },
    tl: { must: ["isang custom connector", "pricing page ng ChatGPT"], mustNot: /walang limitasyon|kahit ilan/i },
  },
  // the hiring-system column only: no employer names claimed
  [PAY]: {
    de: { mustNot: /Arbeitgeber/i },
    es: { mustNot: /empleador/i },
    fr: { mustNot: /employeur/i },
    hi: { mustNot: /नियोक्ता/ },
    nl: { mustNot: /werkgever/i },
    pt: { mustNot: /empregador/i },
    tl: { mustNot: /employer/i },
  },
  // its takedown heading and explanation, not the whole page
  [GHOST]: {
    de: { mustNot: /ganze Seite|gesamte Seite/i },
    es: { mustNot: /toda la página|página entera/i },
    fr: { mustNot: /toute la page|page entière/i },
    hi: { mustNot: /पूरा पेज|पूरे पेज/ },
    nl: { mustNot: /hele pagina|volledige pagina/i },
    pt: { mustNot: /toda a página|página inteira/i },
    tl: { mustNot: /buong pahina/i },
  },
  // company pages only: not search suggestions or listings
  [NAMES]: {
    de: { mustNot: /Such|Vorschl|überall|jede Seite/i },
    es: { mustNot: /búsqueda|sugerencia|en todo el sitio|todas las páginas/i },
    fr: { mustNot: /recherche|suggestion|partout|toutes les pages/i },
    hi: { mustNot: /खोज|सुझाव|हर पेज/ },
    nl: { mustNot: /zoek|suggest|overal|elke pagina/i },
    pt: { mustNot: /busca|sugest|em todo o site|todas as páginas/i },
    tl: { mustNot: /paghahanap|search|mungkahi|lahat ng pahina/i },
  },
};

/** The word each language uses for the day, and for the copy search engines read. */
const DAY: Record<Locale, [RegExp, string]> = {
  en: [/\bday\b/i, "search engines read"], "en-GB": [/\bday\b/i, "search engines read"],
  de: [/\bTag\b/, "Suchmaschinen lesen"], es: [/\bdía\b/, "leen los buscadores"], fr: [/\bjour\b/, "lisent les moteurs de recherche"],
  hi: [/दिन/, "सर्च इंजन पढ़ते हैं"], nl: [/\bdag\b/, "zoekmachines lezen"], pt: [/\bdia\b/, "os buscadores leem"], tl: [/\baraw\b/, "binabasa ng mga search engine"],
};

describe("each translation carries the same limits in its own words", () => {
  it.each(Object.keys(LOCAL))("%s", (id) => {
    for (const l of OTHERS) {
      const { must = [], mustNot } = LOCAL[id][l];
      for (const m of must) expect(SHARDS[l][id].description, `${l}: ${m}`).toContain(m);
      expect(textOf(l, id), `${l}: ${mustNot}`).not.toMatch(mustNot);
    }
  });

  it("the closed-posting entry gives the day only for the copy search engines read, in every language", () => {
    // The page a visitor is left with says "When this page was built, ..."
    // and names no day: the app replaces the baked copy once its route
    // commits. Only the crawler copy writes "(2026-11-15)".
    for (const l of LOCALES) {
      const [day, crawler] = DAY[l];
      const sentences = SHARDS[l][CLOSED].description.split(/(?<=[.।:])\s+/);
      const withDay = sentences.filter((x) => day.test(x));
      expect(withDay.length, `${l}: one sentence names the day`).toBe(1);
      expect(withDay[0], `${l}: the sentence that names the day is about the copy search engines read`).toContain(crawler);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TRANSLATION AS REVIEWED. The first 12 hex digits of SHA-256 over
// "<title>\n<description>", per language, in the order of IDS. A change to any
// of them fails here until the new text is read against what production showed
// on 15 November and its hash is written in.
const REVIEWED: Record<Locale, string[]> = {
  en: ["792098c67644", "e8a61fe6f832", "32fe7d1d6884", "976802109e30", "ea009c54c090", "33e0de88f381"],
  "en-GB": ["792098c67644", "e8a61fe6f832", "32fe7d1d6884", "976802109e30", "ea009c54c090", "33e0de88f381"],
  de: ["ba884902f1a6", "ea6411253ce4", "c5a0c302a0b7", "889857918e02", "2ffa7b365b86", "109b3c40738b"],
  es: ["d57cc520169b", "b3867195d26f", "554bd3632bb7", "6dadb9957e4f", "cfd3e632cabe", "752d6277af08"],
  fr: ["c01bf723300e", "343e79770bad", "dbeb8eee5ee7", "962355432149", "d38434069100", "b00efdbc2468"],
  hi: ["3d35f0d76634", "b7e2094b0dd0", "355633d46c1e", "2ad6c4bbd4da", "b0114bb7ac73", "690fe970e706"],
  nl: ["d8a2c066a63f", "1740870718bd", "c733df0f0412", "cd1ef99dfdc5", "ab5a26078681", "ac41ba148a58"],
  pt: ["fcea55a782f8", "3f6a509c470b", "8e1b5af59377", "7d5c7c0a1f5b", "c70facbee3c2", "3dce19fe5b61"],
  tl: ["9b1317d61845", "e8447af0546b", "ba93e1a40e21", "5eb84790b5e7", "1ecce6aa7b23", "ddae1d397634"],
};
const hash = (t: Text) => createHash("sha256").update(`${t.title}\n${t.description}`).digest("hex").slice(0, 12);

describe("every translation is the text that was reviewed", () => {
  it.each(LOCALES)("%s", (l) => {
    expect(IDS.map((id) => hash(SHARDS[l][id])), `${l}: a reworded entry must be read again against the live read, then its hash updated`).toEqual(REVIEWED[l]);
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
/** The other eight languages: each has its changelog chunk and, as the live entry does, another chunk of its name without it. */
const LANGS = ["en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const clChunk = (l: string) => `${l}-${l.replace("-", "").toUpperCase()}CL0001.js`;
const otherChunk = (l: string) => `${l}-${l.replace("-", "").toUpperCase()}MN0001.js`;
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),${LANGS.map((l) => `()=>import("./${otherChunk(l)}"),()=>import("./${clChunk(l)}")`).join(",")}];export{lazy as a};`;
const filler = (n: number, date: string, what: string) => Array.from({ length: n }, (_, i) => ({ date, title: `${what} ${i}` }));

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: { changelog?: string; chunk?: string; langs?: Partial<Record<string, string>> } = {}): { lines: string[]; calls: string[] } {
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
    // The British chunk carries every key too; the section never reads it in
    // place of the US one, and reads it at all only after the publish.
    ...LANGS.flatMap((l) => [
      { match: `^GET https://site\\.test/assets/${clChunk(l).replace(/\./g, "\\.")}$`, body: over.langs?.[l] ?? chunkOf(SHARDS[l]) },
      { match: `^GET https://site\\.test/assets/${otherChunk(l).replace(/\./g, "\\.")}$`, body: `const s={header:{jobs:"x"}};export{s as default};` },
    ]),
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
/** The string section 52e requires in each entry's US description, as its VD52E_MUST list names it. */
const MUSTS = (/<<'VD52E_MUST'\n([\s\S]*?)\nVD52E_MUST/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52E), "utf8"))?.[1].split("\n") ?? [])
  .map((x) => ({ id: x.split("|")[0], must: x.split("|").slice(1).join("|") }));
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;

describe("section 52e judges the six entries on the crawler page", () => {
  it("lists exactly their titles, in order, each with the date their deploy went live", () => {
    const listed = /<<'VD52E_TITLES'\n([\s\S]*?)\nVD52E_TITLES/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52E), "utf8"))?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("lists one string per entry that holds the limit its live read set, each in that entry's description and found once in the whole US shard", () => {
    const listed = /<<'VD52E_MUST'\n([\s\S]*?)\nVD52E_MUST/.exec(readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52E), "utf8"))?.[1].split("\n") ?? [];
    expect(listed.map((x) => x.split("|")[0])).toEqual(IDS);
    const whole = readFileSync(resolve(ROOT, "src/i18n/changelog/en.json"), "utf8");
    for (const [id, m] of listed.map((x) => x.split("|"))) {
      expect(EN[id].description, id).toContain(m);
      expect(whole.split(m).length - 1, `${m} is found once in the US shard`).toBe(1);
      expect(m, `${m} holds no quote mark the bundle might escape`).not.toMatch(/['"\u2018\u2019\u201c\u201d]/);
    }
    expect(MUSTS.find((x) => x.id === CONNECT)?.must, "the connect line pins the one-connector limit").toMatch(/one custom connector/);
  });

  it("before the publish every line is INFO, and only GETs are sent, never to the British chunk or another language's", () => {
    const { lines, calls } = run(S52E, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 15 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines, show(lines)).toContain("INFO  the other eight languages' changelog strings are judged after the publish");
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
    for (const l of LANGS) expect(calls.some((c) => c.includes(`/assets/${l}-`)), l).toBe(false);
  });

  it("after the publish each title passes on the crawler page with its date, each description and each language passes, and the page describes an entry of 15 November as newest", () => {
    const { lines } = run(S52E);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    for (const { id, must } of MUSTS) expect(lines, show(lines)).toContain(`PASS  the US English changelog strings describe ${id} with "${must}"`);
    for (const l of LANGS) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry all six 15 November entries`);
    expect(lines, show(lines)).toContain(`PASS  /changelog's description names an entry of 2026-11-15 as the newest, no older than this batch's 2026-11-15`);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("a description reworded under the same title FAILs, though its title passes", () => {
    const connect = MUSTS.find((x) => x.id === CONNECT)!;
    const reworded = { ...EN, [CONNECT]: { ...EN[CONNECT], description: EN[CONNECT].description.replace(connect.must, "which can add any number of custom connectors") } };
    const { lines } = run(S52E, { chunk: chunkOf(reworded) });
    expect(fails(lines), show(lines)).toEqual([`FAIL  the US English changelog strings carry no "${connect.must}" for ${CONNECT}: its description is not the one read live on 15 November`]);
    expect(lines, show(lines)).toContain(onPage(TITLES[2]));
  });

  it("a language whose chunk lacks an entry FAILs, and so does a language the entry names no changelog chunk for", () => {
    const de = chunkOf(Object.fromEntries(Object.entries(SHARDS.de).filter(([k]) => k !== CONNECT && k !== FOOTER)));
    const { lines } = run(S52E, { langs: { de, nl: `const s={header:{jobs:"x"}};export{s as default};` } });
    expect(fails(lines), show(lines)).toEqual([
      `FAIL  the de changelog strings (${clChunk("de")}) lack ${CONNECT} ${FOOTER}: the publish did not ship the 15 November entries in de`,
      "FAIL  no nl changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 15 November entries cannot be shown in nl",
    ]);
    for (const l of LANGS.filter((x) => x !== "de" && x !== "nl")) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry all six 15 November entries`);
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
