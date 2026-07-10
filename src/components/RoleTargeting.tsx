// "From grade to game plan" — the two report cards that turn detection output
// into job-getting direction:
//
// RoleTargetingCard: answers "what should I apply for?" from the SAME detection
// the score used — roles in the detected industry (real role-page data, not
// model output), reach roles from the secondary blend with an honest gap note,
// and deterministic search links into the user's target market.
//
// CheckAgainstPostingCard: the single highest-leverage next action after a
// resume-only scan is checking against a REAL opening. Renders only when no
// posting was provided; submits straight into a fresh scan with the posting.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Target, ArrowRight, ExternalLink, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { rolesForIndustry } from "@/data/roles";

const searchLinks = (title: string, countryName?: string | null) => {
  const q = encodeURIComponent(title);
  const loc = countryName && countryName !== "United States" ? encodeURIComponent(countryName) : "";
  return {
    linkedin: `https://www.linkedin.com/jobs/search/?keywords=${q}${loc ? `&location=${loc}` : ""}`,
    indeed: `https://www.indeed.com/jobs?q=${q}${loc ? `&l=${loc}` : ""}`,
  };
};

interface RoleTargetingCardProps {
  industry: string;
  industryBlend?: { primary: string; secondary: string; primaryPct: number; secondaryPct: number } | null;
  countryName?: string | null;
}

export function RoleTargetingCard({ industry, industryBlend, countryName }: RoleTargetingCardProps) {
  const { t } = useTranslation();
  const primaryRoles = rolesForIndustry(industry).slice(0, 5);
  const reachRoles = industryBlend?.secondary
    ? rolesForIndustry(industryBlend.secondary).slice(0, 3)
    : [];
  if (primaryRoles.length === 0 && reachRoles.length === 0) return null;

  const label = (slug: string) => slug.replace(/_/g, " ");

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <Target className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground">{t('freeResults.targeting.title', 'Roles this resume screens for')}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t('freeResults.targeting.subtitle', 'From the same detection your score used — not a guess. Search links open in your target market.')}
      </p>

      {primaryRoles.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {primaryRoles.map((r) => {
            const links = searchLinks(r.title, countryName);
            return (
              <li key={r.slug} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <Link to={`/roles/${r.slug}`} className="font-medium text-foreground hover:text-primary">
                  {r.title}
                </Link>
                <span className="text-[11px] text-muted-foreground">·</span>
                <a href={links.linkedin} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary inline-flex items-center gap-0.5">
                  LinkedIn <ExternalLink className="w-2.5 h-2.5" />
                </a>
                <a href={links.indeed} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary inline-flex items-center gap-0.5">
                  Indeed <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {reachRoles.length > 0 && industryBlend && (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
          <p className="text-xs font-semibold text-foreground mb-1.5">
            {t('freeResults.targeting.reachTitle', 'Within reach — your {{pct}}% {{industry}} side', {
              pct: industryBlend.secondaryPct,
              industry: label(industryBlend.secondary),
            })}
          </p>
          <ul className="space-y-1">
            {reachRoles.map((r) => {
              const links = searchLinks(r.title, countryName);
              return (
                <li key={r.slug} className="flex flex-wrap items-center gap-x-2 text-sm">
                  <Link to={`/roles/${r.slug}`} className="text-foreground hover:text-primary">{r.title}</Link>
                  <a href={links.linkedin} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary inline-flex items-center gap-0.5">
                    LinkedIn <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {t('freeResults.targeting.reachNote', 'The gap for these is keyword coverage, not experience — each role page lists exactly what to add.')}
          </p>
        </div>
      )}
    </div>
  );
}

interface CheckAgainstPostingCardProps {
  onScanWithPosting: (jobDescription: string) => void;
  isScanning?: boolean;
}

export function CheckAgainstPostingCard({ onScanWithPosting, isScanning }: CheckAgainstPostingCardProps) {
  const { t } = useTranslation();
  const [jd, setJd] = useState("");
  const ready = jd.trim().length >= 80;

  return (
    <div className="rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5 p-5 mb-4">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardPaste className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-foreground">{t('freeResults.posting.title', 'Now check it against a real opening')}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {t('freeResults.posting.desc', "This report graded your resume in general. The version that gets interviews is tailored to one posting — paste one and we'll rescan against its exact requirements, free.")}
      </p>
      <textarea
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        placeholder={t('freeResults.posting.placeholder', 'Paste the full job posting here…')}
        rows={4}
        className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 mb-2"
        disabled={isScanning}
      />
      <div className="flex items-center gap-3">
        <Button onClick={() => ready && onScanWithPosting(jd.trim())} disabled={!ready || isScanning} size="sm" className="gap-1.5">
          {t('freeResults.posting.cta', 'Rescan against this posting')}
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        {!ready && jd.trim().length > 0 && (
          <span className="text-[11px] text-muted-foreground">{t('freeResults.posting.tooShort', 'Paste the full posting for a real comparison')}</span>
        )}
      </div>
    </div>
  );
}
