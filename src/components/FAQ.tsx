import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
import { proSummaryOnSale } from "@/config/pro-perks";
import { TRADING_NAME } from "@/config/seller";
import { fullAnalysisOnSale, proOnSale } from "@/lib/purchases-open";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqKeys = [
  "whatDoIGet",
  "howLong",
  "fileFormats",
  "subscription",
  "share",
  "whoWrites",
  "dataStorage",
  "vsChatGPT",
  // Bringing your own AI: connecting it for free, applying yourself with its
  // help, and the board's hand-off controls. Since the apply pivot (owner
  // decision 2026-10-11) the answer sells nothing and says we never submit.
  "bringYourAgent",
];

/**
 * ANSWERS THAT MOVED TO NEW KEYS (wave 4 round 2, checkout-catalogue). An
 * existing locale value is never edited (the translator adds the nine
 * locales for new keys), so an answer that became untrue reads a new key
 * whose English default is the true sentence:
 *   - howLong (S12-134): the analysis was said to be ready "within seconds";
 *     generating it takes up to a few minutes, and the emailed private link
 *     keeps it 90 days.
 *   - subscription: Pro was "unlimited scans and every tool", and every tool
 *     a one-time payment; since the owner's decision of 2026-10-17 Pro is
 *     the writing tools, the Full Analysis included and no daily cap on
 *     scans (read from src/config/pro-perks.ts, the one list), and the one
 *     one-time tool is the Full Analysis.
 *   - whatDoIGet's question and vsChatGPT (integration, account-compliance's
 *     handoff, plan CP-G and S12-049): en-GB named the trader "CV Booster",
 *     a name no receipt carries, so these insert TRADING_NAME
 *     (src/config/seller.ts), which is never translated; and vsChatGPT
 *     promised "LinkedIn analysis" (no longer offered) and that a résumé is
 *     "never used for training", which the AI providers' terms were never
 *     checked to support. It now says what we do: we train no model on it.
 * Either half may move on its own; the other keeps its key.
 */
export const FAQ_REWORDED: Readonly<Record<string, { question?: [string, string]; answer?: [string, string] }>> = {
  howLong: {
    question: ["faq.questions.howLongBound.question", "How long does the analysis take?"],
    answer: ["faq.questions.howLongBound.answer", "Usually a minute or two after payment, and a few minutes at most. It opens on the page Stripe returns you to, and the private link we email you keeps it for 90 days."],
  },
  subscription: {
    question: ["faq.questions.subscriptionLine.question", "Is this a subscription?"],
    answer: ["faq.questions.subscriptionLineFa.answer", "Both options exist, and you choose. The ${{price}} Full Analysis is a one-time payment that never renews. Separately, there is one optional monthly plan, Pro at ${{proPrice}}/month: {{proSummary}}. It renews every month until you cancel. The resume scan, the job board and connecting your own AI stay free either way. Nothing else upgrades you automatically."],
  },
  whatDoIGet: {
    question: ["faq.questions.whatDoIGetNamed.question", "What do I get with {{name}}?"],
  },
  vsChatGPT: {
    question: ["faq.questions.vsChatGPTTrue.question", "Why is this better than ChatGPT or résumé templates?"],
    answer: ["faq.questions.vsChatGPTTrue.answer", "{{name}} scores your résumé the way applicant tracking systems read it, with a 5-category weighted score, 14 industry-specific templates and recruiter-calibrated feedback. Unlike ChatGPT, you get the same structured report every time, with no prompt to write. Unlike templates, you get rewrites of your own bullets and alignment with the job description. We do not train AI models on your résumé, and the free scan deletes it within 7 days."],
  },
};

