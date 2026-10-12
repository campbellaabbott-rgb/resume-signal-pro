// WHAT A BUYER IS TOLD WHEN THEY TRY TO BUY A RETIRED AGENT PRODUCT.
//
// The Agent plan, the Agent Pass and the Apply Assistant are no longer sold
// (owner decision 2026-10-11; the switch is AGENT_PRODUCTS_ON_SALE in
// apply-agent-switch.ts). Their checkouts answer with this instead of opening
// Stripe: HTTP 410, a machine-readable reason the page can key on, and one
// sentence in the buyer's language that says nothing was charged and names
// the free way to apply, which is the person's own AI (Claude or ChatGPT)
// reading the posting and, where the hiring system publishes it, the
// employer's form. The Apply Assistant is one row of create-product-checkout's
// shared product table, so its sentence is here, ready for that function to
// answer with, but that function is not wired to it in this change.
//
// The sentence is shown verbatim by the pass card (it renders a checkout
// refusal's `error`), so it carries the site's nine languages, chosen as the
// renewal terms are (checkoutLanguageOf): the body's `language`, else the
// browser's Accept-Language, else English. The middle sentence is the
// owner-approved apply-yourself line from the wave-4 spec (selfApplyFree), so
// the refusal and the pages describe one path in one set of words. Nothing
// here claims that anyone sends an application for the person.

import { type CheckoutLanguage, checkoutLanguageOf } from "./checkout-policy.ts";

export type RetiredProduct = "agent_plan" | "agent_pass" | "apply_assistant";

/** Where applying yourself starts: the connect page for Claude and ChatGPT. */
export const APPLY_YOURSELF_PATH = "/agents";

/** The reason a page keys on; the sentence is for people. */
export const RETIRED_REASON = "product_retired";

/** HTTP 410 Gone: the product existed and is not coming back on this route. */
export const RETIRED_STATUS = 410;

type Lines = { agent_plan: string; agent_pass: string; apply_assistant: string; free: string; connect: string };

const EN: Lines = {
  agent_plan: "The Apply Agent is no longer sold, and nothing was charged.",
  agent_pass: "The Agent Pass is no longer sold, and nothing was charged.",
  apply_assistant: "The Apply Assistant is no longer sold, and nothing was charged.",
  free: "Applying yourself is free. Your AI reads the posting and, when the employer uses Greenhouse, Ashby, Recruitee, Breezy or Pinpoint, the application form too. Resume Booster tells it to ask you every factual question and to draft only open-ended answers from your CV; you check everything and press submit.",
  connect: "Connect Claude or ChatGPT at resumebooster.work/agents.",
};

/**
 * Each language's lines: one opening per product, then the two shared
 * sentences. en-GB is en, as everywhere on the site. The Apply Assistant keeps
 * its English name in every language, as the site's own locale files do.
 */
