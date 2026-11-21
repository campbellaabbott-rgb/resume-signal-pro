// @vitest-environment node
/**
 * THE CHANGELOG OF 19 NOVEMBER SAYS ONLY WHAT WAS READ LIVE.
 *
 * Two entries for main at f3d7859a1 (PR #78), which went live and verified on
 * 19 November: "Add to Claude" on the Connect your agent page, and Ashby's
 * application form no longer read by the connector or the data API, nor asked
 * for by the website. The three checkout functions changed only an internal
 * build stamp, so they have no entry. Every claim was read against production
 * and the code at main that day, read-only: the live /agents page and the
 * chunks it loads (the install link carries modal=add-custom-connector,
 * connectorName and connectorUrl, the flag is on, the steps name "Sign in when
 * needed" and no longer say to keep the detected settings, and the by-hand
 * steps sit folded beneath), the live board chunk (no ashby: among the
 * question prefixes, the stop list read by the kit and by How applying works),
 * the English and German string bundles (the kit's new note), the verify run's
 * OD14-ASHBY-1, OD14-ASHBY-2 and HO-1 PASS lines with agent-mcp and public-api
 * serving their 2026-11-18.2 builds, and Ashby's robots file (Disallow: /api/
 * for every reader). No sign-in, purchase, scan, model call or mail. Those
 * limits are held here, entry by entry:
 *   - Add to Claude: the button opens Claude's dialog with our name and our
 *     connector's address filled in, and nothing past that is ours to say:
 *     the person signs in to Claude if it asks, checks both and adds the
 *     connector; the steps name "Sign in when needed" where they said to keep
 *     what Claude detected; the by-hand steps stay. No other AI, no key, plan,
 *     team route or price, and no promise about what Claude does next;
 *   - Ashby: why, as Ashby's own site words it to automated readers, never a
 *     law, a ban or a block; the connector only for applying yourself with
 *     Claude or Claude Code (ChatGPT never read Ashby's form, so it is not
 *     named); the data API; both leave Ashby out of the readers they name; on
 *     the board no offer to prepare answers and no screening-questions line, so
 *     the site no longer ASKS; job-board itself still answers the action until
 *     a later board build, so nothing says no path reads, nothing is sent to
 *     Ashby, or anywhere, all or every; Ashby's jobs stay on the board; the
 *     kit's note now says we did not read the employer's form.
 * In every language: no numbers, every quoted label the live string in that
 * language (the page's name) or the English the /agents page shows in every
 * language ("Add to Claude", "Sign in when needed"), no internal name,
 * Portuguese that is Brazilian, Hindi in Devanagari. British English is the
 * US text with "dialogue" for "dialog", each other language carries its own
 * words for the limits above, and every translation is pinned by a hash of
 * its reviewed text, so a reworded one fails until it is read again.
 *
 * Section 52h of the verifier judges the two on the crawler copy of
 * /changelog once the frontend publish carries them. It runs here in bash
 * against a fake curl, as section 52g does in the 18 November test.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { changelog } from "../data/changelog";
import {
  claudeInstallLink, MCP_ADD_TO_CLAUDE_LIVE, MCP_CLAUDE_AUTH_CHOICE, MCP_CONNECTOR_NAME, MCP_FORM_NOT_READ_HERE, MCP_FORM_VENDORS, MCP_HOSTS,
} from "../config/mcp-tools";
import { applyMechanics } from "../lib/apply-mechanics";
import { automationFor } from "../../supabase/functions/_shared/apply-automation";
import { FORM_READER_VENDORS, FORM_STOPPED_VENDORS, PUBLIC_API_FORM_VENDORS } from "../../supabase/functions/_shared/application-form";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Locale = (typeof LOCALES)[number];
type Text = { title: string; description: string };
const shard = (l: string) => (JSON.parse(readFileSync(resolve(ROOT, `src/i18n/changelog/${l}.json`), "utf8")) as { changelogEntries: Record<string, Text> }).changelogEntries;
const SHARDS = Object.fromEntries(LOCALES.map((l) => [l, shard(l)])) as Record<Locale, Record<string, Text>>;
const source = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const locale = (l: Locale) => JSON.parse(source(`src/i18n/locales/${l}.json`)) as Record<string, Record<string, unknown>>;

const ADD = "addToClaudeOpensClaudesConnectorDialogFilledIn";
const ASHBY = "ashbyApplicationFormsAreNoLongerReadOrAskedFor";
const DATE = "2026-11-19";

/** Newest first, as changelog.ts lists them, with the tags each claims. */
const ENTRIES: Array<{ id: string; date: string; tags: string[] }> = [
  { id: ADD, date: DATE, tags: ["new", "improved"] },
  { id: ASHBY, date: DATE, tags: ["fixed"] },
];
const IDS = ENTRIES.map((e) => e.id);
const AT = changelog.findIndex((e) => e.id === IDS[0]);
const EN = SHARDS.en;
const textOf = (l: Locale, id: string) => `${SHARDS[l][id].title} ${SHARDS[l][id].description}`;
const texts = () => LOCALES.flatMap((l) => IDS.map((id) => ({ where: `${l} ${id}`, l, id, text: textOf(l, id) })));

