import { useTranslation } from "react-i18next";
import { useCurrency } from "@/hooks/use-currency";
import { PRODUCTS, SUBSCRIPTIONS } from "@/config/products";
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
 *     a one-time payment; since the product line (2026-10-12) Pro is
 *     everything in a free account plus the writing tools, and the one-time
 *     tools are the Full Analysis and the Freelance tiers.
 */
export const FAQ_REWORDED: Readonly<Record<string, { question: [string, string]; answer: [string, string] }>> = {
  howLong: {
    question: ["faq.questions.howLongBound.question", "How long does the analysis take?"],
    answer: ["faq.questions.howLongBound.answer", "Usually a minute or two after payment, and a few minutes at most. It opens on the page Stripe returns you to, and the private link we email you keeps it for 90 days."],
  },
  subscription: {
    question: ["faq.questions.subscriptionLine.question", "Is this a subscription?"],
    answer: ["faq.questions.subscriptionLine.answer", "Both options exist, and you choose. The $5 Full Analysis and the Freelance Boost tiers are one-time payments that never renew. Separately, there is one optional monthly plan: Pro at ${{proPrice}}/month, which is everything in a free account plus the writing tools. It renews every month until you cancel. The resume scan, the job board and connecting your own AI stay free either way. Nothing else upgrades you automatically."],
  },
};

export function FAQ() {
  const { t } = useTranslation();
  const { formatPrice, isLocalCurrency } = useCurrency();

  // Replace $25 with local currency in answers (using actual product price)
  const fullAnalysisPrice = PRODUCTS.fullAnalysis.priceUsd;
  const questionOf = (key: string) => {
    const moved = FAQ_REWORDED[key];
    return moved ? t(moved.question[0], moved.question[1]) : t(`faq.questions.${key}.question`);
  };
  const getLocalizedAnswer = (key: string) => {
    // Subscription prices are interpolated rather than written into the copy:
    // the "is this a subscription?" answer used to deny that any recurring
    // charge existed while Pro and the Morning Queue were both on sale. Pro is
    // the one plan on sale since the apply pivot retired the agent's.
    const moved = FAQ_REWORDED[key];
    let answer = moved
      ? t(moved.answer[0], moved.answer[1], { proPrice: SUBSCRIPTIONS.pro.priceUsd })
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
            {t('faq.subtitle')}
          </p>
          
          <Accordion type="single" collapsible className="w-full">
            {faqKeys.map((key, index) => (
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
