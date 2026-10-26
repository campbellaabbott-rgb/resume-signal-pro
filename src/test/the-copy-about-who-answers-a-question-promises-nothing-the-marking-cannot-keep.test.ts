// @vitest-environment node
/**
 * THE COPY ABOUT WHO ANSWERS A QUESTION PROMISES NOTHING THE MARKING CANNOT KEEP
 * (wave 4 descope, 2026-10-25).
 *
 * What the rule does. _shared/self-apply.ts (whoAnswers) and the classifier in
 * _shared/application-questions.ts mark each application question: one that
 * looks like it asks about the person goes to the person, an open question
 * about their work can be drafted from their CV. They read words, not meaning.
 * The final recheck of fix round 4 wrote 24 fresh questions about the person
 * and the rule marked 17 of them for a draft (main's classifier, 22), and it
 * sends some ordinary work questions to the person. So no page, locale, crawler
 * file or AI-host text may say that every factual question goes to the person,
 * that the AI drafts only answers about the work, or that a question about the
 * person is never drafted. They say what the marking does and tell the person
 * to read every answer before sending, in all nine languages.
 *
 * The first rewrite (27e54375) said the marking can miss a question about the
 * person only when it is worded unusually. The recheck of the descope found
 * plainly worded ones missed too ("How many years of accident-free driving
 * experience do you have?" is marked for a draft; the answers panel drafts
 * "Are you legally permitted to work in Germany?"). So that qualifier is a
 * removed phrasing in every language, and the copy says the marking can miss a
 * question about the person, even a plainly worded one. The same recheck found
 * three more absolutes the marking cannot keep, now removed: the /agent
 * panel's work-authorisation hints ("on any country you haven't ticked, the
 * agent stops", "the agent will not assume it"), the setupIsOneStep changelog
 * line ("never guessed") and the answers panel's "Every answer is grounded in
 * your résumé", where the fact-check reads only credentials, degrees, figures,
 * employers and titles. The second recheck found one more, in all nine
 * changelog shards: the applyAgentCountries entry's "anything asking about a
 * country you haven't listed stops and waits for you instead of guessing"
 * ("Can you lawfully take up employment in Ireland?" is drafted); it now says
 * a question the agent recognises as asking about such a country stops.
 *
 * What this checks: none of the removed phrasings (each language's own) is left
 * on any surface a seeker, a crawler or an AI host reads; the rewritten keys
 * carry the read-every-answer line in their own language; and, as teeth, every
 * removed sentence is caught by the patterns.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOf } from "./helpers/strip-comments";
import { GUIDES } from "../data/guides";
import { MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS } from "../config/mcp-tools";
import { RETIRED_LINES } from "../../supabase/functions/_shared/apply-agent-retired";
import { DRAFT_MARK_NOTE } from "../../supabase/functions/agent-mcp/apply-myself";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const LANGS = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
type Lang = (typeof LANGS)[number];

/** The removed phrasings, per language. English covers en-GB. */
const REMOVED: Record<Exclude<Lang, "en-GB">, RegExp[]> = {
  en: [
    /\bask(?:s)? (?:you|the person|them) every factual question/i,
    /\basks? (?:you|me|the person) everything factual/i,
    /\bdrafts? only (?:the )?open(?:-ended)? answers/i,
    /\bdrafts? only answers about (?:your|their|the person's) work/i,
    /\bevery factual, demographic and consent question/i,
    /\bthe person for every factual\b/i,
    /\banswers in their own words: every factual question/i,
    /\bquestions are always left to you/i,
    /\bnever guesses at these/i,
    /\bwe don't guess your identity/i,
    /\bit never fills them in for you/i,
    /\bblank isn't guessed at/i,
    /\bworded unusually\b/i,
    /\bunusually worded\b/i,
    /\bstart date are never guessed\b/i,
    /\bon any country you haven.t ticked\b/i,
    /\bthe agent will not assume it\b/i,
    /\bEvery answer is grounded in your (?:résumé|resume|CV)/i,
    /\banything asking about a country you haven.t listed stops\b/i,
  ],
  de: [/jede Sachfrage/i, /nur offene Antworten aus deinem Lebenslauf/i, /nur Antworten über deine Arbeit/i, /Wir raten nicht bei Ihrer Identität/i, /Der Agent rät hier nie/i, /wird nicht geraten/i, /füllt sie nie für dich aus/i, /bleiben immer dir überlassen/i,
    /ungewöhnlich formulierte/i, /Startdatum werden nie erraten/i, /Bei jedem nicht gewählten Land/i, /Jede Antwort stützt sich auf Ihren Lebenslauf/i,
    /jede Frage zu einem nicht angegebenen Land hält an/i],
  es: [/todas las preguntas sobre datos/i, /redacte solo las respuestas abiertas/i, /redacte solo respuestas sobre tu trabajo/i, /No adivinamos tu identidad/i, /El agente nunca las adivina/i, /blanco no se adivina/i, /nunca las rellena por ti/i, /siempre quedan para ti/i,
    /redactada de forma poco habitual/i, /fecha de inicio nunca se adivinan/i, /en cualquier país que no marques/i, /Cada respuesta se basa en tu currículum/i,
    /cualquier pregunta sobre un país que no hayas indicado se detiene/i],
  fr: [/toutes les questions factuelles/i, /ne rédiger que les réponses ouvertes/i, /ne rédiger que des réponses sur votre travail/i, /Nous ne devinons pas votre identité/i, /L'agent ne les devine jamais/i, /n'est jamais deviné/i, /ne les remplit jamais à votre place/i, /vous restent toujours réservées/i,
    /formulée de façon inhabituelle/i, /date de début ne sont jamais devinés/i, /pour tout pays non coché/i, /Chaque réponse s'appuie sur votre CV/i,
    /toute question portant sur un pays non indiqué s.arrête/i],
  hi: [/हर तथ्य वाला सवाल/, /केवल खुले उत्तरों का मसौदा/, /केवल आपके काम के बारे में उत्तरों/, /जनसांख्यिकीय जानकारी का अनुमान नहीं लगाते/, /एजेंट इनका अनुमान कभी नहीं लगाता/, /उसका अनुमान नहीं लगाया जाता/, /इन्हें आपके लिए कभी नहीं भरता/, /हमेशा आपके लिए छोड़े जाते हैं/,
    /अलग ढंग से लिख/, /तारीख़ का अनुमान कभी नहीं लगाया जाता/, /जिस देश को आपने नहीं चुना, उस पर/, /हर जवाब आपके रिज़्यूमे पर आधारित है/,
    /उसके बारे में कोई भी प्रश्न अनुमान लगाने के बजाय/],
  nl: [/elke feitelijke vraag/i, /alleen open antwoorden op basis van je cv/i, /alleen antwoorden over je werk/i, /We raden niet naar je identiteit/i, /De agent raadt hier nooit/i, /leeg laat wordt niet geraden/i, /vult ze nooit voor je in/i, /blijven altijd aan jou/i,
    /ongewoon geformuleerde/i, /startdatum raden we nooit/i, /bij elk land dat u niet aanvinkt/i, /Elk antwoord is gebaseerd op je cv/i,
    /elke vraag over een land dat u niet hebt aangegeven stopt/i],
  pt: [/todas as perguntas factuais/i, /redigir só as respostas abertas/i, /redigir só respostas sobre o seu trabalho/i, /Não adivinhamos a sua identidade/i, /O agente nunca as adivinha/i, /branco não é adivinhado/i, /nunca as preenche por ti/i, /ficam sempre com você/i,
    /escrita de um jeito incomum/i, /escrita de forma invulgar/i, /data de início nunca são adivinhados/i, /em qualquer país não assinalado/i, /Cada resposta baseia-se no seu currículo/i,
    /qualquer pergunta sobre um país que não tenha indicado pára/i],
  tl: [/ang bawat factual na tanong/i, /gumawa lang ng draft ng mga bukas na sagot/i, /gumawa lang ng draft ng mga sagot tungkol sa iyong trabaho/i, /Hindi namin hinuhulaan ang pagkakakilanlan mo/i, /Hindi ito hinuhulaan ng ahente/i, /blangko ay hindi hinuhulaan/i, /hindi niya ito pinupunan para sa iyo/i, /ay laging iniiwan sa iyo/i,
    /na kakaiba ang pagkakasulat/i, /Hindi kailanman hinuhulaan ang iyong work authorisation/i, /sa anumang bansang hindi mo na-tick/i, /Nakabatay sa resume mo ang bawat sagot/i,
    /anumang tanong tungkol sa bansang hindi mo nailista ay hihinto/i],
};
const ALL_REMOVED = Object.values(REMOVED).flat();
const hits = (text: string) => ALL_REMOVED.filter((re) => re.test(text)).map(String);

/** "Read every answer before you send", in each language. */
const READ_EVERY: Record<Lang, RegExp> = {
  en: /read every answer before you send/i,
  "en-GB": /read every answer before you send/i,
  de: /jede Antwort, bevor (?:du|Sie) sie absende/i,
  es: /lee cada respuesta antes de enviarla/i,
  fr: /relisez (?:donc )?chaque réponse avant de l'envoyer/i,
  hi: /भेजने से पहले हर उत्तर पढ़ें/,
  nl: /lees elk antwoord voordat je het verstuurt/i,
  pt: /leia cada resposta antes de enviar/i,
  tl: /basahin ang bawat sagot bago mo ipadala/i,
};

/** "Even a plainly worded one", in each language: the marking can miss a question about the person however it is worded. */
const EVEN_PLAIN: Record<Lang, RegExp> = {
  en: /even a plainly worded one/i,
  "en-GB": /even a plainly worded one/i,
  de: /auch eine klar formulierte/i,
  es: /aunque esté redactada con claridad/i,
  fr: /même formulée clairement/i,
  hi: /चाहे वह साफ़ शब्दों में लिखा हो/,
  nl: /ook een duidelijk geformuleerde/i,
  pt: /mesmo escrita de forma clara/i,
  tl: /kahit malinaw ang pagkakasulat/i,
};

const jsonFiles = (dir: string) => readdirSync(resolve(ROOT, dir)).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));

