// @vitest-environment node
/**
 * THE CHANGELOG OF 21 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Five entries for main at 4a3c2a0bd, which went live and verified on 21
 * November carrying bug round B (PR #67) and job-board 2026-09-09.103 (PR
 * #71). Internal fixes (the owner dashboards, the crash log, CI, the ledger and
 * verifier, the closure rollup, the field curve, the scanner's model chain, the
 * catalogue's pruned boards) have no entry, nor has anything production would
 * not show that day: Greenhouse's stated pay (no row of the new build carried
 * it yet), the board's lap, the scan-report mails, Shortlist's planted
 * instructions in other languages, Illinois notices, the affiliate approval
 * job. Every claim was read against production that day, read-only: job-board's
 * preflight build and the verify run's search-reach PASS lines,
 * get_company_intel by GET for each employer, the published entry and the
 * chunks it names, the crawler copies of the two Austria pages, and the nine
 * banner files. No sign-in, purchase, scan, model call or mail. The limits each
 * read set are held here, entry by entry:
 *   - board search: the spellings are one word in a search for a software
 *     role, never in every search; developer finds engineer there, and nothing
 *     says engineer finds developer (the verify run read only the first); the
 *     six employers by name, read from the hiring system each posts on, with
 *     no count, no sector and no hiring system named;
 *   - company pages: the countries line and the Pay median say so where a
 *     figure counts the whole hiring system; a board with no name is headed by
 *     its system or as this board; the hiring badge on a pooled page names its
 *     board; the German Austria page says what the English one says and no
 *     longer that Zeugnisse are expected. No employer, system or other country;
 *   - language: counts and dates on the pages read in the reader's language,
 *     the release notes on a switch, the skip link once the site has loaded,
 *     the title read out and focus moved only when the link went away with the
 *     old page; never every page or always;
 *   - uploads: a Unicode .txt read wherever a résumé is uploaded; the refusal
 *     in the reader's language only on the free scan and the page after a
 *     purchase; the report's one label; progress screens that name no model,
 *     the paid one in the reader's language. No other file type, no Shortlist,
 *     no AI named;
 *   - affiliate banners: the size the label states, PNG and SVG, a fixed
 *     address; the old address still loads; the newsletter says what the scan
 *     shows. No size in figures, no commission, no ATS.
 * In every language: no number, no quotation mark, no internal name, no AI
 * product, Portuguese that is Brazilian, Hindi in Devanagari. British English
 * is the US text with CV for résumé, each other language carries its own words
 * for the limits above, and every translation is pinned by a hash of its
 * reviewed text.
 *
 * Section 52i of the verifier judges the five on the crawler copy of
 * /changelog once the frontend publish carries them, as 52h does for 19
 * November, and judges what each claims on production at once. Every sentence
 * of each English description carries a claim 52i's VD52I_CLAIMS names, and
 * every claim there has a check that can FAIL. It runs here in bash against a
 * fake curl.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { changelog } from "../data/changelog";
import { joinCompoundRoleWords, roleAliasesFor, roleSwapApplies } from "../../supabase/functions/job-board/search-alias";
import { ROUTE_ANNOUNCER_ID, SHELL_SKIP_LINK } from "../lib/skip-link";
import { CV_LOCALES } from "../data/cv-standards-content";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const SHARDS = Object.fromEntries(LOCALES.map((l) => [l, shard(l)])) as Record<Locale, Record<string, Text>>;
const source = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(source(p)) as Record<string, unknown>;
const locale = (l: string) => json(`src/i18n/locales/${l}.json`) as Record<string, Record<string, unknown>>;
const companyShard = (l: string) => (json(`src/i18n/shards/company/${l}.json`) as { companyProfile: Record<string, unknown> }).companyProfile;

const BOARD = "boardSearchesReadBothSpellingsAndListMoreEmployers";
const COMPANY = "companyPagesSayWhenAFigureCountsAWholeHiringSystem";
const LANG = "figuresDatesReleaseNotesAndSkipLinkFollowYourLanguage";
const TXT = "aUnicodeTxtResumeIsReadWhereverYouUploadOne";
const AFF = "affiliateBannersAreTheSizeTheirLabelsSay";
const DATE = "2026-11-21";

/** Newest first, as changelog.ts lists them, with the tags each claims. */
const ENTRIES: Array<{ id: string; date: string; tags: string[] }> = [
  { id: BOARD, date: DATE, tags: ["new", "improved"] },
  { id: COMPANY, date: DATE, tags: ["fixed"] },
  { id: LANG, date: DATE, tags: ["fixed", "improved"] },
  { id: TXT, date: DATE, tags: ["fixed"] },
  { id: AFF, date: DATE, tags: ["fixed"] },
];
const IDS = ENTRIES.map((e) => e.id);
const AT = changelog.findIndex((e) => e.id === IDS[0]);
const EN = SHARDS.en;
const textOf = (l: Locale, id: string) => `${SHARDS[l][id].title} ${SHARDS[l][id].description}`;
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: textOf(l, id) })));

