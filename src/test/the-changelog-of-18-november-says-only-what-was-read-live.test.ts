// @vitest-environment node
/**
 * THE CHANGELOG OF 18 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Twelve entries for bug round A, which went live and verified on 18 November:
 * the free scan and its backup scanner, the board, the account and order pages,
 * the builder and the tailored résumé, saved-search alerts and the market
 * pulse, the data pages, company pages, the Full Analysis page, Shortlist, the
 * nightly clearing of log addresses, and the frontend with them. Every claim
 * was read against production and the code at main that day, read-only: the
 * verify run's PASS lines, the live chunks the browser loads, crawler copies of
 * the CV standards and benchmark pages, and the Privacy page. No scan, purchase,
 * sign-up or mail was made, so a change only the suite proves is left out, and
 * where a read covered less than a first wording said, the entry says only what
 * held. Those limits are held here, entry by entry:
 *   - the board: the search box was overwritten, not the filters; only saving
 *     a job or a search is finished, once, and only within the hour; the
 *     scorer reads English keywords only; no allowance size, price or plan;
 *   - the free scan: only a failed scan or the simpler report stops counting;
 *     counted once is tied to the backup scanner finishing after the main one,
 *     and so is the hourly message with a time (the main scanner still says
 *     only to try again later); the report comes back in that browser tab for
 *     up to 30 minutes; the 52 countries of the list, which the CV standards
 *     pages outnumber (four of them open the scan on auto-detect); the old
 *     Poland and Italy copy said many employers could not process such a CV,
 *     and recruiters still expect the line; no daily allowance, no price;
 *   - more of the free scan: some sections of the report are still English,
 *     and of the PDF summary only headings and labels; a PDF with no page of
 *     text is still refused; the page gives a count of pages with no text,
 *     not which; an Arabic PDF can still come out out of order; several kinds
 *     of Word file; nothing about plain-text encodings or 17 November's scoring;
 *   - saved-search alerts: strong only for the strong-only setting; a few
 *     hiring systems, unnamed; the whole do-not-mail list, and nothing sent
 *     when it cannot be read; the account page says that mail stopped and why,
 *     once it can check the address is the reader's, never when; the fix-plan
 *     emails were not being sent and are no longer offered, and the old button
 *     opens a page that says so; the pulse at most once a calendar month;
 *   - company pages: some companies, those we found; filings read from now on;
 *     no figure, and only the employers read live;
 *   - the data pages: boards already read when the period began; the job
 *     board's own window; closure events counted each time; the 25-scan floor
 *     for every band and for the share at 80 or more; exactly three pages say
 *     what came from an earlier run; a takedown is never a fill or a hire;
 *   - the builder: for example, not every failure; a long résumé still cut;
 *     the résumé's language where it can tell, and moving and removing apart
 *     from that; the check looks for five kinds of claim and cannot catch
 *     every one; a posting read up to 20,000 characters, not whole;
 *   - error messages: more of them, not all, and a server's own words can
 *     still arrive in English; the old outage message quoted in English in
 *     every language; several counts; Back or a link leaves a failed page;
 *   - signing out: asks only when there is work to lose; another device is
 *     named only for signing out everywhere, as possibly still signed in; an
 *     order to run reads so until it has run; the download adds records such
 *     as the documents made for purchases;
 *   - the Full Analysis page: still unused, never refunded, when busy; a
 *     device's browser that still cannot draw the PDF; the page's own cards,
 *     buttons and messages; the Pro limit as /pricing serves it; no price;
 *   - Shortlist: exactly seven more languages; removal by patterns that can
 *     miss; a name not found may have reached the model; candidates, not roles,
 *     go after four years;
 *   - the 90-day limit: several records, cleared at 90 days or stripped of the
 *     address; older addresses in batches over more than one night.
 * In every language: the same numbers as English, every quoted label the live
 * string in that language (a message readers saw only in English stays
 * English), no internal name, Portuguese that is Brazilian, Hindi in
 * Devanagari. British English is the US text with CV for résumé and two
 * British spellings, each other language carries its own words for the limits
 * above, and every translation is pinned by a hash of its reviewed text, so a
 * reworded one fails until it is read again.
 *
 * Section 52g of the verifier judges the twelve on the crawler copy of
 * /changelog once the frontend publish carries them. It runs here in bash
 * against a fake curl, as section 52f does in the 17 November test.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { changelog } from "../data/changelog";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const SHARDS = Object.fromEntries(LOCALES.map((l) => [l, shard(l)])) as Record<Locale, Record<string, Text>>;
const source = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const BOARD = "theBoardKeepsYourFiltersAndSaysWhyAJobHasNoFitScore";
const FREE = "aFreeScanThatFailsNoLongerCountsAgainstYourDay";
const MORE = "moreOfTheFreeScanIsInYourLanguageAndMoreFilesAreRead";
const ALERTS = "savedSearchAlertsNoLongerCallAPossibleMatchStrong";
const COMPANY = "companyPagesShowTotalRevenueAndCorrectedFilings";
const DATA = "ourDataPagesCountTheWayTheySay";
const BUILDER = "theBuilderSaysWhyAnImportFailedAndTheTailoredResumeIsChecked";
const ERRORS = "errorMessagesComeInYourLanguageAndAnOpenTabLoadsTheNewVersion";
const SIGNOUT = "signingOutAsksBeforeItDeletesWorkAndEachOrderIsListedOnce";
const FULL = "theFullAnalysisPageSaysWhyAPurchaseCannotOpen";
const SHORTLIST = "shortlistHidesPersonalDetailsInMoreLanguagesAndEmployersCanDelete";
const NINETY = "theNinetyDayLimitOnLogDataIsNowEnforced";
const DATE = "2026-11-18";

/** Newest first, as changelog.ts lists them, with the tags each claims. */
const ENTRIES: Array<{ id: string; date: string; tags: string[] }> = [
  { id: BOARD, date: DATE, tags: ["fixed", "improved"] },
  { id: FREE, date: DATE, tags: ["fixed", "improved"] },
  { id: MORE, date: DATE, tags: ["improved", "fixed"] },
  { id: ALERTS, date: DATE, tags: ["fixed"] },
  { id: COMPANY, date: DATE, tags: ["fixed"] },
  { id: DATA, date: DATE, tags: ["fixed"] },
  { id: BUILDER, date: DATE, tags: ["fixed", "improved"] },
  { id: ERRORS, date: DATE, tags: ["fixed", "improved"] },
  { id: SIGNOUT, date: DATE, tags: ["fixed"] },
  { id: FULL, date: DATE, tags: ["fixed", "improved"] },
  { id: SHORTLIST, date: DATE, tags: ["new", "improved"] },
  { id: NINETY, date: DATE, tags: ["fixed"] },
];
const IDS = ENTRIES.map((e) => e.id);
const AT = changelog.findIndex((e) => e.id === IDS[0]);
const EN = SHARDS.en;
const textOf = (l: Locale, id: string) => `${SHARDS[l][id].title} ${SHARDS[l][id].description}`;
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: textOf(l, id) })));