/** Every surface a seeker, a crawler or an AI host reads, as text: comments stripped from code. */
function surfaces(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const dir of ["src/i18n/locales", "src/i18n/changelog", "src/i18n/auth"]) for (const f of jsonFiles(dir)) out.push([f, read(f)]);
  out.push(["public/llms.txt", read("public/llms.txt")]);
  out.push(["src/data/guides.ts GUIDES", JSON.stringify(GUIDES)]);
  out.push(["src/config/mcp-tools.ts", JSON.stringify({ MCP_TOOLS, MCP_PROMPTS, MCP_RESOURCES })]);
  out.push(["RETIRED_LINES", JSON.stringify(RETIRED_LINES)]);
  for (const f of [
    "supabase/functions/agent-mcp/index.ts",
    "supabase/functions/agent-mcp/apply-myself.ts",
    "supabase/functions/public-api/application.ts",
    "supabase/functions/public-api/index.ts",
    "supabase/functions/generate-application-answers/index.ts",
    "supabase/functions/generate-apply-package/index.ts",
    "src/pages/AgentConnect.tsx",
    "src/pages/Agent.tsx",
    "src/pages/AgentPass.tsx",
    "src/components/agents/ApplyYourself.tsx",
    "src/components/apply/ApplicationAnswers.tsx",
    "src/components/account/ApplyProfilePanel.tsx",
    "scripts/prerender-seo.mjs",
    "scripts/prerender-pages.mjs",
  ]) out.push([f, codeOf(read(f))]);
  return out;
}

