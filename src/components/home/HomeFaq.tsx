import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { namedSystems } from "@/lib/home/board-figures";
import { HOME_FREE_REPORT_DAYS, HOME_PAID_REPORT_DAYS, HOME_RESUME_TEXT_HOURS } from "@/lib/home/facts";
import { HomeDetails } from "./HomeDetails";

/**
 * 4.7 QUESTIONS. Every answer stays in the DOM while its question is closed
 * (native <details>), so Google's phone render and a reader's Find read it.
 * The systems named in the first answer, and how many more there are, come
 * from the same read as every count on the page.
 */
export function HomeFaq({ counts }: { counts: Record<string, number> }) {
  const { t } = useTranslation();
  const named = namedSystems(counts);
  const trust = <Link to="/trust" className="link" />;

  const items: Array<{ key: string; q: string; a: ReactNode }> = [
    {
      key: "sources",
      q: t("home.faq.sourcesQ"),
      a: named && named.more > 0
        ? t("home.faq.sourcesA", { names: named.names.join(", "), more: named.more })
        : t("home.faq.sourcesAPlain"),
    },
    { key: "apply", q: t("home.faq.applyQ"), a: t("home.faq.applyA") },
    { key: "current", q: t("home.faq.currentQ"), a: t("home.faq.currentA") },
    { key: "fit", q: t("home.faq.fitQ"), a: t("home.faq.fitA") },
    {
      key: "resume",
      q: t("home.faq.resumeQ"),
      a: (
        <Trans
          i18nKey="home.faq.resumeA"
          values={{ hours: HOME_RESUME_TEXT_HOURS, days: HOME_FREE_REPORT_DAYS, paidDays: HOME_PAID_REPORT_DAYS }}
          components={{ trust }}
        />
      ),
    },
  ];

  return (
    <section aria-labelledby="home-faq" className="border-t border-border py-8 sm:py-10 lg:py-16">
      <div className="container">
        <h2 id="home-faq" className="text-[clamp(1.25rem,5vw,1.875rem)] font-semibold leading-tight md:text-3xl">{t("home.faq.title")}</h2>
        <div className="mt-4 max-w-[780px] border-t border-border" data-home-faq="">
          {items.map((it) => (
            <HomeDetails key={it.key} summary={it.q} className="border-b border-border" summaryClassName="min-h-[52px] py-3 text-base font-medium leading-6">
              <p className="max-w-reading pb-4 text-[15px] leading-[22px] text-muted-foreground">{it.a}</p>
            </HomeDetails>
          ))}
        </div>
      </div>
    </section>
  );
}