describe("the five entries", () => {
  it("sit together, newest first, dated the day their deploy went live, with nothing older above them and the 19 November entries next", () => {
    expect(AT, `${IDS[0]} is missing from changelog.ts`).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(AT, AT + ENTRIES.length)).toEqual(ENTRIES);
    for (const e of changelog.slice(0, AT)) expect(e.date >= DATE, `${e.id} (${e.date}) sits above the 21 November entries but is older`).toBe(true);
    expect(changelog[AT + ENTRIES.length].id, "the 19 November entries come next").toBe("addToClaudeOpensClaudesConnectorDialogFilledIn");
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

  it("each shard lists them in this order right after the 19 November entries, with only newer batches after them", () => {
    const later = new Set(changelog.slice(0, AT).map((e) => e.id));
    for (const l of LOCALES) {
      const keys = Object.keys(SHARDS[l]);
      const at = keys.indexOf(IDS[0]);
      expect(keys.slice(at, at + IDS.length), l).toEqual(IDS);
      expect(keys[at - 1], l).toBe("ashbyApplicationFormsAreNoLongerReadOrAskedFor");
      for (const k of keys.slice(at + IDS.length)) expect(later.has(k), `${l}: ${k} follows the 21 November entries but is not newer`).toBe(true);
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
const AI = /ChatGPT|Claude|Cursor|Gemini|Copilot|OpenAI|Anthropic|\bGPT/;
const SYSTEMS = /Greenhouse|\bLever\b|Teamtailor|Workday|Ashby|SmartRecruiters|iCIMS|UKG|Oracle|\bATS\b/;
const LIMITS: Record<string, Limit> = {
  [BOARD]: {
    must: [
      "a search for a software role now reads back end and backend, front end and frontend, full stack and full-stack, and dev ops and devops as the same word",
      "so either spelling finds the same jobs",
      "In such a search, developer now also finds jobs titled engineer.",
      "lists the jobs of Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI and Mythic",
      "read from the hiring system each of them posts on",
    ],
    mustNot: [
      ["the spellings joined in every search", /\bevery (?:spelling|search)|\bany (?:spelling|search)|\ball (?:spellings|searches)|in (?:every|any) role/i],
      ["engineer finding developer, which the live read did not show", /engineer (?:now )?(?:also )?finds|titled developer/i],
      ["a count of employers or jobs", /\d|\bsix\b|\bdozens?\b|\bhundreds?\b|\bthousands?\b/i],
      ["a sector or startup label for the employers", /startup|start-up|AI compan|defen[cs]e|medical|semiconductor|\bchips?\b/i],
      ["a hiring system named", SYSTEMS],
      ["pay, freshness or removed boards", /\bpay\b|salar|fresh|faster|removed|dead|pruned/i],
      ["an AI product", AI],
    ],
  },
  [COMPANY]: {
    must: [
      "Where a company page's figures count an employer's roles across its whole hiring system",
      "the line naming the countries with the most roles now says so, and so does the median on the Pay card",
      "A board with no name of its own is now headed with the name of its hiring system, or simply as this board",
      "On a page that brings several of an employer's boards together",
      "the description of the actively hiring badge now says its record is for one of those boards, and names it",
      "the German page on CV conventions in Austria now says what the English page says",
      "formal titles such as Mag. and Dipl.-Ing. count for more than in Germany",
      "It no longer says that references and certificates (Zeugnisse) are expected.",
    ],
    mustNot: [
      ["every company page or every figure", /\bevery (?:company )?page|\ball (?:company )?pages|\bevery figure|\ball figures/i],
      ["a number", /\d/],
      ["an employer or a hiring system named", /PwC|Workday|UKG|Oracle|Greenhouse|\bLever\b|SuccessFactors/],
      ["another country's page", /Switzerland|Swiss|every country|all countries/i],
      ["an internal name", /\btoken\b|tilde|~|tenant|\bintel\b|pooled|S14X|RC-OI|data-/i],
      ["an AI product", AI],
    ],
  },
  [LANG]: {
    must: [
      "Counts and dates on the pages you read in your language",
      "are now written the way the language you chose on the site writes them, not the way your browser's language does",
      "When you change the language, the release notes on this page now change with it.",
      "now changes to your language once the site has loaded",
      "a screen reader now reads out the new page's title",
      "if the link you used went away with the page you left, keyboard focus moves to the new page's main content",
    ],
    mustNot: [
      ["every page or every figure", /\bevery (?:page|figure|number|date)|\ball (?:pages|figures|numbers|dates)\b|everywhere|whole site/i],
      ["focus always moved", /\balways\b|every time|first load|whenever/i],
      ["a number", /\d/],
      ["an internal name", /locale|\bIntl\b|toLocale|\baria\b|live region|announcer|data-changelog|skipToMain|main-content|S14X/i],
      ["an AI product", AI],
    ],
  },
  [TXT]: {
    must: [
      "A résumé saved as a .txt file with a text editor's Unicode option is now read as text wherever you upload a résumé on the site",
      "On the free scan and on the page after a purchase, a .txt file that is still not text is refused with a message in your language.",
      "the score at the top and the industry card now name your industry in the same words as the menu where you can correct it",
      "no longer name an AI model",
      "the one for a paid document now uses your language",
    ],
    mustNot: [
      ["another file type", /\bany (?:file|format)|every (?:file|format)|\bPDF\b|\bWord\b|\.docx?\b|scanned/i],
      ["the refusal in the reader's language everywhere", /refused (?:everywhere|wherever)|every refusal/i],
      ["an AI model named", AI],
      ["Shortlist or an employer's tool", /Shortlist|recruiter|candidate/i],
      ["a number", /\d/],
      ["an internal name", /\bUTF|byte-order|\bBOM\b|TextDecoder|ingestParsers|windows-1252|encoding|RC-S13|CW2|S14X/i],
    ],
  },
  [AFF]: {
    must: [
      "Each banner in the affiliate marketing kit is now the size its label states, as a PNG and as an SVG, at a fixed address on our site.",
      "A banner you embedded from the earlier kit still loads from its old address, now at the size its label named.",
      "now describes the free scan by what it shows: how your file parses, and the keywords your résumé is missing",
    ],
    mustNot: [
      ["a size in figures", /\d|pixels?|\bpx\b/i],
      ["commission, payout or approval", /commission|payout|paid out|approv|\bearn/i],
      ["ATS algorithms or rejection, even denied", /\bATS\b|algorithm|reject/i],
      ["an address promised forever", /forever|never change|always|permanent/i],
      ["an AI product", AI],
    ],
  },
};

/** British English: the US text with CV for résumé, nothing else. */
const toGB = (s: string) => s.replace(/\bdialog\b/g, "dialogue").replace(/résumé/g, "CV");

type Other = Exclude<Locale, "en" | "en-GB">;
const OTHERS = LOCALES.filter((l): l is Other => l !== "en" && l !== "en-GB");
/** What no language may write in any entry: a number, an AI product, a hiring system. */
const BASE = (extra: string) => new RegExp(`[0-9०-९]|ChatGPT|Claude|Cursor|Gemini|Copilot|OpenAI|Anthropic|GPT|Greenhouse|\\bLever\\b|Teamtailor|Workday|Ashby|\\bATS\\b${extra ? `|${extra}` : ""}`, "i");
const LOCAL: Record<string, Record<Other, { must: string[]; mustNot: RegExp }>> = {
  // the spellings one word in a software search; developer finds engineer
  // there; the six by name from the system each posts on; never every
  // search, a count, a sector or a system's name
  [BOARD]: {
    de: { must: ["eine Suche nach einer Softwarestelle", "sodass beide Schreibweisen dieselben Stellen finden", "In einer solchen Suche findet developer jetzt auch Stellen mit dem Titel engineer", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI und Mythic"], mustNot: BASE("jede Suche|alle Schreibweisen|Startup|\\bsechs\\b") },
    es: { must: ["una búsqueda de un puesto de software", "cualquiera de las dos grafías encuentra los mismos empleos", "En una búsqueda así, developer encuentra ahora también empleos con el título engineer", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI y Mythic"], mustNot: BASE("todas las grafías|cualquier búsqueda|startup|\\bseis\\b") },
    fr: { must: ["une recherche pour un métier du logiciel", "les deux orthographes trouvent donc les mêmes offres", "Dans une telle recherche, developer trouve désormais aussi les offres intitulées engineer", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI et Mythic"], mustNot: BASE("toutes les orthographes|toute recherche|start-up|startup|\\bsix\\b") },
    hi: { must: ["किसी सॉफ़्टवेयर भूमिका की खोज", "दोनों में से कोई भी वर्तनी वही नौकरियाँ ढूँढती है", "ऐसी खोज में developer अब उन नौकरियों को भी ढूँढता है जिनका शीर्षक engineer है", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI और Mythic"], mustNot: BASE("हर खोज|सभी वर्तनियाँ|स्टार्टअप|छह") },
    nl: { must: ["een zoekopdracht naar een softwarefunctie", "zodat beide schrijfwijzen dezelfde vacatures vinden", "In zo'n zoekopdracht vindt developer nu ook vacatures met de titel engineer", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI en Mythic"], mustNot: BASE("alle schrijfwijzen|elke zoekopdracht|startup|\\bzes\\b") },
    pt: { must: ["uma busca por uma vaga de software", "qualquer uma das duas grafias encontra as mesmas vagas", "Nessa busca, developer agora também encontra vagas com o título engineer", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI e Mythic"], mustNot: BASE("todas as grafias|qualquer busca|startup|\\bseis\\b") },
    tl: { must: ["paghahanap para sa isang software na trabaho", "alinman sa dalawang baybay ay nakakahanap ng parehong mga trabaho", "nahahanap na rin ng developer ang mga trabahong may titulong engineer", "Castelion Corporation, Aidoc, Dropzone AI, SiPearl, Upscale AI at Mythic"], mustNot: BASE("lahat ng baybay|bawat paghahanap|startup|\\banim\\b") },
  },
  // the countries line and the Pay median where a figure counts the whole
  // system; the unnamed board's heading; the badge's one board, named; the
  // Austria page's two conventions and no Zeugnisse; no employer, other
  // system or other country
  [COMPANY]: {
    de: { must: ["in seinem ganzen Bewerbungssystem zählen", "die Zeile mit den Ländern mit den meisten Stellen", "der Median auf der Gehaltskarte", "Ein Jobboard ohne eigenen Namen trägt jetzt den Namen seines Bewerbungssystems als Überschrift", "dass seine Einstellungsbilanz für eines dieser Jobboards gilt, und nennt es", "akademische Titel wie Mag. und Dipl.-Ing. zählen mehr als in Deutschland", "Sie sagt nicht mehr, dass Zeugnisse erwartet werden"], mustNot: BASE("PwC|UKG|Oracle|Schweiz|jede Unternehmensseite|alle Unternehmensseiten") },
    es: { must: ["en todo su sistema de contratación", "la línea que indica los países con más puestos ahora lo dice", "la mediana de la tarjeta Salario", "Un portal sin nombre propio lleva ahora como título el nombre de su sistema de contratación", "su historial corresponde a uno de esos portales, y lo nombra", "los títulos académicos como Mag. y Dipl.-Ing. cuentan más que en Alemania", "Ya no dice que se esperan referencias y certificados (Zeugnisse)"], mustNot: BASE("PwC|UKG|Oracle|Suiza|todas las páginas") },
    fr: { must: ["sur tout son système de recrutement", "la ligne qui indique les pays comptant le plus de postes le dit désormais", "la médiane de la carte Salaire", "Un tableau d'offres sans nom propre a désormais pour titre le nom de son système de recrutement", "son historique porte sur l'un de ces tableaux, et le nomme", "des titres comme Mag. et Dipl.-Ing. qui comptent davantage qu'en Allemagne", "Elle ne dit plus que des références et des certificats (Zeugnisse) sont attendus"], mustNot: BASE("PwC|UKG|Oracle|Suisse|toutes les pages") },
    hi: { must: ["उसके पूरे भर्ती सिस्टम में गिनते हैं", "सबसे ज़्यादा भूमिकाओं वाले देशों की पंक्ति अब यह बताती है", "वेतन कार्ड पर दी गई माध्यिका भी", "उसका शीर्षक अब उसके भर्ती सिस्टम का नाम होता है", "उसका भर्ती रिकॉर्ड उनमें से एक बोर्ड का है, और उस बोर्ड का नाम लेता है", "Mag. और Dipl.-Ing. जैसी औपचारिक उपाधियाँ जर्मनी से ज़्यादा मायने रखती हैं", "वह अब यह नहीं कहता कि संदर्भ पत्र और प्रमाण पत्र (Zeugnisse) अपेक्षित हैं"], mustNot: BASE("PwC|UKG|Oracle|स्विट्ज़रलैंड|सभी कंपनी पेज|हर कंपनी पेज") },
    nl: { must: ["over diens hele wervingssysteem tellen", "zegt de regel met de landen met de meeste functies dat nu", "de mediaan op de kaart Salaris ook", "Een vacaturebord zonder eigen naam krijgt nu de naam van zijn wervingssysteem als kop", "dat het overzicht over een van die borden gaat, en noemt het", "titels zoals Mag. en Dipl.-Ing. tellen zwaarder dan in Duitsland", "Ze zegt niet meer dat referenties en getuigschriften (Zeugnisse) worden verwacht"], mustNot: BASE("PwC|UKG|Oracle|Zwitserland|alle bedrijfspagina") },
    pt: { must: ["em todo o seu sistema de recrutamento", "a linha que mostra os países com mais vagas agora diz isso", "a mediana do cartão Salário também", "Um portal sem nome próprio agora tem como título o nome do seu sistema de recrutamento", "o histórico dele é de um desses portais, e diz qual", "títulos como Mag. e Dipl.-Ing. contam mais do que na Alemanha", "Ela não diz mais que referências e certificados (Zeugnisse) são esperados"], mustNot: BASE("PwC|UKG|Oracle|Suíça|todas as páginas") },
    tl: { must: ["sa buong hiring system nito", "sinasabi na iyon ng linyang naglilista ng mga bansang may pinakamaraming trabaho", "gayundin ng median sa card na Sahod", "may pamagat na ngayon na pangalan ng hiring system nito", "para sa isa sa mga board na iyon ang rekord nito, at pinangangalanan ito", "mas mahalaga ang mga pormal na titulo gaya ng Mag. at Dipl.-Ing. kaysa sa Germany", "Hindi na nito sinasabing inaasahan ang mga reference at sertipiko (Zeugnisse)"], mustNot: BASE("PwC|UKG|Oracle|Switzerland|lahat ng company page") },
  },
  // the pages read in the reader's language, not the browser's; the notes on
  // a switch; the skip link once loaded; the title read out; focus moved only
  // when the link left with the old page; never always or every page
  [LANG]: {
    de: { must: ["auf den Seiten, die du in deiner Sprache liest", "wie die auf der Website gewählte Sprache sie schreibt, nicht wie die Sprache deines Browsers", "wechseln die Versionshinweise auf dieser Seite jetzt mit", "wechselt jetzt in deine Sprache, sobald die Website geladen ist", "liest ein Screenreader jetzt den Titel der neuen Seite vor", "wenn der Link, den du benutzt hast, mit der alten Seite verschwunden ist"], mustNot: BASE("\\bimmer\\b|jedes Mal|beim ersten Laden|alle Seiten|überall") },
    es: { must: ["de las páginas que lees en tu idioma", "como las escribe el idioma que elegiste en el sitio, no como las escribe el idioma de tu navegador", "las notas de versión de esta página cambian ahora con él", "cambia ahora a tu idioma en cuanto el sitio ha cargado", "un lector de pantalla lee ahora el título de la nueva página", "si el enlace que usaste desapareció con la página que dejaste"], mustNot: BASE("siempre|cada vez|todas las páginas") },
    fr: { must: ["des pages que vous lisez dans votre langue", "comme les écrit la langue que vous avez choisie sur le site, et non comme les écrit la langue de votre navigateur", "les notes de version de cette page changent désormais avec elle", "passe désormais dans votre langue une fois le site chargé", "un lecteur d'écran lit désormais le titre de la nouvelle page", "si le lien que vous avez utilisé a disparu avec la page quittée"], mustNot: BASE("toujours|à chaque fois|toutes les pages|partout") },
    hi: { must: ["जिन पेजों को आप अपनी भाषा में पढ़ते हैं", "जैसे साइट पर आपकी चुनी हुई भाषा उन्हें लिखती है, न कि जैसे आपके ब्राउज़र की भाषा लिखती है", "इस पेज के रिलीज़ नोट्स भी अब उसके साथ बदल जाते हैं", "अब साइट लोड होते ही आपकी भाषा में बदल जाता है", "स्क्रीन रीडर अब नए पेज का शीर्षक पढ़कर सुनाता है", "अगर आपने जो लिंक इस्तेमाल किया था वह पिछले पेज के साथ चला गया"], mustNot: BASE("हमेशा|हर बार|सभी पेज") },
    nl: { must: ["op de pagina's die je in je taal leest", "zoals de taal die je op de site koos ze schrijft, niet zoals de taal van je browser dat doet", "veranderen de releasenotes op deze pagina nu mee", "verandert nu naar je taal zodra de site geladen is", "leest een schermlezer nu de titel van de nieuwe pagina voor", "als de link die je gebruikte met de vorige pagina verdween"], mustNot: BASE("\\baltijd\\b|elke keer|alle pagina|overal") },
    pt: { must: ["das páginas que você lê no seu idioma", "como o idioma que você escolheu no site os escreve, e não como o idioma do seu navegador", "as notas de versão desta página agora mudam junto", "agora muda para o seu idioma assim que o site carrega", "um leitor de tela agora lê o título da nova página", "se o link que você usou sumiu com a página anterior"], mustNot: BASE("sempre|toda vez|todas as páginas") },
    tl: { must: ["sa mga pahinang binabasa mo sa iyong wika", "sa paraan ng wikang pinili mo sa site, hindi sa paraan ng wika ng iyong browser", "nagbabago na rin ngayon kasama nito ang release notes sa pahinang ito", "nagbabago na ngayon sa iyong wika kapag na-load na ang site", "binabasa na ngayon nang malakas ng screen reader ang pamagat ng bagong pahina", "kung nawala ang link na ginamit mo kasama ng pahinang iniwan mo"], mustNot: BASE("palagi|tuwing|lahat ng pahina") },
  },
  // a Unicode .txt read wherever a résumé is uploaded; the refusal in the
  // reader's language on the free scan and the page after a purchase only;
  // the report's one label; no model named, the paid screen in the language;
  // no other file type, no Shortlist, no internal name
  [TXT]: {
    de: { must: ["mit der Unicode-Option eines Texteditors als .txt-Datei gespeichert", "wird jetzt überall als Text gelesen, wo du auf der Website einen Lebenslauf hochlädst", "Beim kostenlosen Scan und auf der Seite nach einem Kauf wird eine .txt-Datei, die trotzdem kein Text ist, mit einer Meldung in deiner Sprache abgelehnt", "mit denselben Worten wie das Menü, in dem du sie korrigieren kannst", "nennen kein KI-Modell mehr", "die Anzeige für ein bezahltes Dokument erscheint jetzt in deiner Sprache"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|Kodierung") },
    es: { must: ["con la opción Unicode de un editor de texto", "se lee ahora como texto dondequiera que subas un currículum en el sitio", "En el escaneo gratis y en la página posterior a una compra, un archivo .txt que sigue sin ser texto se rechaza con un mensaje en tu idioma", "con las mismas palabras que el menú donde puedes corregirlo", "ya no nombran un modelo de IA", "la de un documento de pago aparece ahora en tu idioma"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|codificación") },
    fr: { must: ["avec l'option Unicode d'un éditeur de texte", "est désormais lu comme du texte partout où vous déposez un CV sur le site", "Sur le scan gratuit et sur la page qui suit un achat, un fichier .txt qui n'est toujours pas du texte est refusé avec un message dans votre langue", "avec les mêmes mots que le menu où vous pouvez le corriger", "ne nomment plus de modèle d'IA", "celui d'un document payant s'affiche désormais dans votre langue"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|encodage") },
    hi: { must: ["टेक्स्ट एडिटर के यूनिकोड विकल्प से .txt फ़ाइल के रूप में सहेजा गया", "जहाँ भी आप रिज़्यूमे अपलोड करते हैं, वहाँ टेक्स्ट के रूप में पढ़ा जाता है", "मुफ़्त स्कैन पर और ख़रीद के बाद वाले पेज पर, जो .txt फ़ाइल फिर भी टेक्स्ट नहीं है उसे आपकी भाषा में एक संदेश के साथ अस्वीकार किया जाता है", "उन्हीं शब्दों में बताते हैं जिनमें वह मेनू बताता है जहाँ आप उसे सुधार सकते हैं", "अब किसी AI मॉडल का नाम नहीं लेतीं", "पेड दस्तावेज़ वाली स्क्रीन अब आपकी भाषा में दिखती है"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|एन्कोडिंग") },
    nl: { must: ["met de Unicode-optie van een teksteditor als .txt-bestand hebt opgeslagen", "wordt nu als tekst gelezen waar je op de site ook een cv uploadt", "Bij de gratis scan en op de pagina na een aankoop wordt een .txt-bestand dat nog steeds geen tekst is, geweigerd met een melding in je taal", "met dezelfde woorden als het menu waarin je die kunt corrigeren", "noemen geen AI-model meer", "het scherm voor een betaald document is nu in je taal"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|codering") },
    pt: { must: ["com a opção Unicode de um editor de texto", "agora é lido como texto onde quer que você envie um currículo no site", "Na análise gratuita e na página depois de uma compra, um arquivo .txt que continua sem ser texto é recusado com uma mensagem no seu idioma", "com as mesmas palavras do menu onde você pode corrigi-lo", "não citam mais um modelo de IA", "a de um documento pago agora aparece no seu idioma"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|codificação") },
    tl: { must: ["gamit ang Unicode option ng isang text editor", "binabasa na ngayon bilang text saanman ka mag-upload ng resume sa site", "Sa libreng scan at sa pahina pagkatapos ng pagbili, ang .txt file na hindi pa rin text ay tinatanggihan nang may mensahe sa iyong wika", "sa parehong mga salita ng menu kung saan mo ito maitatama", "hindi na nagbabanggit ng AI model", "ang para sa bayad na dokumento ay nasa iyong wika na ngayon"], mustNot: BASE("\\bPDF\\b|\\bWord\\b|docx|Shortlist|UTF|encoding") },
  },
  // the size the label states, PNG and SVG, a fixed address; the old address
  // still loads at the size its label named; the newsletter says what the
  // scan shows; no size in figures, commission, ATS or forever
  [AFF]: {
    de: { must: ["hat jetzt die Größe, die seine Beschriftung angibt, als PNG und als SVG, unter einer festen Adresse", "lädt weiterhin von seiner alten Adresse, jetzt in der Größe, die seine Beschriftung nannte", "beschreibt den kostenlosen Scan jetzt mit dem, was er zeigt"], mustNot: BASE("Provision|Pixel|Algorithm|Ablehnung|für immer") },
    es: { must: ["tiene ahora el tamaño que indica su etiqueta, en PNG y en SVG, en una dirección fija", "sigue cargando desde su dirección antigua, ahora con el tamaño que indicaba su etiqueta", "describe ahora el escaneo gratis por lo que muestra"], mustNot: BASE("comisi|píxel|algoritmo|rechazo|para siempre") },
    fr: { must: ["a désormais la taille qu'indique son libellé, en PNG et en SVG, à une adresse fixe", "se charge toujours depuis son ancienne adresse, désormais à la taille qu'indiquait son libellé", "décrit désormais le scan gratuit par ce qu'il montre"], mustNot: BASE("commission|pixel|algorithme|rejet|pour toujours") },
    hi: { must: ["अब उसी आकार का है जो उसका लेबल बताता है, PNG और SVG दोनों रूपों में, हमारी साइट पर एक तय पते पर", "अब भी अपने पुराने पते से लोड होता है, अब उसी आकार में जो उसके लेबल ने बताया था", "अब मुफ़्त स्कैन को उसी से बताता है जो वह दिखाता है"], mustNot: BASE("कमीशन|पिक्सेल|एल्गोरिद्म|अस्वीकृति|हमेशा के लिए") },
    nl: { must: ["heeft nu de maat die zijn label aangeeft, als PNG en als SVG, op een vast adres", "laadt nog steeds vanaf zijn oude adres, nu in de maat die zijn label noemde", "beschrijft de gratis scan nu met wat die laat zien"], mustNot: BASE("commissie|pixel|algoritme|afwijzing|voor altijd") },
    pt: { must: ["agora tem o tamanho que o rótulo indica, em PNG e em SVG, em um endereço fixo", "continua carregando do endereço antigo, agora no tamanho que o rótulo dele indicava", "agora descreve a análise gratuita pelo que ela mostra"], mustNot: BASE("comiss|pixel|algoritmo|rejeição|para sempre") },
    tl: { must: ["ay nasa laki na ngayon na sinasabi ng label nito, bilang PNG at bilang SVG, sa isang nakapirming address", "naglo-load pa rin mula sa luma nitong address, ngayon ay nasa laking sinabi ng label nito", "Inilalarawan na ngayon ng newsletter template ng kit ang libreng scan ayon sa ipinapakita nito"], mustNot: BASE("komisyon|pixel|algorithm|pagtanggi|magpakailanman") },
  },
};

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

  it("British English is the US text with CV for résumé, and nothing else changed", () => {
    for (const id of IDS) {
      const us = EN[id];
      expect(SHARDS["en-GB"][id], id).toEqual({ title: toGB(us.title), description: toGB(us.description) });
      expect(textOf("en-GB", id), id).not.toMatch(/\bdialog\b|résumé/);
    }
    expect(textOf("en", TXT).split("résumé").length - 1).toBe(3);
    expect(textOf("en", AFF).split("résumé").length - 1).toBe(1);
  });

  it("the Pay card is named as each language's company page names it", () => {
    for (const l of LOCALES) {
      const title = (companyShard(l).pay as Record<string, string>).title;
      expect(title.length, l).toBeGreaterThan(2);
      expect(SHARDS[l][COMPANY].description, `${l}: the Pay card's live title is ${title}`).toContain(title);
    }
  });

  it("the German strings the skip link and the paid progress screen read are the ones section 52i looks for", () => {
    expect((json("src/i18n/shards/site-shell/de.json") as { siteShell: Record<string, string> }).siteShell.skipToMain).toBe("Zum Hauptinhalt springen");
    expect((json("src/i18n/shards/site-shell/en.json") as { siteShell: Record<string, string> }).siteShell.skipToMain).toBe("Skip to main content");
    expect((locale("de").aiGenerationProgress as Record<string, string>).title).toBe("Die KI arbeitet");
    for (const l of LOCALES) {
      const both = JSON.stringify([locale(l).scanProgress, locale(l).aiGenerationProgress]);
      expect(both, `${l}: a progress string names a model`).not.toMatch(/\bgemini\b|\bgpt[-\s]?\d|\bopenai\b|\bclaude\b/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TRANSLATION AS REVIEWED. The first 12 hex digits of SHA-256 over
// "<title>\n<description>", per language, in the order of IDS. A change to any
// of them fails here until the new text is read against what production showed
// on 21 November and its hash is written in.
const REVIEWED: Record<Locale, string[]> = {
  en: ["23506c7716ab", "1759f425b574", "7f4fb9232359", "66c239b53354", "b64c77d71d3d"],
  "en-GB": ["23506c7716ab", "1759f425b574", "7f4fb9232359", "db85d547238b", "a003acbdb510"],
  de: ["d2cd933b00f8", "d51ff8942f78", "9e4d2d5dbe22", "7ce7a9f7a15e", "43d1a5448f0c"],
  es: ["34234252d096", "dd046596b89f", "2a8a96299d22", "53170261274f", "eaa50c1c22a1"],
  fr: ["d53ccf23080b", "59e18ec03126", "1e7903959a88", "4f18cf10140f", "3db6da6e827c"],
  hi: ["ad0ade276106", "0698de8714a6", "ea3343c30714", "33d35c824e1f", "15bbb909aa6e"],
  nl: ["447e3fc13d81", "1b9bb302411e", "92b57ed17705", "da6751d36756", "1103c2f2c5b9"],
  pt: ["f1afbfb4889d", "deaf36f12082", "988ef2073dc5", "13e0bcac1e2c", "8fcdc684dcbe"],
  tl: ["e5ad6a838860", "eff759812b2c", "d76ee5a248ae", "23f2b3e8f885", "6c8fe7263c4d"],
};
const hash = (t: Text) => createHash("sha256").update(`${t.title}\n${t.description}`).digest("hex").slice(0, 12);

describe("every translation is the text that was reviewed", () => {
  it.each(LOCALES)("%s", (l) => {
    expect(IDS.map((id) => hash(SHARDS[l][id])), `${l}: a reworded entry must be read again against the live read, then its hash updated`).toEqual(REVIEWED[l]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO NUMBERS AND NO QUOTED LABEL. No entry writes a number or quotes a label in
// any language: the badge, the card and the pages are named in each language's
// own words, so there is no label whose live string a quote would have to be.
/** Every number a text writes. Pure. */
const numbersIn = (s: string) => [...new Set((s.match(/\d{1,3}(?:[.,   ]\d{3})+(?!\d)|\d+|[०-९]+/g) ?? []).map((x) => x))].sort();
/** Every quotation mark a text writes (an apostrophe is not one). Pure. */
const quotesIn = (s: string) => s.match(/[“”„«»"‘’‚‹›]/g) ?? [];

describe("no numbers and no quotation marks in any language", () => {
  it.each(IDS)("%s writes no number and quotes nothing in any language", (id) => {
    for (const l of LOCALES) {
      expect(numbersIn(textOf(l, id)), l).toEqual([]);
      expect(quotesIn(textOf(l, id)), l).toEqual([]);
    }
  });
});

describe("what the entries name is what the code holds", () => {
  it("a software search joins the four compound words in either spelling, and only beside a role word for back end and front end", () => {
    expect(joinCompoundRoleWords("back end developer")).toBe("backend developer");
    expect(joinCompoundRoleWords("front end developer")).toBe("frontend developer");
    expect(joinCompoundRoleWords("full stack developer")).toBe(joinCompoundRoleWords("full-stack developer"));
    expect(joinCompoundRoleWords("dev ops engineer")).toBe("devops engineer");
    // A grocery's Front End Manager is a checkout: why the entry says a search for a software role.
    expect(joinCompoundRoleWords("front end manager")).toBe("front end manager");
  });

  it("developer finds engineer inside a software family only, which is why the entry says such a search", () => {
    // job-board joins the compound words first, then asks whether the role words trade places.
    const joined = joinCompoundRoleWords("full stack developer");
    expect(roleSwapApplies(joined)).toBe(true);
    expect(roleAliasesFor(joined).developer).toEqual(["engineer"]);
    expect(roleSwapApplies("software developer")).toBe(true);
    expect(roleSwapApplies("real estate developer")).toBe(false);
    expect(roleSwapApplies("web sales engineer")).toBe(false);
    expect(source("supabase/functions/job-board/index.ts")).toMatch(/const qText = joinCompoundRoleWords\(/);
  });

  it("job-board declares the build section 52i asks its preflight for", () => {
    expect(source("supabase/functions/job-board/index.ts")).toMatch(/const BUILD_VERSION = "2026-09-09\.103";/);
    expect(sectionText()).toMatch(/build_ge job-board "\$VD52I_BUILD" 2026-09-09 103/);
  });

  it("the six employers are board .103's row A, by their served names, in the order the entry lists them", () => {
    const added = (json("src/test/fixtures/board-103-row-a-2026-11-17.json") as { added: Array<{ key: string; name: string }> }).added;
    const rows = EMPLOYERS();
    expect(rows.map((r) => `${r.vendor}:${r.token}`)).toEqual(added.map((a) => a.key));
    expect(rows.map((r) => r.name)).toEqual(added.map((a) => a.name));
    expect(EN[BOARD].description).toContain(`the jobs of ${rows.slice(0, -1).map((r) => r.name).join(", ")} and ${rows[rows.length - 1].name},`);
  });

  it("the company page reads the keys and the English words section 52i looks for", () => {
    const code = ["src/components/jobs/company/CompanyHeader.tsx", "src/components/jobs/company/PaySummary.tsx"].map(source).join("\n");
    for (const k of ["companyProfile.facts.countriesLabelPooled", "companyProfile.pay.floorPooled", "companyProfile.h1SystemBoard", "companyProfile.h1ThisBoard", "companyProfile.employerChipOneBoard", "data-employer-chip-board"]) {
      expect(code, k).toContain(k);
      expect(sectionText(), k).toContain(`"${k}"`);
    }
    const cp = companyShard("en") as { facts: Record<string, string>; pay: Record<string, string>; h1SystemBoard: string; h1ThisBoard: string; employerChipOneBoard: string };
    expect(cp.facts.countriesLabelPooled).toBe("Most roles across the {{company}} hiring system in");
    expect(cp.pay.floorPooled_other).toMatch(/on this employer's whole hiring system$/);
    expect([cp.h1SystemBoard, cp.h1ThisBoard]).toEqual(["Roles on a {{system}} board", "Roles on this board"]);
    expect(cp.employerChipOneBoard).toBe("Hiring record for one of this employer's {{n}} boards: {{board}}");
  });

  it("the two Austria pages state the conventions section 52i reads, and the German one no Zeugnisse", () => {
    const de = CV_LOCALES.de.content.AT.conventions;
    expect(de).toEqual(["Tabellarischer Lebenslauf nach deutschem Muster", "Akademische Titel (Mag., Dipl.-Ing.) zählen mehr als in Deutschland"]);
    expect(de.join(" ")).not.toMatch(/Zeugnis/);
    expect(COUNTRY_STANDARDS.AT.conventions).toEqual(["German-style tabular Lebenslauf", "Formal titles (Mag., Dipl.-Ing.) matter more than in Germany"]);
    for (const c of [...de, ...COUNTRY_STANDARDS.AT.conventions]) expect(sectionText(), c).toContain(`"${c}"`);
  });

  it("the skip link, the route announcer and the release notes carry the marks section 52i reads", () => {
    expect(SHELL_SKIP_LINK).toBe('body > a[href="#main-content"]');
    expect(ROUTE_ANNOUNCER_ID).toBe("rb-route-announcer");
    expect(source("src/lib/skip-link.ts")).toMatch(/const PAGE_TARGETS = \["#main-content", "main", "h1"\] as const;/);
    expect(source("src/components/ScrollToTop.tsx")).toMatch(/id=\{ROUTE_ANNOUNCER_ID\}[^>]*aria-live="polite"/);
    expect(source("src/pages/Changelog.tsx")).toMatch(/data-changelog-lng=\{/);
  });

  it("the three upload boxes read a .txt through the reader that honours the byte-order mark, and two refuse in the reader's language", () => {
    const reader = source("src/lib/resumeText.ts");
    expect(reader).toMatch(/new TextDecoder\("utf-16le"\)/);
    expect(reader).toMatch(/new TextDecoder\("utf-16be"\)/);
    for (const p of ["src/pages/Index.tsx", "src/pages/Jobs.tsx", "src/pages/ProductSuccess.tsx"]) expect(source(p), p).toMatch(/import \{ readTextFile \} from "@\/lib\/resumeText";/);
    for (const p of ["src/pages/Index.tsx", "src/pages/ProductSuccess.tsx"]) expect(source(p), p).toContain("t('ingestParsers.refusal.txtUnreadable')");
    expect(source("src/pages/Jobs.tsx")).not.toContain("ingestParsers.refusal.txtUnreadable");
  });

  it("the report's hero and card carry the marks section 52i reads, and the overlay reads its title from the strings", () => {
    expect(source("src/components/scorecard/ScoreHero.tsx")).toContain("data-hero-industry");
    expect(source("src/components/IndustryConfidenceIndicator.tsx")).toContain("data-industry-label");
    expect(source("src/components/AIGenerationProgress.tsx")).toMatch(/aiGenerationProgress\.title/);
  });

  it("the kit names six fixed addresses, its newsletter says what the scan shows, and the old addresses carry the corrected banners byte for byte", () => {
    const kit = source("src/components/affiliate/MarketingKit.tsx");
    for (const s of ["728x90", "300x250", "160x600"]) for (const x of ["png", "svg"]) expect(kit, `${s}.${x}`).toContain(`'/affiliate/banner-${s}.${x}'`);
    expect(kit).toContain("- Shows how your file parses");
    expect(kit).toContain("- Lists the keywords your resume is missing");
    expect(kit).not.toMatch(/real ATS algorithms|cause rejection/);
    const OLD: Record<string, string> = { "728x90": "banner-leaderboard-7wRFqWjL.png", "300x250": "banner-square-Cs_OOO75.png", "160x600": "banner-skyscraper-CCTK8RI-.png" };
    for (const [wh, old] of Object.entries(OLD)) {
      const png = readFileSync(resolve(ROOT, `public/affiliate/banner-${wh}.png`));
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, wh).toBe(wh);
      expect(readFileSync(resolve(ROOT, `public/assets/${old}`)).equals(png), old).toBe(true);
      expect(sectionText(), old).toContain(`/assets/${old}`);
    }
  });
});

describe("nothing an entry says is ours alone to know", () => {
  const REFUSED: Array<[string, RegExp]> = [
    ["an audit or owner-decision id", /\b(?:S\d{1,2}X?|NB|OD\d{1,2}|HO|RC-S\d{1,2}|RC-OI|CW\d)-[A-Z0-9-]+\b|OD14/],
    ["an internal name", /job-board|x-fn-build|\bcron\b|\bRPC\b|\bMCP\b|migration|edge function|prerender|get_company_intel|open_by_source|toLocale|\bIntl\b|rb-route-announcer|data-changelog|skipToMain|ingestParsers|resumeText|TextDecoder|utf-16|countriesLabel|floorPooled|h1SystemBoard|employerChip|public\/affiliate/i],
    // Case kept: Dutch writes the marketing kit as one word, marketingkit.
    ["a component name", /MarketingKit|ScrollToTop|ScoreHero|IndustryConfidence|AIGenerationProgress|CompanyHeader|PaySummary/],
    ["a vendor and token", /\b[a-z]+:[a-z0-9~_-]+\b/],
    ["a commit or migration id", /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\b20\d{12}\b/],
    ["a price or a retired product", /[$€£₹]\s?\d|\bUSD\b|Premium|Apply Assistant|applies for you|apply for you|Agent Pass/i],
    ["an AI product of any kind", /ChatGPT|Claude|Cursor|Copilot|Gemini|Windsurf|Perplexity|VS Code|OpenAI|Anthropic|\bGPT/i],
    ["a provider the pages do not name", /Lovable|Stripe|Supabase|Postgres|Cloudflare/i],
    ["a percentage", /%|\bpercent|por ciento|pour cent|Prozent|प्रतिशत|procent|por cento|porsiyento/i],
    ["a hiring system named", SYSTEMS],
    ["a claim that we send applications", /we (?:send|submit) (?:your )?applications?/i],
  ];
  it.each(REFUSED)("no entry states %s", (_why, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => textOf("pt", id)).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|separador|utilizador|\bestá a [a-z]+r\b|«|»|\bpor si\b|\bnuma?\b/i);
    expect(pt).toMatch(/você/);
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
  /** The shipped text with one sentence added: every word the limits require is still there, so only a refused wording can fail it. */
  const plus = (l: Locale, id: string, sentence: string): Text => ({ ...SHARDS[l][id], description: `${SHARDS[l][id].description} ${sentence}` });
  const refused = (b: string[]) => b.filter((x) => / (?:states|matches) /.test(x));
  const lost = (b: string[]) => b.filter((x) => / lost /.test(x));

  it("board search: engineer finding developer, every search, a count, a sector or a system", () => {
    expect(refused(breaches(BOARD, "en", plus("en", BOARD, "Engineer now also finds jobs titled developer.")))).not.toEqual([]);
    expect(refused(breaches(BOARD, "en", plus("en", BOARD, "This works for every search.")))).not.toEqual([]);
    expect(refused(breaches(BOARD, "en", plus("en", BOARD, "That makes six AI startups.")))).not.toEqual([]);
    expect(refused(breaches(BOARD, "en", plus("en", BOARD, "They post on Greenhouse, Lever and Teamtailor.")))).not.toEqual([]);
    expect(refused(breaches(BOARD, "de", plus("de", BOARD, "Jede Suche liest jetzt alle Schreibweisen.")))).not.toEqual([]);
    expect(refused(breaches(BOARD, "pt", plus("pt", BOARD, "São seis empresas.")))).not.toEqual([]);
    const unscoped = breaches(BOARD, "en", swap("en", BOARD, "a search for a software role now reads", "every search now reads"));
    expect(lost(unscoped).length && refused(unscoped).length, unscoped.join("; ")).toBeTruthy();
  });

  it("company pages: every page, a named employer, another country, or the badge's board left unnamed", () => {
    expect(refused(breaches(COMPANY, "en", plus("en", COMPANY, "This holds on every company page.")))).not.toEqual([]);
    expect(refused(breaches(COMPANY, "en", plus("en", COMPANY, "PwC's page now says so.")))).not.toEqual([]);
    expect(refused(breaches(COMPANY, "fr", plus("fr", COMPANY, "Il en va de même pour la Suisse.")))).not.toEqual([]);
    expect(lost(breaches(COMPANY, "en", swap("en", COMPANY, ", and names it", "")))).not.toEqual([]);
    expect(lost(breaches(COMPANY, "nl", swap("nl", COMPANY, "Ze zegt niet meer dat referenties en getuigschriften (Zeugnisse) worden verwacht.", "")))).not.toEqual([]);
  });

  it("language: focus always moved, every page, or the condition on focus dropped", () => {
    expect(refused(breaches(LANG, "en", plus("en", LANG, "Focus always moves to the main content.")))).not.toEqual([]);
    expect(refused(breaches(LANG, "en", plus("en", LANG, "Every figure on the site now follows your language.")))).not.toEqual([]);
    expect(refused(breaches(LANG, "es", plus("es", LANG, "El foco siempre pasa al contenido principal.")))).not.toEqual([]);
    expect(lost(breaches(LANG, "en", swap("en", LANG, "if the link you used went away with the page you left, ", "")))).not.toEqual([]);
    expect(lost(breaches(LANG, "hi", swap("hi", LANG, "अगर आपने जो लिंक इस्तेमाल किया था वह पिछले पेज के साथ चला गया, तो ", "")))).not.toEqual([]);
  });

  it("uploads: another file type, a model named, Shortlist, or the refusal said of every upload box", () => {
    expect(refused(breaches(TXT, "en", plus("en", TXT, "PDF and Word files are read the same way.")))).not.toEqual([]);
    expect(refused(breaches(TXT, "en", plus("en", TXT, "The scan now runs on Gemini.")))).not.toEqual([]);
    expect(refused(breaches(TXT, "pt", plus("pt", TXT, "O Shortlist também lê o arquivo.")))).not.toEqual([]);
    const everywhere = breaches(TXT, "en", swap("en", TXT, "On the free scan and on the page after a purchase, a .txt file", "A .txt file"));
    expect(lost(everywhere), everywhere.join("; ")).not.toEqual([]);
  });

  it("banners: a size in figures, a commission, or ATS named even to deny it", () => {
    expect(refused(breaches(AFF, "en", plus("en", AFF, "The banners are now 728 pixels wide.")))).not.toEqual([]);
    expect(refused(breaches(AFF, "en", plus("en", AFF, "Affiliates now earn their commission sooner.")))).not.toEqual([]);
    expect(refused(breaches(AFF, "en", plus("en", AFF, "It no longer promises an analysis against real ATS algorithms.")))).not.toEqual([]);
    expect(refused(breaches(AFF, "nl", plus("nl", AFF, "De commissie wordt sneller uitbetaald.")))).not.toEqual([]);
  });

  it("a number or a quotation mark fails in any language", () => {
    expect(numbersIn(swap("fr", AFF, "à une adresse fixe", "à une adresse fixe depuis 2026").description)).not.toEqual([]);
    expect(numbersIn(swap("hi", AFF, "एक तय पते पर", "२ तय पतों पर").description)).not.toEqual([]);
    expect(quotesIn(swap("de", COMPANY, "des Abzeichens für aktives Einstellen", "des Abzeichens „Stellt aktiv ein“").description)).not.toEqual([]);
    expect(quotesIn(swap("en", COMPANY, "the actively hiring badge", "the “Actively hiring” badge").description)).not.toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 52i, run in bash against a fake curl that answers from a route table
// and logs every call, as the 19 November test runs section 52h.
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
const st=r.status??200;
const body=r.b64!==undefined?Buffer.from(r.b64,"base64"):Buffer.from(r.body??"","utf8");
if(D){const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";if(D==="-")process.stdout.write(hdr);else fs.writeFileSync(D,hdr);}
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
if(w)process.stdout.write(w.replace("%{http_code}",String(st)));
`;

const S52I = "52i-changelog-nov-21.sh";
const S52H = "52h-changelog-nov-19.sh";
const sectionText = () => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52I), "utf8");
const heredoc = (name: string) => (new RegExp(`<<'${name}'\\n([\\s\\S]*?)\\n${name}\\n`).exec(sectionText())?.[1].split("\n") ?? []);
const EMPLOYERS = () => heredoc("VD52I_EMPLOYERS").map((x) => { const [vendor, token, name] = x.split("|"); return { vendor, token, name }; });
/** The claims section 52i checks: each check's id, the entry it backs, and the words of that entry's English description it backs. */
const CLAIMS = () => heredoc("VD52I_CLAIMS").map((x) => { const [check, id, ...rest] = x.split("|"); return { check, id, words: rest.join("|") }; });
const CHECKS = () => [...new Set(CLAIMS().map((c) => c.check))];
/** The sentences of an English description: a full stop and a space before a capital, so Mag. and Dipl.-Ing. stay inside theirs. */
const sentencesOf = (d: string) => d.split(/(?<=[.!?])\s+(?=[A-Z])/);

const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(source("scripts/verify-deploy.sh"))?.[0] ?? "";
const KEY = "pk_test_SECRET_52i";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TAG_LABEL: Record<string, string> = { new: "New", improved: "Improved", fixed: "Fixed" };
type Row = { date: string; title: string; tags?: string[] };
const article = (r: Row) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${r.date} · ${(r.tags ?? ["fixed"]).map((t) => TAG_LABEL[t]).join(" · ")}</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(r.title)}</h2><p class="text-xs text-muted-foreground">x</p></article>`;
/** The bake's clamp: a description over 160 characters is cut at a word and ends in an ellipsis. */
const clamp160 = (d: string) => (d.length > 160 ? d.slice(0, 157).replace(/\s+\S*$/, "") + "…" : d);
/** The crawler /changelog as the bake writes it, from rows newest first. */
const crawler = (rows: Row[]) => `<html><head><meta name="description" content="${esc(clamp160(`What changed and when, newest first — including honest postmortems. Latest (${rows[0]?.date}): ${rows[0]?.title ?? ""}.`))}"></head><body><main><h1>Changelog</h1><div class="space-y-4">${rows.map(article).join("")}</div></main></body></html>`;
const rowsOf = (from: number, to: number): Row[] => changelog.slice(from, to).map((e) => ({ date: e.date, title: EN[e.id].title, tags: e.tags }));
const PUBLISHED_PAGE = crawler(rowsOf(AT, AT + 30));
const BEFORE_PAGE = crawler(rowsOf(AT + IDS.length, AT + IDS.length + 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(EN);
const NOT_YET = new Set(changelog.slice(0, AT + IDS.length).map((e) => e.id));
const UNPUBLISHED = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => !NOT_YET.has(k))));
const LANGS = ["en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const clChunk = (l: string) => `${l}-${l.replace("-", "").toUpperCase()}CL0001.js`;
const otherChunk = (l: string) => `${l}-${l.replace("-", "").toUpperCase()}MN0001.js`;
const filler = (n: number, date: string, what: string): Row[] => Array.from({ length: n }, (_, i) => ({ date, title: `${what} ${i}` }));

// Production on 21 November, cut to what section 52i reads: the strings from
// the repo's own files, the code as tells of the shipped build.
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const strings = (o: unknown) => `import{a as e}from"./index-ENTRY001.js";e(JSON.parse(\`${JSON.stringify(o)}\`));`;
const US_STRINGS = strings({ ...pick(locale("en"), ["scanProgress", "aiGenerationProgress", "streamingContent"]), companyProfile: companyShard("en"), ...(json("src/i18n/shards/site-shell/en.json") as object) });
const ENTRY = [
  `const lazy=[()=>import("./rb-en_all-ALL00001.js"),()=>import("./en-CHLG0001.js"),${LANGS.map((l) => `()=>import("./${otherChunk(l)}"),()=>import("./${clChunk(l)}")`).join(",")},()=>import("./de-DESS0001.js")`,
  `()=>import("./Jobs-JOBS0001.js"),()=>import("./ProductSuccess-PSUC0001.js"),()=>import("./Account-ACCT0001.js"),()=>import("./Changelog-CLPG0001.js"),()=>import("./Affiliates-AFFL0001.js")];`,
  `const pre=["assets/Jobs-JOBS0001.js"];const iN='body > a[href="#main-content"]';const xv="siteShell.skipToMain",oU="Skip to main content";`,
  `const uN="rb-route-announcer",dN=["#main-content","main","h1"];x("div",{id:uN,"aria-live":"polite","aria-atomic":"true"});export{lazy as a};`,
].join(",");
const GOOD = {
  jobs: 'import{a as x}from"./CompanyLander-CLND0001.js";import{r as y}from"./resumeText-RTXT0001.js";import{b}from"./index-ENTRY001.js";const n=c.toLocaleString(l);',
  lander: 't("companyProfile.facts.countriesLabelPooled");t("companyProfile.pay.floorPooled",{count:m});t("companyProfile.h1SystemBoard");t("companyProfile.h1ThisBoard");t("companyProfile.employerChipOneBoard");x("span",{"data-employer-chip-board":b});',
  decoder: 'new TextDecoder("utf-16le");new TextDecoder("utf-16be");"windows-1252";',
  idx: 'import{r}from"./resumeText-RTXT0001.js";const F=()=>import("./FreeKeywordResults-FKRS0001.js");t("ingestParsers.refusal.txtUnreadable");',
  fkr: 'x("span",{"data-hero-industry":!0,children:a});x("span",{"data-industry-label":!0,children:b});',
  ps: 'import{r as q}from"./resumeText-RTXT0001.js";t("ingestParsers.refusal.txtUnreadable");x("h3",{children:r("aiGenerationProgress.title")});',
  acc: 'n.toLocaleDateString(l,{month:"short"});',
  clp: 'x("div",{className:"space-y-10","data-changelog-lng":d});',
  aff: `const B=[${["728x90", "300x250", "160x600"].map((s) => `{png:"/affiliate/banner-${s}.png",svg:"/affiliate/banner-${s}.svg"}`).join(",")}];const N="- Shows how your file parses: the text and sections that come through, and the layouts that scramble them\\n- Lists the keywords your resume is missing";`,
  deMain: strings(pick(locale("de"), ["aiGenerationProgress"])),
  deShell: strings(json("src/i18n/shards/site-shell/de.json")),
  atDe: `<html><body><ul>${CV_LOCALES.de.content.AT.conventions.map((c) => `<li>${c}</li>`).join("")}</ul></body></html>`,
  atEn: `<html><body><ul>${COUNTRY_STANDARDS.AT.conventions.map((c) => `<li>${c}</li>`).join("")}</ul></body></html>`,
};
type Bodies = typeof GOOD;
const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(b, 0); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b.toString("base64"); };
const svg = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text x="8" y="40">Free resume scan</text></svg>`;
type Banner = { status?: number; headers?: Record<string, string>; body?: string; b64?: string };
/** Each banner as production served it on 21 November: the old addresses carry the corrected PNG at the size their label named. */
const bannerOf = (path: string): Banner => {
  const old: Record<string, [number, number]> = { leaderboard: [728, 90], square: [300, 250], skyscraper: [160, 600] };
  const m = /banner-(leaderboard|square|skyscraper)-/.exec(path);
  if (m) return { headers: { "content-type": "image/png" }, b64: png(...old[m[1]]) };
  const [w, h] = /(\d+)x(\d+)/.exec(path)!.slice(1).map(Number);
  return path.endsWith(".svg") ? { headers: { "content-type": "image/svg+xml" }, body: svg(w, h) } : { headers: { "content-type": "image/png" }, b64: png(w, h) };
};
const BANNERS = ["728x90", "300x250", "160x600"].flatMap((s) => [`/affiliate/banner-${s}.png`, `/affiliate/banner-${s}.svg`])
  .concat(["/assets/banner-leaderboard-7wRFqWjL.png", "/assets/banner-square-Cs_OOO75.png", "/assets/banner-skyscraper-CCTK8RI-.png"]);

type Over = {
  changelog?: string; chunk?: string; langs?: Partial<Record<string, string>>; en?: string; entry?: string;
  bodies?: Partial<Bodies>; build?: string | null; intel?: Record<string, string>; banners?: Record<string, Banner>;
};
function routesOf(o: Over) {
  const b = { ...GOOD, ...(o.bodies ?? {}) };
  const S = "https://site\\.test";
  const P = "https://p\\.supabase\\.co";
  const intel = Object.fromEntries(EMPLOYERS().map((e) => [e.token, JSON.stringify({ usd_n: 0, open_by_source: [{ source: e.vendor, open_roles: 5 }] })]));
  return [
    { match: `^GET ${S}/changelog$`, body: o.changelog ?? PUBLISHED_PAGE },
    { match: `^GET ${S}/$`, body: `<html><head><script type="module" crossorigin src="/assets/index-ENTRY001.js"></script></head><body></body></html>` },
    { match: `^GET ${S}/assets/index-ENTRY001\\.js$`, body: o.entry ?? ENTRY },
    { match: `^GET ${S}/assets/rb-en_all-ALL00001\\.js$`, body: o.en ?? US_STRINGS },
    { match: `^GET ${S}/assets/en-CHLG0001\\.js$`, body: o.chunk ?? PUBLISHED },
    ...LANGS.flatMap((l) => [
      { match: `^GET ${S}/assets/${re(clChunk(l))}$`, body: o.langs?.[l] ?? chunkOf(SHARDS[l]) },
      { match: `^GET ${S}/assets/${re(otherChunk(l))}$`, body: l === "de" ? b.deMain : `const s={header:{jobs:"x"}};export{s as default};` },
    ]),
    { match: `^GET ${S}/assets/de-DESS0001\\.js$`, body: b.deShell },
    { match: `^GET ${S}/assets/Jobs-JOBS0001\\.js$`, body: b.jobs },
    { match: `^GET ${S}/assets/CompanyLander-CLND0001\\.js$`, body: b.lander },
    { match: `^GET ${S}/assets/resumeText-RTXT0001\\.js$`, body: b.decoder },
    { match: `^GET ${S}/resume-checker$`, body: `<html><head><link rel="modulepreload" crossorigin href="/assets/Index-IDXX0001.js"></head></html>` },
    { match: `^GET ${S}/assets/Index-IDXX0001\\.js$`, body: b.idx },
    { match: `^GET ${S}/assets/FreeKeywordResults-FKRS0001\\.js$`, body: b.fkr },
    { match: `^GET ${S}/assets/ProductSuccess-PSUC0001\\.js$`, body: b.ps },
    { match: `^GET ${S}/assets/Account-ACCT0001\\.js$`, body: b.acc },
    { match: `^GET ${S}/assets/Changelog-CLPG0001\\.js$`, body: b.clp },
    { match: `^GET ${S}/assets/Affiliates-AFFL0001\\.js$`, body: b.aff },
    { match: `^GET ${S}/de/lebenslauf-standards/oesterreich$`, body: b.atDe },
    { match: `^GET ${S}/cv-standards/austria$`, body: b.atEn },
    { match: `^OPTIONS ${P}/functions/v1/job-board$`, status: 200, headers: o.build === null ? {} : { "x-fn-build": o.build ?? "job-board.2026-09-09.103" }, body: "" },
    ...Object.entries({ ...intel, ...(o.intel ?? {}) }).map(([tok, body]) => ({ match: `^GET ${P}/rest/v1/rpc/get_company_intel\\?p_token=${re(tok)}$`, body })),
    ...BANNERS.map((p) => ({ match: `^GET ${S}${re(p)}$`, ...(o.banners?.[p] ?? bannerOf(p)) })),
  ];
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, over: Over = {}): { lines: string[]; calls: string[]; env: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52i-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routesOf(over)));
  writeFileSync(join(dir, "calls.log"), "");
  const text = readFileSync(resolve(ROOT, "scripts/verify-deploy.d", section), "utf8");
  // The shared names every later section reads are printed after the section,
  // so a section that overwrote one shows it.
  writeFileSync(join(dir, "run.sh"), `set -u\nK=${KEY}; RB=rb_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n` + text.split("/tmp/").join(`${dir}/`) + `\nprintf '%s|%s|%s|%s|%s\\n' "$K" "$RB" "$B" "$SITE" "$UA" > "${dir}/env.out"\n`);
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const env = existsSync(join(dir, "env.out")) ? readFileSync(join(dir, "env.out"), "utf8").trim() : "";
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), env, out };
}
const memo = <T,>(f: () => T) => { let v: T | undefined; return () => (v ??= f()); };
const PUBLISHED_RUN = memo(() => run(S52I));
const BEFORE_RUN = memo(() => run(S52I, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED }));
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const verdictOf = (lines: string[], check: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${check} `).test(l));

const MUSTS = () => heredoc("VD52I_MUST").map((x) => ({ id: x.split("|")[0], must: x.split("|").slice(1).join("|") }));
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;
const LATEST_OK = `PASS  /changelog's description names an entry of 2026-11-21 as the newest, no older than this batch's 2026-11-21`;
const langPass = (l: string) => `PASS  the ${l} changelog strings (${clChunk(l)}) carry all five 21 November entries`;

describe("section 52i pins each entry's claims to a check", () => {
  it("lists exactly the five titles, in order, each with the date their deploy went live", () => {
    expect(heredoc("VD52I_TITLES")).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("lists one string per entry that holds its claims, each in that entry's description and found once in the whole US shard", () => {
    const listed = MUSTS();
    expect(listed.map((x) => x.id)).toEqual(IDS);
    const whole = source("src/i18n/changelog/en.json");
    for (const { id, must } of listed) {
      expect(EN[id].description, id).toContain(must);
      expect(whole.split(must).length - 1, `${must} is found once in the US shard`).toBe(1);
      expect(must, `${must} holds no quote mark the bundle might escape`).not.toMatch(/['"‘’“”]/);
      expect(must, `${must} is plain ASCII, which the bundle never escapes`).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("names a claim for every entry, each claim's words once in its entry's English description", () => {
    const claims = CLAIMS();
    expect([...new Set(claims.map((c) => c.id))]).toEqual(IDS);
    for (const c of claims) expect(EN[c.id].description.split(c.words).length - 1, `${c.check} ${c.id}: "${c.words}"`).toBe(1);
    expect(CHECKS()).toEqual(["B1", "B2", "C1", "C2", "C3", "C4", "L1", "L2", "L3", "L4", "U1", "U2", "U3", "U4", "K1", "K2", "K3"]);
  });

  it("every sentence of every English description carries a claim the section checks, so no sentence ships unread", () => {
    for (const id of IDS) {
      const mine = CLAIMS().filter((c) => c.id === id);
      for (const s of sentencesOf(EN[id].description)) expect(mine.some((c) => s.includes(c.words)), `${id}: "${s}" carries no claim 52i checks`).toBe(true);
    }
    expect(sentencesOf(EN[COMPANY].description)).toHaveLength(5);
  });

  it("each claim the entries make is a limit the English holds, so the check and the wording cannot drift apart", () => {
    for (const c of CLAIMS()) expect(LIMITS[c.id].must.some((m) => m.includes(c.words) || c.words.includes(m)), `${c.check}: "${c.words}"`).toBe(true);
  });

  it("the bake's clamp cuts this batch's first title, and the date it reads comes before the cut", () => {
    const content = /<meta name="description" content="([^"]*)"/.exec(PUBLISHED_PAGE)?.[1] ?? "";
    expect(content.length).toBeLessThanOrEqual(160);
    expect(content).toContain(`Latest (${DATE}): `);
  });
});

describe("section 52i judges the five entries on the crawler page, as 52h does", () => {
  it("before the publish every line about the entries is INFO, every claim is judged and passes, and only GETs and one preflight are sent, to no language but German and never to en-GB", () => {
    const { lines, calls, out } = BEFORE_RUN();
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 21 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS") && !/^PASS {2}[A-Z]\d /.test(l)), show(lines)).toEqual([]);
    expect(lines, show(lines)).toContain("INFO  the other eight languages' changelog strings are judged after the publish");
    for (const c of CHECKS()) expect(verdictOf(lines, c), `${c}${show(lines)}`).toEqual([expect.stringMatching(/^PASS /)]);
    for (const c of calls) expect(c, c).toMatch(/^(GET |OPTIONS https:\/\/p\.supabase\.co\/functions\/v1\/job-board$)/);
    expect(calls.filter((c) => c.startsWith("OPTIONS"))).toHaveLength(1);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
    for (const l of LANGS.filter((x) => x !== "de")) expect(calls.some((c) => c.includes(`/assets/${l}-`)), l).toBe(false);
    expect(out).not.toContain(KEY);
  });

  it("after the publish each title, description and language passes, the clamped description names an entry of 21 November as newest, and every claim passes", () => {
    const { lines } = PUBLISHED_RUN();
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    for (const { id, must } of MUSTS()) expect(lines, show(lines)).toContain(`PASS  the US English changelog strings describe ${id} with "${must}"`);
    for (const l of LANGS) expect(lines, show(lines)).toContain(langPass(l));
    expect(lines, show(lines)).toContain(LATEST_OK);
    for (const c of CHECKS()) expect(verdictOf(lines, c), `${c}${show(lines)}`).toEqual([expect.stringMatching(/^PASS /)]);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("section 52h still passes the 19 November entries on the page this batch publishes, with the five on top", () => {
    const { lines } = run(S52H);
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^PASS {2}the US English changelog chunk .* carries the 19 November entries/.test(l)), show(lines)).toBe(true);
    expect(lines, show(lines)).toContain(`PASS  /changelog's description names an entry of 2026-11-21 as the newest, no older than this batch's 2026-11-19`);
  });

  it("leaves the key, the project, the site and the user agent every later section reads as it found them", () => {
    for (const r of [PUBLISHED_RUN(), BEFORE_RUN()]) expect(r.env, show(r.lines)).toBe(`${KEY}|rb_test|https://p.supabase.co|https://site.test|ua`);
  });

  it("a description reworded under the same title FAILs, though its title passes", () => {
    const m = MUSTS().find((x) => x.id === LANG)!;
    const reworded = { ...EN, [LANG]: { ...EN[LANG], description: EN[LANG].description.replace(m.must, "now changes on every page, always") } };
    const { lines } = run(S52I, { chunk: chunkOf(reworded) });
    expect(fails(lines), show(lines)).toEqual([`FAIL  the US English changelog strings carry no "${m.must}" for ${LANG}: its description is not the one read live on 21 November`]);
    expect(lines, show(lines)).toContain(onPage(TITLES[2]));
  });

  it("an entry missing in any language FAILs, and so does a language the entry names no changelog chunk for", () => {
    const de = chunkOf(Object.fromEntries(Object.entries(SHARDS.de).filter(([k]) => k !== AFF)));
    const gb = chunkOf(Object.fromEntries(Object.entries(SHARDS["en-GB"]).filter(([k]) => k !== BOARD && k !== TXT)));
    const { lines } = run(S52I, { langs: { de, "en-GB": gb, nl: `const s={header:{jobs:"x"}};export{s as default};` } });
    expect(fails(lines), show(lines)).toEqual([
      `FAIL  the en-GB changelog strings (${clChunk("en-GB")}) lack ${BOARD} ${TXT}: the publish did not ship the 21 November entries in en-GB`,
      `FAIL  the de changelog strings (${clChunk("de")}) lack ${AFF}: the publish did not ship the 21 November entries in de`,
      "FAIL  no nl changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 21 November entries cannot be shown in nl",
    ]);
    for (const l of LANGS.filter((x) => !["de", "nl", "en-GB"].includes(x))) expect(lines, show(lines)).toContain(langPass(l));
  });

  it("a wrong date FAILs", () => {
    const moved = crawler(rowsOf(AT, AT + 30).map((r) => (r.title === TITLES[3].title ? { ...r, date: "2026-11-20" } : r)));
    const { lines } = run(S52I, { changelog: moved });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog dates "${TITLES[3].title}" 2026-11-20, want 2026-11-21, the day its deploy went live`]);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52I, { changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[4].title)) }).lines;
    expect(lost, show(lost)).toContain(notRebuilt(TITLES[4]));
    const without = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== IDS[4])));
    const gone = run(S52I, { chunk: without, changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[4].title)) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 21 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[4].title}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not, title or description", () => {
    const pushed = run(S52I, { changelog: crawler(filler(30, "2026-12-01", "A newer entry")) }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(pastPage(t));
    const stale = run(S52I, { changelog: BEFORE_PAGE }).lines;
    for (const t of TITLES) expect(stale, show(stale)).toContain(notRebuilt(t));
    expect(stale, show(stale)).toContain(`FAIL  /changelog's description names an entry of 2026-11-19 as the newest, older than this batch's 2026-11-21 (the prerender did not rebuild)`);
  });

  it("thirty entries older than the batch cannot have pushed it off, nor can fewer than thirty newer ones: FAIL", () => {
    const older = run(S52I, { changelog: crawler(filler(30, "2026-11-20", "An entry of 20 November")) }).lines;
    for (const t of TITLES) expect(older, show(older)).toContain(notRebuilt(t));
    const few = run(S52I, { changelog: crawler(filler(29, "2026-12-01", "A newer entry")) }).lines;
    for (const t of TITLES) expect(few, show(few)).toContain(notRebuilt(t));
  });

  it("a description the bake left on an older newest entry FAILs, though every title is listed, and so does one that names none", () => {
    const page = PUBLISHED_PAGE.replace(/Latest \(2026-11-21\): [^"]*/, `Latest (2026-11-19): ${esc(EN.addToClaudeOpensClaudesConnectorDialogFilledIn.title)}.`);
    expect(page).not.toBe(PUBLISHED_PAGE);
    const { lines } = run(S52I, { changelog: page });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog's description names an entry of 2026-11-19 as the newest, older than this batch's 2026-11-21 (the prerender did not rebuild)`]);
    const none = run(S52I, { changelog: PUBLISHED_PAGE.replace(/Latest \([^"]*/, "No entries yet.") }).lines;
    expect(none.some((l) => /^FAIL {2}\/changelog's description names no newest entry/.test(l)), show(none)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52I, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL {2}no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY CLAIM CAN FAIL. Each run below breaks one claim of each of several
// entries at once, each in data only its own check reads; the broken claims
// FAIL and every other claim still passes, so each FAIL is its own check's.
describe("section 52i fails each claim the entries make when production stops holding it", () => {
  const judged = (over: Over, broken: Record<string, RegExp>, info: Record<string, RegExp> = {}) => {
    const { lines } = run(S52I, over);
    for (const c of CHECKS()) {
      const v = verdictOf(lines, c);
      expect(v, `${c}${show(lines)}`).toHaveLength(1);
      if (broken[c]) expect(v[0], `${c} should FAIL${show(lines)}`).toMatch(new RegExp(`^FAIL {2}${c} ${broken[c].source}`));
      else if (info[c]) expect(v[0], `${c} should be INFO${show(lines)}`).toMatch(new RegExp(`^INFO {2}${c} ${info[c].source}`));
      else expect(v[0], `${c} should PASS${show(lines)}`).toMatch(/^PASS /);
    }
    // The publication lines are untouched by a broken claim.
    expect(fails(lines).filter((l) => !/^FAIL {2}[A-Z]\d /.test(l)), show(lines)).toEqual([]);
  };
  const tok = (i: number) => EMPLOYERS()[i].token;
  const enWith = (f: (s: string) => string) => { const s = f(US_STRINGS); expect(s).not.toBe(US_STRINGS); return s; };

  it("an older board build, a countries line in no English, a bare figure, a .txt read as UTF-8 and a banner of another size", () => {
    judged({
      build: "job-board.2026-09-09.102",
      en: enWith((s) => s.replace("Most roles across the {{company}} hiring system in", "Most roles in")),
      bodies: {
        lander: GOOD.lander + "const v=n.toLocaleString();",
        ps: GOOD.ps + 'if(f.type==="text/plain"){const s=await f.text()}',
      },
      banners: { "/affiliate/banner-300x250.png": { headers: { "content-type": "image/png" }, b64: png(512, 512) } },
    }, {
      B1: /job-board answers job-board\.2026-09-09\.102 \(want 2026-09-09\.103 or later\)/,
      C1: /the US English strings lack "Most roles across/,
      L1: /the browser still picks the language of a figure or a date in the board x1/,
      U1: /a \.txt is still read with the UTF-8-only File text\(\) in the success page/,
      K1: /\/affiliate\/banner-300x250\.png answers 200 image\/png at 512x512 \(want 200 image\/png at 300x250\)/,
    });
  });

  it("no employer serving, no unnamed-board heading, notes that ignore the language, no refusal key and an old address gone", () => {
    judged({
      intel: Object.fromEntries(EMPLOYERS().map((e) => [e.token, JSON.stringify({ open_by_source: [{ source: e.vendor, open_roles: 0 }] })])),
      en: enWith((s) => s.replace("Roles on this board", "Roles here")),
      bodies: { clp: 'x("div",{className:"space-y-10"});', ps: GOOD.ps.replace('t("ingestParsers.refusal.txtUnreadable");', "") },
      banners: { "/assets/banner-square-Cs_OOO75.png": { status: 404, headers: { "content-type": "text/html" }, body: "<html>not found</html>" } },
    }, {
      B2: /none of the 6 employers the board-search entry names serves an open role/,
      C2: /the US English strings lack "Roles on this board"/,
      L2: /the changelog page chunk Changelog-CLPG0001\.js carries no data-changelog-lng/,
      U2: /the success page carry no ingestParsers\.refusal\.txtUnreadable/,
      K2: /\/assets\/banner-square-Cs_OOO75\.png answers 404/,
    });
  });

  it("an answer that cannot be read, a badge that names no board, no German skip link, the report's own map and a newsletter that promises algorithms", () => {
    judged({
      intel: { [tok(3)]: "<html>bad gateway</html>" },
      bodies: {
        lander: GOOD.lander.replace('x("span",{"data-employer-chip-board":b});', ""),
        deShell: strings({ siteShell: { skipToMain: "Skip to main content" } }),
        fkr: GOOD.fkr + 'const M={creative:"Creative/Design",hr:"Human Resources"};',
        aff: GOOD.aff + 'const O="Analysis against real ATS algorithms";',
      },
    }, {
      B2: /get_company_intel answered no open_by_source for SiPearl \(teamtailor:sipearl\)/,
      C3: /the Jobs chunk Jobs-JOBS0001\.js and its imports lack data-employer-chip-board/,
      L3: /no de-\*\.js chunk the entry names says Zum Hauptinhalt springen/,
      U3: /it still carries the card's own label map/,
      K3: /the kit still promises "real ATS algorithms"/,
    });
  });

  it("no build at all, Zeugnisse expected again, no route announcer, a progress string that names a model and an SVG served as the app shell", () => {
    judged({
      build: null,
      entry: ENTRY.replace('const uN="rb-route-announcer",', "const uN=null,"),
      en: enWith((s) => s.replace("Reading your resume, step by step", "Using Gemini Pro for maximum accuracy")),
      bodies: { atDe: GOOD.atDe.replace("</ul>", "<li>Zeugnisse werden erwartet</li></ul>") },
      banners: { "/affiliate/banner-160x600.svg": { headers: { "content-type": "text/html" }, body: "<!doctype html><div id=root></div>" } },
    }, {
      B1: /job-board answers no build \(want 2026-09-09\.103 or later\)/,
      C4: /the German page still says Zeugnisse werden erwartet/,
      L4: /the entry lacks "rb-route-announcer"/,
      U4: /a progress string names a model \(Gemini\)/,
      K1: /\/affiliate\/banner-160x600\.svg answers 200 text\/html/,
    });
  });

  it("an English Austria page without the titles, an account figure in the browser's language, a reader that cannot decode UTF-16 big-endian, an overlay that names GPT-5 and a kit that drops an address", () => {
    judged({
      bodies: {
        atEn: GOOD.atEn.replace("<li>Formal titles (Mag., Dipl.-Ing.) matter more than in Germany</li>", ""),
        acc: GOOD.acc + "const f=new Intl.NumberFormat();",
        decoder: 'new TextDecoder("utf-16le");"windows-1252";',
        ps: GOOD.ps + 'x("h3",{children:"GPT-5 is Working"});',
        aff: GOOD.aff.replace('svg:"/affiliate/banner-728x90.svg"', 'svg:"/assets/banner-728x90-AbC123.svg"'),
      },
    }, {
      C4: /the English page lacks "Formal titles \(Mag\., Dipl\.-Ing\.\) matter more than in Germany"/,
      L1: /the browser still picks the language of a figure or a date in the account page x1/,
      U1: /no résumé text reader that decodes utf-16le and utf-16be is imported/,
      U4: /the success page ProductSuccess-PSUC0001\.js still writes "GPT-5"/,
      K1: /the kit Affiliates-AFFL0001\.js does not name \/affiliate\/banner-728x90\.svg/,
    });
  });

  it("one employer at zero is INFO while the rest serve; a Pay median in no English, a skip link the entry never localises, a report without its marks, no German progress title and an old address serving the old JPEG FAIL", () => {
    const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000", "hex").toString("base64");
    judged({
      intel: { [tok(5)]: JSON.stringify({ open_by_source: [{ source: "lever", open_roles: 0 }] }) },
      en: enWith((s) => s.split("on this employer's whole hiring system").join("on this board")),
      entry: ENTRY.replace('const xv="siteShell.skipToMain",', 'const xv="x",'),
      bodies: { fkr: 'x("span",{children:a});', deMain: strings({ aiGenerationProgress: { title: "AI is working" } }) },
      banners: { "/assets/banner-leaderboard-7wRFqWjL.png": { headers: { "content-type": "image/png" }, b64: jpeg } },
    }, {
      C1: /the US English strings lack "on this employer's whole hiring system"/,
      L3: /the entry lacks "siteShell\.skipToMain"/,
      U3: /the report chunk FreeKeywordResults-FKRS0001\.js lacks the hero mark/,
      U4: /no de-\*\.js chunk the entry names says Die KI arbeitet/,
      K2: /\/assets\/banner-leaderboard-7wRFqWjL\.png answers 200 image\/png \(want 200 image\/png at 728x90\)/,
    }, {
      B2: /5 of 6 employers the entry names serve open roles .*Mythic lever:mythic-ai\.com 0 serve none today/,
    });
  });

  it("an employer's roles under another hiring system are not its own", () => {
    judged({ intel: Object.fromEntries(EMPLOYERS().map((e) => [e.token, JSON.stringify({ open_by_source: [{ source: "workday", open_roles: 40 }] })])) }, {
      B2: /none of the 6 employers the board-search entry names serves an open role under its own hiring system/,
    });
  });
});