describe("no surface carries a removed absolute about who answers a question", () => {
  it("not in the nine locales, the shards, llms.txt, the guides, the MCP and API text, the retired lines, the pages or the bake", () => {
    const found = surfaces().flatMap(([name, text]) => hits(text).map((re) => `${name}: ${re}`));
    expect(found).toEqual([]);
  });

  it("the scan reads every locale and shard file and every named source", () => {
    const names = surfaces().map(([n]) => n);
    for (const lang of LANGS) {
      expect(names).toContain(`src/i18n/locales/${lang}.json`);
      expect(names).toContain(`src/i18n/changelog/${lang}.json`);
    }
    expect(surfaces().every(([, text]) => text.length > 200)).toBe(true);
  });
});

describe("the rewritten copy tells the person to read every answer, in their language", () => {
  const locale = (lang: Lang) => JSON.parse(read(`src/i18n/locales/${lang}.json`));

  it.each(LANGS)("%s: the apply-yourself lines and the answers panel", (lang) => {
    const d = locale(lang);
    for (const s of [d.agentConnect.selfApplyFree, d.agentConnect.applyStep3, d.applyAnswers.yoursBody]) {
      expect(s, `${lang}: ${s}`).toMatch(READ_EVERY[lang]);
      expect(hits(s)).toEqual([]);
    }
  });

  it.each(LANGS.filter((l) => l !== "en-GB"))("%s: the retired products' line says the same", (lang) => {
    expect(RETIRED_LINES[lang].free).toMatch(READ_EVERY[lang]);
    expect(RETIRED_LINES[lang].free).toMatch(EVEN_PLAIN[lang]);
  });

  it.each(LANGS)("%s: the hedge says the marking can miss a question about the person even when it is plainly worded", (lang) => {
    const d = locale(lang);
    for (const s of [d.agentConnect.selfApplyFree, d.agentConnect.applyStep3, d.applyAnswers.yoursBody, d.applyProfile.legalIntro]) {
      expect(s, `${lang}: ${s}`).toMatch(EVEN_PLAIN[lang]);
    }
  });

  /** The applyAgentCountries line's hedge, in each language: only a question the agent recognises stops. */
  const RECOGNISES_COUNTRY: Record<Lang, RegExp> = {
    en: /a question it recognises as asking about a country you haven't listed stops and waits for you\./,
    "en-GB": /a question it recognises as asking about a country you haven't listed stops and waits for you\./,
    de: /eine Frage, die er als Frage zu einem nicht angegebenen Land erkennt, hält an und wartet auf Sie\./,
    es: /una pregunta que reconoce como pregunta sobre un país que no hayas indicado se detiene y te espera\./,
    fr: /une question qu'il reconnaît comme portant sur un pays non indiqué s'arrête et vous attend\./,
    hi: /जिस प्रश्न को एजेंट ऐसे देश के बारे में पहचानता है जिसे आपने सूचीबद्ध नहीं किया, वह रुककर आपकी प्रतीक्षा करेगा।/,
    nl: /een vraag die hij herkent als een vraag over een land dat u niet hebt aangegeven, stopt en wacht op u\./,
    pt: /uma pergunta que reconhece como sendo sobre um país que não tenha indicado pára e espera por si\./,
    tl: /ang tanong na kinikilala ng agent na tungkol sa bansang hindi mo nailista ay hihinto at maghihintay sa iyo\./,
  };
  it.each(LANGS)("%s: the applyAgentCountries changelog line stops only on a question the agent recognises", (lang) => {
    const shard = JSON.parse(read(`src/i18n/changelog/${lang}.json`));
    const d = String(shard.changelogEntries.applyAgentCountries.description);
    expect(d).toMatch(RECOGNISES_COUNTRY[lang]);
    expect(hits(d)).toEqual([]);
  });

  it("every English surface that describes the marking says it can miss a question and says to read every answer", () => {
    const tool = MCP_TOOLS.find((t) => t.name === "apply_myself")!.body;
    const prompt = MCP_PROMPTS.find((p) => p.name === "apply_myself")!.body;
    const guide = JSON.stringify(GUIDES["how-the-apply-agent-works"]);
    const api = codeOf(read("supabase/functions/public-api/application.ts"));
    const mcp = codeOf(read("supabase/functions/agent-mcp/index.ts"));
    const llms = read("public/llms.txt");
    for (const [name, text] of [["the apply_myself card", tool], ["the apply_myself prompt card", prompt], ["the guide", guide], ["llms.txt", llms], ["the /v1 application text", api], ["the packet's drafting note", DRAFT_MARK_NOTE]] as const) {
      expect(text, name).toMatch(/reads? every answer/i);
    }
    expect(mcp).toMatch(/answeredBy is read from the question's words and can be wrong/);
    expect(mcp).toMatch(/The marks are read from the words and can be wrong, so the person reads every answer before they send/);
    expect(api).toMatch(/a factual or protected question, even a plainly worded one, can be marked draft_from_your_cv/);
    expect(mcp).toMatch(/a question about the person, even a plainly worded one, can be marked draft_from_your_cv/);
    expect(guide).toMatch(/can still be marked for a draft, and some ordinary work questions are marked for you/);
  });
});

describe("TEETH: every removed sentence is caught", () => {
  // The sentences as they stood before the descope, one per surface and language.
  const BEFORE: Array<[string, string]> = [
    ["en selfApplyFree", "Resume Booster tells it to ask you every factual question and to draft only open-ended answers from your CV; you check everything and press submit."],
    ["en applyStep3", "and to draft only answers about your work, from your CV, showing you each draft first."],
    ["en yoursBody", "We don't guess your identity, work authorization, salary, or demographics — the honest answer to each is yours alone."],
    ["en legalIntro", "The agent never guesses at these — a wrong answer here can void an application."],
    ["en intro", "Anything you leave blank isn't guessed at — applications that need it wait for you instead."],
    ["en demographics", "Left off, the agent declines them on your behalf — it never fills them in for you."],
    ["en changelog", "identity, salary, and demographic questions are always left to you."],
    ["mcp card", "who answers it — the person for every factual, demographic and consent question, their AI only for open questions about work done or motivation."],
    ["mcp prompt", "asks you every factual question, drafts only the open answers about your work from your CV, and stops before Submit."],
    ["guide FAQ", "It drafts open answers about your work from your CV and asks you everything factual."],
    ["/v1", "every factual, demographic and consent question is the person's own."],
    ["/v1 you", "The person answers in their own words: every factual question (work authorisation, sponsorship, salary)"],
    ["de", "Resume Booster weist sie an, dir jede Sachfrage zu stellen und nur offene Antworten aus deinem Lebenslauf zu entwerfen"],
    ["de yoursBody", "Wir raten nicht bei Ihrer Identität, Arbeitserlaubnis, Gehaltsvorstellung oder demografischen Angaben"],
    ["es", "Resume Booster le indica que te haga todas las preguntas sobre datos y que redacte solo las respuestas abiertas a partir de tu CV"],
    ["fr", "Resume Booster lui demande de vous poser toutes les questions factuelles et de ne rédiger que les réponses ouvertes à partir de votre CV"],
    ["hi", "Resume Booster उसे कहता है कि हर तथ्य वाला सवाल आपसे पूछे और आपके CV से केवल खुले उत्तरों का मसौदा बनाए"],
    ["nl", "Resume Booster vraagt je AI om je elke feitelijke vraag te stellen en alleen open antwoorden op basis van je cv te schrijven"],
    ["pt", "O Resume Booster orienta a IA a fazer a você todas as perguntas factuais e a redigir só as respostas abertas a partir do seu currículo"],
    ["tl", "Sinasabihan ito ng Resume Booster na itanong sa iyo ang bawat factual na tanong at gumawa lang ng draft ng mga bukas na sagot mula sa iyong CV"],
    ["pt legalIntro", "O agente nunca as adivinha — uma resposta errada aqui pode anular uma candidatura."],
    ["tl changelog", "ang mga tanong sa pagkakakilanlan, sahod, at demograpiko ay laging iniiwan sa iyo."],
    // The first descope's qualifier, in each language, and the three absolutes its recheck found.
    ["en qualifier", "That check reads the words and can miss a question about you that is worded unusually, so read every answer before you send."],
    ["en /v1 qualifier", "The rule reads the question's words, so an unusually worded factual or protected question can be marked draft_from_your_cv."],
    ["de qualifier", "Diese Prüfung liest nur die Wörter und kann eine ungewöhnlich formulierte Frage zu dir übersehen"],
    ["es qualifier", "puede pasar por alto una pregunta sobre ti redactada de forma poco habitual"],
    ["fr qualifier", "peut manquer une question sur vous formulée de façon inhabituelle"],
    ["hi qualifier", "यह जाँच सिर्फ़ शब्द पढ़ती है और अलग ढंग से लिखा गया आपके बारे में कोई सवाल चूक सकती है"],
    ["nl qualifier", "kan een ongewoon geformuleerde vraag over jou missen"],
    ["pt qualifier", "pode deixar passar uma pergunta sobre você escrita de um jeito incomum"],
    ["pt legalIntro qualifier", "e pode falhar uma escrita de forma invulgar."],
    ["tl qualifier", "maaaring makaligtaan nito ang tanong tungkol sa iyo na kakaiba ang pagkakasulat"],
    ["en otherCountriesHint", "Tick only what’s true: on any country you haven’t ticked, the agent stops and asks you rather than answering."],
    ["en authorizedHint", "Anywhere else, tick it below — the agent will not assume it."],
    ["en setupIsOneStep", "Your work authorisation, salary and start date are never guessed."],
    ["en allGrounded", "Every answer is grounded in your résumé — nothing invented."],
    ["de setupIsOneStep", "Arbeitserlaubnis, Gehalt und Startdatum werden nie erraten."],
    ["es allGrounded", "Cada respuesta se basa en tu currículum: nada inventado."],
    ["fr otherCountriesHint", "Ne cochez que ce qui est vrai : pour tout pays non coché, l’agent s’arrête et vous demande au lieu de répondre."],
    ["hi allGrounded", "हर जवाब आपके रिज़्यूमे पर आधारित है — कुछ भी गढ़ा नहीं गया।"],
    ["nl setupIsOneStep", "Je werkvergunning, salaris en startdatum raden we nooit."],
    ["pt otherCountriesHint", "Assinale apenas o que for verdade: em qualquer país não assinalado, o agente pára e pergunta-lhe em vez de responder."],
    ["tl allGrounded", "Nakabatay sa resume mo ang bawat sagot — walang inimbento."],
    // The applyAgentCountries changelog line, in each language, as it stood (the second recheck of the descope).
    ["en applyAgentCountries", "and anything asking about a country you haven't listed stops and waits for you instead of guessing."],
    ["de applyAgentCountries", "jede Frage zu einem nicht angegebenen Land hält an und wartet auf Sie, statt zu raten."],
    ["es applyAgentCountries", "y cualquier pregunta sobre un país que no hayas indicado se detiene y te espera en lugar de adivinar."],
    ["fr applyAgentCountries", "et toute question portant sur un pays non indiqué s'arrête et vous attend au lieu de deviner."],
    ["hi applyAgentCountries", "और जिस देश को आपने सूचीबद्ध नहीं किया उसके बारे में कोई भी प्रश्न अनुमान लगाने के बजाय रुककर आपकी प्रतीक्षा करेगा।"],
    ["nl applyAgentCountries", "en elke vraag over een land dat u niet hebt aangegeven stopt en wacht op u in plaats van te gokken."],
    ["pt applyAgentCountries", "e qualquer pergunta sobre um país que não tenha indicado pára e espera por si em vez de adivinhar."],
    ["tl applyAgentCountries", "at anumang tanong tungkol sa bansang hindi mo nailista ay hihinto at maghihintay sa iyo sa halip na manghula."],
  ];
  it.each(BEFORE)("%s", (_name, sentence) => {
    expect(hits(sentence).length, sentence).toBeGreaterThan(0);
  });

  it("the read-every-answer patterns refuse the old lines", () => {
    expect("you check everything and press submit.").not.toMatch(READ_EVERY.en);
    expect("du prüfst alles und klickst selbst auf Absenden.").not.toMatch(READ_EVERY.de);
  });
});
