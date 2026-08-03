/**
 * THE HONESTY CORE COULD ONLY READ ENGLISH.
 *
 * MEASURED 2026-08-03. Ten labels were put through `classifyQuestion`: a Dutch
 * date of birth, a Dutch gender, a Swedish personnummer, a French, German and
 * Spanish date of birth, a Dutch address, a Dutch background check. TEN OF TEN
 * came back `draftable`.
 *
 * `draftable` is the class that gets sent to a language model. So on any
 * non-English form the file whose own header calls it "the honesty core of the
 * apply agent" inverted its entire purpose: it would have had an LLM invent a
 * DATE OF BIRTH, a GENDER, or a NATIONAL IDENTITY NUMBER, then submit it to an
 * employer in a real person's name.
 *
 * The only thing behind it was the grounding gate refusing an unsupported
 * draft. That is a backstop catching what a classifier should never have let
 * through, and it is not what anyone would call a design.
 *
 * NOT A HYPOTHETICAL. The same day's dry runs drove live Dutch (velomedi),
 * Swedish (vardaga, attendosverige), Norwegian (compass-group) and Italian
 * (roccofortehotels) application forms. The board is overwhelmingly not
 * anglophone, and every vendor the agent can actually submit to — Teamtailor
 * (Stockholm), Personio (Munich), Recruitee (Amsterdam) — is European.
 *
 * The patterns are ADDITIVE: each `*_INTL` is OR'd with its English original
 * rather than merged, so every English case keeps the behaviour its own tests
 * pin, and any regression can only come from the new lines.
 */
import { describe, expect, it } from "vitest";
import { classifyQuestion } from "../../supabase/functions/_shared/application-questions.ts";

/**
 * The ten that failed, plus the languages of every vendor the agent can submit
 * to. A protected characteristic is the worst thing to get wrong here: the
 * others produce a bad answer, this one produces a fabricated fact about a
 * person's body, age or origin.
 */
describe("protected characteristics are protected in every language", () => {
  const CASES: Array<[string, string]> = [
    ["nl", "Wat is je geboortedatum?"],
    ["de", "Was ist Ihr Geburtsdatum?"],
    ["fr", "Quelle est votre date de naissance ?"],
    ["es", "¿Cuál es tu fecha de nacimiento?"],
    ["it", "Qual è la tua data di nascita?"],
    ["pt", "Qual é a sua data de nascimento?"],
    ["sv", "Vad är ditt födelsedatum?"],
    ["no", "Hva er din fødselsdato?"],
    ["sv", "Vad är ditt personnummer?"],
    ["no", "Oppgi ditt fødselsnummer"],
    ["nl", "Wat is uw geslacht?"],
    ["de", "Welches Geschlecht haben Sie?"],
    ["sv", "Vilket kön identifierar du dig som?"],
    ["nl", "Wat is je nationaliteit?"],
    ["de", "Ihre Staatsangehörigkeit"],
    ["fr", "Quelle est votre nationalité ?"],
    ["nl", "Heb je een handicap?"],
    ["de", "Haben Sie eine Behinderung?"],
    ["es", "¿Tienes alguna discapacidad?"],
    ["nl", "Wat is je burgerlijke staat?"],
    ["de", "Familienstand"],
  ];

  for (const [lang, label] of CASES) {
    it(`${lang}: "${label.slice(0, 44)}" is demographic`, () => {
      expect(
        classifyQuestion(label, ""),
        "an LLM would be asked to invent this",
      ).toBe("demographic");
    });
  }
});

describe("identity fields come from the profile, in every language", () => {
  const CASES: Array<[string, string]> = [
    ["nl", "Wat zijn je adresgegevens?"],
    ["de", "Wie lautet Ihre Telefonnummer?"],
    ["fr", "Quel est votre numéro de téléphone ?"],
    ["es", "¿Cuál es tu dirección?"],
    ["it", "Qual è il tuo indirizzo?"],
    ["sv", "Vad är din adress?"],
    ["nl", "Postcode"],
    ["de", "Postleitzahl"],
    ["fr", "Code postal"],
    ["de", "Vorname"],
    ["fr", "Prénom"],
    ["sv", "Efternamn"],
  ];
  for (const [lang, label] of CASES) {
    it(`${lang}: "${label}" is identity`, () => {
      expect(classifyQuestion(label, "")).toBe("identity");
    });
  }
});

describe("facts the résumé cannot establish still refuse, in every language", () => {
  const CASES: Array<[string, string]> = [
    ["nl", "Ben je bereid om een Verklaring Omtrent Gedrag aan te vragen?"],
    ["de", "Was ist Ihre Gehaltsvorstellung?"],
    ["fr", "Quelles sont vos prétentions salariales ?"],
    ["es", "¿Cuál es tu pretensión salarial?"],
    ["sv", "Vad är din uppsägningstid?"],
    ["nl", "Wat is je opzegtermijn?"],
    ["de", "Wann ist Ihr frühestmöglicher Startdatum?"],
    ["nl", "Heb je een rijbewijs?"],
    ["de", "Besitzen Sie einen Führerschein?"],
    ["nl", "Heb je een werkvergunning?"],
    ["sv", "Har du arbetstillstånd?"],
  ];
  for (const [lang, label] of CASES) {
    it(`${lang}: "${label.slice(0, 44)}" is factual`, () => {
      expect(classifyQuestion(label, "")).toBe("factual");
    });
  }
});

describe("document uploads are recognised, in every language", () => {
  for (const [lang, label] of [
    ["sv", "Ladda upp ditt personliga brev"],
    ["de", "Lebenslauf hochladen"],
    ["nl", "Motivatiebrief"],
    ["fr", "Lettre de motivation"],
    ["es", "Carta de presentación"],
  ] as const) {
    it(`${lang}: "${label}" is file`, () => {
      expect(classifyQuestion(label, "")).toBe("file");
    });
  }
});

/**
 * THE OTHER DIRECTION. Widening a classifier is how you accidentally stop
 * answering questions that were being answered well. These are ordinary
 * non-English essay questions — the ones a résumé genuinely can answer — and
 * they must stay draftable. "Waarom wil je fietskoerier worden?" is verbatim
 * from a live Velomedi posting.
 */
describe("ordinary non-English questions still get answered", () => {
  for (const [lang, label] of [
    ["nl", "Waarom wil je fietskoerier worden?"],
    ["nl", "Wat is je ervaring met projectmanagement?"],
    ["de", "Beschreiben Sie ein Projekt, auf das Sie stolz sind."],
    ["fr", "Décrivez une réussite professionnelle dont vous êtes fier."],
    ["es", "¿Por qué quieres trabajar con nosotros?"],
    ["sv", "Berätta om en utmaning du löst."],
  ] as const) {
    it(`${lang}: "${label.slice(0, 40)}" stays draftable`, () => {
      expect(
        classifyQuestion(label, ""),
        "the multilingual patterns have grown too greedy",
      ).toBe("draftable");
    });
  }
});
