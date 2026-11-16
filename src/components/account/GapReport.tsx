// The aggregated gap report — the account's answer to "what should I fix
// next?". We already compute missing keywords per tracked posting; this
// aggregates them across the user's pipeline into the skills most often
// absent, with counts, and hands the list to the builder through the same
// session mechanism the scan report uses. Only renders with enough scored
// rows to be meaningful (the caller gates on that).
//
// The hand-off names the text it was made for (S14X-285): `fingerprint` is
// builder-import's textFingerprint of the résumé put in the session, so the
// builder can drop a hand-off made for a different text.

import { useNavigate } from "react-router-dom";
import { Wrench, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { textFingerprint } from "@/lib/builder-import";

export function GapReport({ gaps, withFit, resumeText }: {
  gaps: Array<[string, number]>;
  withFit: number;
  resumeText: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (gaps.length === 0) return null;

  const openBuilder = () => {
    try {
      if (resumeText) sessionStorage.setItem("rb_resume_text", resumeText);
      sessionStorage.setItem("rb_scan_fixes", JSON.stringify({
        rewrites: [],
        keywords: gaps.map(([k]) => k),
        reportId: null,
        fingerprint: resumeText ? textFingerprint(resumeText) : null,
      }));
    } catch { /* builder still opens; user pastes manually */ }
    navigate("/builder");
  };

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Wrench className="w-4 h-4 text-warning" />
        <h2 className="font-semibold text-foreground text-sm">
          {t("accountPage.gapTitle", "What to fix next")}
        </h2>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {t("accountPage.gapBlurb", "The skills most often missing from your résumé across the {{n}} target roles we've scored for you — from the postings' own requirements, not a guess.", { n: withFit })}
      </p>
      <ul className="space-y-1.5 mb-3">
        {gaps.map(([kw, n]) => (
          <li key={kw} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-foreground font-medium">{kw}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {t("accountPage.gapCount", "missing in {{n}} of {{total}} roles", { n, total: withFit })}
            </span>
          </li>
        ))}
      </ul>
      {resumeText && (
        <button
          type="button"
          onClick={openBuilder}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[12px] font-semibold px-3 py-1.5 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {t("accountPage.gapCta", "Work these into my résumé in the builder")}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