export const RETIRED_LINES: Readonly<Record<CheckoutLanguage, Lines>> = {
  en: EN,
  "en-GB": EN,
  de: {
    agent_plan: "Der Bewerbungs-Agent wird nicht mehr verkauft, und dir wurde nichts berechnet.",
    agent_pass: "Der Agent-Pass wird nicht mehr verkauft, und dir wurde nichts berechnet.",
    apply_assistant: "Der Apply Assistant wird nicht mehr verkauft, und dir wurde nichts berechnet.",
    free: "Selbst bewerben ist kostenlos. Deine KI liest die Stellenanzeige und, wenn der Arbeitgeber Greenhouse, Ashby, Recruitee, Breezy oder Pinpoint nutzt, auch das Bewerbungsformular. Resume Booster weist sie an, dir jede Sachfrage zu stellen und nur offene Antworten aus deinem Lebenslauf zu entwerfen; du prüfst alles und klickst selbst auf Absenden.",
    connect: "Verbinde Claude oder ChatGPT unter resumebooster.work/agents.",
  },
  es: {
    agent_plan: "El Agente de Postulación ya no se vende y no se te ha cobrado nada.",
    agent_pass: "El Agent Pass ya no se vende y no se te ha cobrado nada.",
    apply_assistant: "El Apply Assistant ya no se vende y no se te ha cobrado nada.",
    free: "Postularte por tu cuenta es gratis. Tu IA lee la oferta y, si el empleador usa Greenhouse, Ashby, Recruitee, Breezy o Pinpoint, también el formulario de solicitud. Resume Booster le indica que te haga todas las preguntas sobre datos y que redacte solo las respuestas abiertas a partir de tu CV; tú lo revisas todo y pulsas enviar.",
    connect: "Conecta Claude o ChatGPT en resumebooster.work/agents.",
  },
  fr: {
    agent_plan: "L'Agent de candidature n'est plus vendu, et rien ne vous a été facturé.",
    agent_pass: "L'Agent Pass n'est plus vendu, et rien ne vous a été facturé.",
    apply_assistant: "L'Apply Assistant n'est plus vendu, et rien ne vous a été facturé.",
    free: "Postuler vous-même est gratuit. Votre IA lit l'offre et, si l'employeur utilise Greenhouse, Ashby, Recruitee, Breezy ou Pinpoint, le formulaire de candidature aussi. Resume Booster lui demande de vous poser toutes les questions factuelles et de ne rédiger que les réponses ouvertes à partir de votre CV ; vous vérifiez tout et c'est vous qui cliquez sur Envoyer.",
    connect: "Connectez Claude ou ChatGPT sur resumebooster.work/agents.",
  },
  hi: {
    agent_plan: "अप्लाई एजेंट अब नहीं बेचा जाता, और आपसे कोई शुल्क नहीं लिया गया।",
    agent_pass: "Agent Pass अब नहीं बेचा जाता, और आपसे कोई शुल्क नहीं लिया गया।",
    apply_assistant: "Apply Assistant अब नहीं बेचा जाता, और आपसे कोई शुल्क नहीं लिया गया।",
    free: "खुद आवेदन करना मुफ़्त है। आपका AI नौकरी का विवरण पढ़ता है, और अगर नियोक्ता Greenhouse, Ashby, Recruitee, Breezy या Pinpoint इस्तेमाल करता है, तो आवेदन फ़ॉर्म भी। Resume Booster उसे कहता है कि हर तथ्य वाला सवाल आपसे पूछे और आपके CV से केवल खुले उत्तरों का मसौदा बनाए; आप सब कुछ जाँचते हैं और सबमिट आप दबाते हैं।",
    connect: "resumebooster.work/agents पर Claude या ChatGPT जोड़ें।",
  },
  nl: {
    agent_plan: "De Sollicitatie-agent wordt niet meer verkocht, en er is niets in rekening gebracht.",
    agent_pass: "De Agent Pass wordt niet meer verkocht, en er is niets in rekening gebracht.",
    apply_assistant: "De Apply Assistant wordt niet meer verkocht, en er is niets in rekening gebracht.",
    free: "Zelf solliciteren is gratis. Je AI leest de vacature en, als de werkgever Greenhouse, Ashby, Recruitee, Breezy of Pinpoint gebruikt, ook het sollicitatieformulier. Resume Booster vraagt je AI om je elke feitelijke vraag te stellen en alleen open antwoorden op basis van je cv te schrijven; jij controleert alles en drukt zelf op verzenden.",
    connect: "Koppel Claude of ChatGPT via resumebooster.work/agents.",
  },
  pt: {
    agent_plan: "O Agente de Candidaturas não é mais vendido, e nada foi cobrado de você.",
    agent_pass: "O Agent Pass não é mais vendido, e nada foi cobrado de você.",
    apply_assistant: "O Apply Assistant não é mais vendido, e nada foi cobrado de você.",
    free: "Candidatar-se por conta própria é grátis. Sua IA lê a vaga e, se o empregador usa Greenhouse, Ashby, Recruitee, Breezy ou Pinpoint, também o formulário de candidatura. O Resume Booster orienta a IA a fazer a você todas as perguntas factuais e a redigir só as respostas abertas a partir do seu currículo; você confere tudo e clica em enviar.",
    connect: "Conecte o Claude ou o ChatGPT em resumebooster.work/agents.",
  },
  tl: {
    agent_plan: "Hindi na ibinebenta ang Apply Agent, at walang siningil sa iyo.",
    agent_pass: "Hindi na ibinebenta ang Agent Pass, at walang siningil sa iyo.",
    apply_assistant: "Hindi na ibinebenta ang Apply Assistant, at walang siningil sa iyo.",
    free: "Libre ang mag-apply nang ikaw mismo. Binabasa ng iyong AI ang job posting at, kung Greenhouse, Ashby, Recruitee, Breezy o Pinpoint ang gamit ng employer, pati ang application form. Sinasabihan ito ng Resume Booster na itanong sa iyo ang bawat factual na tanong at gumawa lang ng draft ng mga bukas na sagot mula sa iyong CV; ikaw ang susuri sa lahat at pipindot ng submit.",
    connect: "Ikonekta ang Claude o ChatGPT sa resumebooster.work/agents.",
  },
};

/**
 * The buyer's language: the body's `language` (what the page sent), else the
 * first Accept-Language tag the site has, else English. The pass card sends
 * no language, so the browser's header is the only hint it gives.
 */
export function retiredLanguageOf(body: unknown, acceptLanguage?: string | null): CheckoutLanguage {
  const fromBody = checkoutLanguageOf(body);
  if (fromBody) return fromBody;
  for (const part of String(acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0].trim();
    if (!tag || tag === "*") continue;
    const lang = checkoutLanguageOf({ language: tag });
    if (lang) return lang;
  }
  return "en";
}

/** The whole sentence a buyer reads, in one language. */
export function retiredSentence(product: RetiredProduct, language: CheckoutLanguage): string {
  const l = RETIRED_LINES[language] ?? EN;
  return `${l[product]} ${l.free} ${l.connect}`;
}

export interface RetiredCheckoutAnswer {
  status: typeof RETIRED_STATUS;
  body: {
    retired: true;
    reason: typeof RETIRED_REASON;
    product: RetiredProduct;
    language: CheckoutLanguage;
    error: string;
    applyYourself: string;
  };
}

/**
 * The refusal a retired product's checkout returns. `origin` is the caller's
 * checkoutOrigin (only our own hosts), so a preview build links to itself.
 */
export function retiredCheckoutAnswer(
  product: RetiredProduct,
  opts: { body: unknown; acceptLanguage?: string | null; origin: string },
): RetiredCheckoutAnswer {
  const language = retiredLanguageOf(opts.body, opts.acceptLanguage);
  return {
    status: RETIRED_STATUS,
    body: {
      retired: true,
      reason: RETIRED_REASON,
      product,
      language,
      error: retiredSentence(product, language),
      applyYourself: `${opts.origin.replace(/\/+$/, "")}${APPLY_YOURSELF_PATH}`,
    },
  };
}
