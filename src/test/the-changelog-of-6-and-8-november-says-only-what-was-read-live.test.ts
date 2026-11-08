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
 *     observed, and promises no absolute about who can delete;
 *   - the purchase-link entry says "usually", names the purchases it covers and
 *     says the Full Analysis page is unchanged;
 *   - the drafts entry keeps a draft only while the page stays open, for 20
 *     jobs, and its allowance sentence covers the cover letter and the tailored
 *     résumé only;
 *   - the email entry lists exactly the four acts that give an older search its
 *     language;
 *   - the One-click apply entry is about Explore and saved searches, not the
 *     connector or the API, which still narrow to the same hiring systems;
 *   - the refresh entry gives no number (the threshold read live moved between
 *     237 and 244 seconds) and says we have not yet seen a restart.
 * In every language: the same digits as the English, the site's own button
 * labels where an entry quotes one, no internal name, Portuguese that is
 * Brazilian, and British English that says CV.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { changelog } from "../data/changelog";

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
      must: ["Our pages no longer load their fonts from Google.", "so opening a page asks Google's font servers for nothing"],
      mustNot: [
        ["the Privacy page, which still names Google for fonts further down", /privacy/i],
        ["a speed nobody measured", /faster|speed|quick|cache/i],
      ],
    },
    [DELETE]: {
      must: [
        "Before, anyone who had the share link to a paid analysis could delete it.",
        "Now the share link can still open the analysis but cannot delete it.",
        "Deleting also needs the purchase the analysis was bought with",
        "or by writing to us from the address they paid with",
      ],
      mustNot: [
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
        "This works while the page stays open, for your 20 most recent jobs",
        "as long as your résumé, the posting and your language are unchanged; a reload or a new tab starts fresh",
        "busy for everyone",
      ],
      mustNot: [
        ["a draft kept past the page", /saved to your account|in your account|across devices|any device|after a reload|survives? a reload/i],
        ["answers spared an allowance they never used", /answers? (?:don't|do not|never) (?:use|count)/i],
        ["a busy notice the review did not read", /busy for your network/i],
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
        "since 31 October the board it opened already listed every job",
        "now count and email new jobs from the whole board",
        "opening one has shown the whole board since 31 October",
      ],
      mustNot: [
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
  const digits = (s: string) => (s.match(/\d(?:[\d.,   ]*\d)?/g) ?? []).map((x) => x.replace(/[.,   ]/g, "")).sort();

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