describe("the twelve entries", () => {
  it("sit together, newest first, dated the day their deploy went live, with nothing older above them and the 17 November entries next", () => {
    expect(AT, `${IDS[0]} is missing from changelog.ts`).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(AT, AT + ENTRIES.length)).toEqual(ENTRIES);
    for (const e of changelog.slice(0, AT)) expect(e.date >= DATE, `${e.id} (${e.date}) sits above the 18 November entries but is older`).toBe(true);
    expect(changelog[AT + ENTRIES.length].id, "the 17 November entries come next").toBe("aResumeInAnotherLanguageIsNoLongerScoredAsEnglish");
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

  it("each shard lists them in this order right after the 17 November entries, with only newer batches after them", () => {
    const later = new Set(changelog.slice(0, AT).map((e) => e.id));
    for (const l of LOCALES) {
      const keys = Object.keys(SHARDS[l]);
      const at = keys.indexOf(IDS[0]);
      expect(keys.slice(at, at + IDS.length), l).toEqual(IDS);
      expect(keys[at - 1], l).toBe("jobsOnlyStaffMayApplyForAreNotOfferedToSearchEngines");
      for (const k of keys.slice(at + IDS.length)) expect(later.has(k), `${l}: ${k} follows the 18 November entries but is not newer`).toBe(true);
    }
  });

  it("wait in no pending file: the changelog step applied them and the queue is empty", () => {
    const dir = resolve(ROOT, "docs/changelog-pending");
    const pending = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
    for (const f of pending) {
      const keys = (JSON.parse(readFileSync(resolve(dir, f), "utf8")).entries ?? []).map((e: { key: string }) => e.key);
      for (const id of IDS) expect(keys, `${f} still carries ${id}`).not.toContain(id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE LIMITS, AS PURE CHECKS. Each entry's English carries the words that hold
// the limit its live read set and none of the wordings that read did not hold;
// each other language carries its own words for the same limits. breaches()
// lists what a text gets wrong, so the cases below run it on the shipped text
// (nothing) and on overclaims (something).
type Limit = { must: string[]; mustNot: Array<[string, RegExp]> };
const LIMITS: Record<string, Limit> = {
  [BOARD]: {
    must: [
      "the board typed your résumé's job title into the search box, which changed what you had asked for",
      "it now leaves the search box alone, keeps your filters and ranks the jobs they match by fit",
      "when you clicked to save a job or a search",
      "if you sign in within the hour it finishes that click once",
      "the scorer, which reads English keywords only",
      "instead of calling it a temporary problem",
    ],
    mustNot: [
      ["filters cleared before, where the search box was overwritten", /(?:cleared|deleted|wiped|lost|reset) (?:your )?filters|filters (?:were|got) (?:cleared|deleted|wiped|lost|reset)/i],
      ["every click, or another browser or device", /every (?:click|action)|any (?:click|action)|another (?:browser|device)|other (?:browsers|devices)|across (?:browsers|devices)/i],
      ["the fit score as a share of keywords", /\bshare\b|percent|%|keywords you (?:already )?have/i],
      ["the allowance's size, a price or a plan", /\d|[$€£]|\bPro\b|\bplans?\b|price/i],
      ["a scorer that reads other languages", /in any language|every language|your (?:own )?language/i],
    ],
  },
  [FREE]: {
    must: [
      "A free scan that fails, or that gives you only the simpler report made without AI, no longer counts against your free scans for the day",
      "a scan our backup scanner finishes after the main one failed now counts once, not twice",
      "When our backup scanner turns a scan away because too many requests came from your connection in one hour, the page now says so and when to try again",
      "in that browser tab, for up to 30 minutes",
      "The “Applying in” list now offers 52 countries, where it offered 24",
      "the scan button on the CV standards page of each of those countries opens the scan set to that country",
      "said many employers could not process a CV without a data-processing consent line",
      "many recruiters expect the line but the law does not require it",
    ],
    mustNot: [
      ["every scan given back, or a full report", /every (?:free )?scan|any scan|all (?:your )?scans|full report|refund/i],
      ["the daily allowance or a price", /\b(?:7|15)\b|\bseven\b|\bfifteen\b|[$€£]/i],
      ["all the countries the CV standards pages cover", /all (?:the )?(?:\d+ )?countries|every country|each country we/i],
      ["the hourly message with a time from the main scanner", /(?:main|primary) (?:scanner|one) (?:turns|refuses)/i],
      ["the consent line called useless or ignored", /useless|ignor|pointless|not needed|unnecessary/i],
      ["a CV that could not be processed at all", /could not be processed|cannot be processed|can't be processed/i],
      ["any device, where the report is kept in the tab", /any device|another device|any browser/i],
    ],
  },
  [MORE]: {
    must: [
      "now appear in the language you use on the site; some sections of the report are still in English",
      "the headings and labels of the PDF summary you can download",
      "A PDF résumé followed by pages with no text",
      "the page says how many pages had no text",
      "An Arabic PDF can still come out with some letters out of order",
      "several kinds of Word file are read more completely",
    ],
    mustNot: [
      ["the scan's findings or the whole report in the site's language", /findings|advice|whole report|entire report|every (?:section|part)|all (?:of )?the report/i],
      ["a fully scanned résumé read", /scanned résumé|scanned PDFs? (?:is|are) (?:now )?read|image-only|fully scanned|PDFs? with no text/i],
      ["every Word file", /every Word|any Word|all Word/i],
      ["plain-text files in other encodings", /\.txt|text files?\b|encoding/i],
      ["17 November's scoring in eight other languages", /\beight\b|Spanish|French|German|Portuguese|Dutch|Italian|Hindi|Tagalog|scored in/i],
      ["the whole PDF summary in the site's language", /whole PDF|entire PDF|fix-plan|steps/i],
      ["which pages had no text", /which pages/i],
    ],
  },
  [ALERTS]: {
    must: [
      "only an alert set to “Strong fit only” calls them strong",
      "they give no age for jobs from a few hiring systems that change a posting's date whenever the employer edits it",
      "check each address against the whole list of addresses that asked us to stop all our emails, and send nothing when that list cannot be read",
      "your account page now says so and why, once the page can check that the address is yours",
      "now comes at most once a calendar month",
      "no longer offers the fix-plan emails, which were not being sent",
      "the button in an older report now opens a page that says no emails will follow",
    ],
    mustNot: [
      ["alerts scored differently", /scored differently|new scor|re-?scor|scoring (?:has )?changed/i],
      ["a hiring system's name, or every posting age dropped", /Breezy|Paylocity|UKG|every posting|all postings/i],
      ["the new-jobs badge or a fit score read only from the owner's scan", /badge|owner/i],
      ["a stop-all lifted from the account page", /\blift|turn (?:mail|email|them) back on|re-?subscribe/i],
      ["fix-plan emails never sent, coming back, or deleted", /never (?:been )?sent|will return|come back|coming back|deleted|purged/i],
      ["the pulse on a fixed day", /\b1st\b|first of the month|28 days|every month on/i],
      ["the do-not-mail list never read before", /never checked|did not check|didn't check/i],
      ["the date mail stopped", /the date (?:mail|we|it) stopped|when we stopped|since when/i],
      ["the old button itself saying so", /button (?:now )?(?:says|reads)/i],
      ["stamps, the agent, grants, clipped names or mail records", /DMARC|stamp|\bkick|clip|grant|column|agent/i],
    ],
  },
  [COMPANY]: {
    must: [
      "Some listed companies' pages",
      "those we found are removed",
      "the three kinds their source holds, not H-1B alone",
      "this applies to filings we read from now on",
    ],
    mustNot: [
      ["every figure or filing now right", /every (?:revenue|wage|filing|figure|company)|all (?:revenue|wage|filings|figures|companies)|now correct\b/i],
      ["filings already on the site read again", /read again|re-?read|already on the site/i],
      ["a state whose notices no nightly read had finished", /Maryland|Virginia|Arizona|Iowa/],
      ["a revenue, wage or worker figure", /[$€£]|\d{2,}|million|billion|percent|%/i],
      ["a statement about a role or a hire", /hiring|hired|\broles?\b|position/i],
    ],
  },
  [DATA]: {
    must: [
      "now count only boards we were already reading when the period began",
      "by the job board's own 30-day rule",
      "calls its 90-day figure closure events, because a posting taken down more than once counts each time",
      "hold back every 10-point score band with fewer than 25 scans",
      "only when at least 25 scans scored that high",
      "now says postings taken down, where it said roles filled or closed",
    ],
    mustNot: [
      ["a takedown called a hire or a fill", /\bhires?\b|\bhired\b|\bfills?\b/i],
      ["today's figures", /\d{3,}|\d+ ?%|percent/i],
      ["every effect of coverage growth removed", /every effect|no longer (?:any|affected)|all (?:coverage|growth)/i],
      ["each employer board's own rule", /each (?:employer|board)'s|employer'?s own|every board's/i],
    ],
  },
  [BUILDER]: {
    must: [
      "for example that today's import limit has been reached, and offers Try again",
      "it says how many of its characters were imported, so you can add the rest",
      "taken from the résumé's own language where it can tell; jobs and schools can be moved up and down, and the last entry can be removed too",
      "for credentials, degrees, employers, job titles and figures your résumé does not show",
      "It now reads a job posting up to 20,000 characters, where it read 5,000, and says when a posting was longer",
      "The check looks only for those kinds of claims and cannot catch every one, so read the result before you use it.",
    ],
    mustNot: [
      ["every failure naming its cause", /every (?:failure|import)|always says why/i],
      ["any résumé imported whole", /any résumé|whole résumé|every résumé|no longer cut|no limit/i],
      ["a promise of accuracy", /never invents|guarantee|accurate|always (?:true|correct)/i],
      ["the whole posting read", /whole posting|entire posting|any length|full posting/i],
      ["a letter", /letter/i],
      ["the claim a draft was refused for", /tells you why|says which claim|names the claim/i],
      ["a model, a status, a price or an allowance", /\bGPT|\bmodel\b|\b[45]\d\d\b|[$€£]|\d+ (?:imports|tries|a day|an hour)/i],
    ],
  },
  [ERRORS]: {
    must: [
      "though a message our server writes in its own words can still arrive in English",
      "When our AI provider could not take requests, the message could say “Payment required”",
      "it now says the problem is on our side, not with your payment",
      "showing “Loading the new version…” with a “Reload now” button",
      "if a page does fail, Back or a link takes you on",
      "several counts now say one in the singular",
    ],
    mustNot: [
      ["every message or string", /every (?:string|message|error)|all (?:strings|messages|errors|of the site)|whole site/i],
      ["all counts", /all counts|every count/i],
      ["the AI provider's name, its gateway or its credits", /Lovable|gateway|credits|OpenAI|Google|Anthropic/i],
      ["files that could not be read, which another entry owns", /\bfiles?\b/i],
      ["errors that can no longer happen", /no longer (?:fail|happen|crash)|never (?:fail|crash)/i],
      ["search engines, crash reports or telemetry", /search engine|index|crawl|crash report|telemetry|analytics/i],
      ["the apply agent, the Pro badge or the changelog", /agent|\bPro\b|badge|changelog/i],
    ],
  },
  [SIGNOUT]: {
    must: [
      "signing out now asks first when either holds something",
      "this device is still signed out and the page says so",
      "if you chose to sign out everywhere, it says your other devices may still be signed in",
      "reads “Paid: open it to run” until it has run",
      "“Download all my data (JSON)” now also includes records kept only on our server, such as",
    ],
    mustNot: [
      ["every sign-out asking", /every sign-out|always asks|each time you sign out/i],
      ["other devices signed out", /other devices (?:are|were|get) (?:also )?signed out|signs? out (?:your )?other devices/i],
      ["the password-change code or the keys made before the address was proved", /password|\bkeys?\b/i],
      ["the Pro checkout, a grant's month, or a payment event", /thirty|checkout|grant|month|webhook|\bevents?\b/i],
      ["everything in the download", /everything|all (?:your|of your) (?:data|records)|every record/i],
      ["a price, a provider, a table or a reference format", /[$€£]|Stripe|Supabase|Lovable|\bauth\b|\btables?\b|reference/i],
      ["opening the page alone clearing it", /until you open it|once you open it|opening (?:it|the page) (?:clears|runs)/i],
    ],
  },
  [FULL]: {
    must: [
      "for example that it was refunded, was for another product or has already made its analysis",
      "the page now says so and that your purchase is still unused",
      "when a device's browser still cannot draw it",
      "the page's own cards, buttons and messages now appear in the language you use on the site",
      "10 a day and 60 a month",
    ],
    mustNot: [
      ["a price", /[$€£]|\bUSD\b|\bEUR\b/],
      ["the analysis email resent, or delivery guaranteed", /resen[dt]|re-sent|guarantee|always delivered|emailed again/i],
      ["every phone saving the PDF", /every (?:phone|device|browser)|any (?:phone|device)|all (?:phones|devices)/i],
      ["the whole analysis translated", /whole analysis|entire analysis|translated/i],
      ["unopened presses no longer counted", /unopened|presses|count against/i],
      ["a refusal code, a function or a build", /\bcode\b|function|build/i],
    ],
  },
  [SHORTLIST]: {
    must: [
      "it now also removes them when they are written in German, French, Spanish, Portuguese, Dutch, Chinese or Japanese",
      "a candidate whose name was not found says so, since that name may have reached the model",
      "candidates still held four years after they were uploaded are deleted automatically",
      "Removal works by patterns, so a detail written in words its rules do not know can still reach the model.",
    ],
    mustNot: [
      ["every personal detail removed, or no bias", /all personal|every personal|bias|\bfair\b|anonymi[sz]ed/i],
      ["every language, Hindi or Tagalog", /every language|any language|Hindi|Tagalog|Italian/i],
      ["roles deleted after four years", /roles? (?:are|is) (?:deleted|purged) after|roles? (?:still )?held four/i],
      ["how a request could steer the redactor, or an internal name", /steer|inject|prompt|\btables?\b|function|\bjobs?\b|migration/i],
      ["names always removed", /names are (?:always )?removed|removes (?:every|all) names?/i],
    ],
  },
  [NINETY]: {
    must: [
      "but several of our records, such as the logs of scans and of files we could not read",
      "deletes those records once they are 90 days old, or takes the address out of the ones we keep",
      "so clearing them can take more than one night",
    ],
    mustNot: [
      ["every log or record", /all (?:our )?(?:logs|records|addresses)|every (?:log|record|address)/i],
      ["our hosting provider's own logs", /hosting|host's|provider's (?:own )?logs|Supabase|Lovable|Cloudflare/i],
      ["every address deleted at once", /at once|immediately|instantly/i],
      ["an internal name", /\btables?\b|function|migration|cron|stamp/i],
      ["a deleted account's rows erased", /deleted account|not subscribed/i],
      ["the connector search row's wording", /connector|\b30\b/i],
      ["client roles or log writers refusing strangers", /client role|server-only|stranger|refus/i],
      ["the click-record prune as run, or the mail log's addresses withheld", /prun|mail log|withh[eo]ld/i],
    ],
  },
};

/** British English: the US text with CV for résumé and two British spellings, nothing else. */
const toGB = (s: string) => s.replace(/résumé/g, "CV").replace("practice interview questions", "practise interview questions").replace("affiliate program's", "affiliate programme's");

type Other = Exclude<Locale, "en" | "en-GB">;
const OTHERS = LOCALES.filter((l): l is Other => l !== "en" && l !== "en-GB");
const LOCAL: Record<string, Record<Other, { must: string[]; mustNot: RegExp }>> = {
  // the search box overwritten, not the filters; saving a job or a search,
  // once, within the hour; English keywords only; no size, price or plan
  [BOARD]: {
    de: { must: ["hat die Jobbörse den Jobtitel aus deinem Lebenslauf ins Suchfeld geschrieben", "jetzt lässt sie das Suchfeld unverändert, behält deine Filter", "eine Stelle oder eine Suche zu speichern", "wenn du dich innerhalb einer Stunde anmeldest, führt sie diesen Klick einmal zu Ende", "die nur englische Schlüsselwörter liest"], mustNot: /Filter (?:gelöscht|entfernt)|jede Aktion|jeden Klick|anderen Geräten|anderen Browser|Anteil|Prozent|\bPro\b|Preis|\d/i },
    es: { must: ["el tablón escribía el puesto de tu currículum en el cuadro de búsqueda", "ahora deja el cuadro de búsqueda como está, conserva tus filtros", "para guardar un empleo o una búsqueda", "si inicias sesión en menos de una hora, completa ese clic una vez", "que solo lee palabras clave en inglés"], mustNot: /borraba tus filtros|eliminaba tus filtros|cualquier acción|cada acción|otros dispositivos|otro navegador|proporción|porcentaje|\bPro\b|precio|\d/i },
    fr: { must: ["le tableau saisissait l'intitulé de poste de votre CV dans le champ de recherche", "il laisse désormais le champ de recherche tel quel, garde vos filtres", "pour enregistrer une offre ou une recherche", "si vous vous connectez dans l'heure, elle termine ce clic une fois", "qui ne lit que des mots-clés en anglais"], mustNot: /effaçait vos filtres|supprimait vos filtres|toute action|chaque action|autres appareils|autre navigateur|proportion|pourcentage|\bPro\b|\bprix\b|\d/i },
    hi: { must: ["बोर्ड आपके रिज़्यूमे का जॉब टाइटल खोज बॉक्स में लिख देता था", "अब वह खोज बॉक्स को नहीं छेड़ता, आपके फ़िल्टर बनाए रखता है", "कोई नौकरी या खोज सहेजने के लिए", "अगर आप एक घंटे के भीतर साइन इन करते हैं तो वह उस क्लिक को एक बार पूरा कर देता है", "जो सिर्फ़ अंग्रेज़ी कीवर्ड पढ़ता है"], mustNot: /दूसरे डिवाइस|दूसरे ब्राउज़र|प्रतिशत|हर क्लिक|\bPro\b|कीमत|[0-9०-९]/ },
    nl: { must: ["typte het bord de functietitel van je cv in het zoekvak", "nu laat het het zoekvak met rust, houdt het je filters", "om een vacature of een zoekopdracht op te slaan", "log je binnen het uur in, dan wordt die klik één keer afgemaakt", "die alleen Engelse trefwoorden leest"], mustNot: /filters (?:gewist|verwijderd)|elke actie|elke klik|andere apparaten|andere browser|aandeel|percentage|\bPro\b|prijs|\d/i },
    pt: { must: ["o quadro digitava o cargo do seu currículo na caixa de busca", "agora ele deixa a caixa de busca como está, mantém seus filtros", "para salvar uma vaga ou uma busca", "se entrar dentro de uma hora, aquele clique é concluído uma vez", "que lê apenas palavras-chave em inglês"], mustNot: /apagava seus filtros|qualquer ação|cada ação|outros dispositivos|outro navegador|proporção|porcentagem|\bPro\b|preço|\d/i },
    tl: { must: ["itina-type noon ng board ang job title ng résumé mo sa search box", "ngayon ay hindi na nito ginagalaw ang search box, pinananatili ang mga filter mo", "para i-save ang isang trabaho o isang paghahanap", "kung mag-sign in ka sa loob ng isang oras, tinatapos nito nang isang beses ang click na iyon", "na mga keyword sa Ingles lang ang binabasa"], mustNot: /binura ang mga filter|bawat aksyon|ibang device|ibang browser|porsiyento|\bPro\b|presyo|\d/i },
  },
  // a failed scan or the simpler report; once, for the backup finishing; the
  // hourly message from the backup scanner; that tab, up to 30 minutes; many
  // employers could not process, recruiters expect, the law does not require
  [FREE]: {
    de: { must: ["Ein kostenloser Scan, der fehlschlägt oder dir nur den einfacheren, ohne KI erstellten Bericht gibt", "zählt jetzt einmal, nicht zweimal", "Wenn unser Ersatz-Scanner einen Scan ablehnt, weil in einer Stunde zu viele Anfragen von deiner Verbindung kamen", "in diesem Browser-Tab bis zu 30 Minuten lang", "viele Arbeitgeber könnten einen Lebenslauf ohne Einwilligungsklausel zur Datenverarbeitung nicht verarbeiten", "dass viele Recruiter die Klausel erwarten, das Gesetz sie aber nicht verlangt"], mustNot: /jeder Scan|alle Scans|alle Länder|vollständigen Bericht|Erstattung|nutzlos|ignorier|Haupt-Scanner einen Scan ablehnt|\b(?:7|15)\b|\bsieben\b|fünfzehn|[$€£]/i },
    es: { must: ["Un escaneo gratis que falla, o que solo te da el informe más sencillo hecho sin IA", "ahora cuenta una vez, no dos", "Cuando nuestro escáner de respaldo rechaza un escaneo porque desde tu conexión llegaron demasiadas solicitudes en una hora", "en esa pestaña del navegador, durante un máximo de 30 minutos", "muchos empleadores no podían procesar un currículum sin una cláusula de consentimiento", "muchos reclutadores esperan esa cláusula, pero que la ley no la exige"], mustNot: /todos los escaneos|cualquier escaneo|todos los países|informe completo|reembols|inútil|ignora|escáner principal rechaza|\b(?:7|15)\b|\bsiete\b|quince|[$€£]/i },
    fr: { must: ["Un scan gratuit qui échoue, ou qui ne vous donne que le rapport plus simple établi sans IA", "compte désormais une fois, et non deux", "Quand notre scanner de secours refuse un scan parce que trop de requêtes sont venues de votre connexion en une heure", "dans cet onglet du navigateur, pendant 30 minutes au maximum", "de nombreux employeurs ne pouvaient pas traiter un CV sans mention de consentement", "de nombreux recruteurs attendent cette mention, mais que la loi ne l'exige pas"], mustNot: /tous les scans|tout scan|tous les pays|rapport complet|rembours|inutile|ignor|scanner principal refuse|\b(?:7|15)\b|\bsept\b|\bquinze\b|[$€£]/i },
    hi: { must: ["जो मुफ़्त स्कैन विफल हो जाता है, या जो आपको सिर्फ़ बिना AI के बनी सरल रिपोर्ट देता है", "वह अब दो बार नहीं, एक बार गिना जाता है", "जब एक घंटे में आपके कनेक्शन से बहुत ज़्यादा अनुरोध आने की वजह से हमारा बैकअप स्कैनर स्कैन करने से मना कर देता है", "उसी ब्राउज़र टैब में उसी रिपोर्ट पर लौटते हैं, 30 मिनट तक", "कई नियोक्ता डेटा-प्रोसेसिंग सहमति वाली पंक्ति के बिना CV को प्रोसेस नहीं कर सकते", "कई रिक्रूटर इस पंक्ति की अपेक्षा करते हैं, लेकिन क़ानून इसे ज़रूरी नहीं बनाता"], mustNot: /हर स्कैन|सभी स्कैन|सभी देश|पूरी रिपोर्ट|रिफ़ंड|बेकार|अनदेखा|मुख्य स्कैनर स्कैन|\b(?:7|15)\b|[$€£]/ },
    nl: { must: ["Een gratis scan die mislukt, of die je alleen het eenvoudigere rapport geeft dat zonder AI is gemaakt", "telt nu één keer, niet twee keer", "Als onze reservescanner een scan weigert omdat er in één uur te veel verzoeken van je verbinding kwamen", "in dat browsertabblad, tot 30 minuten lang", "veel werkgevers een cv zonder toestemmingsregel voor gegevensverwerking niet konden verwerken", "veel recruiters de regel verwachten, maar dat de wet hem niet verplicht stelt"], mustNot: /elke scan|alle scans|alle landen|volledig rapport|terugbetaal|nutteloos|negeren|hoofdscanner (?:een scan )?weigert|\b(?:7|15)\b|\bzeven\b|vijftien|[$€£]/i },
    pt: { must: ["Uma análise gratuita que falha, ou que dá a você apenas o relatório mais simples feito sem IA", "agora conta uma vez, não duas", "Quando o nosso analisador de reserva recusa uma análise porque chegaram solicitações demais da sua conexão em uma hora", "naquela aba do navegador, por até 30 minutos", "muitos empregadores não podiam processar um currículo sem uma linha de consentimento", "muitos recrutadores esperam essa linha, mas que a lei não a exige"], mustNot: /todas as análises|qualquer análise|todos os países|relatório completo|reembols|inútil|ignora|analisador principal recusa|\b(?:7|15)\b|\bsete\b|quinze|[$€£]/i },
    tl: { must: ["ang libreng scan na pumalya, o na nagbigay lang sa iyo ng mas simpleng report na ginawa nang walang AI", "ibinibilang na ngayon nang isang beses, hindi dalawang beses", "Kapag tinanggihan ng aming backup scanner ang isang scan dahil masyadong maraming request ang nanggaling sa koneksyon mo sa loob ng isang oras", "sa browser tab na iyon, hanggang 30 minuto", "hindi maproseso ng maraming employer ang CV na walang linya ng pahintulot", "inaasahan ng maraming recruiter ang linyang iyon pero hindi ito hinihingi ng batas"], mustNot: /bawat scan|lahat ng scan|lahat ng bansa|buong report|refund|walang silbi|binabalewala|pangunahing scanner ang isang scan|\b(?:7|15)\b|[$€£]/i },
  },
  // some sections still English; PDF headings and labels only; a count of
  // pages, not which; an Arabic PDF can still come out out of order; several
  // kinds of Word file; nothing about text encodings or the eight languages
  [MORE]: {
    de: { must: ["einige Abschnitte des Berichts sind noch auf Englisch", "die Überschriften und Beschriftungen der PDF-Zusammenfassung", "die Seite sagt, wie viele Seiten keinen Text hatten", "Ein arabisches PDF kann noch mit einigen Buchstaben in falscher Reihenfolge herauskommen", "mehrere Arten von Word-Dateien werden vollständiger gelesen"], mustNot: /welche Seiten|jede Word|alle Word|\.txt|Textdatei|Kodierung|gesamte PDF|ganze PDF|ganze Bericht|gesamte Bericht|Spanisch|Französisch|Italienisch/i },
    es: { must: ["algunas secciones del informe siguen en inglés", "los títulos y etiquetas del resumen en PDF", "la página indica cuántas páginas no tenían texto", "Un PDF en árabe todavía puede salir con algunas letras desordenadas", "varios tipos de archivo de Word se leen de forma más completa"], mustNot: /qué páginas|todos los archivos de Word|cualquier archivo de Word|\.txt|archivo de texto|codificación|todo el PDF|todo el informe|francés|italiano|alemán/i },
    fr: { must: ["certaines sections du rapport restent en anglais", "les titres et libellés du résumé PDF", "la page indique combien de pages n'avaient pas de texte", "Un PDF en arabe peut encore sortir avec certaines lettres dans le désordre", "plusieurs types de fichiers Word sont lus plus complètement"], mustNot: /quelles pages|tous les fichiers Word|tout fichier Word|\.txt|fichier texte|encodage|tout le PDF|tout le rapport|espagnol|italien|allemand/i },
    hi: { must: ["रिपोर्ट के कुछ हिस्से अब भी अंग्रेज़ी में हैं", "PDF सारांश के शीर्षक और लेबल", "पेज बताता है कि कितने पेजों पर कोई टेक्स्ट नहीं था", "किसी अरबी PDF में अब भी कुछ अक्षर क्रम से बाहर आ सकते हैं", "कई तरह की Word फ़ाइलें अब ज़्यादा पूरी तरह पढ़ी जाती हैं"], mustNot: /कौन-से पेज|किन पेजों|हर Word|सभी Word|\.txt|टेक्स्ट फ़ाइल|एन्कोडिंग|पूरी PDF|पूरी रिपोर्ट|स्पेनिश|फ़्रेंच|इतालवी/ },
    nl: { must: ["sommige onderdelen van het rapport zijn nog in het Engels", "de koppen en labels van de pdf-samenvatting", "de pagina zegt hoeveel pagina's geen tekst hadden", "Een Arabische pdf kan er nog steeds uitkomen met sommige letters in de verkeerde volgorde", "verschillende soorten Word-bestanden worden vollediger gelezen"], mustNot: /welke pagina's|elk Word|alle Word|\.txt|tekstbestand|codering|de hele pdf|het hele rapport|Spaans|Frans|Italiaans/i },
    pt: { must: ["algumas seções do relatório ainda estão em inglês", "os títulos e rótulos do resumo em PDF", "a página diz quantas páginas não tinham texto", "Um PDF em árabe ainda pode sair com algumas letras fora de ordem", "vários tipos de arquivo do Word são lidos de forma mais completa"], mustNot: /quais páginas|todos os arquivos do Word|qualquer arquivo do Word|\.txt|arquivo de texto|codificação|todo o PDF|todo o relatório|espanhol|francês|italiano/i },
    tl: { must: ["nasa Ingles pa rin ang ilang seksyon ng report", "ang mga heading at label ng PDF summary", "sinasabi ng page kung ilang page ang walang text", "Maaari pa ring lumabas ang isang Arabic na PDF na may ilang titik na wala sa ayos", "mas buong nababasa na ang ilang uri ng Word file"], mustNot: /aling mga page|bawat Word|lahat ng Word|\.txt|text file|encoding|buong PDF|buong report|Espanyol|Pranses|Italyano/i },
  },
  // strong only for strong-only; a few systems, unnamed; the whole list and
  // nothing sent unread; the account page says so and why once it can check;
  // at most once a calendar month; not being sent; the old button opens a page
  [ALERTS]: {
    de: { must: ["nur ein Alert, der auf „Nur starke Passung“ eingestellt ist, bezeichnet sie als stark", "für Stellen aus einigen wenigen Bewerbungssystemen", "mit der vollständigen Liste der Adressen ab", "verschicken nichts, wenn sich diese Liste nicht lesen lässt", "zeigt deine Kontoseite das jetzt an und nennt den Grund, sobald sie prüfen kann, dass die Adresse dir gehört", "höchstens einmal pro Kalendermonat", "die nicht verschickt wurden", "öffnet jetzt eine Seite, die sagt, dass keine E-Mails folgen werden"], mustNot: /Breezy|Paylocity|UKG|nie verschickt|nie gesendet|zurückkehren|gelöscht|Datum, an dem|seit wann|am 1\.|28 Tage|Schaltfläche sagt|Abzeichen|Badge|DMARC/i },
    es: { must: ["solo una alerta configurada en «Solo alta compatibilidad» los califica de alta compatibilidad", "de unos pocos sistemas de contratación", "con la lista completa de direcciones", "no envían nada cuando esa lista no se puede leer", "tu página de cuenta ahora lo indica y explica por qué, en cuanto puede comprobar que la dirección es tuya", "como máximo una vez por mes natural", "que no se estaban enviando", "ahora abre una página que dice que no llegará ningún correo"], mustNot: /Breezy|Paylocity|UKG|nunca se enviaron|volverán|eliminad|borrad|la fecha en que|desde cuándo|el día 1|28 días|el botón dice|insignia|DMARC/i },
    fr: { must: ["seule une alerte réglée sur « Forte compatibilité seulement » les présente comme une forte compatibilité", "de quelques systèmes de recrutement", "à la liste complète des adresses", "n'envoient rien lorsque cette liste ne peut pas être lue", "votre page de compte l'indique désormais, avec la raison, dès qu'elle peut vérifier que l'adresse est bien la vôtre", "au plus une fois par mois civil", "qui n'étaient pas envoyés", "ouvre désormais une page qui indique qu'aucun e-mail ne suivra"], mustNot: /Breezy|Paylocity|UKG|jamais envoyés|reviendront|supprimé|la date à laquelle|depuis quand|le 1er|28 jours|le bouton indique|badge|DMARC/i },
    hi: { must: ["सिर्फ़ “सिर्फ़ मज़बूत मेल” पर सेट अलर्ट ही उन्हें मज़बूत कहता है", "कुछ हायरिंग सिस्टम की नौकरियों", "उन पतों की पूरी सूची से मिलाते हैं", "जब वह सूची पढ़ी नहीं जा सकती, तब कुछ नहीं भेजते", "जैसे ही आपका खाता पेज यह जाँच पाता है कि पता आपका ही है, वह अब यह बताता है और इसकी वजह भी", "किसी कैलेंडर महीने में ज़्यादा से ज़्यादा एक बार", "जो भेजे नहीं जा रहे थे", "अब एक पेज खोलता है जो बताता है कि आगे कोई ईमेल नहीं आएगा"], mustNot: /Breezy|Paylocity|UKG|कभी नहीं भेजे|वापस आएँगे|मिटा दिए|किस तारीख़|DMARC|बैज/ },
    nl: { must: ["alleen een alert dat op ‘Alleen sterke match’ staat, noemt ze sterk", "uit een paar wervingssystemen", "aan de volledige lijst met adressen", "versturen niets als die lijst niet te lezen is", "zegt je accountpagina dat nu, met de reden erbij, zodra de pagina kan nagaan dat het adres van jou is", "hooguit één keer per kalendermaand", "die niet werden verstuurd", "opent nu een pagina die zegt dat er geen mails zullen volgen"], mustNot: /Breezy|Paylocity|UKG|nooit verstuurd|komen terug|verwijderd|de datum waarop|sinds wanneer|op de 1e|28 dagen|de knop zegt|badge|DMARC/i },
    pt: { must: ["só um alerta definido como “Só alta compatibilidade” as chama de fortes", "de alguns sistemas de recrutamento", "com a lista completa de endereços", "não enviam nada quando essa lista não pode ser lida", "a página da sua conta agora informa isso e o motivo, assim que consegue verificar que o endereço é seu", "no máximo uma vez por mês do calendário", "que não estavam sendo enviados", "agora abre uma página que diz que nenhum e-mail virá depois"], mustNot: /Breezy|Paylocity|UKG|nunca foram enviados|voltarão|excluíd|apagad|a data em que|desde quando|no dia 1|28 dias|o botão diz|\bselo\b|DMARC/i },
    tl: { must: ["ang alert lang na naka-set sa “Malakas na tugma lang” ang tumatawag na malakas ang mga ito", "mula sa ilang hiring system", "sa buong listahan ng mga address", "wala silang ipinapadala kapag hindi mabasa ang listahang iyon", "sinasabi na ito ngayon ng account page mo at kung bakit, sa sandaling matiyak nito na sa iyo ang address", "nang hindi hihigit sa isang beses kada buwan sa kalendaryo", "na hindi naipapadala", "nagbubukas na ngayon ang button sa mas lumang report ng page na nagsasabing walang email na susunod"], mustNot: /Breezy|Paylocity|UKG|hindi kailanman naipadala|babalik|binura|petsa kung kailan|DMARC|badge/i },
  },
  // some companies, those we found, the three kinds, filings read from now on;
  // no other state, no figure, no hiring
  [COMPANY]: {
    de: { must: ["Die Seiten einiger börsennotierter Unternehmen", "Die, die wir gefunden haben, sind entfernt", "die drei Arten, die ihre Quelle enthält, statt nur als H-1B", "das gilt für Meldungen, die wir ab jetzt lesen"], mustNot: /\balle\b|\bjede[rs]?\b|erneut gelesen|Maryland|Virginia|Arizona|Iowa|Millionen|Milliarden|Prozent|[$€]|eingestellt|Einstellung/i },
    es: { must: ["Las páginas de algunas empresas cotizadas", "las que encontramos se han eliminado", "los tres tipos que contiene su fuente, y no solo H-1B", "esto se aplica a los documentos que leamos a partir de ahora"], mustNot: /\btodas\b|\btodos\b|\bcada\b|volvimos a leer|Maryland|Virginia|Arizona|Iowa|millones|por ciento|[$€]|contrat/i },
    fr: { must: ["Les pages de certaines sociétés cotées", "celles que nous avons trouvées ont été retirées", "les trois types que contient leur source, et non pour le seul H-1B", "cela vaut pour les déclarations que nous lisons à partir de maintenant"], mustNot: /\btous\b|\btoutes\b|\bchaque\b|relu|Maryland|Virginie|Arizona|Iowa|millions|pour cent|[$€]|embauch|recrut/i },
    hi: { must: ["कुछ सूचीबद्ध कंपनियों के पेज", "जो हमें मिलीं, वे हटा दी गई हैं", "यही तीन प्रकार इनके स्रोत में हैं", "यह उन फ़ाइलिंग पर लागू होता है जिन्हें हम अब से पढ़ेंगे"], mustNot: /सभी|हर कंपनी|दोबारा पढ़|मैरीलैंड|वर्जीनिया|एरिज़ोना|आयोवा|Maryland|Virginia|Arizona|Iowa|मिलियन|करोड़|लाख|[$€]|भर्ती/ },
    nl: { must: ["Op de pagina's van sommige beursgenoteerde bedrijven", "de gevallen die we vonden, zijn verwijderd", "de drie soorten die hun bron bevat, niet alleen voor H-1B", "dit geldt voor meldingen die we vanaf nu lezen"], mustNot: /\balle\b|\belke?\b|opnieuw gelezen|Maryland|Virginia|Arizona|Iowa|miljoen|miljard|procent|[$€]|aangenomen|werving/i },
    pt: { must: ["As páginas de algumas empresas de capital aberto", "os que encontramos foram removidos", "os três tipos que a fonte deles contém, e não só H-1B", "isso vale para os registros que lermos daqui em diante"], mustNot: /\btod[oa]s\b|\bcada\b|lidos de novo|relid|Maryland|Virgínia|Virginia|Arizona|Iowa|milhões|bilhões|por cento|[$€]|contrata/i },
    tl: { must: ["Ang mga page ng ilang listed company", "inalis na ang mga nahanap namin", "ang tatlong uri na hawak ng pinagmulan nila, hindi H-1B lang", "para ito sa mga filing na babasahin namin mula ngayon"], mustNot: /\blahat\b|\bbawat\b|muling binasa|Maryland|Virginia|Arizona|Iowa|milyon|bilyon|porsiyento|[$€]|hiring|\bhire/i },
  },
  // boards already read; the job board's own window; closure events each
  // time; the 25-scan floor; the ticker's takedowns, its old wording last
  [DATA]: {
    de: { must: ["nur Boards, die wir zu Beginn des Zeitraums schon gelesen haben", "nach der eigenen 30-Tage-Regel der Jobbörse", "nennt seine 90-Tage-Zahl Schließungsereignisse, weil eine Anzeige, die mehr als einmal entfernt wird, jedes Mal zählt", "jedes 10-Punkte-Band mit weniger als 25 Scans zurück", "nur, wenn mindestens 25 Scans so viele Punkte erreicht haben", "spricht jetzt von entfernten Stellenanzeigen, wo sie von besetzten oder geschlossenen Stellen sprach"], mustNot: /jedes Arbeitgebers|Regel jedes|jede Wirkung|vollständig bereinigt|\d{3,}|Prozent/i },
    es: { must: ["solo los portales que ya leíamos cuando empezó el periodo", "según la propia regla de 30 días del tablón de empleo", "llama eventos de cierre a su cifra de 90 días, porque una oferta retirada más de una vez cuenta cada vez", "cada franja de 10 puntos con menos de 25 escaneos", "solo cuando al menos 25 escaneos han obtenido 80 o más", "ahora dice «ofertas retiradas», donde decía «puestos cubiertos o cerrados»"], mustNot: /de cada empleador|regla de cada|todo efecto|ya no influye|\d{3,}|por ciento/i },
    fr: { must: ["ne comptent désormais que les sites que nous lisions déjà au début de la période", "selon la règle des 30 jours propre au tableau d'offres", "appelle son chiffre sur 90 jours des événements de fermeture, car une offre retirée plus d'une fois compte à chaque fois", "chaque tranche de 10 points comptant moins de 25 scans", "que lorsqu'au moins 25 scans ont atteint ce niveau", "indique désormais « offres retirées », là où il disait « postes pourvus ou fermés »"], mustNot: /de chaque employeur|propre à chaque|tout effet|\d{3,}|pour cent/i },
    hi: { must: ["सिर्फ़ उन बोर्डों को गिनते हैं जिन्हें हम अवधि शुरू होने के समय पहले से पढ़ रहे थे", "जॉब बोर्ड के अपने 30 दिन वाले नियम से", "अपने 90 दिन वाले आँकड़े को बंद होने की घटनाएँ कहता है, क्योंकि एक से ज़्यादा बार हटाई गई पोस्टिंग हर बार गिनी जाती है", "25 से कम स्कैन वाले हर 10-अंक के स्कोर बैंड को रोक लेते हैं", "तभी बताते हैं जब कम से कम 25 स्कैन का स्कोर 80 या उससे ज़्यादा रहा हो", "अब हटाई गई पोस्टिंग कहती है, जहाँ पहले वह भरी गई या बंद हुई भूमिकाएँ कहती थी"], mustNot: /हर नियोक्ता|हर बोर्ड का अपना|[0-9]{3,}|प्रतिशत/ },
    nl: { must: ["tellen nu alleen borden die we al lazen toen de periode begon", "volgens de eigen 30-dagenregel van het vacaturebord", "noemt zijn 90-dagencijfer sluitingsgebeurtenissen, omdat een vacature die meer dan eens is weggehaald elke keer meetelt", "elke scoreband van 10 punten met minder dan 25 scans achter", "alleen als minstens 25 scans zo hoog scoorden", "spreekt nu van offline gehaalde vacatures, waar die eerst van vervulde of gesloten vacatures sprak"], mustNot: /van elke werkgever|regel van elk|elk effect|\d{3,}|procent/i },
    pt: { must: ["contam só os portais que já estávamos lendo quando o período começou", "pela própria regra de 30 dias do quadro de vagas", "chama o seu número de 90 dias de eventos de encerramento, porque uma vaga retirada mais de uma vez conta a cada vez", "toda faixa de pontuação de 10 pontos com menos de 25 análises", "só informam a parcela com pontuação de 80 ou mais quando pelo menos 25 análises atingiram 80 ou mais", "agora fala em vagas retiradas do ar, onde falava em vagas preenchidas ou fechadas"], mustNot: /de cada empregador|regra de cada|todo efeito|\d{3,}|por cento/i },
    tl: { must: ["ang mga board lang na binabasa na namin noong nagsimula ang panahon", "ayon sa sariling 30-araw na panuntunan ng job board", "tinatawag na nitong mga closure event ang 90-araw na numero nito, dahil ang posting na tinanggal nang higit sa isang beses ay nabibilang sa bawat pagkakataon", "ang bawat 10-puntos na score band na may mas kaunti sa 25 scan", "kapag hindi bababa sa 25 scan ang nakakuha ng ganoong iskor", "mga posting na tinanggal, kung saan dati ay sinasabi nitong mga posisyong napunan o isinara"], mustNot: /bawat employer|panuntunan ng bawat|\d{3,}|porsiyento/i },
  },
  // for example; a count of characters, the rest to add; the résumé's language
  // where it can tell, and moving apart from it; five kinds of claim; up to
  // 20,000 characters; the check cannot catch every one; no letter, no model
  [BUILDER]: {
    de: { must: ["zum Beispiel dass das heutige Importlimit erreicht ist", "sagt sie, wie viele seiner Zeichen importiert wurden, damit du den Rest ergänzen kannst", "wo sie diese erkennen kann; Stellen und Schulen lassen sich nach oben und unten verschieben", "auf Qualifikationsnachweise, Abschlüsse, Arbeitgeber, Jobtitel und Zahlen geprüft, die dein Lebenslauf nicht zeigt", "bis zu 20.000 Zeichen einer Stellenanzeige statt 5.000 und sagt, wenn eine Anzeige länger war", "Die Prüfung sucht nur nach diesen Arten von Behauptungen und kann nicht jede erkennen"], mustNot: /Anschreiben|\bBrief|erfindet nie|garantiert|fehlerfrei|ganze Anzeige|gesamte Anzeige|jeden Lebenslauf|ohne Kürzung|Modell|[$€£]/i },
    es: { must: ["por ejemplo que se alcanzó el límite de importaciones de hoy", "dice cuántos de sus caracteres se importaron, para que puedas añadir el resto", "cuando puede distinguirlo; los empleos y los centros de estudio se pueden subir y bajar", "en busca de certificaciones, títulos académicos, empleadores, puestos y cifras que tu currículum no muestra", "hasta 20.000 caracteres de una oferta de empleo, donde antes leía 5.000, e indica cuando una oferta era más larga", "La comprobación solo busca esos tipos de afirmaciones y no puede detectarlas todas"], mustNot: /carta|nunca inventa|garantiza|sin errores|toda la oferta|oferta completa|cualquier currículum|modelo|[$€£]/i },
    fr: { must: ["par exemple que la limite d'importations du jour est atteinte", "elle indique combien de ses caractères ont été importés, pour que vous puissiez ajouter le reste", "quand il peut la déterminer ; les emplois et les écoles peuvent être déplacés vers le haut ou vers le bas", "les certifications, diplômes, employeurs, intitulés de poste et chiffres que votre CV ne montre pas", "jusqu'à 20 000 caractères d'une offre d'emploi, contre 5 000 auparavant, et signale quand une offre était plus longue", "La vérification ne cherche que ces types d'affirmations et ne peut pas toutes les repérer"], mustNot: /lettre|n'invente jamais|garanti|sans erreur|toute l'offre|offre entière|n'importe quel CV|modèle|[$€£]/i },
    hi: { must: ["जैसे कि आज की इम्पोर्ट सीमा पूरी हो गई है", "वह बताता है कि उसके कितने कैरेक्टर इम्पोर्ट हुए, ताकि आप बाकी जोड़ सकें", "जहाँ वह पहचान पाता है वहाँ रिज़्यूमे की अपनी भाषा में; नौकरियों और स्कूलों को ऊपर-नीचे किया जा सकता है", "ऐसे क्रेडेंशियल, डिग्री, नियोक्ता, जॉब टाइटल और आँकड़ों के लिए जो आपके रिज़्यूमे में नहीं हैं", "अब वह जॉब पोस्टिंग को 20,000 कैरेक्टर तक पढ़ता है, जहाँ पहले 5,000 तक पढ़ता था", "यह जाँच सिर्फ़ इन्हीं तरह के दावों को देखती है और हर एक को नहीं पकड़ सकती"], mustNot: /कवर लेटर|पत्र|गारंटी|पूरी पोस्टिंग|मॉडल|[$€£]/ },
    nl: { must: ["bijvoorbeeld dat de importlimiet van vandaag is bereikt", "zegt ze hoeveel tekens ervan zijn geïmporteerd, zodat je de rest kunt toevoegen", "als die te herkennen is; banen en opleidingen kunnen omhoog en omlaag worden verplaatst", "op kwalificaties, diploma's, werkgevers, functietitels en cijfers die je cv niet laat zien", "Het leest een vacature nu tot 20.000 tekens, waar dat 5.000 was, en zegt het als een vacature langer was", "De controle kijkt alleen naar die soorten claims en kan ze niet allemaal vangen"], mustNot: /brief|verzint nooit|gegarandeerd|foutloos|de hele vacature|elk cv|\bmodel\b|[$€£]/i },
    pt: { must: ["por exemplo, que o limite de importações de hoje foi atingido", "diz quantos caracteres dele foram importados, para que você possa adicionar o resto", "quando consegue identificá-lo; empregos e escolas podem ser movidos para cima e para baixo", "em busca de certificações, diplomas, empregadores, cargos e números que o seu currículo não mostra", "até 20.000 caracteres de uma vaga, em vez dos 5.000 de antes, e avisa quando a vaga era mais longa", "A verificação procura apenas esses tipos de afirmação e não consegue detectar todas"], mustNot: /carta|nunca inventa|garant|sem erros|a vaga inteira|qualquer currículo|modelo|[$€£]/i },
    tl: { must: ["halimbawa na naabot na ang import limit ngayong araw", "sinasabi nito kung ilan sa mga character nito ang na-import, para maidagdag mo ang natitira", "kapag natutukoy nito; maaari nang ilipat pataas at pababa ang mga trabaho at paaralan", "para sa mga credential, degree, employer, job title at numerong hindi ipinapakita ng résumé mo", "hanggang 20,000 character, mula sa dating 5,000, at sinasabi kapag mas mahaba ang posting", "Ang ganitong mga claim lang ang hinahanap ng pagsusuri at hindi nito mahuhuli ang bawat isa"], mustNot: /cover letter|liham|hindi kailanman nag-iimbento|garantisado|buong posting|\bmodel\b|[$€£]/i },
  },
  // a server's own words can still be English; the outage message quoted in
  // English; our side, not your payment; the update screen's own labels; Back
  // or a link; several counts; no provider, file, telemetry, agent or Pro
  [ERRORS]: {
    de: { must: ["doch eine Meldung, die unser Server mit eigenen Worten formuliert, kann weiterhin auf Englisch kommen", "konnte die Meldung „Payment required“ lauten", "dass das Problem bei uns liegt, nicht bei deiner Zahlung", "„Die neue Version wird geladen …“ mit einer Schaltfläche „Jetzt neu laden“", "bringen dich Zurück oder ein Link weiter", "mehrere Zählungen stehen bei eins jetzt im Singular"], mustNot: /jede Meldung|alle Meldungen|alle Zählungen|jede Zählung|Lovable|Gateway|Guthaben|Datei|Suchmaschin|Absturzbericht|Telemetrie|\bPro\b|Agent/i },
    es: { must: ["aunque un mensaje que nuestro servidor redacta con sus propias palabras todavía puede aparecer en inglés", "el mensaje podía decir «Payment required»", "que el problema está de nuestro lado, no en tu pago", "«Cargando la nueva versión…» con un botón «Recargar ahora»", "Atrás o un enlace te permiten seguir", "varios recuentos ahora usan el singular cuando son uno"], mustNot: /todos los mensajes|cada mensaje|todos los recuentos|Lovable|pasarela|créditos|archivo|buscador|informe de errores|telemetría|\bPro\b|agente/i },
    fr: { must: ["même si un message que notre serveur rédige dans ses propres termes peut encore arriver en anglais", "le message pouvait dire « Payment required »", "le problème vient de chez nous, pas de votre paiement", "« Chargement de la nouvelle version… » avec un bouton « Recharger maintenant »", "Retour ou un lien vous permettent de continuer", "plusieurs décomptes passent au singulier pour un"], mustNot: /tous les messages|chaque message|tous les décomptes|Lovable|passerelle|crédits|fichier|moteur de recherche|rapport de plantage|télémétrie|\bPro\b|agent/i },
    hi: { must: ["हालाँकि हमारा सर्वर जो संदेश अपने शब्दों में ख़ुद लिखता है, वह अब भी अंग्रेज़ी में आ सकता है", "संदेश “Payment required” कह सकता था", "समस्या हमारी तरफ़ है, आपके भुगतान में नहीं", "“नया संस्करण लोड हो रहा है…” दिखाते हुए, “अभी फिर से लोड करें” बटन के साथ", "वापस जाने का बटन या कोई लिंक आपको आगे ले जाता है", "कई गिनतियाँ अब एक होने पर एकवचन का इस्तेमाल करती हैं"], mustNot: /हर संदेश|सभी संदेश|सभी गिनतियाँ|Lovable|गेटवे|क्रेडिट|फ़ाइल|सर्च इंजन|टेलीमेट्री|\bPro\b|एजेंट/ },
    nl: { must: ["al kan een melding die onze server in eigen woorden formuleert nog steeds in het Engels komen", "kon de melding ‘Payment required’ zeggen", "dat het probleem bij ons ligt, niet bij je betaling", "met ‘De nieuwe versie wordt geladen…’ en een knop ‘Nu opnieuw laden’", "brengt Terug of een link je verder", "verschillende tellingen gebruiken nu het enkelvoud bij één"], mustNot: /elke melding|alle meldingen|alle tellingen|Lovable|gateway|tegoed|bestand|zoekmachine|crashrapport|telemetrie|\bPro\b|agent/i },
    pt: { must: ["embora uma mensagem que nosso servidor escreve com as próprias palavras ainda possa vir em inglês", "a mensagem podia dizer “Payment required”", "o problema é do nosso lado, não com o seu pagamento", "“Carregando a nova versão…” com um botão “Recarregar agora”", "Voltar ou um link levam você adiante", "várias contagens agora usam o singular quando o número é um"], mustNot: /todas as mensagens|cada mensagem|todas as contagens|Lovable|gateway|créditos|arquivo|buscador|relatório de falhas|telemetria|\bPro\b|agente/i },
    tl: { must: ["bagaman maaari pa ring dumating sa Ingles ang mensaheng isinusulat ng server namin sa sarili nitong mga salita", "maaaring “Payment required” ang sabihin noon ng mensahe", "nasa panig namin ang problema, hindi sa bayad mo", "ipinapakita ang “Nilo-load ang bagong bersyon…” kasama ang button na “I-reload ngayon”", "makakaalis ka roon gamit ang Back o isang link", "gumagamit na ngayon ng isahan ang ilang bilang kapag isa lang"], mustNot: /bawat mensahe|lahat ng mensahe|lahat ng bilang|Lovable|gateway|credits|\bfile\b|search engine|telemetry|\bPro\b|agent/i },
  },
  // asks only when there is work; this device signed out, other devices only
  // for everywhere; paid, open to run, until it has run; the download label
  // with (JSON), and such as; no password, keys, checkout or provider
  [SIGNOUT]: {
    de: { must: ["jetzt fragt das Abmelden zuerst, wenn eines davon etwas enthält", "ist dieses Gerät trotzdem abgemeldet, und die Seite sagt das", "wenn du dich überall abmelden wolltest, sagt sie, dass deine anderen Geräte möglicherweise noch angemeldet sind", "zeigt „Bezahlt: zum Starten öffnen“, bis sie ausgeführt wurde", "„Alle meine Daten herunterladen (JSON)“ enthält jetzt auch Datensätze", "etwa die Dokumente"], mustNot: /jedes Abmelden|fragt immer|anderen Geräte (?:sind|wurden) (?:auch )?abgemeldet|Passwort|Schlüssel|dreißig|Checkout|Webhook|alles|alle Datensätze|[$€£]|Stripe|Supabase|bis du sie öffnest/i },
    es: { must: ["ahora cerrar sesión pregunta primero cuando alguno de los dos contiene algo", "este dispositivo queda igualmente con la sesión cerrada y la página lo indica", "si elegiste cerrar sesión en todas partes, dice que tus otros dispositivos quizá sigan con la sesión iniciada", "dice «Pagado: ábrelo para ejecutarlo» hasta que se haya ejecutado", "«Descargar todos mis datos (JSON)» ahora incluye también registros", "como los documentos"], mustNot: /cada vez que cierras|siempre pregunta|otros dispositivos (?:también )?(?:se cerraron|quedan cerrados)|contraseña|\bclaves?\b|treinta|checkout|webhook|todos los registros|[$€£]|Stripe|Supabase|hasta que lo abras/i },
    fr: { must: ["la déconnexion demande désormais d'abord quand l'un ou l'autre contient quelque chose", "cet appareil est tout de même déconnecté et la page l'indique", "si vous avez choisi de vous déconnecter partout, elle indique que vos autres appareils sont peut-être encore connectés", "affiche « Payé : ouvrez-le pour le lancer » jusqu'à ce qu'elle ait été exécutée", "« Télécharger toutes mes données (JSON) » inclut désormais aussi des enregistrements", "comme les documents"], mustNot: /chaque déconnexion|demande toujours|autres appareils (?:sont|ont été) (?:aussi )?déconnectés|mot de passe|\bclés?\b|trente|webhook|tous les enregistrements|tout ce qui|[$€£]|Stripe|Supabase|jusqu'à ce que vous l'ouvriez/i },
    hi: { must: ["अब जब इनमें से किसी में कुछ होता है तो साइन आउट पहले पूछता है", "यह डिवाइस फिर भी साइन आउट हो जाता है और पेज यह बताता है", "अगर आपने हर जगह से साइन आउट करना चुना था, तो वह बताता है कि आपके दूसरे डिवाइस अब भी साइन इन हो सकते हैं", "तब तक “भुगतान हो गया: चलाने के लिए खोलें” दिखाता है जब तक वह चल नहीं जाता", "“मेरा सारा डेटा डाउनलोड करें (JSON)” में अब वे रिकॉर्ड भी शामिल हैं", "जैसे आपकी ख़रीद के लिए बनाए गए दस्तावेज़"], mustNot: /हर बार साइन आउट|हमेशा पूछता|दूसरे डिवाइस भी साइन आउट|पासवर्ड|कुंजी|तीस|चेकआउट|सभी रिकॉर्ड|[$€£]|Stripe|Supabase|जब तक आप उसे खोल/ },
    nl: { must: ["nu vraagt uitloggen het eerst als een van beide iets bevat", "dan is dit apparaat toch uitgelogd en zegt de pagina dat", "koos je ervoor overal uit te loggen, dan zegt ze dat je andere apparaten mogelijk nog zijn ingelogd", "staat bij een bestelling die je op een eigen pagina start ‘Betaald: open het om te starten’ tot die is uitgevoerd", "‘Al mijn gegevens downloaden (JSON)’ bevat nu ook gegevens", "zoals de documenten"], mustNot: /elke keer dat je uitlogt|vraagt altijd|andere apparaten (?:zijn|werden) (?:ook )?uitgelogd|wachtwoord|sleutel|dertig|checkout|webhook|alles|alle gegevens|[$€£]|Stripe|Supabase|tot je (?:het|haar) opent/i },
    pt: { must: ["agora, sair da conta pergunta antes quando algum deles tem conteúdo", "este dispositivo sai da conta mesmo assim e a página avisa isso", "se você escolheu sair em todos os dispositivos, ela diz que seus outros dispositivos ainda podem estar conectados", "mostra “Pago: abra para executar” até ser executado", "“Transferir todos os meus dados (JSON)” agora também inclui registros", "como os documentos"], mustNot: /sempre pergunta|toda vez que você sai|outros dispositivos (?:também )?(?:saíram|foram desconectados)|senha|\bchaves?\b|trinta|checkout|webhook|\btudo\b|todos os registros|[$€£]|Stripe|Supabase|até você abrir/i },
    tl: { must: ["ngayon ay nagtatanong muna ang pag-sign out kapag may laman ang alinman sa mga ito", "naka-sign out pa rin ang device na ito at sinasabi iyon ng page", "kung pinili mong mag-sign out sa lahat ng device, sinasabi nitong maaaring naka-sign in pa ang iba mo pang device", "nagpapakita ng “Bayad na: buksan para patakbuhin” hanggang sa mapatakbo ito", "Kasama na rin ngayon sa “I-download ang lahat ng data ko (JSON)” ang mga record", "gaya ng mga dokumentong"], mustNot: /palaging nagtatanong|tuwing nag-sign out|naka-sign out na rin ang iba|password|\bsusi\b|tatlumpu|checkout|webhook|lahat ng record|[$€£]|Stripe|Supabase|hanggang buksan mo/i },
  },
  // for example; still unused when busy; a device's browser that still cannot
  // draw it; the page's own cards, buttons and messages; ten and sixty
  [FULL]: {
    de: { must: ["zum Beispiel dass er erstattet wurde, für ein anderes Produkt war oder seine Analyse schon erstellt hat", "dass dein Kauf noch unbenutzt ist", "wenn der Browser eines Geräts sie trotzdem nicht zeichnen kann", "die eigenen Karten, Schaltflächen und Meldungen der Seite", "10 pro Tag und 60 pro Monat"], mustNot: /[$€£]|erneut gesendet|garantiert|jedes (?:Handy|Gerät)|alle Geräte|ganze Analyse|übersetzt|ungeöffnet/i },
    es: { must: ["por ejemplo que se reembolsó, que era de otro producto o que ya generó su análisis", "que tu compra sigue sin usar", "cuando el navegador de un dispositivo sigue sin poder dibujarlo", "las tarjetas, botones y mensajes propios de la página", "10 al día y 60 al mes"], mustNot: /[$€£]|reenvi|garantiza|cada (?:teléfono|dispositivo)|todos los dispositivos|todo el análisis|traducid|sin abrir/i },
    fr: { must: ["par exemple qu'il a été remboursé, qu'il concernait un autre produit ou qu'il a déjà produit son analyse", "que votre achat reste inutilisé", "quand le navigateur d'un appareil ne parvient toujours pas à la dessiner", "les cartes, boutons et messages propres à la page", "10 par jour et 60 par mois"], mustNot: /[$€£]|renvoy|garanti|chaque (?:téléphone|appareil)|tous les appareils|toute l'analyse|tradui|non ouvert/i },
    hi: { must: ["जैसे कि उसका पैसा वापस कर दिया गया, वह किसी दूसरे प्रोडक्ट के लिए थी या वह अपना विश्लेषण पहले ही बना चुकी है", "आपकी ख़रीद अब भी इस्तेमाल नहीं हुई है", "जब किसी डिवाइस का ब्राउज़र उसे फिर भी नहीं बना पाता", "पेज के अपने कार्ड, बटन और संदेश", "रोज़ 10 और महीने में 60"], mustNot: /[$€£]|दोबारा भेज|गारंटी|हर फ़ोन|हर डिवाइस|सभी डिवाइस|पूरा विश्लेषण|अनुवाद/ },
    nl: { must: ["bijvoorbeeld dat de aankoop is terugbetaald, voor een ander product was of haar analyse al heeft gemaakt", "dat je aankoop nog ongebruikt is", "als de browser van een apparaat hem nog steeds niet kan tekenen", "de eigen kaarten, knoppen en meldingen van de pagina", "10 per dag en 60 per maand"], mustNot: /[$€£]|opnieuw verstuurd|gegarandeerd|elke (?:telefoon|apparaat)|alle apparaten|de hele analyse|vertaald|ongeopend/i },
    pt: { must: ["por exemplo, que ela foi reembolsada, era de outro produto ou já gerou a sua análise", "que a sua compra continua sem uso", "quando o navegador de um dispositivo ainda assim não consegue desenhá-la", "os próprios cartões, botões e mensagens da página", "10 por dia e 60 por mês"], mustNot: /[$€£]|reenvi|garant|todo (?:celular|dispositivo)|todos os dispositivos|toda a análise|traduzid|não aberta/i },
    tl: { must: ["halimbawa na na-refund ito, para sa ibang produkto ito o nakagawa na ito ng analysis nito", "na hindi pa nagagamit ang pagbili mo", "kapag hindi pa rin ito maiguhit ng browser ng isang device", "ang sariling mga card, button at mensahe ng page", "10 bawat araw at 60 bawat buwan"], mustNot: /[$€£]|ipinadala ulit|garantisado|bawat phone|bawat device|lahat ng device|buong analysis|isinalin/i },
  },
  // exactly seven more languages; a name may have reached the model;
  // candidates after four years; removal by patterns that can miss
  [SHORTLIST]: {
    de: { must: ["jetzt entfernt es sie auch, wenn sie auf Deutsch, Französisch, Spanisch, Portugiesisch, Niederländisch, Chinesisch oder Japanisch geschrieben sind", "da dieser Name das Modell erreicht haben kann", "Kandidaten, die vier Jahre nach dem Hochladen noch gespeichert sind, werden automatisch gelöscht", "Das Entfernen funktioniert über Muster, sodass eine Angabe, die in Wörtern geschrieben ist, die seine Regeln nicht kennen, das Modell trotzdem erreichen kann"], mustNot: /alle persönlichen|jede persönliche|vorurteilsfrei|Bias|\bfair\b|jede Sprache|allen Sprachen|Hindi|Tagalog|Italienisch|Stellen werden nach vier|Tabelle|Funktion\b|Migration/i },
    es: { must: ["ahora también los elimina cuando están escritos en alemán, francés, español, portugués, neerlandés, chino o japonés", "ya que ese nombre puede haber llegado al modelo", "los candidatos que sigan guardados cuatro años después de subirse se eliminan automáticamente", "La eliminación funciona mediante patrones, así que un dato escrito con palabras que sus reglas no conocen puede seguir llegando al modelo"], mustNot: /todos los datos personales|cualquier dato personal|sin sesgo|imparcial|cualquier idioma|todos los idiomas|hindi|tagalo|italiano|puestos se eliminan tras|tabla|función|migración/i },
    fr: { must: ["il les retire désormais aussi lorsqu'elles sont écrites en allemand, en français, en espagnol, en portugais, en néerlandais, en chinois ou en japonais", "car ce nom a pu parvenir au modèle", "les candidats encore conservés quatre ans après leur téléversement sont supprimés automatiquement", "Le retrait fonctionne par motifs, si bien qu'une donnée écrite avec des mots que ses règles ne connaissent pas peut encore parvenir au modèle"], mustNot: /toutes les données personnelles|toute donnée personnelle|sans biais|impartial|toute langue|toutes les langues|hindi|tagalog|italien|postes sont supprimés après|\btables?\b|\bfonctions?\b|migration/i },
    hi: { must: ["अब वह उसे तब भी हटाता है जब वह जर्मन, फ़्रेंच, स्पेनिश, पुर्तगाली, डच, चीनी या जापानी में लिखी हो", "क्योंकि वह नाम मॉडल तक पहुँचा हो सकता है", "अपलोड होने के चार साल बाद भी रखे गए उम्मीदवार अपने आप हटा दिए जाते हैं", "हटाने का काम पैटर्न के आधार पर होता है, इसलिए ऐसे शब्दों में लिखी जानकारी, जिन्हें इसके नियम नहीं जानते, अब भी मॉडल तक पहुँच सकती है"], mustNot: /सारी निजी|सभी निजी|पूर्वाग्रह|हर भाषा|सभी भाषा|हिंदी|टैगालॉग|इतालवी/ },
    nl: { must: ["nu verwijdert hij ze ook als ze in het Duits, Frans, Spaans, Portugees, Nederlands, Chinees of Japans zijn geschreven", "omdat die naam het model bereikt kan hebben", "kandidaten die vier jaar na het uploaden nog worden bewaard, worden automatisch verwijderd", "Het verwijderen werkt met patronen, dus een gegeven dat is geschreven in woorden die de regels niet kennen, kan het model nog steeds bereiken"], mustNot: /alle persoonsgegevens|elk persoonsgegeven|zonder vooroordeel|bias|elke taal|alle talen|Hindi|Tagalog|Italiaans|functies worden na vier|\btabel|migratie/i },
    pt: { must: ["agora também os remove quando estão escritos em alemão, francês, espanhol, português, holandês, chinês ou japonês", "já que esse nome pode ter chegado ao modelo", "os candidatos ainda guardados quatro anos depois de enviados são excluídos automaticamente", "A remoção funciona por padrões, então um dado escrito com palavras que as regras dela não conhecem ainda pode chegar ao modelo"], mustNot: /todos os dados pessoais|qualquer dado pessoal|sem viés|imparcial|qualquer idioma|todos os idiomas|híndi|tagalo|italiano|vagas são excluídas após|tabela|migração/i },
    tl: { must: ["inaalis na rin nito ngayon ang mga ito kapag nakasulat sa Aleman, Pranses, Espanyol, Portuges, Olandes, Tsino o Hapon", "dahil maaaring nakarating ang pangalang iyon sa model", "awtomatikong binubura ang mga kandidatong nakatabi pa rin apat na taon matapos silang i-upload", "Gumagana ang pag-aalis ayon sa mga pattern, kaya maaari pa ring makarating sa model ang detalyeng nakasulat sa mga salitang hindi alam ng mga panuntunan nito"], mustNot: /lahat ng personal|bawat personal|walang kinikilingan|\bbias\b|bawat wika|lahat ng wika|Tagalog|Italyano|\btable\b|migration/ },
  },
  // several records; cleared at 90 days or stripped of the address; more
  // than one night for the older ones; no internal name, no host's logs
  [NINETY]: {
    de: { must: ["doch mehrere unserer Datensätze, etwa die Protokolle von Scans und von Dateien, die wir nicht lesen konnten", "der diese Datensätze löscht, sobald sie 90 Tage alt sind, oder die IP-Adresse aus denen entfernt, die wir behalten", "daher kann das Löschen mehr als eine Nacht dauern"], mustNot: /alle Protokolle|alle Datensätze|jede IP-Adresse|sofort|auf einmal|Hosting|Tabelle|Migration|Cron|gelöschten Kontos|Connector|\b30\b|Mail-Protokoll/i },
    es: { must: ["pero varios de nuestros registros, como los de escaneos y los de archivos que no pudimos leer", "elimina esos registros cuando cumplen 90 días, o quita la dirección IP de los que conservamos", "así que borrarlas puede llevar más de una noche"], mustNot: /todos los registros|todas las direcciones|cada dirección|de inmediato|de una vez|alojamiento|tabla|migración|cron|cuenta eliminada|conector|\b30\b/i },
    fr: { must: ["mais plusieurs de nos enregistrements, comme les journaux des scans et des fichiers que nous n'avons pas pu lire", "pour supprimer ces enregistrements dès qu'ils ont 90 jours, ou retirer l'adresse IP de ceux que nous gardons", "si bien que leur effacement peut prendre plus d'une nuit"], mustNot: /tous les journaux|tous les enregistrements|chaque adresse|immédiatement|d'un coup|hébergeur|\btables?\b|migration|cron|compte supprimé|connecteur|\b30\b/i },
    hi: { must: ["लेकिन हमारे कई रिकॉर्ड, जैसे स्कैन के लॉग और उन फ़ाइलों के लॉग जिन्हें हम पढ़ नहीं सके", "जो उन रिकॉर्ड को 90 दिन पुराने होते ही मिटा देती है", "इसलिए उन्हें साफ़ करने में एक से ज़्यादा रात लग सकती है"], mustNot: /सभी लॉग|सभी रिकॉर्ड|हर पता|तुरंत|एक साथ|होस्टिंग|टेबल|माइग्रेशन|क्रॉन|कनेक्टर|\b30\b/ },
    nl: { must: ["maar verschillende van onze registraties, zoals de logs van scans en van bestanden die we niet konden lezen", "die die registraties verwijdert zodra ze 90 dagen oud zijn, of het adres verwijdert uit de registraties die we bewaren", "dus het wissen ervan kan meer dan één nacht duren"], mustNot: /alle logs|alle registraties|elk adres|meteen|in één keer|hosting|\btabel|migratie|cron|verwijderd account|connector|\b30\b/i },
    pt: { must: ["mas vários dos nossos registros, como os logs de análises e de arquivos que não conseguimos ler", "apaga esses registros assim que completam 90 dias, ou retira o endereço daqueles que guardamos", "então apagá-los pode levar mais de uma noite"], mustNot: /todos os logs|todos os registros|cada endereço|imediatamente|de uma vez|hospedagem|tabela|migração|cron|conta excluída|conector|\b30\b/i },
    tl: { must: ["pero ilan sa aming mga record, gaya ng mga log ng mga scan at ng mga file na hindi namin nabasa", "nagbubura sa mga record na iyon kapag 90 araw na ang mga ito, o nag-aalis ng address sa mga itinatago namin", "kaya maaaring tumagal nang higit sa isang gabi ang pag-clear sa mga ito"], mustNot: /lahat ng log|lahat ng record|bawat address|agad-agad|minsanan|hosting|\btable\b|migration|cron|connector|\b30\b/i },
  },
};

/** The capitalised words of the company entry's English beyond the employers, the state and the filings read live. Pure. */
const READ_NAMES = new Set(["Some", "Oscar", "Health", "U-Haul", "Affirm", "Hisense", "USA", "These", "H-1B", "H-1B1", "E-3", "When", "Washington's", "Alaska", "Airlines", "And", "SEC", "US"]);
const namedBeyondRead = (d: string) => (d.match(/\b[A-Z][\w'-]*/g) ?? []).filter((w) => !READ_NAMES.has(w));

/** What a language's text of an entry gets wrong against that entry's limits: nothing, for the shipped text. Pure. */
function breaches(id: string, l: Locale, t: Text): string[] {
  const text = `${t.title} ${t.description}`;
  const out: string[] = [];
  if (l === "en" || l === "en-GB") {
    const { must, mustNot } = LIMITS[id];
    for (const m of must) if (!t.description.includes(l === "en" ? m : toGB(m))) out.push(`${l} ${id}: lost "${m}"`);
    for (const [why, re] of mustNot) if (re.test(text)) out.push(`${l} ${id}: states ${why}`);
  } else {
    const { must, mustNot } = LOCAL[id][l];
    for (const m of must) if (!text.includes(m)) out.push(`${l} ${id}: lost "${m}"`);
    if (mustNot.test(text)) out.push(`${l} ${id}: matches ${mustNot}`);
  }
  return out;
}

describe("each entry carries the limits its live read set, in every language", () => {
  it("covers every entry and every language", () => {
    expect(Object.keys(LIMITS).sort()).toEqual([...IDS].sort());
    expect(Object.keys(LOCAL).sort()).toEqual([...IDS].sort());
    for (const id of IDS) expect(Object.keys(LOCAL[id]).sort(), id).toEqual([...OTHERS].sort());
  });

  it.each(IDS)("%s", (id) => {
    for (const l of LOCALES) expect(breaches(id, l, SHARDS[l][id]), l).toEqual([]);
  });

  it("British English is the US text with CV for résumé and two British spellings, and nothing else changed", () => {
    for (const id of IDS) {
      const us = EN[id];
      expect(SHARDS["en-GB"][id], id).toEqual({ title: toGB(us.title), description: toGB(us.description) });
      expect(textOf("en-GB", id), id).not.toMatch(/résumé|resume/i);
    }
    expect(textOf("en", FREE)).toMatch(/practice interview questions/);
    expect(textOf("en-GB", FREE)).toMatch(/practise interview questions/);
    expect(textOf("en-GB", NINETY)).toMatch(/affiliate programme's/);
  });

  it("the data pages' ticker gives a language's word for filled only in the wording it replaced, after the new one", () => {
    const TICKER: Record<Locale, [string, string]> = {
      en: ["postings taken down", "filled"], "en-GB": ["postings taken down", "filled"],
      de: ["entfernten Stellenanzeigen", "besetzten"], es: ["ofertas retiradas", "cubiertos"],
      fr: ["offres retirées", "pourvus"], hi: ["हटाई गई पोस्टिंग कहती", "भरी गई"],
      nl: ["offline gehaalde vacatures", "vervulde"], pt: ["vagas retiradas do ar", "preenchidas"],
      tl: ["mga posting na tinanggal, kung saan", "napunan"],
    };
    for (const l of LOCALES) {
      const d = SHARDS[l][DATA].description;
      const [now, old] = TICKER[l];
      expect(d.split(old).length - 1, `${l}: ${old}`).toBe(1);
      expect(d.indexOf(now), `${l}: ${now}`).toBeGreaterThanOrEqual(0);
      expect(d.indexOf(old), `${l}: the old wording follows the new`).toBeGreaterThan(d.indexOf(now));
    }
  });

  it("the data pages name exactly three pages that say what came from an earlier run", () => {
    const sentence = EN[DATA].description.split(/(?<=\.)\s+/).find((s) => /earlier run/.test(s));
    expect(sentence).toBe("When an hourly recomputation could not finish, the Ghost Job Index, Weekly Hiring Trends and the Pay Transparency Index now say which figures come from an earlier run.");
  });

  it("the sign-out entry names other devices once in each language, in the clause about signing out everywhere", () => {
    const OTHER: Record<Locale, string> = {
      en: "other devices", "en-GB": "other devices", de: "anderen Geräte", es: "otros dispositivos", fr: "autres appareils",
      hi: "दूसरे डिवाइस", nl: "andere apparaten", pt: "outros dispositivos", tl: "iba mo pang device",
    };
    for (const l of LOCALES) expect(SHARDS[l][SIGNOUT].description.split(OTHER[l]).length - 1, l).toBe(1);
  });

  it("the Full Analysis entry's busy sentence keeps the purchase unused and refunds nothing", () => {
    const busy = EN[FULL].description.split(/(?<=\.)\s+/).find((s) => /busy/.test(s)) ?? "";
    expect(busy).toMatch(/still unused/);
    expect(busy).not.toMatch(/refund/i);
  });

  it("the company entry names only the employers and the state read live, in every language", () => {
    const READ = ["Oscar Health", "U-Haul", "Affirm", "Hisense USA", "Alaska Airlines"];
    for (const l of LOCALES) for (const n of READ) expect(SHARDS[l][COMPANY].description, `${l} ${n}`).toContain(n);
    for (const l of ["en", "en-GB"] as const) expect(namedBeyondRead(SHARDS[l][COMPANY].description), l).toEqual([]);
  });

  it("the error entry quotes the old outage message in English in every language: it was English-only when readers saw it", () => {
    for (const l of LOCALES) expect(SHARDS[l][ERRORS].description, l).toMatch(/[“„«‘] ?Payment required ?[”“»’]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TRANSLATION AS REVIEWED. The first 12 hex digits of SHA-256 over
// "<title>\n<description>", per language, in the order of IDS. A change to any
// of them fails here until the new text is read against what production showed
// on 18 November and its hash is written in.
const REVIEWED: Record<Locale, string[]> = {
  en: ["4143c5424f70", "86d29a307ea6", "fff9072dd952", "68814ba5b0cf", "f0f31f151cc4", "4e963d5f70ec", "0cda6dd36ac1", "eb2a426db3d6", "a28b29949362", "c6e1102ef2ae", "471ac8e210dd", "6b5d98ed30a6"],
  "en-GB": ["650346820a93", "c82521673be2", "c3f607a6a6e9", "68814ba5b0cf", "f0f31f151cc4", "4e963d5f70ec", "f5c1fd9e7a78", "eb2a426db3d6", "5f173cfaf2d2", "08138d1db9a8", "d1f26f1b9a22", "90463885fda9"],
  de: ["cc6bb5841736", "7ac3f378e4f3", "4ba8e2876f01", "f07ea75a234f", "cc33475165b3", "e50cddaff936", "bd558daae54d", "4955c52c0b47", "21e928d1e606", "018c85444573", "2168ffb1fb65", "c67a52ba1488"],
  es: ["23473d5e5c04", "78599498a1f4", "f40957460556", "cbdffe103a0b", "bde8c17ca009", "dde959abd6ae", "a590b8efdc55", "e1e0078e8cc5", "73c6f00c778f", "2ba1d4e98a29", "3f7375906903", "a998fb13ebba"],
  fr: ["babfa0f9c988", "147ddfaf433e", "414e2d2ffc21", "7f5580aa6346", "bdeaab8f0fef", "9e9ac3991d12", "a4d1a189b8a8", "2152073d6780", "068bc8651fe7", "0fec7e07596c", "d6b1be5901b8", "2d4d98c0d678"],
  hi: ["e8cab187010d", "a5ff62572d60", "c52af69921c4", "ba3e8d161145", "1a60bc81a34c", "c2023a4fea37", "c874b9fd5469", "dc47c85730e8", "87cab605f92e", "12a4f66cfa41", "4f4b69f6b6f0", "36e67e716ed3"],
  nl: ["1463a1e5fe0a", "58101120c67e", "ca0dc474bda3", "e867ca35143c", "12454a78a3c9", "fd2053d21e8c", "208bca150122", "f70f00af326b", "546b19b13a88", "b392cf731c14", "480774a8f159", "b62fbe6918fd"],
  pt: ["3ee27590c4bb", "ba397e7e00da", "61be1a13a1aa", "cc153cdab973", "df988721af33", "2989b909f6e7", "b3cc51c592f9", "c811412a7bc5", "7be7ef3e1640", "e26a5f50b7e8", "adeea63e7e20", "01c00176b38d"],
  tl: ["37c3cfe70faa", "7e75b2bede9b", "fe83bc5638de", "bb935e6ed93c", "20bd3732b8da", "19d247ce00a5", "40ae7aa8fc7f", "bdcab3a0893c", "02d698aab37a", "a8edd8abec21", "127e00eb2e19", "5fa7e962dd57"],
};
const hash = (t: Text) => createHash("sha256").update(`${t.title}\n${t.description}`).digest("hex").slice(0, 12);

describe("every translation is the text that was reviewed", () => {
  it.each(LOCALES)("%s", (l) => {
    expect(IDS.map((id) => hash(SHARDS[l][id])), `${l}: a reworded entry must be read again against the live read, then its hash updated`).toEqual(REVIEWED[l]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME NUMBERS AND THE LIVE LABELS. Each entry carries the same numbers in
// every language, and those the code holds are the code's. A label quoted in
// quotation marks is the live string in that language, except a string readers
// saw before this deploy, which the site no longer carries.
/** Every number a text writes, with its thousands separator removed. Pure. */
const numbersIn = (s: string) => [...new Set((s.match(/\d{1,3}(?:[.,   ]\d{3})+(?!\d)|\d+/g) ?? []).map((x) => Number(x.replace(/\D/g, ""))))].sort((a, b) => a - b);
const NUMBERS: Record<string, number[]> = {
  [BOARD]: [], [FREE]: [24, 30, 52], [MORE]: [], [ALERTS]: [], [COMPANY]: [1, 3], [DATA]: [10, 24, 25, 30, 80, 90],
  [BUILDER]: [5000, 20000], [ERRORS]: [1], [SIGNOUT]: [], [FULL]: [10, 60], [SHORTLIST]: [], [NINETY]: [90, 180],
};

const flat = (o: unknown, out: string[] = []): string[] => {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const v of Object.values(o)) flat(v, out);
  return out;
};
/** Every UI string a language's site carries: its locale file, its own folders and its shards, never the changelog. */
function liveStrings(l: Locale): string[] {
  const files = [`src/i18n/locales/${l}.json`];
  for (const d of readdirSync(resolve(ROOT, "src/i18n"))) {
    if (d === "changelog" || d === "locales") continue;
    if (existsSync(resolve(ROOT, `src/i18n/${d}/${l}.json`))) files.push(`src/i18n/${d}/${l}.json`);
    if (d === "shards") for (const s of readdirSync(resolve(ROOT, "src/i18n/shards"))) if (existsSync(resolve(ROOT, `src/i18n/shards/${s}/${l}.json`))) files.push(`src/i18n/shards/${s}/${l}.json`);
  }
  return files.flatMap((f) => flat(JSON.parse(source(f))));
}
const LIVE = Object.fromEntries(LOCALES.map((l) => [l, liveStrings(l)])) as Record<Locale, string[]>;
const QUOTE = /“([^”]+)”|„([^“]+)“|«\s?([^»]+?)\s?»|‘([^’]+)’/g;
/** Strings readers saw before this deploy, quoted as what changed; the site no longer carries them in that language. */
const BEFORE: Partial<Record<Locale, string[]>> = {
  de: ["Payment required"], es: ["Payment required", "puestos cubiertos o cerrados"], fr: ["Payment required", "postes pourvus ou fermés"],
  hi: ["Payment required"], nl: ["Payment required"], pt: ["Payment required"], tl: ["Payment required", "1 mga isyu ang natuklasan"],
};
/** Each quote in a text that is neither a live string of its language nor one it carried before. Pure over LIVE. */
function unreadQuotes(l: Locale, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTE)) {
    const q = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    const counted = q.replace(/^1 /, "{{count}} ");
    if (BEFORE[l]?.includes(q)) continue;
    if (!LIVE[l].some((s) => s.includes(q) || s.includes(counted))) out.push(q);
  }
  return out;
}

describe("the same numbers and the live labels in every language", () => {
  it.each(IDS)("%s carries the same numbers in every language", (id) => {
    for (const l of LOCALES) expect(numbersIn(textOf(l, id)), l).toEqual(NUMBERS[id]);
  });

  it("every quoted label is the live string in that language", () => {
    for (const { where, l, text } of texts()) expect(unreadQuotes(l, text), where).toEqual([]);
  });

  it("a string quoted as what readers saw before is one the site no longer carries in that language", () => {
    for (const [l, before] of Object.entries(BEFORE) as Array<[Locale, string[]]>) {
      for (const q of before) {
        expect(LIVE[l].some((s) => s.includes(q)), `${l} still carries ${q}`).toBe(false);
        expect(IDS.some((id) => textOf(l, id).includes(q)), `${l} quotes ${q}`).toBe(true);
      }
    }
  });
});

describe("what the entries name is what the code holds", () => {
  it("the free scan's list offers 52 countries, the CV standards pages cover four more, and a kept report lives 30 minutes in the tab", () => {
    const markets = source("src/config/scan-markets.ts");
    const list = /const MARKETS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(markets)?.[1] ?? "";
    const codes = [...list.matchAll(/\["([A-Z]{2})",/g)].map((m) => m[1]);
    expect(codes).toHaveLength(52);
    const slugs = /export const COUNTRY_SLUGS[^{]*\{([\s\S]*?)\n\};/.exec(source("src/data/cv-standards-content.ts"))?.[1] ?? "";
    const pages = [...slugs.matchAll(/\b([A-Z]{2}):\s*"/g)].map((m) => m[1]);
    expect(pages).toHaveLength(56);
    expect(pages.filter((c) => !codes.includes(c)).sort(), "the pages that open the scan on auto-detect").toEqual(["BH", "KW", "OM", "QA"]);
    const index = source("src/pages/Index.tsx");
    expect(index).toMatch(/const PENDING_REPORT_MAX_MS = 30 \* 60 \* 1000;/);
    expect(index).toMatch(/sessionStorage\.setItem\(PENDING_REPORT_KEY/);
  });

  it("only the backup scanner's hourly refusal names a time; the main scanner's reads as refused, not a spent day", () => {
    expect(source("src/hooks/use-streaming-scan.ts")).toMatch(/if \(parsed\.code === 'rate_limited_budget'\) \{[\s\S]{0,200}retryAfterSeconds/);
    expect(source("src/lib/resilient-edge-function.ts")).toMatch(/body\?\.rateLimited === true && body\?\.code !== 'rate_limited_budget'\) return 'daily_limit';/);
  });

  it("the no-text notice carries a count of pages, not which", () => {
    expect(source("src/lib/parse-failure-copy.ts")).toMatch(/const pages = typeof data\.skippedPages === "number" \? data\.skippedPages : 0;/);
  });

  it("the tailor reads a posting up to 20,000 characters and says when it was cut", () => {
    expect(source("supabase/functions/_shared/input-limits.ts")).toMatch(/export const MAX_JOB_DESCRIPTION_LENGTH = 20_000;/);
    const tailor = source("supabase/functions/generate-tailored-resume/index.ts");
    expect(tailor).toMatch(/postingTruncated = !!jobDescription && jobDescription\.length > MAX_JOB_DESCRIPTION_LENGTH/);
    expect(tailor).toMatch(/jobDescription\.slice\(0, MAX_JOB_DESCRIPTION_LENGTH\)/);
  });

  it("the Pro limit is the one the pricing strings serve", () => {
    const pricing = JSON.parse(source("src/i18n/shards/payments/en.json")) as Record<string, Record<string, string>>;
    expect(flat(pricing)).toContain("Up to 10 Full Analyses a day and 60 a month");
  });

  it("the benchmark floor is 25 scans for a band and for the share at 80 or more", () => {
    const sql = source("supabase/migrations/20261112195000_the_scan_floor_covers_every_band.sql");
    expect(sql).toMatch(/having count\(\*\) >= 25/);
    expect(sql).toMatch(/'pct_80_plus', case when n > 0 and n_80_plus >= 25 then/);
  });

  it("an order run on its own page reads open to run until it has run, and the old fix-plan button opens a page that says no emails follow", () => {
    expect(source("supabase/functions/get-account-data/index.ts")).toMatch(/if \(s === "email_failed"\) return runsOnItsPage \? "open_to_run" : "ready";/);
    expect(flat(JSON.parse(source("src/i18n/shards/account/en.json")))).toContain("Paid: open it to run");
    expect(source("src/pages/FixPlanConfirm.tsx")).toMatch(/mailPrefs\.fixPlanWithdrawn"/);
    expect(flat(JSON.parse(source("src/i18n/shards/mail/en.json"))).join(" ")).toMatch(/no emails will follow/);
  });

  it("Shortlist's labelled fields are read in the seven languages the entry names, and candidates go after four years", () => {
    const redaction = source("supabase/functions/shortlist-evaluate/redaction.ts");
    // A date-of-birth label and an age label in German, French, Spanish,
    // Portuguese, Dutch, Chinese and Japanese.
    for (const label of ["geburtsdatum", "date de naissance", "fecha de nacimiento", "data de nascimento", "geboortedatum", "出生日期", "生年月日"]) expect(redaction, label).toContain(`"${label}"`);
    for (const label of ["alter", "âge", "edad", "idade", "leeftijd", "年龄", "年齢"]) expect(redaction, label).toContain(`"${label}"`);
    expect(source("supabase/migrations/20261112211000_an_employer_deletes_a_shortlist_candidate_or_role_and_what_is_four_years_old_is_deleted.sql")).toMatch(/v_cut timestamptz := p_now - interval '4 years';/);
  });

  it("the nightly clears at 90 days in batches, and the Privacy page keeps searches 180 days", () => {
    const sql = source("supabase/migrations/20261112100000_a_log_keeps_no_address_past_ninety_days.sql");
    expect(sql).toMatch(/v_cutoff timestamptz := now\(\) - interval '90 days';/);
    expect(sql).toMatch(/v_batch constant integer := \d+;/);
    expect(source("src/pages/Privacy.tsx")).toMatch(/are kept for 180 days with no account, address or visitor id attached, then only as daily totals/);
  });
});

describe("nothing an entry says is ours alone to know", () => {
  const REFUSED: Array<[string, RegExp]> = [
    ["an audit id", /\b(?:S\d{1,2}X?|NB)-\d{1,3}\b/],
    ["an internal name", /job-board\.|x-fn-build|drizzle|pg_cron|\bcron\b|\bRPC\b|\bMCP\b|\bslices?\b|migration|edge function|prerender|x-rb-|rate_limited|open_to_run|skippedPages|sessionStorage|scan_metrics|parse_failures|get-account-data|tailored-resume|free-keyword-scan|shortlist-evaluate/i],
    ["a vendor and token", /\b[a-z]+:[a-z0-9~_-]+\b/],
    ["a hiring system's name", /Workable|Recruitee|Pinpoint|Workday|Greenhouse|\bLever\b|Ashby|Teamtailor|SmartRecruiters|iCIMS|Oracle|Phenom|Breezy|Paylocity|UKG/],
    ["a commit or migration id", /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\b20\d{12}\b/],
    ["a price or a retired product", /[$€£]\s?\d|\bUSD\b|Premium|Apply Assistant|applies for you|apply for you|Agent Pass/i],
    ["an AI host seekers are not shown", /Cursor|Copilot|Gemini|Windsurf|Perplexity|VS Code|OpenAI|Anthropic|\bGPT/i],
    ["a provider the pages do not name", /Lovable|Stripe|Supabase|Postgres|Cloudflare/i],
    ["a cover letter, in any language", /cover letter|Anschreiben|carta de presentación|lettre de motivation|कवर लेटर|sollicitatiebrief|motivatiebrief|carta de apresentação|\bliham\b/i],
    ["a claim that we send applications", /we (?:send|submit) (?:your )?applications?/i],
  ];
  it.each(REFUSED)("no entry states %s", (_why, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => textOf("pt", id)).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|separador|utilizador|\bestá a [a-z]+r\b|«|»/i);
    expect(pt).toMatch(/você/);
    expect(pt).toMatch(/\baba do navegador\b/);
  });

  it("the Hindi is in Devanagari", () => {
    for (const id of IDS) expect(textOf("hi", id), id).toMatch(/[ऀ-ॿ]{3}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEETH. The checks above pass the shipped text; each case here rewrites one
// entry into a claim the live read did not hold, and a check names it.
describe("the checks catch an overclaim", () => {
  const swap = (l: Locale, id: string, from: string | RegExp, to: string): Text => {
    const t = SHARDS[l][id];
    const description = t.description.replace(from, to);
    expect(description, `${l} ${id}: the rewrite applies`).not.toBe(t.description);
    return { ...t, description };
  };

  it("the free scan's old copy said a CV could not be processed at all, or the report came back anywhere", () => {
    expect(breaches(FREE, "en", swap("en", FREE, "many employers could not process a CV", "a CV could not be processed"))).not.toEqual([]);
    expect(breaches(FREE, "en", swap("en", FREE, "in that browser tab, for up to 30 minutes", "on any device"))).not.toEqual([]);
    expect(breaches(FREE, "en", swap("en", FREE, "When our backup scanner turns", "When our main scanner turns"))).not.toEqual([]);
    expect(breaches(FREE, "de", swap("de", FREE, "viele Arbeitgeber könnten einen Lebenslauf", "ein Lebenslauf könne"))).not.toEqual([]);
  });

  it("the no-text notice names which pages, or the account page names a date", () => {
    expect(breaches(MORE, "en", swap("en", MORE, "how many pages had no text", "which pages had no text"))).not.toEqual([]);
    expect(breaches(MORE, "fr", swap("fr", MORE, "combien de pages n'avaient pas de texte", "quelles pages n'avaient pas de texte"))).not.toEqual([]);
    expect(breaches(ALERTS, "en", swap("en", ALERTS, "now says so and why", "now says the date we stopped and why"))).not.toEqual([]);
  });

  it("the old fix-plan button itself says so, or the fix-plan emails were never sent", () => {
    expect(breaches(ALERTS, "en", swap("en", ALERTS, "the button in an older report now opens a page that says no emails will follow", "the button in an older report now says no emails will follow"))).not.toEqual([]);
    expect(breaches(ALERTS, "en", swap("en", ALERTS, "which were not being sent", "which were never sent"))).not.toEqual([]);
    expect(breaches(ALERTS, "nl", swap("nl", ALERTS, "die niet werden verstuurd", "die nooit verstuurd zijn"))).not.toEqual([]);
  });

  it("an order clears when its page is opened, or other devices were signed out", () => {
    expect(breaches(SIGNOUT, "en", swap("en", SIGNOUT, "until it has run", "until you open it"))).not.toEqual([]);
    expect(breaches(SIGNOUT, "en", swap("en", SIGNOUT, "your other devices may still be signed in", "your other devices were signed out"))).not.toEqual([]);
    expect(breaches(SIGNOUT, "es", swap("es", SIGNOUT, "hasta que se haya ejecutado", "hasta que lo abras"))).not.toEqual([]);
  });

  it("the ticker calls a takedown a fill, a company is named that was not read, or every filing is right", () => {
    expect(breaches(DATA, "en", swap("en", DATA, "now says postings taken down", "now says roles filled"))).not.toEqual([]);
    expect(breaches(COMPANY, "en", swap("en", COMPANY, "those we found are removed", "every wage filing is now correct"))).not.toEqual([]);
    expect(namedBeyondRead(swap("en", COMPANY, "Oscar Health, U-Haul and Affirm", "Oscar Health, U-Haul, Affirm and Walmart").description)).toEqual(["Walmart"]);
    expect(breaches(COMPANY, "pt", swap("pt", COMPANY, "os que encontramos foram removidos", "todos foram removidos"))).not.toEqual([]);
  });

  it("the tailored résumé never invents, the whole posting is read, or Shortlist reads every language", () => {
    expect(breaches(BUILDER, "en", swap("en", BUILDER, "The check looks only for those kinds of claims and cannot catch every one", "The tailored résumé never invents a claim"))).not.toEqual([]);
    expect(breaches(BUILDER, "en", swap("en", BUILDER, "up to 20,000 characters", "the whole posting"))).not.toEqual([]);
    expect(breaches(SHORTLIST, "en", swap("en", SHORTLIST, "Chinese or Japanese", "Chinese, Japanese, Hindi or Tagalog"))).not.toEqual([]);
    expect(breaches(SHORTLIST, "hi", swap("hi", SHORTLIST, "चीनी या जापानी", "चीनी, जापानी या हिंदी"))).not.toEqual([]);
  });

  it("every log is cleared at once, every message is translated, or the busy service refunds", () => {
    expect(breaches(NINETY, "en", swap("en", NINETY, "several of our records", "all our logs"))).not.toEqual([]);
    expect(breaches(NINETY, "en", swap("en", NINETY, "so clearing them can take more than one night", "and are cleared at once"))).not.toEqual([]);
    expect(breaches(ERRORS, "en", swap("en", ERRORS, "several counts", "all counts"))).not.toEqual([]);
    expect(breaches(FULL, "en", swap("en", FULL, "that your purchase is still unused", "that your purchase was refunded"))).not.toEqual([]);
    expect(breaches(BOARD, "tl", swap("tl", BOARD, "sa loob ng isang oras", "sa ibang device"))).not.toEqual([]);
  });

  it("a translation with a number English does not carry, or a quoted label the site does not have, fails", () => {
    expect(numbersIn(swap("de", FREE, "52 Länder", "56 Länder").description)).not.toEqual(NUMBERS[FREE]);
    expect(numbersIn(swap("fr", FULL, "10 par jour", "15 par jour").description)).not.toEqual(NUMBERS[FULL]);
    expect(unreadQuotes("es", swap("es", SIGNOUT, "«Descargar todos mis datos (JSON)»", "«Exportar mi cuenta entera»").description)).toContain("Exportar mi cuenta entera");
    expect(unreadQuotes("pt", swap("pt", ERRORS, "“Recarregar agora”", "“Recarregar a página agora”").description)).toContain("Recarregar a página agora");
    expect(unreadQuotes("en", swap("en", SIGNOUT, "“Paid: open it to run”", "“Paid: ready to run”").description)).toContain("Paid: ready to run");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 52g, run in bash against a fake curl that answers from a route table
// and logs every call, as the 17 November test runs section 52f.
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
const TAG_LABEL: Record<string, string> = { new: "New", improved: "Improved", fixed: "Fixed" };
type Row = { date: string; title: string; tags?: string[] };
const article = (r: Row) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${r.date} · ${(r.tags ?? ["fixed"]).map((t) => TAG_LABEL[t]).join(" · ")}</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(r.title)}</h2><p class="text-xs text-muted-foreground">x</p></article>`;
/** The bake's clamp: a description over 160 characters is cut at a word and ends in an ellipsis. */
const clamp160 = (d: string) => (d.length > 160 ? d.slice(0, 157).replace(/\s+\S*$/, "") + "…" : d);
/** The crawler /changelog as the bake writes it, from rows newest first, its description clamped as the bake clamps it. */
const crawler = (rows: Row[]) => `<html><head><meta name="description" content="${esc(clamp160(`What changed and when, newest first — including honest postmortems. Latest (${rows[0]?.date}): ${rows[0]?.title ?? ""}.`))}"></head><body><main><h1>Changelog</h1><div class="space-y-4">${rows.map(article).join("")}</div></main></body></html>`;
const rowsOf = (from: number, to: number): Row[] => changelog.slice(from, to).map((e) => ({ date: e.date, title: EN[e.id].title, tags: e.tags }));
/** The page this batch published: the twelve on top of the 18 entries before them. */
const PUBLISHED_PAGE = crawler(rowsOf(AT, AT + 30));
/** The page before the publish: the 30 entries before the twelve. */
const BEFORE_PAGE = crawler(rowsOf(AT + IDS.length, AT + IDS.length + 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(EN);
/** The strings before the publish: neither the twelve nor anything newer than them. */
const NOT_YET = new Set(changelog.slice(0, AT + IDS.length).map((e) => e.id));
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => !NOT_YET.has(k))));
/** The other eight languages: each has its changelog chunk and, as the live entry does, another chunk of its name without it. */
const LANGS = ["en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const clChunk = (l: string) => `${l}-${l.replace("-", "").toUpperCase()}CL0001.js`;
const otherChunk = (l: string) => `${l}-${l.replace("-", "").toUpperCase()}MN0001.js`;
const ENTRY = `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),${LANGS.map((l) => `()=>import("./${otherChunk(l)}"),()=>import("./${clChunk(l)}")`).join(",")}];export{lazy as a};`;
const filler = (n: number, date: string, what: string): Row[] => Array.from({ length: n }, (_, i) => ({ date, title: `${what} ${i}` }));

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: { changelog?: string; chunk?: string; langs?: Partial<Record<string, string>> } = {}): { lines: string[]; calls: string[]; env: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52g-"));
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
  // The shared names every later section reads are printed after the section,
  // so a section that overwrote one shows it.
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; RB=rb_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n` + text.split("/tmp/").join(`${dir}/`) + `\nprintf '%s|%s|%s|%s|%s\\n' "$K" "$RB" "$B" "$SITE" "$UA" > "${dir}/env.out"\n`);
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const env = existsSync(join(dir, "env.out")) ? readFileSync(join(dir, "env.out"), "utf8").trim() : "";
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), env };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const S52G = "52g-changelog-nov-18.sh";
const sectionText = () => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52G), "utf8");
/** The string section 52g requires in each entry's US description, as its VD52G_MUST list names it. */
const MUSTS = (/<<'VD52G_MUST'\n([\s\S]*?)\nVD52G_MUST/.exec(sectionText())?.[1].split("\n") ?? [])
  .map((x) => ({ id: x.split("|")[0], must: x.split("|").slice(1).join("|") }));
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;
const LATEST_OK = `PASS  /changelog's description names an entry of 2026-11-18 as the newest, no older than this batch's 2026-11-18`;

describe("section 52g judges the twelve entries on the crawler page", () => {
  it("lists exactly their titles, in order, each with the date their deploy went live", () => {
    const listed = /<<'VD52G_TITLES'\n([\s\S]*?)\nVD52G_TITLES/.exec(sectionText())?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("lists one string per entry that holds the limit its live read set, each in that entry's description and found once in the whole US shard", () => {
    const listed = /<<'VD52G_MUST'\n([\s\S]*?)\nVD52G_MUST/.exec(sectionText())?.[1].split("\n") ?? [];
    expect(listed.map((x) => x.split("|")[0])).toEqual(IDS);
    const whole = readFileSync(resolve(ROOT, "src/i18n/changelog/en.json"), "utf8");
    for (const [id, m] of listed.map((x) => x.split("|"))) {
      expect(EN[id].description, id).toContain(m);
      expect(whole.split(m).length - 1, `${m} is found once in the US shard`).toBe(1);
      expect(m, `${m} holds no quote mark the bundle might escape`).not.toMatch(/['"‘’“”]/);
      expect(m, `${m} is plain ASCII, which the bundle never escapes`).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(MUSTS.find((x) => x.id === FREE)?.must, "the free-scan line ties the hourly message to the backup scanner").toMatch(/backup scanner/);
    expect(MUSTS.find((x) => x.id === ALERTS)?.must, "the alerts line keeps that the page must first check the address").toMatch(/once the page can check/);
    expect(MUSTS.find((x) => x.id === NINETY)?.must, "the 90-day line keeps the more-than-one-night limit").toMatch(/more than one night/);
  });

  it("the bake clamps the page's description at 160 characters and cuts this batch's first title, and the date it reads comes before the cut", () => {
    const content = /<meta name="description" content="([^"]*)"/.exec(PUBLISHED_PAGE)?.[1] ?? "";
    expect(content.length).toBeLessThanOrEqual(160);
    expect(content).toMatch(/…$/);
    expect(content).not.toContain(esc(EN[BOARD].title));
    expect(content).toContain(`Latest (${DATE}): `);
  });

  it("before the publish every line is INFO, and only GETs are sent, never to the British chunk or another language's", () => {
    const { lines, calls } = run(S52G, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 18 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines, show(lines)).toContain("INFO  the other eight languages' changelog strings are judged after the publish");
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
    for (const l of LANGS) expect(calls.some((c) => c.includes(`/assets/${l}-`)), l).toBe(false);
  });

  it("after the publish each title passes on the crawler page with its date, each description and each language passes, and the clamped description still names an entry of 18 November as newest", () => {
    const { lines } = run(S52G);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    for (const { id, must } of MUSTS) expect(lines, show(lines)).toContain(`PASS  the US English changelog strings describe ${id} with "${must}"`);
    for (const l of LANGS) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry all twelve 18 November entries`);
    expect(lines, show(lines)).toContain(LATEST_OK);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("leaves the key, the project, the site and the user agent every later section reads as it found them", () => {
    for (const r of [run(S52G), run(S52G, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED })]) {
      expect(r.env, show(r.lines)).toBe("pk_test|rb_test|https://p.supabase.co|https://site.test|ua");
    }
  });

  it("a description reworded under the same title FAILs, though its title passes", () => {
    const signout = MUSTS.find((x) => x.id === SIGNOUT)!;
    const reworded = { ...EN, [SIGNOUT]: { ...EN[SIGNOUT], description: EN[SIGNOUT].description.replace(signout.must, "your other devices were signed out too") } };
    const { lines } = run(S52G, { chunk: chunkOf(reworded) });
    expect(fails(lines), show(lines)).toEqual([`FAIL  the US English changelog strings carry no "${signout.must}" for ${SIGNOUT}: its description is not the one read live on 18 November`]);
    expect(lines, show(lines)).toContain(onPage(TITLES[8]));
  });

  it("a language whose chunk lacks an entry FAILs, and so does a language the entry names no changelog chunk for", () => {
    const de = chunkOf(Object.fromEntries(Object.entries(SHARDS.de).filter(([k]) => k !== FREE && k !== NINETY)));
    const { lines } = run(S52G, { langs: { de, nl: `const s={header:{jobs:"x"}};export{s as default};` } });
    expect(fails(lines), show(lines)).toEqual([
      `FAIL  the de changelog strings (${clChunk("de")}) lack ${FREE} ${NINETY}: the publish did not ship the 18 November entries in de`,
      "FAIL  no nl changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 18 November entries cannot be shown in nl",
    ]);
    for (const l of LANGS.filter((x) => x !== "de" && x !== "nl")) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry all twelve 18 November entries`);
  });

  it("a wrong date FAILs", () => {
    const moved = crawler(rowsOf(AT, AT + 30).map((r) => (r.title === TITLES[3].title ? { ...r, date: "2026-11-17" } : r)));
    const { lines } = run(S52G, { changelog: moved });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog dates "${TITLES[3].title}" 2026-11-17, want 2026-11-18, the day its deploy went live`]);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52G, { changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[6].title)) }).lines;
    expect(lost, show(lost)).toContain(notRebuilt(TITLES[6]));
    const without = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== IDS[11])));
    const gone = run(S52G, { chunk: without, changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[11].title)) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 18 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[11].title}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not, title or description", () => {
    const pushed = run(S52G, { changelog: crawler(filler(30, "2026-12-01", "A newer entry")) }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(pastPage(t));
    const stale = run(S52G, { changelog: BEFORE_PAGE }).lines;
    for (const t of TITLES) expect(stale, show(stale)).toContain(notRebuilt(t));
    expect(stale, show(stale)).toContain(`FAIL  /changelog's description names an entry of 2026-11-17 as the newest, older than this batch's 2026-11-18 (the prerender did not rebuild)`);
  });

  it("thirty entries older than the batch cannot have pushed it off, nor can fewer than thirty newer ones: FAIL", () => {
    const older = run(S52G, { changelog: crawler(filler(30, "2026-11-17", "An entry of 17 November")) }).lines;
    for (const t of TITLES) expect(older, show(older)).toContain(notRebuilt(t));
    const few = run(S52G, { changelog: crawler(filler(29, "2026-12-01", "A newer entry")) }).lines;
    for (const t of TITLES) expect(few, show(few)).toContain(notRebuilt(t));
  });

  it("a description the bake left on an older newest entry FAILs, though every title is listed", () => {
    const page = PUBLISHED_PAGE.replace(/Latest \(2026-11-18\): [^"]*/, `Latest (2026-11-17): ${esc(EN.aResumeInAnotherLanguageIsNoLongerScoredAsEnglish.title)}.`);
    expect(page).not.toBe(PUBLISHED_PAGE);
    const { lines } = run(S52G, { changelog: page });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog's description names an entry of 2026-11-17 as the newest, older than this batch's 2026-11-18 (the prerender did not rebuild)`]);
    const none = run(S52G, { changelog: PUBLISHED_PAGE.replace(/Latest \([^"]*/, "No entries yet.") }).lines;
    expect(none.some((l) => /^FAIL {2}\/changelog's description names no newest entry/.test(l)), show(none)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52G, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL {2}no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
