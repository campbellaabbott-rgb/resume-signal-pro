import { ClipboardList, Globe, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { APPLY_PAGE_SAMPLE, applyMechanics } from "@/lib/apply-mechanics";
import { count, date } from "@/lib/format";

/**
 * "HOW APPLYING WORKS HERE": the confidence block, in measured facts only.
 * Used by the posting detail pane and the company page's About section.
 *
 * `systemKey` and `systemLabel` name the system the apply link OPENS ON, read
 * from the applyUrl host by the listing's apply-url helper and passed in.
 * `rechecksOnApply` is set only by a caller whose Apply handler really
 * re-checks the posting (the board's does: verifyJob on the click); without
 * it the sentence is not printed.
 *
 * NOTHING HERE SAYS WE SEND AN APPLICATION. The server-side apply agent is
 * retired (owner, 2026-10-11): people apply on the employer's own site, with
 * their own AI's help where they want it, so the block names the system, what
 * its forms showed in our sample, the screening questions we read and the
 * re-check, and no line about an agent of ours.
 */
export interface HowApplyingWorksProps {
  systemKey: string | null;
  systemLabel: string | null;
  rechecksOnApply?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

export function HowApplyingWorks({ systemKey, systemLabel, rechecksOnApply = false, headingLevel = 2, className }: HowApplyingWorksProps) {
  const { t, i18n } = useTranslation();
  const m = applyMechanics(systemKey);
  const system = systemLabel?.trim() || null;
  const sample = { pages: count(APPLY_PAGE_SAMPLE.pages, { lng: i18n.language }), date: date(APPLY_PAGE_SAMPLE.date, { lng: i18n.language }) };

  const lines: Array<{ key: string; icon: ReactNode; text: string }> = [];
  if (system) {
    lines.push({ key: "through", icon: <Globe />, text: t("howApply.through", { system, defaultValue: "Applications go through {{system}}." }) });
    if (m.captcha === "usually") {
      lines.push({
        key: "captcha",
        icon: <ShieldAlert />,
        text: t("howApply.captchaClick", { system, ...sample, defaultValue: "In our check of {{pages}} apply pages ({{date}}), {{system}} forms usually showed a human-verification step." }),
      });
    } else if (m.captcha === "none-in-sample") {
      lines.push({
        key: "captcha",
        icon: <ShieldCheck />,
        text: t("howApply.captchaAuto", { system, ...sample, defaultValue: "In our check of {{pages}} apply pages ({{date}}), {{system}} forms showed no human-verification step in that sample." }),
      });
    }
  }
  if (m.readsScreeningQuestions) {
    lines.push({ key: "questions", icon: <ClipboardList />, text: t("howApply.questions", "We read this posting's own screening questions.") });
  }
  if (rechecksOnApply) {
    lines.push({ key: "recheck", icon: <RefreshCw />, text: t("howApply.recheck", "We re-check the posting is still live when you press Apply.") });
  }
  if (!lines.length) return null;

  const H = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={cn("rounded-lg border border-border bg-card p-4", className)} data-how-applying="">
      <H className="text-base font-semibold text-foreground">{t("howApply.heading", "How applying works here")}</H>
      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
        {lines.map((l) => (
          <li key={l.key} className="flex items-start gap-2" data-line={l.key}>
            <span aria-hidden="true" className="mt-0.5 inline-flex text-subtle-foreground [&_svg]:size-4">{l.icon}</span>
            <span>{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
