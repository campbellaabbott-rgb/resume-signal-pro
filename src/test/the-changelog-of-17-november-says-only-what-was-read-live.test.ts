// @vitest-environment node
/**
 * THE CHANGELOG OF 17 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Six entries for the deploy that went live and verified on 17 November: the
 * free scan's build, the board's next build, the migrations of that round and
 * the frontend with them. Every claim was read against production that day,
 * read-only: the free scan's live build stamp (no scan was run, so that entry
 * says only what the code at that build does), job-board probes of the lists
 * that were too big, of the boards that posted in bulk and their kept twins,
 * and of the country filter, the site's own company name list, and the crawler
 * copies of a job page whose title was typed in capitals and of a posting only
 * an employer's own staff may apply for. Where the read covered less than a
 * first wording said, the entry says only what held. Those limits are held
 * here:
 *   - the free-scan entry is about words found anywhere in the text, never
 *     headings; names exactly the eight languages the code reads besides
 *     English; says the keywords are still matched only in English and that
 *     the credit is a limited share in step with length, not a reading; keeps
 *     "no keyword credit" for a résumé placed in no field; measures nothing
 *     (no score, never "the same score as in English"); and names no paid tool
 *     and no fallback;
 *   - the oversize-list entry says several, never all, keeps that some lists
 *     are still too big (twenty-five boards still were, some serving none),
 *     names only the four employers the site's name list spells that way,
 *     promises no company page (the crawler copy of TransPerfect's says it has
 *     none) and no full description, and names no hiring system;
 *   - the bulk-board entry names no aggregator, says "a few", never calls them
 *     re-posters or spam, and claims the kept copy only for the duplicated
 *     pairs (not the repointed boards, the agency labels or renamed employers);
 *   - the country entry leads with Hong Kong and keeps that many such jobs are
 *     still filed under China until they are read again, claims neither Macau
 *     nor Taiwan (Taipei rows still read China), names only the four new
 *     countries the filter was read on, keeps "as we read them again" for the
 *     older rows, and keeps the pay half to "a few" with no figure;
 *   - the capitals entry names the four places that changed and keeps the two
 *     that did not (the trail of links above the heading, and the board), says
 *     the pages "no longer print" a logo caption (the stored rows still carry
 *     it), claims no careers-site web address, and quotes no caption, title or
 *     employer;
 *   - the staff-only entry keeps that these jobs still show and their pages
 *     still open, says "a page of this kind" (one page was asked to be left
 *     out), and says nothing of paid-survey ads, which this deploy did not
 *     remove.
 * In every language: no digit, no internal name, Portuguese that is
 * Brazilian, Hindi in Devanagari. British English is the US text with CV for
 * résumé and nothing else changed, each other language carries its own words
 * for the limits above, and every translation is pinned by a hash of its
 * reviewed text, so a reworded one fails until it is read again.
 *
 * Section 52f of the verifier judges the six on the crawler copy of
 * /changelog once the frontend publish carries them. It runs here in bash
 * against a fake curl, as section 52e does in the 15 November test.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { changelog } from "../data/changelog";
import { employerName } from "../lib/company-display";
import { titleFromCapitals } from "../lib/seo/display-case";
import { detectCountry } from "../../supabase/functions/job-board/normalize";
import { internalBoardReason, internalOnlyTextReason } from "../../scripts/prerender-posting-rule.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const SHARDS = Object.fromEntries(LOCALES.map((l) => [l, shard(l)])) as Record<Locale, Record<string, Text>>;
const locale = (l: string) => JSON.parse(readFileSync(resolve(ROOT, `src/i18n/locales/${l}.json`), "utf8")) as Record<string, Record<string, unknown>>;
const label = (l: string, path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], locale(l)) as string;
const source = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SCAN = "aResumeInAnotherLanguageIsNoLongerScoredAsEnglish";
const OVERSIZE = "severalEmployersWhoseListsWereTooBigNowShowTheirJobs";
const BULK = "boardsThatPostedInBulkAndSecondCopiesOfJobsLeaveTheBoard";
const COUNTRY = "moreJobsFiledInTheirOwnCountryAndUsPayInUsDollars";
const CAPITALS = "jobPagesWriteCapitalsTitlesNormallyAndNoLogoNamesTheEmployer";
const STAFF = "jobsOnlyStaffMayApplyForAreNotOfferedToSearchEngines";
const DATE = "2026-11-17";

/** Newest first, as changelog.ts lists them, with the tags each claims. */
const ENTRIES: Array<{ id: string; date: string; tags: string[] }> = [
  { id: SCAN, date: DATE, tags: ["fixed"] },
  { id: OVERSIZE, date: DATE, tags: ["new"] },
  { id: BULK, date: DATE, tags: ["fixed"] },
  { id: COUNTRY, date: DATE, tags: ["fixed"] },
  { id: CAPITALS, date: DATE, tags: ["fixed"] },
  { id: STAFF, date: DATE, tags: ["fixed"] },
];
const IDS = ENTRIES.map((e) => e.id);
const AT = changelog.findIndex((e) => e.id === IDS[0]);
const EN = SHARDS.en;
const textOf = (l: Locale, id: string) => `${SHARDS[l][id].title} ${SHARDS[l][id].description}`;
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: textOf(l, id) })));