describe("the two entries", () => {
  it("sit together, newest first, dated the day their deploy went live, with nothing older above them and the 18 November entries next", () => {
    expect(AT, `${IDS[0]} is missing from changelog.ts`).toBeGreaterThanOrEqual(0);
    expect(changelog.slice(AT, AT + ENTRIES.length)).toEqual(ENTRIES);
    for (const e of changelog.slice(0, AT)) expect(e.date >= DATE, `${e.id} (${e.date}) sits above the 19 November entries but is older`).toBe(true);
    expect(changelog[AT + ENTRIES.length].id, "the 18 November entries come next").toBe("theBoardKeepsYourFiltersAndSaysWhyAJobHasNoFitScore");
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

  it("each shard lists them in this order right after the 18 November entries, with only newer batches after them", () => {
    const later = new Set(changelog.slice(0, AT).map((e) => e.id));
    for (const l of LOCALES) {
      const keys = Object.keys(SHARDS[l]);
      const at = keys.indexOf(IDS[0]);
      expect(keys.slice(at, at + IDS.length), l).toEqual(IDS);
      expect(keys[at - 1], l).toBe("theNinetyDayLimitOnLogDataIsNowEnforced");
      for (const k of keys.slice(at + IDS.length)) expect(later.has(k), `${l}: ${k} follows the 19 November entries but is not newer`).toBe(true);
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
  [ADD]: {
    must: [
      "the steps for Claude now begin with an “Add to Claude” button",
      "opens Claude's dialog for adding a custom connector with our name, Resume Booster, and our connector's address already filled in",
      "If Claude asks, you sign in to it first; then you check both and add the connector yourself.",
      "name the setting to choose under authentication, “Sign in when needed”, where they told you to keep whatever settings Claude detected",
      "The steps for adding the connector by hand are still on the page",
    ],
    mustNot: [
      ["the connector added for you, in one click or unchecked", /adds? (?:it|the connector) for you|automatic|one[- ]click|in a click|instantly|no need to (?:check|confirm)|without (?:checking|confirming)/i],
      ["what Claude does after the dialog, or a sign-in to our account", /sign in to (?:your|our) (?:account|Resume Booster)|Connect card|tools? that needs? your account|the first time you use|switched on|you do not add/i],
      ["another AI or tool", /ChatGPT|Claude Code|Cursor|Gemini|Copilot|VS Code|Windsurf|Perplexity|OpenAI|Anthropic|\bGPT/i],
      ["a key, a plan, a team route or a price", /\bkeys?\b|\bplans?\b|\bTeam\b|Enterprise|\bOwner\b|organi[sz]ation|[$€£]|\d/i],
      ["the by-hand steps gone", /removed|no longer (?:on|shows?|has)|replac/i],
      ["an internal name", /\bMCP\b|\bflag\b|modal|connectorUrl|connectorName|deep ?link|query|HO-1|install link|prerender/i],
      ["every Claude app or device", /every (?:device|app)|Claude Desktop|phone|mobile/i],
    ],
  },
  [ASHBY]: {
    must: [
      "Ashby's job site asks automated readers to keep out of the part of it that an Ashby job's application questions come from.",
      "when you apply yourself with Claude or Claude Code through our connector, it no longer reads the questions of a job whose employer uses Ashby",
      "our data API no longer reads them either",
      "both now leave Ashby out when they name the hiring systems whose forms they read",
      "On our job board, such a job no longer offers to prepare answers to its form's questions",
      "its page no longer says we read its screening questions: the site no longer asks for them",
      "You answer those questions on the employer's own application page",
      "its note now says we did not read the employer's form, where it said the hiring system does not publish one",
    ],
    mustNot: [
      ["every path closed, or Ashby sent nothing", /\banywhere\b|\bany\b|\ball\b|\bevery(?:where|thing| employer)?\b|\bnever\b|\bnowhere\b|\bnothing\b|\bno longer sends?\b/i],
      ["ChatGPT, where Ashby's form was never read", /ChatGPT/],
      ["an AI host seekers are not shown", /Cursor|Gemini|Copilot|VS Code|Windsurf|Perplexity|OpenAI|Anthropic|\bGPT/i],
      ["Ashby's jobs leaving the board", /no longer (?:shows?|lists?|carr(?:y|ies)|has) (?:Ashby )?(?:jobs|postings)|(?:jobs|postings) (?:are|were) removed|left the board/i],
      ["Ashby's request called a law, a ban or a block", /\blaws?\b|legal|forbid|\bban(?:s|ned)?\b|block|terms of (?:service|use)|not allowed|permission/i],
      ["another hiring system named", /Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|Teamtailor|Paylocity|BambooHR|Workday|Oracle|SmartRecruiters|iCIMS|UKG|\bADP\b/],
      ["an internal name", /robots|\/api\/|GraphQL|endpoint|job-board|apply_myself|\bMCP\b|withheld|not-read-on-this-surface|\/v1\b|OD14|\bATS\b/i],
      ["the drafted questions called the employer's real ones", /real questions|actual questions/i],
      ["a number", /\d/],
    ],
  },
};

/** British English: the US text with "dialogue" for "dialog" (and CV for résumé, which neither entry writes), nothing else. */
const toGB = (s: string) => s.replace(/\bdialog\b/g, "dialogue").replace(/résumé/g, "CV");

type Other = Exclude<Locale, "en" | "en-GB">;
const OTHERS = LOCALES.filter((l): l is Other => l !== "en" && l !== "en-GB");
const LOCAL: Record<string, Record<Other, { must: string[]; mustNot: RegExp }>> = {
  // the button opens the dialog with name and address filled in; you sign in
  // if asked, check both and add it yourself; the setting named where the old
  // step said keep what Claude detected; the by-hand steps stay; no other AI,
  // key, plan, team route, price or internal name
  [ADD]: {
    de: { must: ["beginnen die Schritte für Claude jetzt mit einer Schaltfläche „Add to Claude“", "in dem unser Name, Resume Booster, und die Adresse unseres Connectors schon ausgefüllt sind", "Wenn Claude danach fragt, meldest du dich zuerst bei Claude an; dann prüfst du beides und fügst den Connector selbst hinzu", "„Sign in when needed“, wo sie dir vorher sagten, die von Claude erkannten Einstellungen so zu lassen, wie sie sind", "stehen weiterhin auf der Seite"], mustNot: /automatisch|mit einem Klick|sofort|ohne zu prüfen|ChatGPT|Claude Code|Cursor|Gemini|Copilot|Schlüssel|Tarif|\bTeam\b|Enterprise|Organisation|[$€£]|\d|\bMCP\b|entfernt/i },
    es: { must: ["los pasos para Claude empiezan ahora con un botón «Add to Claude»", "con nuestro nombre, Resume Booster, y la dirección de nuestro conector ya rellenados", "Si Claude te lo pide, primero inicias sesión en Claude; después compruebas los dos datos y añades tú el conector", "«Sign in when needed», donde antes te decían que dejaras la configuración que Claude hubiera detectado", "siguen en la página"], mustNot: /automátic|con un clic|al instante|sin comprobar|ChatGPT|Claude Code|Cursor|Gemini|Copilot|\bclaves?\b|\bplan(?:es)?\b|\bTeam\b|Enterprise|organización|[$€£]|\d|\bMCP\b|eliminad/i },
    fr: { must: ["les étapes pour Claude commencent désormais par un bouton « Add to Claude »", "avec notre nom, Resume Booster, et l'adresse de notre connecteur déjà remplis", "Si Claude vous le demande, vous vous connectez d'abord à Claude ; ensuite, vous vérifiez les deux et ajoutez vous-même le connecteur", "« Sign in when needed », là où elles vous disaient de garder les réglages que Claude avait détectés", "sont toujours sur la page"], mustNot: /automatique|en un clic|instantanément|sans vérifier|ChatGPT|Claude Code|Cursor|Gemini|Copilot|\bclés?\b|formule|\bTeam\b|Enterprise|organisation|[$€£]|\d|\bMCP\b|supprim/i },
    hi: { must: ["Claude के चरण अब “Add to Claude” बटन से शुरू होते हैं", "जिसमें हमारा नाम, Resume Booster, और हमारे कनेक्टर का पता पहले से भरे होते हैं", "अगर Claude कहे, तो आप पहले Claude में साइन इन करते हैं; फिर आप दोनों को जाँचते हैं और कनेक्टर खुद जोड़ते हैं", "“Sign in when needed”, जहाँ पहले वे कहते थे कि Claude ने जो भी सेटिंग पहचानी हों, उन्हें वैसे ही रहने दें", "अब भी पेज पर हैं"], mustNot: /अपने आप|एक क्लिक|तुरंत|ChatGPT|Claude Code|Cursor|Gemini|Copilot|कुंजी|प्लान|Team|Enterprise|संगठन|[$€£]|[0-9०-९]|MCP|हटा/ },
    nl: { must: ["beginnen de stappen voor Claude nu met een knop ‘Add to Claude’", "met onze naam, Resume Booster, en het adres van onze connector al ingevuld", "Als Claude erom vraagt, log je eerst in bij Claude; daarna controleer je beide en voeg je de connector zelf toe", "‘Sign in when needed’, waar ze eerst zeiden dat je de instellingen moest laten staan die Claude had gevonden", "staan nog op de pagina"], mustNot: /automatisch|met één klik|meteen|zonder te controleren|ChatGPT|Claude Code|Cursor|Gemini|Copilot|sleutel|abonnement|\bTeam\b|Enterprise|organisatie|[$€£]|\d|\bMCP\b|verwijderd/i },
    pt: { must: ["os passos para o Claude agora começam com um botão “Add to Claude”", "com o nosso nome, Resume Booster, e o endereço do nosso conector já preenchidos", "Se o Claude pedir, você primeiro entra na sua conta do Claude; depois confere os dois e adiciona o conector você mesmo", "“Sign in when needed”, onde antes diziam para manter as configurações que o Claude tivesse detectado", "continuam na página"], mustNot: /automátic|com um clique|na hora|sem conferir|ChatGPT|Claude Code|Cursor|Gemini|Copilot|\bchaves?\b|\bplanos?\b|\bTeam\b|Enterprise|organização|[$€£]|\d|\bMCP\b|removid/i },
    tl: { must: ["nagsisimula na ngayon ang mga hakbang para sa Claude sa button na “Add to Claude”", "na nakapunan na ang pangalan namin, Resume Booster, at ang address ng aming connector", "Kung hihilingin ng Claude, mag-sign in ka muna rito; pagkatapos ay suriin mo ang dalawa at ikaw mismo ang magdagdag ng connector", "“Sign in when needed”, kung saan dati ay sinasabi nilang panatilihin ang anumang setting na natukoy ng Claude", "Nasa pahina pa rin ang mga hakbang"], mustNot: /awtomatiko|isang click|agad-agad|ChatGPT|Claude Code|Cursor|Gemini|Copilot|\bkeys?\b|\bplan\b|\bTeam\b|Enterprise|organisasyon|[$€£]|\d|\bMCP\b|inalis/i },
  },
  // Ashby's own request, as a request; the connector for applying yourself in
  // Claude or Claude Code; the data API; both leave Ashby out of the readers
  // they name; no offer to prepare answers and no questions line, so the site
  // no longer asks; the employer's own page; the kit's note. Never anywhere,
  // all, every, never or nothing; no ChatGPT, law, ban, other system or number
  [ASHBY]: {
    de: { must: ["bittet Programme, die Seiten automatisch lesen, den Teil der Seite zu meiden, aus dem die Bewerbungsfragen einer Ashby-Stelle stammen", "mit Claude oder Claude Code über unseren Connector selbst bewirbst, liest er die Fragen einer Stelle, deren Arbeitgeber Ashby nutzt, nicht mehr", "unsere Daten-API liest sie ebenfalls nicht mehr", "beide lassen Ashby jetzt weg", "bietet eine solche Stelle nicht mehr an, Antworten auf die Fragen ihres Formulars vorzubereiten", "ihre Seite sagt nicht mehr, dass wir ihre Auswahlfragen lesen: Die Website fragt nicht mehr danach", "auf der Bewerbungsseite des Arbeitgebers selbst", "sagt sein Hinweis jetzt, dass wir das Formular des Arbeitgebers nicht gelesen haben"], mustNot: /überall|\balle[nrs]?\b|\bjede[mnrs]?\b|\bnie(?:mals)?\b|\bnichts\b|ChatGPT|Cursor|Gemini|Copilot|Gesetz|verboten|gesperrt|blockiert|Nutzungsbedingungen|Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|robots|GraphQL|Endpunkt|\bATS\b|\d/i },
    es: { must: ["pide a los programas que leen páginas automáticamente que no entren en la parte del sitio de la que vienen las preguntas de solicitud de un empleo de Ashby", "cuando te postulas por tu cuenta con Claude o Claude Code a través de nuestro conector, este ya no lee las preguntas de un empleo cuyo empleador usa Ashby", "nuestra API de datos tampoco las lee ya", "los dos dejan ahora fuera a Ashby", "un empleo así ya no ofrece la opción de preparar respuestas a las preguntas de su formulario", "su página ya no dice que leemos sus preguntas de selección: el sitio ya no las pide", "en la propia página de solicitud del empleador", "su nota dice ahora que no leímos el formulario de la empresa"], mustNot: /ningún sitio|ninguna parte|cualquier|\btod[oa]s?\b|\bcada\b|\bnunca\b|\bnada\b|ChatGPT|Cursor|Gemini|Copilot|\bley\b|ilegal|prohib|bloque|términos|Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|robots|GraphQL|endpoint|\bATS\b|\d/i },
    fr: { must: ["demande aux programmes qui lisent les pages automatiquement de ne pas entrer dans la partie du site d'où viennent les questions de candidature d'une offre Ashby", "quand vous postulez vous-même avec Claude ou Claude Code par notre connecteur, celui-ci ne lit plus les questions d'une offre dont l'employeur utilise Ashby", "notre API de données ne les lit plus non plus", "l'un comme l'autre laissent désormais Ashby de côté", "une telle offre ne propose plus de préparer des réponses aux questions de son formulaire", "sa page ne dit plus que nous lisons ses questions de présélection : le site ne les demande plus", "sur la page de candidature de l'employeur lui-même", "sa note dit désormais que nous n'avons pas lu le formulaire de l'employeur"], mustNot: /partout|\btou(?:s|t|te|tes)\b|\bchaque\b|\bjamais\b|\brien\b|ChatGPT|Cursor|Gemini|Copilot|\bloi\b|illégal|interdit|bloqu|conditions d'utilisation|Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|robots|GraphQL|point d'accès|\bATS\b|\d/i },
    hi: { must: ["अपने आप पेज पढ़ने वाले प्रोग्रामों से कहती है कि वे साइट के उस हिस्से से दूर रहें जहाँ से किसी Ashby नौकरी के आवेदन के सवाल आते हैं", "जब आप हमारे कनेक्टर के ज़रिए Claude या Claude Code के साथ खुद आवेदन करते हैं, तो वह अब उस नौकरी के सवाल नहीं पढ़ता जिसका नियोक्ता Ashby इस्तेमाल करता है", "हमारा डेटा API भी अब उन्हें नहीं पढ़ता", "Ashby को छोड़ देते हैं", "ऐसी नौकरी अब उसके फ़ॉर्म के सवालों के जवाब तैयार करने की पेशकश नहीं करती", "उसका पेज अब यह नहीं कहता कि हम उसके स्क्रीनिंग प्रश्न पढ़ते हैं: साइट अब उन्हें नहीं माँगती", "नियोक्ता के अपने आवेदन पेज पर ही", "उसका नोट अब कहता है कि हमने नियोक्ता का फ़ॉर्म नहीं पढ़ा"], mustNot: /कहीं भी|हर जगह|सभी|हर नियोक्ता|कभी नहीं|कुछ भी नहीं|ChatGPT|Cursor|Gemini|Copilot|क़ानून|कानून|प्रतिबंध|ब्लॉक|Greenhouse|Recruitee|Breezy|Pinpoint|Lever|Workable|robots|GraphQL|एंडपॉइंट|ATS|[0-9०-९]/ },
    nl: { must: ["vraagt programma's die pagina's automatisch lezen om weg te blijven uit het deel van de site waar de sollicitatievragen van een Ashby-vacature vandaan komen", "zelf solliciteert met Claude of Claude Code via onze connector, leest die de vragen van een vacature waarvan de werkgever Ashby gebruikt niet meer", "leest onze data-API ze ook niet meer", "beide laten Ashby nu weg", "biedt zo'n vacature niet meer aan om antwoorden op de vragen van haar formulier voor te bereiden", "haar pagina zegt niet meer dat we haar screeningsvragen lezen: de site vraagt er niet meer om", "op de eigen sollicitatiepagina van de werkgever", "zegt de notitie daarbij nu dat we het formulier van de werkgever niet hebben gelezen"], mustNot: /\boveral\b|\balle\b|\belke?\b|\bnooit\b|\bniets\b|ChatGPT|Cursor|Gemini|Copilot|\bwet\b|illegaal|verb(?:ied|oden)|geblokkeerd|voorwaarden|Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|robots|GraphQL|endpoint|\bATS\b|\d/i },
    pt: { must: ["pede aos programas que leem páginas automaticamente que fiquem fora da parte do site de onde vêm as perguntas de candidatura de uma vaga do Ashby", "quando você se candidata por conta própria com o Claude ou o Claude Code pelo nosso conector, ele não lê mais as perguntas de uma vaga cujo empregador usa o Ashby", "nossa API de dados também não as lê mais", "os dois agora deixam o Ashby de fora", "uma vaga assim não oferece mais a opção de preparar respostas para as perguntas do formulário dela", "a página dela não diz mais que lemos as perguntas de triagem dela: o site não as pede mais", "na própria página de candidatura do empregador", "a nota do kit agora diz que não lemos o formulário do empregador"], mustNot: /qualquer|lugar nenhum|\btod[oa]s?\b|\bcada\b|\bnunca\b|\bnada\b|ChatGPT|Cursor|Gemini|Copilot|\blei\b|ilegal|proib|bloque|termos de uso|Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|robots|GraphQL|endpoint|\bATS\b|\d/i },
    tl: { must: ["Hinihiling ng job site ng Ashby sa mga program na awtomatikong nagbabasa ng mga page na lumayo sa bahagi ng site na pinanggagalingan ng mga tanong sa aplikasyon ng isang trabaho sa Ashby", "kapag ikaw mismo ang nag-a-apply gamit ang Claude o Claude Code sa pamamagitan ng aming connector, hindi na nito binabasa ang mga tanong ng trabahong Ashby ang gamit ng employer", "hindi na rin binabasa ng aming data API ang mga ito", "pareho na nilang hindi isinasama ang Ashby", "hindi na nag-aalok ang ganitong trabaho na ihanda ang mga sagot sa mga tanong ng form nito", "hindi na sinasabi ng page nito na binabasa namin ang mga tanong sa screening nito: hindi na hinihingi ng site ang mga ito", "sa sariling application page ng employer", "sinasabi na ngayon ng note nito na hindi namin binasa ang form ng employer"], mustNot: /kahit saan|\blahat\b|\bbawat\b|kailanman|\bwala\b|ChatGPT|Cursor|Gemini|Copilot|\bbatas\b|ilegal|ipinagbabawal|block|Greenhouse|Recruitee|Breezy|Pinpoint|\bLever\b|Workable|robots|GraphQL|endpoint|\bATS\b|\d/i },
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

  it("British English is the US text with dialogue for dialog, and nothing else changed", () => {
    for (const id of IDS) {
      const us = EN[id];
      expect(SHARDS["en-GB"][id], id).toEqual({ title: toGB(us.title), description: toGB(us.description) });
      expect(textOf("en-GB", id), id).not.toMatch(/\bdialog\b|résumé/);
    }
    expect(textOf("en", ADD).split(/\bdialog\b/).length - 1).toBe(2);
    expect(textOf("en-GB", ADD).split(/\bdialogue\b/).length - 1).toBe(2);
  });

  it("the Ashby entry names Claude and Claude Code for the connector, once each, and ChatGPT nowhere, in every language", () => {
    for (const l of LOCALES) {
      const t = textOf(l, ASHBY);
      expect(t.split("Claude Code").length - 1, l).toBe(1);
      expect(t.replace(/Claude Code/g, "").split("Claude").length - 1, l).toBe(1);
      expect(t, l).not.toMatch(/ChatGPT/);
    }
  });

  it("the Add to Claude entry names no AI but Claude in any language", () => {
    for (const l of LOCALES) expect(textOf(l, ADD), l).not.toMatch(/ChatGPT|Claude Code|Cursor|Gemini|Copilot|OpenAI|Anthropic/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVERY TRANSLATION AS REVIEWED. The first 12 hex digits of SHA-256 over
// "<title>\n<description>", per language, in the order of IDS. A change to any
// of them fails here until the new text is read against what production showed
// on 19 November and its hash is written in.
const REVIEWED: Record<Locale, string[]> = {
  en: ["8d3419d70776", "b884690dc7f0"],
  "en-GB": ["606992f8b419", "b884690dc7f0"],
  de: ["dc18cb757f53", "32502f837bee"],
  es: ["a5c0a283cec7", "028db313c163"],
  fr: ["d12f83794528", "ba1b656c92a3"],
  hi: ["a355ae32e3c2", "15e389369515"],
  nl: ["1f182a2410c1", "c063f7c5261a"],
  pt: ["c259803d9ced", "59ceed6b07b2"],
  tl: ["5b50b54f1f7b", "45e7f4a9368a"],
};
const hash = (t: Text) => createHash("sha256").update(`${t.title}\n${t.description}`).digest("hex").slice(0, 12);

describe("every translation is the text that was reviewed", () => {
  it.each(LOCALES)("%s", (l) => {
    expect(IDS.map((id) => hash(SHARDS[l][id])), `${l}: a reworded entry must be read again against the live read, then its hash updated`).toEqual(REVIEWED[l]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO NUMBERS AND THE LIVE LABELS. Neither entry writes a number in any
// language. A label quoted in quotation marks is the page's name as that
// language's footer links it, or one of the two labels the /agents page shows
// in English in every language: the button and Claude's authentication choice,
// both read from the code that renders them.
/** Every number a text writes. Pure. */
const numbersIn = (s: string) => [...new Set((s.match(/\d{1,3}(?:[.,   ]\d{3})+(?!\d)|\d+/g) ?? []).map((x) => Number(x.replace(/\D/g, ""))))].sort((a, b) => a - b);
const PAGE_NAME = Object.fromEntries(LOCALES.map((l) => [l, (locale(l).footer as { links: Record<string, string> }).links.agents])) as Record<Locale, string>;
const CLAUDE_HOST = MCP_HOSTS.find((h) => h.id === "claude")!;
const SERVER = "https://example.invalid/functions/v1/agent-mcp";
const BUTTON = CLAUDE_HOST.deeplinks!({ url: SERVER, addToClaude: true }).find((d) => !d.secondary)!;
/** The labels the /agents page shows in English whatever the reader's language: read from the code, not typed here. */
const ENGLISH_ON_THE_PAGE = [BUTTON.label, MCP_CLAUDE_AUTH_CHOICE];
const QUOTE = /“([^”]+)”|„([^“]+)“|«\s?([^»]+?)\s?»|‘([^’]+)’/g;
/** Each quote in a text that is neither the page's name in that language nor an English label the page shows. Pure. */
function unreadQuotes(l: Locale, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTE)) {
    const q = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
    if (q !== PAGE_NAME[l] && !ENGLISH_ON_THE_PAGE.includes(q)) out.push(q);
  }
  return out;
}
const quotesIn = (text: string) => [...text.matchAll(QUOTE)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]).trim());

describe("no numbers and the live labels in every language", () => {
  it.each(IDS)("%s writes no number in any language", (id) => {
    for (const l of LOCALES) expect(numbersIn(textOf(l, id)), l).toEqual([]);
  });

  it("every quoted label is the page's live name in that language, or an English label the page shows", () => {
    for (const { where, l, text } of texts()) expect(unreadQuotes(l, text), where).toEqual([]);
  });

  it("the Add to Claude entry quotes the page's name, the button and the setting in every language, and the Ashby entry quotes nothing", () => {
    expect(ENGLISH_ON_THE_PAGE).toEqual(["Add to Claude", "Sign in when needed"]);
    for (const l of LOCALES) {
      expect(quotesIn(SHARDS[l][ADD].description), l).toEqual([PAGE_NAME[l], "Add to Claude", "Sign in when needed"]);
      expect(quotesIn(textOf(l, ASHBY)), l).toEqual([]);
    }
  });
});

describe("what the entries name is what the code holds", () => {
  it("the button carries the documented install link: Claude's add-a-custom-connector dialog, our name and our connector's address, and nothing else", () => {
    expect(MCP_ADD_TO_CLAUDE_LIVE).toBe(true);
    expect(BUTTON.href).toBe(claudeInstallLink(SERVER));
    const u = new URL(BUTTON.href);
    expect(`${u.origin}${u.pathname}`).toBe("https://claude.ai/customize/connectors");
    expect([...u.searchParams.keys()]).toEqual(["modal", "connectorName", "connectorUrl"]);
    expect(u.searchParams.get("modal")).toBe("add-custom-connector");
    expect(u.searchParams.get("connectorName")).toBe(MCP_CONNECTOR_NAME);
    expect(MCP_CONNECTOR_NAME).toBe("Resume Booster");
    expect(u.searchParams.get("connectorUrl")).toBe(SERVER);
    // The page hands the flag in; with none handed in (the prerender) there is no button.
    expect(source("src/pages/AgentConnect.tsx")).toMatch(/addToClaude = MCP_ADD_TO_CLAUDE_LIVE/);
    expect(CLAUDE_HOST.deeplinks!({ url: SERVER })).toEqual([]);
  });

  it("the steps begin with the button, have the person sign in if asked, check both and add it, name the setting, and keep the by-hand steps beneath", () => {
    const steps = CLAUDE_HOST.steps({ url: SERVER, addToClaude: true }).map((s) => s.text);
    expect(steps[0]).toBe("Click **Add to Claude** above. Claude opens its connector dialog with the name and the address filled in; sign in to Claude first if it asks.");
    expect(steps[1]).toMatch(/^Check that the name is \*\*Resume Booster\*\* and the address is this one, then click \*\*Continue\*\*/);
    expect(steps).toContain("Under authentication, choose **Sign in when needed** and click **Continue**.");
    expect(steps).toContain("Click **Add**.");
    for (const s of [...steps, ...CLAUDE_HOST.fallbackSteps!({ url: SERVER }).map((x) => x.text)]) expect(s).not.toMatch(/Keep them as they are|settings it detected/);
    expect(CLAUDE_HOST.fallbackSteps!({ url: SERVER })[0].text).toBe("In Claude, open **Customize**, then **Connectors**.");
    expect(source("src/pages/AgentConnect.tsx")).toMatch(/<details className="mt-4" data-manual-steps>/);
  });

  it("the page's name is the live label of its footer link in every language", () => {
    expect(PAGE_NAME.en).toBe("Connect your agent");
    for (const l of LOCALES) expect(PAGE_NAME[l].length, l).toBeGreaterThan(3);
  });

  it("Ashby is on the stop list every surface reads, the shared reader withholds it, and ChatGPT never read it", () => {
    expect(MCP_FORM_NOT_READ_HERE).toEqual(["ashby"]);
    expect(MCP_FORM_VENDORS.map((v) => v.key)).not.toContain("ashby");
    expect(FORM_STOPPED_VENDORS).toEqual(["ashby"]);
    expect(FORM_READER_VENDORS).toContain("ashby");
    // Inside ChatGPT the connector reads only the public-API pair, which never
    // held Ashby: "no longer" would be false there, so the entry names Claude
    // and Claude Code.
    expect(PUBLIC_API_FORM_VENDORS).not.toContain("ashby");
    const mcp = source("supabase/functions/agent-mcp/index.ts");
    expect(mcp).toMatch(/const FORM_NOT_READ_HERE: readonly string\[\] = \["ashby"\];/);
    expect(mcp).toMatch(/edition === "chatgpt" \? PUBLIC_API_FORM_VENDORS : CONNECTOR_FORM_VENDORS/);
    expect(source("supabase/functions/public-api/index.ts")).toMatch(/const V1_FORM_READS: readonly string\[\] = V1_FORM_VENDORS\.filter\(\(v\) => v !== "ashby"\);/);
  });

  it("the board offers no Prep answers on an Ashby job and the kit asks for no Ashby questions, while the table still flags them, so the stop is what removed them", () => {
    const kit = source("src/components/apply/ApplicationAnswers.tsx");
    const list = /export const REAL_QUESTION_PREFIXES: readonly string\[\] = \[\s*([^\]]*)\]/.exec(kit)?.[1] ?? "";
    const prefixes = [...list.matchAll(/"([a-z]+:)"/g)].map((m) => m[1]);
    expect(prefixes).toEqual(["breezy:", "greenhouse:", "pinpoint:", "recruitee:"]);
    expect(kit).toMatch(/if \(!vendor \|\| MCP_FORM_NOT_READ_HERE\.includes\(vendor\)\) return false;/);
    expect(kit).toMatch(/if \(jobId && asksForRealQuestions\(jobId\)\)/);
    expect(source("src/pages/Jobs.tsx")).toMatch(/applicationAnswers: REAL_QUESTION_PREFIXES\.some\(\(p\) => detailJob\.id\.startsWith\(p\)\) \?/);
    expect(automationFor("ashby").realQuestions).toBe(true);
    expect(applyMechanics("ashby").readsScreeningQuestions).toBe(false);
    expect(applyMechanics("greenhouse").readsScreeningQuestions).toBe(true);
  });

  it("job-board itself still answers the questions action, which is why the entry says the site no longer asks rather than that nothing reads", () => {
    expect(source("supabase/functions/job-board/index.ts")).toMatch(/if \(action === "application-questions"\) \{/);
  });

  it("the questions line How applying works drops is the one the entry describes, and the kit's note says we did not read the form in every language", () => {
    expect((locale("en").howApply as Record<string, string>).questions).toBe("We read this posting's own screening questions.");
    const NOTE: Record<Locale, string> = {
      en: "(we did not read this employer's form)", "en-GB": "(we did not read this employer's form)",
      de: "(das Formular dieses Arbeitgebers haben wir nicht gelesen)", es: "(no leímos el formulario de esta empresa)",
      fr: "(nous n'avons pas lu le formulaire de cet employeur)", hi: "(हमने इस नियोक्ता का फ़ॉर्म नहीं पढ़ा)",
      nl: "(het formulier van deze werkgever hebben we niet gelezen)", pt: "(não lemos o formulário deste empregador)",
      tl: "(hindi namin binasa ang form ng employer na ito)",
    };
    for (const l of LOCALES) {
      const note = (locale(l).applyAnswers as Record<string, string>).inferredIntro;
      expect(note, l).toContain(NOTE[l]);
      expect(note, l).not.toMatch(/\bATS\b/);
    }
  });
});

describe("nothing an entry says is ours alone to know", () => {
  const REFUSED: Array<[string, RegExp]> = [
    ["an audit or owner-decision id", /\b(?:S\d{1,2}X?|NB|OD\d{1,2}|HO)-\d{1,3}\b|OD14/],
    ["an internal name", /job-board|x-fn-build|\bcron\b|\bRPC\b|\bMCP\b|migration|edge function|prerender|apply_myself|agent-mcp|public-api|withheld|not-read-on-this-surface|modal=|connectorUrl|robots\.txt|GraphQL|MCP_/i],
    ["a vendor and token", /\b[a-z]+:[a-z0-9~_-]+\b/],
    ["a commit or migration id", /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b|\b20\d{12}\b/],
    ["a price or a retired product", /[$€£]\s?\d|\bUSD\b|Premium|Apply Assistant|applies for you|apply for you|Agent Pass/i],
    ["an AI host seekers are not shown", /Cursor|Copilot|Gemini|Windsurf|Perplexity|VS Code|OpenAI|Anthropic|\bGPT/i],
    ["a provider the pages do not name", /Lovable|Stripe|Supabase|Postgres|Cloudflare/i],
    ["a claim that we send applications", /we (?:send|submit) (?:your )?applications?/i],
  ];
  it.each(REFUSED)("no entry states %s", (_why, re) => {
    for (const { where, text } of texts()) expect(text, where).not.toMatch(re);
  });

  it("the Portuguese is Brazilian", () => {
    const pt = IDS.map((id) => textOf("pt", id)).join(" ");
    expect(pt).not.toMatch(/ficheiro|ecrã|telemóvel|registad|separador|utilizador|\bestá a [a-z]+r\b|«|»|\bpor si\b/i);
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
  /** The breaches that name a refused wording, not a lost one. */
  const refused = (b: string[]) => b.filter((x) => / (?:states|matches) /.test(x));

  it("the Ashby stop said of anywhere, of all employers, or of nothing sent, in four languages", () => {
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "We no longer read Ashby forms anywhere.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "Nothing is sent to Ashby now.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "This holds for all employers.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "We never read an employer's form again.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "fr", plus("fr", ASHBY, "Plus rien n'est lu, nulle part.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "pt", plus("pt", ASHBY, "Nenhum dos nossos serviços lê mais nada.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "de", plus("de", ASHBY, "Nichts davon wird mehr gelesen.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "hi", plus("hi", ASHBY, "अब कहीं भी कोई फ़ॉर्म नहीं पढ़ा जाता।")))).not.toEqual([]);
  });

  it("the Ashby entry names ChatGPT, where the form was never read, or calls Ashby's request a ban", () => {
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "The same now holds in ChatGPT.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "es", plus("es", ASHBY, "Lo mismo vale ahora en ChatGPT.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "Ashby forbids it.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "Reading it would break the law.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "nl", plus("nl", ASHBY, "Ashby verbiedt het.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "tl", plus("tl", ASHBY, "Ipinagbabawal ito ng Ashby.")))).not.toEqual([]);
  });

  it("the Ashby entry says its jobs left the board, names another system, or calls the drafted questions the employer's real ones", () => {
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "Our job board no longer shows Ashby jobs.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "Greenhouse forms are still read.")))).not.toEqual([]);
    expect(refused(breaches(ASHBY, "en", plus("en", ASHBY, "The kit drafts the employer's real questions.")))).not.toEqual([]);
  });

  it("losing a limit fails too: the connector unscoped, or the site said to read nothing where it only no longer asks", () => {
    const unscoped = breaches(ASHBY, "en", swap("en", ASHBY, "when you apply yourself with Claude or Claude Code through our connector, it", "our connector"));
    expect(unscoped.some((x) => / lost /.test(x)), unscoped.join("; ")).toBe(true);
    const site = breaches(ASHBY, "de", swap("de", ASHBY, "Die Website fragt nicht mehr danach", "Die Website liest sie nicht mehr"));
    expect(site.some((x) => / lost /.test(x)), site.join("; ")).toBe(true);
  });

  it("Add to Claude adds the connector by itself, names another AI, or drops the by-hand steps", () => {
    expect(refused(breaches(ADD, "en", plus("en", ADD, "Claude then adds the connector for you.")))).not.toEqual([]);
    expect(refused(breaches(ADD, "en", plus("en", ADD, "It works the same way in ChatGPT.")))).not.toEqual([]);
    expect(refused(breaches(ADD, "en", plus("en", ADD, "The old steps were removed.")))).not.toEqual([]);
    expect(refused(breaches(ADD, "de", plus("de", ADD, "Der Connector wird automatisch hinzugefügt.")))).not.toEqual([]);
    expect(refused(breaches(ADD, "tl", plus("tl", ADD, "Awtomatikong idinadagdag ang connector.")))).not.toEqual([]);
    const auto = breaches(ADD, "en", swap("en", ADD, "then you check both and add the connector yourself", "then Claude adds the connector for you"));
    expect(auto.some((x) => / lost /.test(x)) && refused(auto).length > 0, auto.join("; ")).toBe(true);
  });

  it("Add to Claude promises what Claude does next, a plan, or a team route", () => {
    expect(refused(breaches(ADD, "en", plus("en", ADD, "Claude asks you to sign in to your account the first time you use a tool that needs it.")))).not.toEqual([]);
    expect(refused(breaches(ADD, "en", plus("en", ADD, "This works on every Claude plan.")))).not.toEqual([]);
    expect(refused(breaches(ADD, "fr", plus("fr", ADD, "Un propriétaire d'organisation peut l'ajouter pour son équipe.")))).not.toEqual([]);
  });

  it("a number, or a quoted label the page does not carry, fails", () => {
    expect(numbersIn(swap("fr", ADD, "déjà remplis", "déjà remplis en 2 secondes").description)).not.toEqual([]);
    expect(unreadQuotes("es", swap("es", ADD, "un botón «Add to Claude»", "un botón «Añadir a Claude»").description)).toContain("Añadir a Claude");
    expect(unreadQuotes("en", swap("en", ADD, "“Sign in when needed”", "“No sign in”").description)).toContain("No sign in");
    expect(unreadQuotes("de", swap("de", ADD, "„Deinen Agenten verbinden“", "„Verbinde deine KI“").description)).toContain("Verbinde deine KI");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 52h, run in bash against a fake curl that answers from a route table
// and logs every call, as the 18 November test runs section 52g.
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
/** The page this batch publishes: the two on top of the 28 entries before them. */
const PUBLISHED_PAGE = crawler(rowsOf(AT, AT + 30));
/** The page before the publish: the 30 entries before the two. */
const BEFORE_PAGE = crawler(rowsOf(AT + IDS.length, AT + IDS.length + 30));
const chunkOf = (entries: Record<string, unknown>) => `const e=${JSON.stringify({ changelogEntries: entries })};export{e as default};`;
const PUBLISHED = chunkOf(EN);
/** The strings before the publish: neither the two nor anything newer than them. */
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
  const dir = mkdtempSync(join(tmpdir(), "vd-52h-"));
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

const S52H = "52h-changelog-nov-19.sh";
const sectionText = () => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", S52H), "utf8");
/** The string section 52h requires in each entry's US description, as its VD52H_MUST list names it. */
const MUSTS = (/<<'VD52H_MUST'\n([\s\S]*?)\nVD52H_MUST/.exec(sectionText())?.[1].split("\n") ?? [])
  .map((x) => ({ id: x.split("|")[0], must: x.split("|").slice(1).join("|") }));
const TITLES = ENTRIES.map((e) => ({ date: e.date, title: EN[e.id].title }));
const onPage = (t: { date: string; title: string }) => `PASS  /changelog serves crawlers "${t.title}", dated ${t.date}`;
const pastPage = (t: { title: string }) => `PASS  "${t.title}" is past the newest 30 entries the crawler page lists, and the US English changelog strings carry it`;
const notRebuilt = (t: { title: string }) => `FAIL  the US English changelog strings carry "${t.title}", but the crawler copy of /changelog does not (the prerender did not rebuild)`;
const LATEST_OK = `PASS  /changelog's description names an entry of 2026-11-19 as the newest, no older than this batch's 2026-11-19`;

describe("section 52h judges the two entries on the crawler page", () => {
  it("lists exactly their titles, in order, each with the date their deploy went live", () => {
    const listed = /<<'VD52H_TITLES'\n([\s\S]*?)\nVD52H_TITLES/.exec(sectionText())?.[1].split("\n") ?? [];
    expect(listed).toEqual(TITLES.map((t) => `${t.date}|${t.title}`));
  });

  it("lists one string per entry that holds the limit its live read set, each in that entry's description and found once in the whole US shard", () => {
    const listed = /<<'VD52H_MUST'\n([\s\S]*?)\nVD52H_MUST/.exec(sectionText())?.[1].split("\n") ?? [];
    expect(listed.map((x) => x.split("|")[0])).toEqual(IDS);
    const whole = readFileSync(resolve(ROOT, "src/i18n/changelog/en.json"), "utf8");
    for (const [id, m] of listed.map((x) => x.split("|"))) {
      expect(EN[id].description, id).toContain(m);
      expect(whole.split(m).length - 1, `${m} is found once in the US shard`).toBe(1);
      expect(m, `${m} holds no quote mark the bundle might escape`).not.toMatch(/['"‘’“”]/);
      expect(m, `${m} is plain ASCII, which the bundle never escapes`).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(MUSTS.find((x) => x.id === ADD)?.must, "the Add to Claude line keeps that the person checks and adds it").toMatch(/add the connector yourself/);
    expect(MUSTS.find((x) => x.id === ASHBY)?.must, "the Ashby line keeps the connector to Claude and Claude Code").toMatch(/with Claude or Claude Code through our connector/);
  });

  it("the bake clamps the page's description at 160 characters and cuts this batch's first title, and the date it reads comes before the cut", () => {
    const content = /<meta name="description" content="([^"]*)"/.exec(PUBLISHED_PAGE)?.[1] ?? "";
    expect(content.length).toBeLessThanOrEqual(160);
    expect(content).toMatch(/…$/);
    expect(content).not.toContain(esc(EN[ADD].title));
    expect(content).toContain(`Latest (${DATE}): `);
  });

  it("before the publish every line is INFO, and only GETs are sent, never to the British chunk or another language's", () => {
    const { lines, calls } = run(S52H, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED });
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*does not carry the 19 November entries yet/.test(l)), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(lines, show(lines)).toContain("INFO  the other eight languages' changelog strings are judged after the publish");
    for (const c of calls) expect(c, c).toMatch(/^GET /);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
    for (const l of LANGS) expect(calls.some((c) => c.includes(`/assets/${l}-`)), l).toBe(false);
  });

  it("after the publish each title passes on the crawler page with its date, each description and each language passes, and the clamped description still names an entry of 19 November as newest", () => {
    const { lines } = run(S52H);
    expect(fails(lines), show(lines)).toEqual([]);
    for (const t of TITLES) expect(lines, show(lines)).toContain(onPage(t));
    for (const { id, must } of MUSTS) expect(lines, show(lines)).toContain(`PASS  the US English changelog strings describe ${id} with "${must}"`);
    for (const l of LANGS) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry both 19 November entries`);
    expect(lines, show(lines)).toContain(LATEST_OK);
    for (const l of lines) expect(l, l).toMatch(/^(PASS|FAIL|INFO|==) /);
  });

  it("section 52g still passes the 18 November entries on the page this batch publishes, with the two on top", () => {
    const { lines } = run("52g-changelog-nov-18.sh");
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.some((l) => /^PASS {2}the US English changelog chunk .* carries the 18 November entries/.test(l)), show(lines)).toBe(true);
    expect(lines, show(lines)).toContain(`PASS  /changelog's description names an entry of 2026-11-19 as the newest, no older than this batch's 2026-11-18`);
  });

  it("leaves the key, the project, the site and the user agent every later section reads as it found them", () => {
    for (const r of [run(S52H), run(S52H, { changelog: BEFORE_PAGE, chunk: UNPUBLISHED })]) {
      expect(r.env, show(r.lines)).toBe("pk_test|rb_test|https://p.supabase.co|https://site.test|ua");
    }
  });

  it("a description reworded under the same title FAILs, though its title passes", () => {
    const ashby = MUSTS.find((x) => x.id === ASHBY)!;
    const reworded = { ...EN, [ASHBY]: { ...EN[ASHBY], description: EN[ASHBY].description.replace(ashby.must, "when you apply yourself with any AI, anywhere") } };
    const { lines } = run(S52H, { chunk: chunkOf(reworded) });
    expect(fails(lines), show(lines)).toEqual([`FAIL  the US English changelog strings carry no "${ashby.must}" for ${ASHBY}: its description is not the one read live on 19 November`]);
    expect(lines, show(lines)).toContain(onPage(TITLES[1]));
  });

  it("a language whose chunk lacks an entry FAILs, and so does a language the entry names no changelog chunk for", () => {
    const de = chunkOf(Object.fromEntries(Object.entries(SHARDS.de).filter(([k]) => k !== ASHBY)));
    const { lines } = run(S52H, { langs: { de, nl: `const s={header:{jobs:"x"}};export{s as default};` } });
    expect(fails(lines), show(lines)).toEqual([
      `FAIL  the de changelog strings (${clChunk("de")}) lack ${ASHBY}: the publish did not ship the 19 November entries in de`,
      "FAIL  no nl changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts: the 19 November entries cannot be shown in nl",
    ]);
    for (const l of LANGS.filter((x) => x !== "de" && x !== "nl")) expect(lines, show(lines)).toContain(`PASS  the ${l} changelog strings (${clChunk(l)}) carry both 19 November entries`);
  });

  it("a wrong date FAILs", () => {
    const moved = crawler(rowsOf(AT, AT + 30).map((r) => (r.title === TITLES[1].title ? { ...r, date: "2026-11-18" } : r)));
    const { lines } = run(S52H, { changelog: moved });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog dates "${TITLES[1].title}" 2026-11-18, want 2026-11-19, the day its deploy went live`]);
  });

  it("a title the crawler page lost FAILs, and so does one dropped from both", () => {
    const lost = run(S52H, { changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[1].title)) }).lines;
    expect(lost, show(lost)).toContain(notRebuilt(TITLES[1]));
    const without = chunkOf(Object.fromEntries(Object.entries(EN).filter(([k]) => k !== IDS[1])));
    const gone = run(S52H, { chunk: without, changelog: crawler(rowsOf(AT, AT + 30).filter((r) => r.title !== TITLES[1].title)) }).lines;
    expect(gone, show(gone)).toContain(`FAIL  the 19 November entries are published, but neither /changelog nor the US English changelog strings carry "${TITLES[1].title}" (an entry was dropped or retitled when it landed)`);
  });

  it("a later batch that pushes them off the page passes, and a stale bake does not, title or description", () => {
    const pushed = run(S52H, { changelog: crawler(filler(30, "2026-12-01", "A newer entry")) }).lines;
    expect(fails(pushed), show(pushed)).toEqual([]);
    for (const t of TITLES) expect(pushed, show(pushed)).toContain(pastPage(t));
    const stale = run(S52H, { changelog: BEFORE_PAGE }).lines;
    for (const t of TITLES) expect(stale, show(stale)).toContain(notRebuilt(t));
    expect(stale, show(stale)).toContain(`FAIL  /changelog's description names an entry of 2026-11-18 as the newest, older than this batch's 2026-11-19 (the prerender did not rebuild)`);
  });

  it("thirty entries older than the batch cannot have pushed it off, nor can fewer than thirty newer ones: FAIL", () => {
    const older = run(S52H, { changelog: crawler(filler(30, "2026-11-18", "An entry of 18 November")) }).lines;
    for (const t of TITLES) expect(older, show(older)).toContain(notRebuilt(t));
    const few = run(S52H, { changelog: crawler(filler(29, "2026-12-01", "A newer entry")) }).lines;
    for (const t of TITLES) expect(few, show(few)).toContain(notRebuilt(t));
  });

  it("a description the bake left on an older newest entry FAILs, though every title is listed", () => {
    const page = PUBLISHED_PAGE.replace(/Latest \(2026-11-19\): [^"]*/, `Latest (2026-11-18): ${esc(EN.theBoardKeepsYourFiltersAndSaysWhyAJobHasNoFitScore.title)}.`);
    expect(page).not.toBe(PUBLISHED_PAGE);
    const { lines } = run(S52H, { changelog: page });
    expect(fails(lines), show(lines)).toEqual([`FAIL  /changelog's description names an entry of 2026-11-18 as the newest, older than this batch's 2026-11-19 (the prerender did not rebuild)`]);
    const none = run(S52H, { changelog: PUBLISHED_PAGE.replace(/Latest \([^"]*/, "No entries yet.") }).lines;
    expect(none.some((l) => /^FAIL {2}\/changelog's description names no newest entry/.test(l)), show(none)).toBe(true);
  });

  it("no US chunk at all is a FAIL, and the British chunk is never read in its place", () => {
    const { lines, calls } = run(S52H, { chunk: `const e={};export{e as default};` });
    expect(lines.some((l) => /^FAIL {2}no US English changelog chunk the served entry names carries workdayCompanyPagesLostTheirFacts/.test(l)), show(lines)).toBe(true);
    expect(calls.some((c) => c.includes("en-GB-"))).toBe(false);
  });
});