/**
 * WHAT THE FAQ MAY SAY IS ON SALE (review round of 2026-10-26). The scanner
 * page is the FAQ's only home after the homepage switch-over, and it said
 * both paid options exist and how soon the analysis arrives while /pricing
 * says "Not on sale yet" and the owner prints no delivery time until a
 * delivery has been watched (P18). So the answers follow the sale gates
 * (src/lib/purchases-open.ts), which read the owner's switches and never the
 * seller (both on, as on main, so the answer that names both shows):
 *   - nothing on sale: "Is this a subscription?" says nothing is on sale, and
 *     "How long does the analysis take?" is not asked;
 *   - the Full Analysis on sale (G2): it alone is described, and the
 *     delivery time is printed;
 *   - both on sale: the answer that names both.
 * Pro never goes on sale before the Full Analysis (src/config/sales-gate.ts,
 * held by a test), so Pro alone is not a state the FAQ has to describe.
 */
export const FAQ_SALE_ANSWERS = {
  closed: ["faq.questions.subscriptionClosed.answer", "Not today: nothing is on sale yet. The pricing page says before you pay what each paid option includes and whether it renews. The resume scan, the job board and connecting your own AI are free."],
  fullAnalysisOnly: ["faq.questions.subscriptionFaOnly.answer", "No. The ${{price}} Full Analysis is a one-time payment that never renews, and no monthly plan is on sale yet. The resume scan, the job board and connecting your own AI stay free either way. Nothing upgrades you automatically."],
} as const satisfies Record<string, readonly [string, string]>;

export function FAQ() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();
  const faOnSale = fullAnalysisOnSale();
  const bothOnSale = faOnSale && proOnSale();
  const keys = faqKeys.filter((key) => key !== "howLong" || faOnSale);

  // Replace $25 with local currency in answers (using actual product price)
  const fullAnalysisPrice = PRODUCTS.fullAnalysis.priceUsd;
  const questionOf = (key: string) => {
    const moved = FAQ_REWORDED[key]?.question;
    return moved ? t(moved[0], moved[1], { name: TRADING_NAME }) : t(`faq.questions.${key}.question`);
  };
  const getLocalizedAnswer = (key: string) => {
    // Subscription prices are interpolated rather than written into the copy:
    // the "is this a subscription?" answer used to deny that any recurring
    // charge existed while Pro and the Morning Queue were both on sale. Pro is
    // the one plan on sale since the apply pivot retired the agent's.
    const moved = key === "subscription" && !bothOnSale
      ? (faOnSale ? FAQ_SALE_ANSWERS.fullAnalysisOnly : FAQ_SALE_ANSWERS.closed)
      : FAQ_REWORDED[key]?.answer;
    let answer = moved
      ? t(moved[0], moved[1], {
        proPrice: SUBSCRIPTIONS.pro.priceUsd,
        price: fullAnalysisPrice,
        proSummary: t(proSummaryOnSale().key, proSummaryOnSale().text),
        name: TRADING_NAME,
      })
      : t(`faq.questions.${key}.answer`, {
        proPrice: SUBSCRIPTIONS.pro.priceUsd,
      });
    // Replace any hardcoded $25 references with actual price
    if (answer.includes('$25')) {
      const priceDisplay = isLocalCurrency 
        ? `$${fullAnalysisPrice} (≈ ${formatPrice(fullAnalysisPrice)})` 
        : `$${fullAnalysisPrice}`;
      answer = answer.replace(/\$25/g, priceDisplay);
    }
    if (isLocalCurrency && answer.includes('£20')) {
      answer = answer.replace('£20', `£20 (≈ ${formatPrice(fullAnalysisPrice)})`);
    }
    return answer;
  };

  return (
    <section id="faq" className="py-20 border-t border-border">
      <div className="container">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            {t('faq.title')}
          </h2>
          <p className="text-muted-foreground text-center mb-12">
            {t('faq.subtitleNamed', 'Everything you need to know about {{name}}', { name: TRADING_NAME })}
          </p>
          
          <Accordion type="single" collapsible className="w-full">
            {keys.map((key, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger className="text-left">
                  {questionOf(key)}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {getLocalizedAnswer(key)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-12 text-center p-6 rounded-lg bg-muted/30 border border-border">
            <p className="text-muted-foreground mb-2">
              {t('faq.stillHaveQuestions', "Still have questions?")}
            </p>
            <a
              href="mailto:resumeboostersupp@gmail.com"
              className="text-primary hover:underline font-medium"
            >
              resumeboostersupp@gmail.com
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
