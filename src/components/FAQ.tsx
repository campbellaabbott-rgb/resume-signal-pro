import { useTranslation } from "react-i18next";
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
];

export function FAQ() {
  const { t } = useTranslation();

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
                  {t(`faq.questions.${key}.question`)}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {t(`faq.questions.${key}.answer`)}
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