describe("the six entries", () => {
  it("sit together, newest first, dated the day their deploy went live, with nothing older above them and the 15 November entries next", () => {
    expect(AT, `${IDS[0]} is missing from changelog.ts`).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(AT, AT + ENTRIES.length)).toEqual(ENTRIES);
    for (const e of changelog.slice(0, AT)) expect(e.date >= DATE, `${e.id} (${e.date}) sits above the 17 November entries but is older`).toBe(true);
    expect(changelog[AT + ENTRIES.length].id, "the 15 November entries come next").toBe("aJobPageSaysWhenItsEmployerClosedThePosting");
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

  it("each shard lists them last, in this order, after the 15 November entries", () => {
    for (const l of LOCALES) {
      const keys = Object.keys(SHARDS[l]);
      expect(keys.slice(-IDS.length), l).toEqual(IDS);
      expect(keys[keys.length - IDS.length - 1], l).toBe("theFooterLinksOurDataPages");
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

describe("each English description carries the limit the live read set, and not a wording it did not hold", () => {
  const LIMITS: Record<string, { must: string[]; mustNot: Array<[string, RegExp]> }> = {
    [SCAN]: {
      must: [
        "they looked only for the English words for experience, education and skills",
        "uses that language's own words for at least two of experience, education and skills",
        "The keywords are still matched only in English",
        "the scan credits a limited share of them, in step with its length",
        "it still gives no keyword credit",
        "is scored by the same rules as before",
      ],
      mustNot: [
        // The check finds the language's words anywhere in the text.
        ["headings, where the check reads words anywhere in the text", /heading/i],
        // No scan was run: the code at the live build is what was read.
        ["a measured score or a promise of the English score", /same score|as in English|\d/i],
        ["keywords read in the résumé's own language", /keywords? (?:are|is) (?:now )?read in|read(?:s)? (?:the )?keywords in (?:Spanish|French|German|Portuguese|Dutch|Italian|Hindi|Tagalog)/i],
        ["a paid tool or the other path", /Full Analysis|Pro\b|paid|fallback|stream/i],
        ["a language the code does not read", /Chinese|Japanese|Korean|Russian|Arabic|Polish|Turkish|Swedish|Indonesian|Vietnamese/i],
        ["privacy", /privacy/i],
      ],
    },
    [OVERSIZE]: {
      must: ["We now read several of them a posting at a time", "Some lists are still too big for us, so not every such employer shows yet."],
      mustNot: [
        // Twenty-five boards were still oversize, and some serve none.
        ["every such list, or all of them", /\bevery (?:big|large|such) (?:list|employer|board)\b(?! shows yet)|\ball (?:big|large) |no longer too big/i],
        ["a count", /\d/],
        ["a company page the crawler copy says it does not have", /company page|employer page|page of its own/i],
        ["a held, agency or vendor board", /Workable|Recruitee|Pinpoint|agency|held/i],
        ["a full description nobody read", /full description|whole description|complete description/i],
      ],
    },
    [BULK]: {
      must: ["A few boards posted jobs in bulk rather than as an employer's own hiring page.", "the copy we kept still lists the employer's jobs"],
      mustNot: [
        ["an aggregator's name", /EUTALENTS|Jobs for Humanity|JobsForHumanity|S&P/i],
        ["a charge the read did not prove", /re-?post|spam|scrap/i],
        ["a company page, whose crawler copy keeps its old title until the next bake", /company page|employer page/i],
        ["the repointed boards, agency labels or renamed employers", /agency|renamed|moved to|now read from/i],
        ["a count", /\d/],
      ],
    },
    [COUNTRY]: {
      must: [
        "When we read such a job again, it is now filed under Hong Kong",
        "many are still filed under China until we read them again",
        "older ones follow as we read them again",
        "And a few jobs in US towns",
      ],
      mustNot: [
        ["every Hong Kong job, or every job", /every|all (?:Hong Kong )?jobs/i],
        ["Macau or Taiwan, whose rows still read China", /Maca[ou]|Taiwan|Taipei/i],
        ["a country the filter was not read on", /Ghana|Qatar|Sri Lanka|Bangladesh|Ethiopia|Uganda|Tanzania|Rwanda|Senegal|Nepal|Cameroon|Algeria|Vienna|Wien|Austria/i],
        ["a pay filter or a sort", /all pay|filter by pay|sort/i],
        ["a count", /\d/],
        ["an employer's name", /JLL|Bristol|Myers|Squibb|Boskalis|Lesaffre|Mirantis|Tickmill/i],
        ["the work-mode fix or the street rule", /remote|hybrid|street/i],
      ],
    },
    [CAPITALS]: {
      must: [
        "in the heading you see, the browser tab, the description search engines show and the job details they read",
        "the trail of links above the heading still shows the title as the employer typed it",
        "On the board itself, a job's title still shows as the employer typed it.",
        "no longer print such a caption as the employer",
      ],
      mustNot: [
        ["the whole page, or everywhere", /shout|everywhere|every place|whole page/i],
        ["a careers-site web address", /web address|address|\.ca\b|domain/i],
        ["a caption, an example title or an employer", /MONOGRAM|ORANGE|Trailborn|Inova|Micron|Sentara|MFG|Email Signature|colou?r/i],
        ["a name corrected at the source or in our rows", /corrected|renamed|stored|our data/i],
        ["a count", /\d/],
      ],
    },
    [STAFF]: {
      must: ["a page of this kind that we had listed for search engines now asks them to leave it out", "These jobs still show on our board, and their pages still open"],
      mustNot: [
        ["a page taken away", /no longer (?:has|have|gets?) a page|page (?:was|is) (?:removed|gone)|removed from (?:our|the) board/i],
        ["a count, or every such page", /\d|pages of this kind|every such page|all such/i],
        ["the survey ads this deploy did not remove", /survey|panel|paid to/i],
        ["an employer or board", /Coupang/i],
        ["pages search engines can no longer find", /cannot find|can no longer find|hidden from search/i],
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
      for (const [why, re] of mustNot) expect(textOf(l, id), `${l}: ${why}`).not.toMatch(re);
    }
  });

  it("the pay sentence of the country entry claims no filter, sort or every job", () => {
    for (const l of ["en", "en-GB"] as const) {
      const pay = SHARDS[l][COUNTRY].description.split(/(?<=[.;])\s+/).filter((x) => /dollars/.test(x)).join(" ");
      expect(pay, l).toMatch(/a few jobs/);
      expect(pay, l).not.toMatch(/every|all pay|filter by pay|sort/i);
    }
  });

  it("British English is the US text with CV for résumé, and nothing else changed", () => {
    for (const id of IDS) {
      const us = EN[id];
      expect(SHARDS["en-GB"][id], id).toEqual({ title: us.title.replace(/résumé/g, "CV"), description: us.description.replace(/résumé/g, "CV") });
    }
    expect(EN[SCAN].title).toMatch(/résumé/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SAME LIMITS IN EACH LANGUAGE'S OWN WORDS. The English limits above read
// only English, so a translation reworded into a claim the English refuses
// (headings, every list, every Hong Kong job, a page removed) would pass while
// its English stayed right. Each language carries the words its own text uses
// for the limit, and the words it would use to break it.
type Other = Exclude<Locale, "en" | "en-GB">;
const OTHERS = LOCALES.filter((l): l is Other => l !== "en" && l !== "en-GB");
const LOCAL: Record<string, Record<Other, { must: string[]; mustNot: RegExp }>> = {
  // words not headings; keywords still English; a limited share, not a reading;
  // no field, no credit; nothing measured; free scan only
  [SCAN]: {
    de: {
      must: ["die eigenen Wörter dieser Sprache", "mindestens zwei der Begriffe Berufserfahrung, Ausbildung und Kenntnisse", "Die Schlüsselwörter werden weiterhin nur auf Englisch abgeglichen", "einen begrenzten Anteil der Schlüsselwörter an, im Verhältnis zu seiner Länge", "rechnet er weiterhin keine Schlüsselwörter an", "nach denselben Regeln bewertet wie bisher", "Der kostenlose Scan"],
      mustNot: /Überschrift|Abschnitt|Full Analysis|\bpro\b|kostenpflichtig|bezahlt|Fallback|gleichen Score|denselben Score|wie auf Englisch/i,
    },
    es: {
      must: ["las palabras propias de ese idioma", "al menos dos de los conceptos experiencia, formación y habilidades", "Las palabras clave se siguen comparando solo en inglés", "computa a su favor una parte limitada de ellas, en proporción a su longitud", "sigue sin computar a su favor ninguna palabra clave", "se puntúan con las mismas reglas que antes", "El escaneo gratis"],
      mustNot: /encabezado|sección|secciones|Full Analysis|\bpro\b|de pago|alternativ|misma puntuación/i,
    },
    fr: {
      must: ["les mots propres à cette langue", "au moins deux des trois notions d'expérience, de formation et de compétences", "Les mots-clés sont toujours comparés uniquement en anglais", "le scan lui accorde donc une part limitée de ces mots-clés, proportionnelle à sa longueur", "il ne lui accorde toujours aucun crédit pour les mots-clés", "sont notés selon les mêmes règles qu'avant", "Le scan gratuit"],
      mustNot: /\btitres?\b|intitulé|en-tête|\bsections?\b|Full Analysis|\bpro\b|payant|même score/i,
    },
    hi: {
      must: ["उसी भाषा के अपने शब्द", "कम से कम दो", "कीवर्ड अब भी सिर्फ़ अंग्रेज़ी में मिलाए जाते हैं", "एक सीमित हिस्से का श्रेय देता है, उसकी लंबाई के अनुपात में", "वह अब भी कीवर्ड का कोई श्रेय नहीं देता", "पहले जैसे ही नियमों से", "मुफ़्त स्कैन"],
      mustNot: /शीर्षक|हेडिंग|Full Analysis|सशुल्क|पेड|वही स्कोर/,
    },
    nl: {
      must: ["de eigen woorden van die taal", "minstens twee van werkervaring, opleiding en vaardigheden", "De trefwoorden worden nog steeds alleen in het Engels vergeleken", "kent de scan er een beperkt deel van toe, in verhouding tot de lengte", "dan kent hij nog steeds geen trefwoorden toe", "volgens dezelfde regels beoordeeld als voorheen", "De gratis scan"],
      mustNot: /\bkop\b|kopje|sectie|Full Analysis|\bpro\b|betaald|dezelfde score/i,
    },
    pt: {
      must: ["as palavras do próprio idioma", "pelo menos duas", "As palavras-chave continuam sendo identificadas apenas em inglês", "dá crédito a uma parcela limitada delas, de acordo com o tamanho", "ela continua sem dar nenhum crédito por palavras-chave", "pelas mesmas regras de antes", "A análise gratuita"],
      mustNot: /títul|cabeçalho|seção|seções|Full Analysis|\bpro\b|mesma pontuação/i,
    },
    tl: {
      must: ["sariling mga salita ng wikang iyon", "hindi bababa sa dalawa", "Sa Ingles lang pa rin itinutugma ang mga keyword", "credit sa limitadong bahagi lang ng mga ito, na umaayon sa haba nito", "wala pa rin itong ibinibigay na keyword credit", "parehong mga panuntunan gaya ng dati", "libreng scan"],
      mustNot: /heading|Full Analysis|\bpro\b|bayad|parehong iskor/i,
    },
  },
  // several, never all; some lists still too big; no company page, full
  // description, hiring system or agency
  [OVERSIZE]: {
    de: { must: ["Mehrere davon", "Manche Listen sind für uns noch immer zu groß", "noch nicht jeder dieser Arbeitgeber", "Noch in diesem Monat"], mustNot: /\balle\b|Unternehmensseite|vollständig|Agentur|zurückgestellt|Workable|Recruitee|Pinpoint/i },
    es: { must: ["varias de ellas", "Algunas listas siguen siendo demasiado grandes para nosotros", "todavía no aparecen todos esos empleadores", "Este mismo mes"], mustNot: /todas las listas|página de empresa|descripción completa|agencia|Workable|Recruitee|Pinpoint/i },
    fr: { must: ["Nous en lisons désormais plusieurs", "Certaines listes restent trop grandes pour nous", "certains de ces employeurs n'apparaissent pas encore", "Plus tôt ce mois-ci"], mustNot: /\btous\b|\btoutes\b|page entreprise|description complète|agence|Workable|Recruitee|Pinpoint/i },
    hi: { must: ["उनमें से कई", "कुछ सूचियाँ अब भी हमारे लिए बहुत बड़ी हैं", "ऐसे सभी नियोक्ता अभी नहीं दिखते"], mustNot: /कंपनी पेज|पूरा विवरण|एजेंसी|Workable|Recruitee|Pinpoint/ },
    nl: { must: ["Meerdere daarvan", "Sommige lijsten zijn nog steeds te groot voor ons", "nog niet elke werkgever van dit soort staat erop", "Eerder deze maand"], mustNot: /\balle\b|bedrijfspagina|volledige|bureau|Workable|Recruitee|Pinpoint/i },
    pt: { must: ["várias delas", "Algumas listas ainda são grandes demais para nós", "nem todos esses empregadores aparecem ainda"], mustNot: /página de empresa|descrição completa|agência|Workable|Recruitee|Pinpoint/i },
    tl: { must: ["ang ilan sa mga ito", "May ilang listahan na masyadong malaki pa rin para sa amin", "hindi pa lumalabas ang lahat ng ganitong employer"], mustNot: /company page|full description|agency|Workable|Recruitee|Pinpoint/i },
  },
  // a few, unnamed; in bulk rather than an employer's own page; one kept copy
  // for the duplicated pairs only
  [BULK]: {
    de: { must: ["Ein paar Quellen", "in großen Mengen und nicht als die eigene Karriereseite eines Arbeitgebers", "Bei diesen behalten wir jetzt eine Kopie"], mustNot: /kopiert|Spam|umbenannt|Agentur|Unternehmensseite|EUTALENTS|Humanity|S&P/i },
    es: { must: ["Unas pocas fuentes", "en bloque, y no como la página de empleo propia de un empleador", "En esos casos ahora conservamos una sola copia"], mustNot: /copiad|spam|agencia|renombr|página de empresa|EUTALENTS|Humanity|S&P/i },
    fr: { must: ["Quelques sources", "en masse, et non comme la page de recrutement propre d'un employeur", "Pour ces employeurs, nous ne gardons désormais qu'une copie"], mustNot: /copiées|spam|agence|renommé|page entreprise|EUTALENTS|Humanity|S&P/i },
    hi: { must: ["कुछ बोर्ड", "किसी नियोक्ता के अपने हायरिंग पेज की तरह नहीं, बल्कि थोक में", "जो प्रति हमने रखी है वह अब भी नियोक्ता की नौकरियाँ दिखाती है"], mustNot: /स्पैम|एजेंसी|कंपनी पेज|EUTALENTS|Humanity|S&P/ },
    nl: { must: ["Een paar bronnen", "in bulk in plaats van als de eigen vacaturepagina van een werkgever", "Daarvan bewaren we nu één kopie"], mustNot: /gekopieerd|spam|bureau|hernoemd|bedrijfspagina|EUTALENTS|Humanity|S&P/i },
    pt: { must: ["Alguns poucos quadros", "em massa, e não como a página de recrutamento do próprio empregador", "a cópia que mantivemos continua listando as vagas do empregador"], mustNot: /republic|spam|agência|renomead|página de empresa|EUTALENTS|Humanity|S&P/i },
    tl: { must: ["May iilang board", "nang maramihan sa halip na bilang sariling hiring page ng isang employer", "inililista pa rin ng kopyang itinabi namin ang mga trabaho ng employer"], mustNot: /muling ipinaskil|spam|agency|company page|EUTALENTS|Humanity|S&P/i },
  },
  // when read again; many still under China; older rows as read again; a few
  // pay rows; no Macau, Taiwan, Vienna, employer, work mode or street
  [COUNTRY]: {
    de: { must: ["Wenn wir eine solche Stelle erneut lesen", "viele sind noch unter China eingeordnet, bis wir sie erneut lesen", "ältere Stellen folgen nach und nach, wenn wir sie erneut lesen", "ein paar Stellen"], mustNot: /\balle\b|\bjede\b|Maca[ou]|Taiwan|Wien|Österreich|remote|hybrid|Straße|sortier/i },
    es: { must: ["Cuando volvemos a leer un empleo así", "muchos siguen clasificados en China hasta que los volvamos a leer", "los más antiguos seguirán a medida que los volvamos a leer", "unos pocos empleos"], mustNot: /\btodos\b|\bcada\b|Maca[ou]|Taiwán|Viena|Austria|remoto|híbrido|\bcalle\b|ordenar/i },
    fr: { must: ["Quand nous relisons une telle offre", "beaucoup restent classées en Chine tant que nous ne les avons pas relues", "les plus anciennes suivront à mesure que nous les relirons", "quelques offres"], mustNot: /\btous\b|\btoutes\b|\bchaque\b|Maca[ou]|Taïwan|Vienne|Autriche|à distance|hybride|\brue\b|\btri\b/i },
    hi: { must: ["जब हम ऐसी किसी नौकरी को दोबारा पढ़ते हैं", "कई अब भी चीन में दर्ज हैं", "जैसे-जैसे हम उन्हें दोबारा पढ़ते हैं", "कुछ नौकरियाँ"], mustNot: /सभी|हर नौकरी|मकाऊ|ताइवान|वियना|रिमोट|हाइब्रिड/ },
    nl: { must: ["Als we zo'n vacature opnieuw lezen", "veel staan nog onder China tot we ze opnieuw lezen", "oudere volgen naarmate we ze opnieuw lezen", "een paar vacatures"], mustNot: /\balle\b|\belke\b|Maca[ou]|Taiwan|Wenen|Oostenrijk|op afstand|hybride|straat|sorteren/i },
    pt: { must: ["Quando lemos uma vaga assim de novo", "muitas ainda estão atribuídas à China", "à medida que as lemos de novo", "algumas poucas vagas"], mustNot: /\btod[oa]s\b|\bcada\b|Maca[ou]|Taiwan|Viena|Áustria|remot|híbrid|\brua\b|ordena/i },
    tl: { must: ["Kapag muli naming binasa ang ganitong trabaho", "marami pa rin ang nakatala sa China", "habang muli naming binabasa ang mga ito", "may iilang trabaho"], mustNot: /\blahat\b|\bbawat\b|Maca[ou]|Taiwan|Vienna|Austria|remote|hybrid|kalye/i },
  },
  // the four places that changed and the two that did not; no longer printed,
  // not corrected; no web address, example, employer or colour
  [CAPITALS]: {
    de: { must: ["in der Überschrift, die du siehst, im Browser-Tab, in der Beschreibung, die Suchmaschinen anzeigen, und in den Stellenangaben, die sie lesen", "die Reihe von Links über der Überschrift zeigt den Titel weiterhin so, wie der Arbeitgeber ihn eingegeben hat", "Auf der Jobbörse selbst erscheint der Titel einer Stelle weiterhin so", "zeigen eine solche Beschriftung nicht mehr als Arbeitgeber an"], mustNot: /korrigiert|umbenannt|gespeichert|Adresse|Domain|überall|ganze Seite|Farbe/i },
    es: { must: ["en el encabezado que ves, en la pestaña del navegador, en la descripción que muestran los buscadores y en los detalles del empleo que leen", "la ruta de enlaces sobre el encabezado sigue mostrando el título tal como lo escribió el empleador", "En el propio portal, el título de un empleo se sigue mostrando tal como lo escribió el empleador", "ya no muestran esa leyenda como el empleador"], mustNot: /corregid|renombrad|guardad|nuestros datos|dirección|dominio|en todas partes|toda la página|color/i },
    fr: { must: ["dans le titre que vous voyez, l'onglet du navigateur, la description qu'affichent les moteurs de recherche et les détails de l'offre qu'ils lisent", "le fil de liens au-dessus du titre affiche toujours l'intitulé tel que l'employeur l'a tapé", "Sur le tableau lui-même, l'intitulé d'une offre s'affiche toujours tel que l'employeur l'a tapé", "n'affichent plus une telle légende comme employeur"], mustNot: /corrigé|renommé|enregistré|nos données|adresse|domaine|partout|toute la page|couleur/i },
    hi: { must: ["आपको दिखने वाली हेडिंग", "ब्राउज़र टैब", "सर्च इंजन जो विवरण दिखाते हैं", "नौकरी की उस जानकारी में जिसे वे पढ़ते हैं", "हेडिंग के ऊपर लिंक की कड़ी अब भी शीर्षक वैसे ही दिखाती है जैसे नियोक्ता ने टाइप किया था", "बोर्ड पर ख़ुद, नौकरी का शीर्षक अब भी वैसे ही दिखता है", "नहीं छापते"], mustNot: /वेब पता|डोमेन|सुधार|हर जगह|पूरा पेज|रंग/ },
    nl: { must: ["in de kop die je ziet, het browsertabblad, de beschrijving die zoekmachines tonen en de vacaturegegevens die ze lezen", "het spoor van links boven de kop toont de titel nog steeds zoals de werkgever hem typte", "Op het bord zelf staat de titel van een vacature nog steeds zoals de werkgever hem typte", "tonen zo'n bijschrift niet meer als werkgever"], mustNot: /gecorrigeerd|hernoemd|opgeslagen|onze gegevens|\badres|domein|overal|hele pagina|kleur/i },
    pt: { must: ["no cabeçalho que você vê", "na aba do navegador", "na descrição que os buscadores mostram", "nos detalhes da vaga que eles leem", "a trilha de links acima do cabeçalho continua mostrando o título como o empregador o digitou", "No próprio quadro, o título de uma vaga continua aparecendo como o empregador o digitou", "não mostram mais essa legenda"], mustNot: /corrigid|renomead|endereço|domínio|em todo lugar|toda a página|\bcor\b|nossos dados/i },
    tl: { must: ["sa heading na nakikita mo", "sa tab ng browser", "sa paglalarawan na ipinapakita ng mga search engine", "sa mga detalye ng trabaho na binabasa nila", "ipinapakita pa rin ng hanay ng mga link sa itaas ng heading ang pamagat gaya ng pagkaka-type ng employer", "Sa board mismo, ipinapakita pa rin ang pamagat ng trabaho gaya ng pagkaka-type ng employer", "Hindi na inilalimbag"], mustNot: /address|domain|kulay|naitama|pinalitan ng pangalan|kahit saan|buong pahina/i },
  },
  // a page of this kind, asked to be left out; the jobs still show and their
  // pages still open; nothing about surveys
  [STAFF]: {
    de: { must: ["eine Seite dieser Art", "bittet sie jetzt, die Seite auszulassen", "Diese Stellen erscheinen weiterhin auf unserer Jobbörse, und ihre Seiten öffnen sich weiterhin"], mustNot: /Seiten dieser Art|alle solchen|keine Seite mehr|entfernt|Umfrage|nicht mehr finden|versteckt|Coupang/i },
    es: { must: ["una página de este tipo", "ahora les pide que la dejen fuera", "Estos empleos siguen apareciendo en nuestro portal, y sus páginas siguen abriéndose"], mustNot: /páginas de este tipo|todas las|ya no tiene página|eliminad|encuesta|ya no pueden encontrar|ocult|Coupang/i },
    fr: { must: ["une page de ce type", "leur demande désormais de l'écarter", "Ces offres apparaissent toujours sur notre tableau, et leurs pages s'ouvrent toujours"], mustNot: /pages de ce type|toutes les|supprimée|retirée|sondage|enquête|ne peuvent plus trouver|cachée|Coupang/i },
    hi: { must: ["इस तरह का एक पेज", "अब उनसे उसे छोड़ देने को कहता है", "ये नौकरियाँ अब भी हमारे बोर्ड पर दिखती हैं, और उनके पेज अब भी खुलते हैं"], mustNot: /सर्वे|सर्वेक्षण|हटा दिया|छिपा|Coupang/ },
    nl: { must: ["een pagina van dit soort", "vraagt zoekmachines nu om haar weg te laten", "Deze vacatures staan nog steeds op ons bord, en hun pagina's openen nog steeds"], mustNot: /pagina's van dit soort|alle zulke|geen pagina meer|verwijderd|enquête|niet meer vinden|verborgen|Coupang/i },
    pt: { must: ["uma página desse tipo", "agora pede que eles a deixem de fora", "Essas vagas continuam aparecendo no nosso quadro, e as páginas delas continuam abrindo"], mustNot: /páginas desse tipo|todas as|não conseguem mais encontrar|pesquisa|removid|ocult|Coupang/i },
    tl: { must: ["ang isang pahinang ganito", "humihiling na ngayon sa kanila na huwag itong isama", "Lumalabas pa rin ang mga trabahong ito sa aming board, at bumubukas pa rin ang kanilang mga pahina"], mustNot: /survey|hindi na mahahanap|inalis|itinago|Coupang/i },
  },
};

/** Captions, example titles and employers the capitals entry must not quote, in any language. */
const CAPTION_NAMES = /MONOGRAM|ORANGE|Trailborn|Inova|Micron|Sentara|\bMFG\b|Email Signature/i;

describe("each translation carries the same limits in its own words", () => {
  it("covers every entry", () => {
    expect(Object.keys(LOCAL).sort()).toEqual([...IDS].sort());
  });

  it.each(IDS)("%s", (id) => {
    for (const l of OTHERS) {
      const { must, mustNot } = LOCAL[id][l];
      for (const m of must) expect(textOf(l, id), `${l}: ${m}`).toContain(m);
      expect(textOf(l, id), `${l}: ${mustNot}`).not.toMatch(mustNot);
    }
  });

  it("where a language's word for every appears in the oversize entry, it is only in the clause that says not every such employer shows yet", () => {
    expect(textOf("es", OVERSIZE).match(/\btodos\b/g), "es todos").toHaveLength(1);
    expect(textOf("nl", OVERSIZE).match(/\belke\b/gi), "nl elke").toHaveLength(1);
    expect(textOf("de", OVERSIZE).match(/\bjeder\b/gi), "de jeder").toHaveLength(1);
    expect(textOf("hi", OVERSIZE).match(/सभी/g), "hi").toHaveLength(1);
    expect(textOf("tl", OVERSIZE).match(/\blahat\b/g), "tl lahat").toHaveLength(1);
    expect(textOf("pt", OVERSIZE).match(/\btodos\b/g), "pt todos").toHaveLength(1);
  });

  it("the capitals entry quotes no caption, title or employer in any language", () => {
    for (const l of LOCALES) expect(textOf(l, CAPITALS), l).not.toMatch(CAPTION_NAMES);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TRANSLATION AS REVIEWED. The first 12 hex digits of SHA-256 over
// "<title>\n<description>", per language, in the order of IDS. A change to any
// of them fails here until the new text is read against what production showed
// on 17 November and its hash is written in.
const REVIEWED: Record<Locale, string[]> = {
  en: ["bca524d59c8f", "0c9e0aff3bab", "ca43e8b69ebd", "191905a7cc70", "c786857ae1be", "160d542013c3"],
  "en-GB": ["4f087bef6664", "0c9e0aff3bab", "ca43e8b69ebd", "191905a7cc70", "c786857ae1be", "160d542013c3"],
  de: ["19a137764f83", "99dc2d84c54a", "dbbff89b914c", "ecaf355dfcc0", "41028ff1fdb5", "492238f694a1"],
  es: ["a7971eb43940", "5ade4093a7ce", "87d4c05f03fb", "654e0a585c0b", "c33018e8e55c", "066b5c1fdd01"],
  fr: ["00229cddf8f5", "607d74ac3efe", "246b72ff74f9", "a547d665b696", "25d0f57e7fba", "fb7c4f1cbea8"],
  hi: ["32310f3c4aad", "65680ad8a61d", "b6b5aca91ee1", "001b22d078ce", "b64d92222691", "f0ea36487519"],
  nl: ["c99b4626fd00", "4a02c9de3faf", "e00a05533982", "8e0dcaafa90d", "2a54b23ec458", "3d82aeaad9bf"],
  pt: ["0c69c7e043de", "85c41b3fb092", "41cc594862ba", "5fb5ef7a7b34", "3eec849c60a2", "c4748e54950a"],
  tl: ["fd7b70e9c899", "3b1992017f0e", "7bedfbd00045", "f15830153dc7", "3a6e1d462844", "b1c549c770b0"],
};
const hash = (t: Text) => createHash("sha256").update(`${t.title}\n${t.description}`).digest("hex").slice(0, 12);

describe("every translation is the text that was reviewed", () => {
  it.each(LOCALES)("%s", (l) => {
    expect(IDS.map((id) => hash(SHARDS[l][id])), `${l}: a reworded entry must be read again against the live read, then its hash updated`).toEqual(REVIEWED[l]);
  });
});

describe("what the entries name is what the site itself carries", () => {
  /** The eight languages each language's text names, by the code's own language code. */
  const LANGUAGE_NAMES: Record<Locale, Record<string, string>> = {
    en: { es: "Spanish", fr: "French", de: "German", pt: "Portuguese", nl: "Dutch", it: "Italian", hi: "Hindi", tl: "Tagalog" },
    "en-GB": { es: "Spanish", fr: "French", de: "German", pt: "Portuguese", nl: "Dutch", it: "Italian", hi: "Hindi", tl: "Tagalog" },
    de: { es: "Spanisch", fr: "Französisch", de: "Deutsch", pt: "Portugiesisch", nl: "Niederländisch", it: "Italienisch", hi: "Hindi", tl: "Tagalog" },
    es: { es: "español", fr: "francés", de: "alemán", pt: "portugués", nl: "neerlandés", it: "italiano", hi: "hindi", tl: "tagalo" },
    fr: { es: "espagnol", fr: "français", de: "allemand", pt: "portugais", nl: "néerlandais", it: "italien", hi: "hindi", tl: "tagalog" },
    hi: { es: "स्पेनिश", fr: "फ़्रेंच", de: "जर्मन", pt: "पुर्तगाली", nl: "डच", it: "इतालवी", hi: "हिंदी", tl: "टैगालॉग" },
    nl: { es: "Spaans", fr: "Frans", de: "Duits", pt: "Portugees", nl: "Nederlands", it: "Italiaans", hi: "Hindi", tl: "Tagalog" },
    pt: { es: "espanhol", fr: "francês", de: "alemão", pt: "português", nl: "holandês", it: "italiano", hi: "híndi", tl: "tagalo" },
    tl: { es: "Espanyol", fr: "Pranses", de: "Aleman", pt: "Portuges", nl: "Olandes", it: "Italyano", hi: "Hindi", tl: "Tagalog" },
  };

  it("the free-scan entry names exactly the languages the scan's code reads besides English, in every language", () => {
    const supported = /export const SUPPORTED_LANGUAGES: readonly string\[\] = \[([^\]]*)\]/.exec(source("supabase/functions/free-keyword-scan/resume-language.ts"))?.[1];
    expect(supported, "SUPPORTED_LANGUAGES in resume-language.ts").toBeTruthy();
    const codes = supported!.split(",").map((x) => x.trim().replace(/['"]/g, "")).filter((x) => x && x !== "en");
    expect(codes).toHaveLength(8);
    for (const l of LOCALES) {
      expect(Object.keys(LANGUAGE_NAMES[l]).sort(), l).toEqual([...codes].sort());
      for (const name of Object.values(LANGUAGE_NAMES[l])) expect(SHARDS[l][SCAN].description, `${l}: ${name}`).toContain(name);
    }
  });

  it("the free-scan entry's at least two is the code's own threshold, in every language", () => {
    expect(source("supabase/functions/free-keyword-scan/rule-score.ts")).toMatch(/export const OWN_LANGUAGE_MIN_SECTIONS = 2;/);
    const TWO: Record<Locale, string> = {
      en: "at least two of experience, education and skills", "en-GB": "at least two of experience, education and skills",
      de: "mindestens zwei der Begriffe", es: "al menos dos de los conceptos", fr: "au moins deux des trois notions", hi: "कम से कम दो",
      nl: "minstens twee van werkervaring", pt: "pelo menos duas destas três", tl: "hindi bababa sa dalawa",
    };
    for (const l of LOCALES) expect(SHARDS[l][SCAN].description, l).toContain(TWO[l]);
  });

  it("every employer the oversize entry names is the name the site's own list carries and prints, in every language", () => {
    // Read live on 17 November from get_company_suggest, each with its token.
    const READ: Record<string, string> = { transperfect: "TransPerfect", duravermeer: "Dura Vermeer", aaff: "aaff B.V.", tether: "Tether Operations Limited" };
    const sources = source("supabase/functions/job-board/sources.ts");
    for (const [token, name] of Object.entries(READ)) {
      expect(sources, `${name} in the catalogue under ${token}`).toContain(`${name}\\v7\\v${token}`);
      expect(employerName(token, name), token).toBe(name);
      for (const l of LOCALES) expect(SHARDS[l][OVERSIZE].description, `${l} ${name}`).toContain(name);
    }
  });

  it("the country entry names the four new countries and Hong Kong in every language, and the code files the places read live there", () => {
    const READ: Record<string, string> = {
      "Hong Kong, SAR, China": "HK",
      "Onne, RV, Nigeria": "NG",
      "Zarqa, Zarqa Governorate, Jordan": "JO",
      "Kazakhstan, Turkistan Region, Kazakhstan": "KZ",
    };
    for (const [place, cc] of Object.entries(READ)) expect(detectCountry(place), place).toBe(cc);
    // The code files Taipei under Taiwan too, but rows read live on 17 November
    // still read China, so no entry claims it.
    expect(detectCountry("Taipei, Taiwan, China")).toBe("TW");
    const COUNTRIES: Record<Locale, string[]> = {
      en: ["Hong Kong", "Nigeria", "Kazakhstan", "Jordan", "Lebanon"], "en-GB": ["Hong Kong", "Nigeria", "Kazakhstan", "Jordan", "Lebanon"],
      de: ["Hongkong", "Nigeria", "Kasachstan", "Jordanien", "Libanon"], es: ["Hong Kong", "Nigeria", "Kazajistán", "Jordania", "Líbano"],
      fr: ["Hong Kong", "Nigeria", "Kazakhstan", "Jordanie", "Liban"], hi: ["हांगकांग", "नाइजीरिया", "कज़ाख़स्तान", "जॉर्डन", "लेबनान"],
      nl: ["Hongkong", "Nigeria", "Kazachstan", "Jordanië", "Libanon"], pt: ["Hong Kong", "Nigéria", "Cazaquistão", "Jordânia", "Líbano"],
      tl: ["Hong Kong", "Nigeria", "Kazakhstan", "Jordan", "Lebanon"],
    };
    for (const l of LOCALES) {
      for (const c of COUNTRIES[l]) {
        expect(SHARDS[l][COUNTRY].title, `${l} title ${c}`).toContain(c);
        expect(SHARDS[l][COUNTRY].description, `${l} description ${c}`).toContain(c);
      }
      expect(SHARDS[l][COUNTRY].description, `${l} quotes the place as the employer wrote it`).toContain("Hong Kong, SAR, China");
    }
  });

  it("the capitals entry describes what the code does, and its fallback is the word each language's job page prints", () => {
    expect(titleFromCapitals("MFG PEE PH PR TECH"), "the title read live on a crawler copy").toBe("Mfg PEE PH PR Tech");
    expect(titleFromCapitals("Senior Payroll Specialist"), "a title with a small letter is left as typed").toBe("Senior Payroll Specialist");
    for (const l of LOCALES) {
      const fallback = label(l, "jobPostingPage.theEmployer");
      expect(fallback, l).toBeTruthy();
      expect(SHARDS[l][CAPITALS].description, `${l}: ${fallback}`).toMatch(new RegExp(`[“„«‘] ?${fallback.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ?[”“»’]`));
    }
  });

  it("the staff-only entry's boards and posting line are the ones the bake refuses", () => {
    expect(internalBoardReason("coupanginternal", "Coupang Internal")).toBe("an internal board");
    expect(internalBoardReason("x", "Acme Referrals")).toBe("a referral board");
    expect(internalBoardReason("x", "Acme Employees Only")).toBe("an employees-only board");
    expect(internalBoardReason("x", "Acme Invitation Only")).toBe("an invitation-only board");
    expect(internalOnlyTextReason("This posting is exclusively for internal employees"), "the line read on the live posting").toBeTruthy();
    expect(internalBoardReason("transperfect", "TransPerfect"), "a board open to everyone").toBeNull();
  });
});

describe("the same limits in every language", () => {
  it("no entry carries a digit in any language, Latin or Devanagari", () => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(/[0-9०-९]/);
  });

  const REFUSED: Array<[string, RegExp]> = [
    ["an audit id", /\b(?:S\d{1,2}|NB)-\d{1,3}\b/],
    ["an internal name", /job-board\.|x-fn-build|drizzle|pg_cron|\bcron\b|\bRPC\b|\bMCP\b|\bslices?\b|migration|edge function|company_name_overrides|employer-names|prerender|x-rb-|own-language|oversize|\bcxg\b|weekday-/i],
    ["a vendor and token", /\b[a-z]+:[a-z0-9~_-]+\b/],
    ["a hiring system's name", /Workable|Recruitee|Pinpoint|Workday|Greenhouse|\bLever\b|Ashby|Teamtailor|SmartRecruiters|iCIMS|Oracle|Phenom/],
    ["a commit or migration id", /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\b20\d{12}\b/],
    ["a retired product", /\$\s?99|\$\s?29|\$\s?7\b|Premium|Apply Assistant|applies for you|apply for you/i],
    ["an AI host seekers are not shown", /Cursor|Copilot|Gemini|Windsurf|Perplexity|VS Code|OpenAI|Anthropic/i],
    ["a claim that we send applications", /we (?:send|submit) (?:your )?applications?/i],
  ];
  it.each(REFUSED)("no entry states %s", (_why, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
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
    expect(pt).toMatch(/\baba do navegador\b/);
  });

  it("the Hindi is in Devanagari", () => {
    for (const id of IDS) expect(textOf("hi", id), id).toMatch(/[ऀ-ॿ]{3}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 52f, run in bash against a fake curl that answers from a route table
// and logs every call, as the 15 November test runs section 52e.
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
const article = (date: string, title: string) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${date} · Fixed</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(title)}</h2><p class="text-xs text-muted-foreground">x</p></article>`;
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

function run(section: string, over: { changelog?: string; chunk?: string; langs?: Partial<Record<string, string>> } = {}): { lines: string[]; calls: string[]; env: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd-52f-"));
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

const S52F = "52f-changelog-nov-17.sh";
const sectionText = () => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52F), "utf8");
/** The string section 52f requires in each entry's US description, as its VD52F_MUST list names it. */
const MUSTS = (/<<'VD52F_MUST'\n([\s\S]*?)\nVD52F_MUST/.exec(sectionText())?.[1].split("\n") ?? [])
  .map((x) => ({ id: x.split("|")[0], must: x.split("|").slice(1).join("|") }));
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;

describe("section 52f judges the six entries on the crawler page", () => {
  it("lists exactly their titles, in order, each with the date their deploy went live", () => {
    const listed = /<<'VD52F_TITLES'\n([\s\S]*?)\nVD52F_TITLES/.exec(sectionText())?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("lists one string per entry that holds the limit its live read set, each in that entry's description and found once in the whole US shard", () => {
    const listed = /<<'VD52F_MUST'\n([\s\S]*?)\nVD52F_MUST/.exec(sectionText())?.[1].split("\n") ?? [];
    expect(listed.map((x) => x.split("|")[0])).toEqual(IDS);
    const whole = readFileSync(resolve(ROOT, "src/i18n/changelog/en.json"), "utf8");
    for (const [id, m] of listed.map((x) => x.split("|"))) {
      expect(EN[id].description, id).toContain(m);
      expect(whole.split(m).length - 1, `${m} is found once in the US shard`).toBe(1);
      expect(m, `${m} holds no quote mark the bundle might escape`).not.toMatch(/['"‘’“”]/);
      expect(m, `${m} is plain ASCII, which the bundle never escapes`).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(MUSTS.find((x) => x.id === SCAN)?.must, "the free-scan line pins the at-least-two threshold").toMatch(/at least two/);
    expect(MUSTS.find((x) => x.id === STAFF)?.must, "the staff-only line pins that the pages still open").toMatch(/their pages still open/);
  });

  it("before the publish every line is INFO, and only GETs are sent, never to the British chunk or another language's", () => {
    const { lines, calls } = run(S52F, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 17 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines, show(lines)).toContain("INFO  the other eight languages' changelog strings are judged after the publish");
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
    for (const l of LANGS) expect(calls.some((c) => c.includes(`/assets/${l}-`)), l).toBe(false);
  });

  it("after the publish each title passes on the crawler page with its date, each description and each language passes, and the page describes an entry of 17 November as newest", () => {
    const { lines } = run(S52F);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    for (const { id, must } of MUSTS) expect(lines, show(lines)).toContain(`PASS  the US English changelog strings describe ${id} with "${must}"`);
    for (const l of LANGS) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry all six 17 November entries`);
    expect(lines, show(lines)).toContain(`PASS  /changelog's description names an entry of 2026-11-17 as the newest, no older than this batch's 2026-11-17`);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("leaves the key, the project, the site and the user agent every later section reads as it found them", () => {
    for (const r of [run(S52F), run(S52F, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED })]) {
      expect(r.env, show(r.lines)).toBe("pk_test|rb_test|https://p.supabase.co|https://site.test|ua");
    }
  });

  it("a description reworded under the same title FAILs, though its title passes", () => {
    const scan = MUSTS.find((x) => x.id === SCAN)!;
    const reworded = { ...EN, [SCAN]: { ...EN[SCAN], description: EN[SCAN].description.replace(scan.must, "for any one of experience, education or skills") } };
    const { lines } = run(S52F, { chunk: chunkOf(reworded) });
    expect(fails(lines), show(lines)).toEqual([`FAIL  the US English changelog strings carry no "${scan.must}" for ${SCAN}: its description is not the one read live on 17 November`]);
    expect(lines, show(lines)).toContain(onPage(TITLES[0]));
  });

  it("a language whose chunk lacks an entry FAILs, and so does a language the entry names no changelog chunk for", () => {
    const de = chunkOf(Object.fromEntries(Object.entries(SHARDS.de).filter(([k]) => k !== SCAN && k !== STAFF)));
    const { lines } = run(S52F, { langs: { de, nl: `const s={header:{jobs:"x"}};export{s as default};` } });
    expect(fails(lines), show(lines)).toEqual([
      `FAIL  the de changelog strings (${clChunk("de")}) lack ${SCAN} ${STAFF}: the publish did not ship the 17 November entries in de`,
      "FAIL  no nl changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 17 November entries cannot be shown in nl",
    ]);
    for (const l of LANGS.filter((x) => x !== "de" && x !== "nl")) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry all six 17 November entries`);
  });

  it("a wrong date FAILs", () => {
    const moved = crawler(rowsOf(AT, AT + 30).map((r) => (r.title === TITLES[3].title ? { ...r, date: "2026-11-15" } : r)));
    const { lines } = run(S52F, { changelog: moved });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog dates "${TITLES[3].title}" 2026-11-15, want 2026-11-17, the day its deploy went live`]);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52F, { changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[0].title)) }).lines;
    expect(lost, show(lost)).toContain(notRebuilt(TITLES[0]));
    const without = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== IDS[5])));
    const gone = run(S52F, { chunk: without, changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[5].title)) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 17 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[5].title}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not, title or description", () => {
    const pushed = run(S52F, { changelog: crawler(filler(30, "2026-12-01", "A newer entry")) }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(pastPage(t));
    const stale = run(S52F, { changelog: BEFORE_PAGE }).lines;
    for (const t of TITLES) expect(stale, show(stale)).toContain(notRebuilt(t));
    expect(stale, show(stale)).toContain(`FAIL  /changelog's description names an entry of 2026-11-15 as the newest, older than this batch's 2026-11-17 (the prerender did not rebuild)`);
  });

  it("thirty entries older than the batch cannot have pushed it off, nor can fewer than thirty newer ones: FAIL", () => {
    const older = run(S52F, { changelog: crawler(filler(30, "2026-11-16", "An entry of 16 November")) }).lines;
    for (const t of TITLES) expect(older, show(older)).toContain(notRebuilt(t));
    const few = run(S52F, { changelog: crawler(filler(29, "2026-12-01", "A newer entry")) }).lines;
    for (const t of TITLES) expect(few, show(few)).toContain(notRebuilt(t));
  });

  it("a description the bake left on an older newest entry FAILs, though every title is listed", () => {
    const page = PUBLISHED_PAGE.replace(/Latest \(2026-11-17\): [^"]*\./, `Latest (2026-11-15): ${esc(EN.aJobPageSaysWhenItsEmployerClosedThePosting.title)}.`);
    expect(page).not.toBe(PUBLISHED_PAGE);
    const { lines } = run(S52F, { changelog: page });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog's description names an entry of 2026-11-15 as the newest, older than this batch's 2026-11-17 (the prerender did not rebuild)`]);
    const none = run(S52F, { changelog: PUBLISHED_PAGE.replace(/Latest \([^"]*\./, "No entries yet.") }).lines;
    expect(none.some((l) => /^FAIL {2}\/changelog's description names no newest entry/.test(l)), show(none)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52F, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL {2}no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
