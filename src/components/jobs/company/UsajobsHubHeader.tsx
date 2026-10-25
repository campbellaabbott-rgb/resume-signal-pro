// USAJOBS IS A LISTING SITE, NOT AN EMPLOYER.
//
// /jobs/company/usajobs read "Open roles at USAJOBS", "straight from USAJOBS'
// own job board", "Work at USAJOBS? Claim this profile" and "Watch USAJOBS",
// and never said that the federal feed answers at most 10,000 results per
// query (audit CP6, plan D12). This header names it for what it is -- federal
// openings listed on USAJOBS -- states the per-query cap and that not every
// federal opening is here, and offers no claim and no "own job board" copy.
// Each role names its own agency; the department filter groups them where
// the facet exists.
import { Landmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { USAJOBS_RESULT_CAP, type LanderModel } from "@/lib/company/lander-model";
import { count as fmtCount } from "@/lib/format";
import { CompanyBreadcrumb, HeaderActions, openRolesLine } from "./CompanyHeader";

export function UsajobsHubHeader({ model, onWatch, onCopyLink }: {
  model: LanderModel;
  onWatch: () => void;
  onCopyLink?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language || "en";
  const answer = openRolesLine(t, model.openRoles, lang);
  const title = t("companyProfile.usajobs.h1", "Federal openings listed on USAJOBS");
  return (
    <header data-company-header="usajobs" className="mb-4 space-y-3">
      <CompanyBreadcrumb name="USAJOBS" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {answer
          ? <p className="text-sm font-medium text-foreground sm:text-base" data-company-answer="">{answer}</p>
          : <span aria-hidden="true" className="block h-5 w-56 max-w-full rounded-md bg-muted animate-pulse motion-reduce:animate-none" />}
        <p className="hidden sm:block text-sm text-muted-foreground">
          {t("companyProfile.usajobs.subtitle", "USAJOBS lists openings from many federal agencies; each role names its agency.")}
        </p>
      </div>
      <p className="flex items-start gap-2 text-meta text-foreground" data-usajobs-cap="">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{t("companyProfile.usajobs.cap", "Up to {{cap}} results per query; not every federal opening.", { cap: fmtCount(USAJOBS_RESULT_CAP, { lng: lang }) })}</span>
      </p>
      <HeaderActions
        watchLabel={t("jobsPage.watchCta", "Watch {{company}}", { company: "USAJOBS" })}
        menuLabel={t("companyProfile.actions.more", "More actions for {{name}}", { name: "USAJOBS" })}
        onWatch={onWatch}
        onCopyLink={onCopyLink}
      />
    </header>
  );
}
