// PERKS STATED IN THEIR JOB POSTINGS: the checkmark list on the company lander.
//
// Owner decision D1 (2026-10-11) chose a checkmark list over a count and a
// quote, to be built honestly. So every check here is a claim with its basis
// one tap away:
//
//   - the heading says where the perks come from ("stated in their job
//     postings"), and the line under it says that a perk not listed is not a
//     perk refused;
//   - a check appears only for a key whose audit is live and only above the
//     per-country threshold (src/lib/employer-perks.ts decides which, once);
//   - tapping, hovering or focusing a check opens its basis: "stated in at
//     least k of n open <country> postings we could read, read <date>",
//     the verbatim line, and a link to the posting it came from while that
//     posting still serves;
//   - eligibility conditions and a possible legal minimum (UK and German
//     statute only, linked) are tagged on the check itself;
//   - a stated visa limit is listed apart, never with a checkmark.
//
// THE DISCLOSURE PATTERN. Each check is a real <button> with aria-expanded
// and aria-controls naming its panel, and aria-describedby naming the count
// sentence, so a screen reader hears the basis with the perk. Hover (a mouse
// or pen, never a touch, which would open and close on one tap) and keyboard
// focus open the panel; a click or tap pins it open and a second one closes
// it; Escape closes it and returns focus to the check. Focus moving into the
// panel (its posting link) keeps it open.
//
// NOTHING IS A PLACEHOLDER. Until a key passes its audit the block renders
// nothing at all; an expired key is a key the reader no longer names. On a
// board two vendors share, an agency's board, a franchise board or a vendor
// whose benefits text our ingest drops, the block prints only the reason, and
// only while some key is live elsewhere.

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Check, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import {
  PERK_ROW_THRESHOLDS,
  perkPostingHref,
  perksView,
  qualifiedCount,
  readEmployerPerks,
  showsConditions,
  type EmployerPerksAnswer,
  type PerkClaim,
  type PerkWithheldReason,
} from "@/lib/employer-perks";

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function readDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function perkLabel(t: TFunction, perk: PerkClaim["perk"]): string {
  switch (perk) {
    case "health": return t("jobsPage.perks.labelHealth", "Health insurance");
    case "dental": return t("jobsPage.perks.labelDental", "Dental coverage");
    case "vision": return t("jobsPage.perks.labelVision", "Vision coverage");
    case "life_dis": return t("jobsPage.perks.labelLifeDis", "Life or disability insurance");
    case "retire": return t("jobsPage.perks.labelRetire", "Retirement or pension plan");
    case "pto": return t("jobsPage.perks.labelPto", "Paid time off");
    case "parental": return t("jobsPage.perks.labelParental", "Parental leave");
    case "equity": return t("jobsPage.perks.labelEquity", "Equity or stock");
    case "visa_not_offered": return t("jobsPage.perks.labelVisaNotOffered", "Visa sponsorship: stated as not available");
  }
}

function withheldLine(t: TFunction, reason: PerkWithheldReason, share: number | null): string {
  switch (reason) {
    case "collision":
      return t("jobsPage.perks.withheldCollision", "Not shown here: two employers use this board name, so we can't tell whose postings a perk line comes from.");
    case "agency":
      return t("jobsPage.perks.withheldAgency", "Not shown for a staffing agency's board: perks in its postings describe the agency's own package or each client's, not one employer's.");
    case "franchise":
      return share != null
        ? t("jobsPage.perks.withheldFranchise", "Not shown for this board: {{pct}}% of the postings we could read say the location is independently owned and operated, so each franchisee sets its own benefits.", { pct: Math.round(share * 100) })
        : t("jobsPage.perks.withheldFranchiseUnsized", "Not shown for this board: many of its postings say the location is independently owned and operated, so each franchisee sets its own benefits.");
    case "vendor_text_not_stored":
      return t("jobsPage.perks.withheldVendor", "Not shown for this board yet: its hiring system puts benefits in a part of the posting we don't store yet.");
  }
}

