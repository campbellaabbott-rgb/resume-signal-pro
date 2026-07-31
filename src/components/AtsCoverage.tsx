import { useTranslation } from "react-i18next";
import { Bot, MousePointerClick } from "lucide-react";
import { ATS_VENDORS, AUTO_VENDORS, CLICK_VENDORS } from "@/config/ats-vendors";
import { useAgentSender } from "@/hooks/useAgentSender";

/**
 * The ATS platforms we integrate with, on the front page.
 *
 * Names rather than a percentage, on purpose. "We cover 68% of jobs" is
 * unfalsifiable by a reader and I could not measure it honestly — the board
 * clusters by vendor and sampling it at different offsets answered 79%, 100%
 * and 0.6% to the same question. A platform name is something a person can
 * check against the jobs they are actually looking at.
 *
 * The auto-apply split only appears when a worker is live. Otherwise every
 * platform is shown as prepared-for-one-click, which is what is true then.
 */
export function AtsCoverage({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const { online } = useAgentSender();

  const groups = online
    ? [
        {
          key: "auto",
          Icon: Bot,
          title: t("atsCoverage.autoTitle", "We apply for you"),
          blurb: t("atsCoverage.autoBlurb", "The agent completes and submits the application itself."),
          vendors: AUTO_VENDORS,
        },
        {
          key: "click",
          Icon: MousePointerClick,
          title: t("atsCoverage.clickTitle", "Filled in, you press send"),
          blurb: t("atsCoverage.clickBlurb", "These use a CAPTCHA or a human check. We never solve or bypass one, so your application arrives ready and you send it."),
          vendors: CLICK_VENDORS,
        },
      ]
    : [
        {
          key: "all",
          Icon: MousePointerClick,
          title: t("atsCoverage.allTitle", "Applications prepared for you"),
          blurb: t("atsCoverage.allBlurb", "We pull jobs directly from these systems and prepare your application for each one."),
          vendors: ATS_VENDORS,
        },
      ];

  return (
    <section className={className} aria-labelledby="ats-coverage-heading">
      <div className="text-center mb-8">
        <h2 id="ats-coverage-heading" className="text-2xl md:text-3xl font-bold mb-2">
          {t("atsCoverage.heading", "Built for the systems employers actually use")}
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          {t("atsCoverage.sub", "We read jobs straight from {{count}} applicant tracking systems — not scraped from a search engine.", {
            count: ATS_VENDORS.length,
          })}
        </p>
      </div>

      <div className={online ? "grid md:grid-cols-2 gap-6" : ""}>
        {groups.map(({ key, Icon, title, blurb, vendors }) => (
          <div key={key} className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-primary flex-shrink-0" />
              <h3 className="font-semibold">{title}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{blurb}</p>
            <ul className="flex flex-wrap gap-2">
              {vendors.map((v) => (
                <li
                  key={v.key}
                  className="rounded-md border bg-background px-2.5 py-1 text-sm font-medium"
                >
                  {v.label}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