function PerkItem({ claim, lang, limit }: { claim: PerkClaim; lang: string; limit: boolean }) {
  const { t } = useTranslation();
  const [pinned, setPinned] = useState(false);
  const [peek, setPeek] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = pinned || (peek && !dismissed);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panelId = `${id}-basis`;
  const countId = `${id}-count`;

  const country = countryName(claim.country, lang);
  const date = readDate(claim.asOf, lang);
  const conditions = showsConditions(claim);
  const label = perkLabel(t, claim.perk);
  const hoverable = (pointerType: string) => pointerType === "mouse" || pointerType === "pen";

  return (
    <li
      className="relative"
      data-perk={claim.perk}
      onPointerEnter={(e) => { if (hoverable(e.pointerType)) setPeek(true); }}
      onPointerLeave={(e) => { if (hoverable(e.pointerType)) { setPeek(false); setDismissed(false); } }}
      onFocus={() => setPeek(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setPeek(false); setDismissed(false); }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setPinned(false);
          setDismissed(true);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={countId}
        onClick={() => {
          if (pinned) { setPinned(false); setDismissed(true); }
          else { setPinned(true); setDismissed(false); }
        }}
        className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-left text-[13px] rounded-sm py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {limit
          ? <Ban className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          : <Check className="w-4 h-4 text-success shrink-0" aria-hidden="true" />}
        <span className="text-foreground underline decoration-dotted decoration-muted-foreground/60 underline-offset-2">{label}</span>
        {conditions && (
          <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-muted text-muted-foreground">
            {t("jobsPage.perks.conditionsTag", "conditions stated")}
          </span>
        )}
        {claim.baseline && (
          <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-muted text-muted-foreground">
            {t("jobsPage.perks.legalTag", "may be the legal minimum")}
          </span>
        )}
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="mt-1 sm:mt-0 sm:absolute sm:left-0 sm:right-0 sm:top-full sm:z-20 rounded-lg border border-border bg-popover text-popover-foreground p-3 text-[12px] leading-snug shadow-md space-y-1.5"
      >
        <p id={countId} className="text-foreground">
          {limit
            ? t("jobsPage.perks.countLimit", "Stated as not available in at least {{k}} of {{n}} open {{country}} postings we could read, read {{date}}. The rest are not counted as offering it.", { k: claim.k, n: claim.n, country, date })
            : t("jobsPage.perks.count", "Stated in at least {{k}} of {{n}} open {{country}} postings we could read, read {{date}}.", { k: claim.k, n: claim.n, country, date })}
        </p>
        <figure className="space-y-0.5">
          <figcaption className="text-muted-foreground">{t("jobsPage.perks.quoteLabel", "In their words:")}</figcaption>
          <blockquote className="border-l-2 border-primary/40 pl-2 italic text-foreground break-words">“{claim.quote}”</blockquote>
        </figure>
        {claim.postingId ? (
          <Link to={perkPostingHref(claim.postingId)} className="inline-block text-primary hover:underline">
            {t("jobsPage.perks.postingLink", "See the posting this line comes from")}
          </Link>
        ) : (
          <p className="text-muted-foreground">{t("jobsPage.perks.postingGone", "The posting this line was quoted from is no longer on the board.")}</p>
        )}
        {conditions && (
          <p className="text-muted-foreground">
            {t("jobsPage.perks.conditions", "{{q}} of these {{k}} postings hedge it or limit who is eligible.", { q: qualifiedCount(claim), k: claim.k })}
          </p>
        )}
        {claim.standardText && (
          <p className="text-muted-foreground">{t("jobsPage.perks.standardText", "Most of these postings carry this same line word for word.")}</p>
        )}
        {claim.baseline && (
          <p className="text-muted-foreground">
            {t("jobsPage.perks.legal", "This country's law sets a minimum for this, and this line may describe that minimum:")}{" "}
            <a
              href={claim.baseline.sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary hover:underline"
            >
              {claim.baseline.statute}
              <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
            </a>
          </p>
        )}
      </div>
    </li>
  );
}

export function CompanyPerksView({ answer }: { answer: EmployerPerksAnswer | null }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const view = perksView(answer);
  if (!view) return null;
  const lang = i18n.language || "en";
  const title = t("jobsPage.perks.title", "Perks stated in their job postings");

  if (view.kind === "withheld") {
    return (
      <section aria-labelledby={titleId} data-company-perks="withheld" data-perks-withheld={view.reason} className="rounded-xl border border-border bg-card p-3 max-w-xl mb-3">
        <h2 id={titleId} className="text-[13px] font-semibold text-foreground">{title}</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">{withheldLine(t, view.reason, view.share)}</p>
      </section>
    );
  }

  const several = view.groups.length > 1;
  const { minReadable, minStated, minShare } = PERK_ROW_THRESHOLDS;
  return (
    <section aria-labelledby={titleId} data-company-perks="claims" className="rounded-xl border border-border bg-card p-4 max-w-xl mb-3">
      <h2 id={titleId} className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-[12px] text-muted-foreground mt-0.5">
        {t("jobsPage.perks.notListed", "A perk not listed here doesn't mean it isn't offered: it means we didn't find it stated in enough of the postings we could read.")}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
        {t("jobsPage.perks.howTo", "Tap, hover or focus a perk to see how many postings state it and the line they use.")}
      </p>
      <div className="space-y-3">
        {view.groups.map((g) => (
          <div key={g.country} data-perks-country={g.country}>
            {several && <h3 className="text-[12px] font-semibold text-foreground mb-1">{countryName(g.country, lang)}</h3>}
            {g.checks.length > 0 && (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {g.checks.map((c) => <PerkItem key={c.perk} claim={c} lang={lang} limit={false} />)}
              </ul>
            )}
            {g.limits.length > 0 && (
              <div className="mt-2">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                  {t("jobsPage.perks.limitsTitle", "Stated limits")}
                </h4>
                <ul className="grid grid-cols-1 gap-y-1">
                  {g.limits.map((c) => <PerkItem key={c.perk} claim={c} lang={lang} limit />)}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {t("jobsPage.perks.basis", "Read from the text of their own open postings. A check needs at least {{minN}} postings in a country that we could read, with the perk stated in at least {{minK}} of them and in at least {{minPct}}% of them. \"At least\" because our reader can miss a mention.", {
          minN: minReadable,
          minK: minStated,
          minPct: Math.round(minShare * 100),
        })}
      </p>
    </section>
  );
}

export function CompanyPerks({ companyToken }: { companyToken: string }) {
  const [answer, setAnswer] = useState<EmployerPerksAnswer | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAnswer(null);
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_employer_perks", { p_token: companyToken });
        if (!cancelled) setAnswer(readEmployerPerks(data));
      } catch { /* additive block: a reader that could not load prints nothing, and no error either */ }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  return <CompanyPerksView answer={answer} />;
}

export default CompanyPerks;
