// PERKS STATED IN THEIR JOB POSTINGS: the checkmark list on the company page.
//
// Owner decision D1 (2026-10-11) chose a checkmark list over a count and a
// quote, to be built honestly. So every mark here is a claim with its basis
// one activation away:
//
//   - the heading says where the perks come from ("stated in their job
//     postings"), and the line under it says that a perk not listed is not
//     a perk refused;
//   - a mark appears only for a key whose audit is live and only above the
//     per-country threshold (src/lib/employer-perks.ts decides which, once);
//   - a CHECK means at least half of the postings we could read in that
//     country state it. A perk above the threshold but under half sits apart,
//     "In some of their postings", with a hollow dot (design spec 5.5a): a
//     bare check at 2 of 20 postings read as "offered" (audit CP20);
//   - activating a mark opens its basis in the flow: "stated in at least k of
//     n open <country> postings we could read, read <date>", the verbatim
//     line, and a link to the posting it came from while that posting still
//     serves;
//   - eligibility conditions and a possible legal minimum (UK and German
//     statute only, linked) are tagged on the mark itself;
//   - a stated visa limit is listed apart, never with a checkmark.
//
// THE DISCLOSURE PATTERN. Each mark is a real <button> with aria-expanded and
// aria-controls naming its panel, and aria-describedby naming the count
// sentence, so a screen reader hears the basis with the perk without opening
// anything. The panel opens on click, tap, Enter or Space, and on nothing
// else. FOCUS NEVER OPENS IT: a list that opened as a keyboard user tabbed
// through it pushed every later check down under them (audit CP20). Every
// activation flips it, so each one is announced.
//
// HOVER ONLY PREVIEWS. A mouse or pen resting on a mark shows the count and
// the quote in a small card laid OVER the list (it never moves the list),
// without the link, and marked aria-hidden because the same sentence is the
// mark's description. It stays while the pointer is on the mark or the card,
// and Escape dismisses it (WCAG 1.4.13).
//
// ONE PANEL AT A TIME, IN THE FLOW. The open mark is held by the list, not by
// each item, so opening one closes any other. The panel sits in normal flow
// at every width and pushes the list down: it never covers another mark.
// Escape anywhere closes it (focus goes back to the mark when it was inside
// the item), and so does a press anywhere outside the open item.
//
// NOTHING IS A PLACEHOLDER. Until a key passes its audit the block renders
// nothing at all; an expired key is a key the reader no longer names. On a
// board two vendors share, an agency's board, a franchise board or a vendor
// whose benefits text our ingest drops, the block prints only the reason, and
// only while some key is live elsewhere.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Check, Circle, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { inflight } from "@/lib/company/inflight";
import { date as fmtDate, count as fmtCount } from "@/lib/company/format";
import {
  PERK_CHECK_MIN_SHARE,
  PERK_ROW_THRESHOLDS,
  perkMark,
  perkPostingHref,
  perksView,
  qualifiedCount,
  readEmployerPerks,
  showsConditions,
  type EmployerPerksAnswer,
  type PerkClaim,
  type PerkStatute,
  type PerkWithheldReason,
  type PerksView,
} from "@/lib/employer-perks";

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function perkLabel(t: TFunction, claim: Pick<PerkClaim, "perk" | "k" | "n">): string {
  switch (claim.perk) {
    case "health": return t("jobsPage.perks.labelHealth", "Health insurance");
    case "dental": return t("jobsPage.perks.labelDental", "Dental coverage");
    case "vision": return t("jobsPage.perks.labelVision", "Vision coverage");
    case "life_dis": return t("jobsPage.perks.labelLifeDis", "Life or disability insurance");
    case "retire": return t("jobsPage.perks.labelRetire", "Retirement or pension plan");
    case "pto": return t("jobsPage.perks.labelPto", "Paid time off");
    case "parental": return t("jobsPage.perks.labelParental", "Parental leave");
    case "equity": return t("jobsPage.perks.labelEquity", "Equity or stock");
    // A stated limit carries its share on the label itself: three postings of
    // thirty saying it is not an employer that "does not sponsor", and the
    // label must not read as one before anyone opens the count.
    case "visa_not_offered": return t("jobsPage.perks.labelVisaNotOffered", "Visa sponsorship: stated as not available in at least {{k}} of {{n}} postings", { k: claim.k, n: claim.n });
  }
}

function withheldLine(t: TFunction, reason: PerkWithheldReason, share: number | null): string {
  switch (reason) {
    case "collision":
      return t("jobsPage.perks.withheldCollision", "Not shown here: more than one hiring system carries a board with this name, and we can't tell whether they are one employer.");
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

/** A statute, linked to its official text, with where it applies when that is narrower than the country. */
function StatuteLink({ law }: { law: PerkStatute }) {
  return (
    <>
      <a
        href={law.sourceUrl}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary"
      >
        {law.statute}
        <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
      </a>
      {law.appliesIn ? <>{" "}({law.appliesIn})</> : null}
    </>
  );
}

/** The count sentence a mark opens (and previews), in the reader's language. */
function countSentence(t: TFunction, claim: PerkClaim, limit: boolean, lang: string): string {
  const country = countryName(claim.country, lang);
  const date = fmtDate(claim.asOf, { lng: lang });
  const k = fmtCount(claim.k, { lng: lang });
  const n = fmtCount(claim.n, { lng: lang });
  return limit
    ? t("jobsPage.perks.countLimit", "Stated as not available in at least {{k}} of {{n}} open {{country}} postings we could read, read {{date}}. The rest are not counted as offering it.", { k, n, country, date })
    : t("jobsPage.perks.count", "Stated in at least {{k}} of {{n}} open {{country}} postings we could read, read {{date}}.", { k, n, country, date });
}

function PerkItem({
  claim, lang, limit, open, onOpen, onClose,
}: {
  claim: PerkClaim;
  lang: string;
  limit: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const item = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState(false);
  const id = useId();
  const panelId = `${id}-basis`;
  const countId = `${id}-count`;

  const conditions = showsConditions(claim);
  const label = perkLabel(t, claim);
  const mark = limit ? "limit" : perkMark(claim);
  const sentence = countSentence(t, claim, limit, lang);
  const hoverable = (pointerType: string) => pointerType === "mouse" || pointerType === "pen";
  const showPreview = preview && !open;

  // Escape anywhere closes what is shown (the panel, the preview). Focus goes
  // back to the mark when it was inside this item. A press outside this item
  // closes the panel.
  useEffect(() => {
    if (!open && !preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPreview(false);
      if (!open) return;
      const inside = item.current?.contains(document.activeElement) ?? false;
      onClose();
      if (inside) button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!open) return;
      if (item.current && e.target instanceof Node && item.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, preview, onClose]);

  return (
    <li
      ref={item}
      data-perk={claim.perk}
      data-perk-mark={mark}
      className="relative"
      onPointerEnter={(e) => { if (hoverable(e.pointerType)) setPreview(true); }}
      onPointerLeave={(e) => { if (hoverable(e.pointerType)) setPreview(false); }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={countId}
        onClick={() => {
          setPreview(false);
          if (open) onClose();
          else onOpen();
        }}
        className="inline-flex min-h-8 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-sm py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {mark === "limit"
          ? <Ban className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
          : mark === "check"
            ? <Check className="w-4 h-4 text-success shrink-0" aria-hidden="true" />
            : <Circle className="w-3 h-3 mx-0.5 text-muted-foreground shrink-0" aria-hidden="true" />}
        <span className="text-foreground underline decoration-dotted decoration-border-strong underline-offset-2">{label}</span>
        {conditions && (
          <span className="text-xs font-medium px-1.5 rounded-sm bg-muted text-muted-foreground">
            {t("jobsPage.perks.conditionsTag", "conditions stated")}
          </span>
        )}
        {claim.baseline && (
          <span className="text-xs font-medium px-1.5 rounded-sm bg-muted text-muted-foreground">
            {t("jobsPage.perks.legalTag", "may be the legal minimum")}
          </span>
        )}
      </button>
      {showPreview && (
        <div
          aria-hidden="true"
          data-perk-preview=""
          className="absolute left-0 top-full z-10 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-xs leading-snug text-popover-foreground shadow-md"
        >
          <p className="text-foreground">{sentence}</p>
          <p className="mt-1 italic text-foreground break-words">“{claim.quote}”</p>
        </div>
      )}
      <div
        id={panelId}
        hidden={!open}
        className="mt-1 rounded-lg border border-border bg-popover text-popover-foreground p-3 text-meta leading-snug space-y-1.5"
      >
        <p id={countId} className="text-foreground">{sentence}</p>
        <figure className="space-y-0.5">
          <figcaption className="text-muted-foreground">{t("jobsPage.perks.quoteLabel", "In their words:")}</figcaption>
          <blockquote className="border-l-2 border-border-strong pl-2 italic text-foreground break-words">“{claim.quote}”</blockquote>
        </figure>
        {claim.postingId ? (
          <Link to={perkPostingHref(claim.postingId)} className="inline-block text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
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
            <StatuteLink law={claim.baseline} />
            {claim.baseline.also && <>; <StatuteLink law={claim.baseline.also} /></>}
          </p>
        )}
      </div>
    </li>
  );
}

/** How many perk rows the block would print: the accordion's summary counts them. */
export function perksStatedCount(view: PerksView | null): number {
  if (!view || view.kind !== "claims") return 0;
  return view.groups.reduce((n, g) => n + g.checks.length, 0);
}

export function CompanyPerksView({ answer, headingLevel = 2, bare = false }: {
  answer: EmployerPerksAnswer | null;
  /** h2 on the page and in the rail; h3 inside the phone accordion. */
  headingLevel?: 2 | 3;
  /** Inside a profile surface: no border of its own. */
  bare?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  const close = useCallback(() => setOpenCheck(null), []);
  const view = perksView(answer);
  if (!view) return null;
  const lang = i18n.language || "en";
  const title = t("jobsPage.perks.title", "Perks stated in their job postings");
  const H = (headingLevel === 3 ? "h3" : "h2") as "h2" | "h3";
  const sub = (headingLevel === 3 ? "h4" : "h3") as "h3" | "h4";
  const box = bare ? "" : "rounded-lg border border-border bg-card p-4";

  if (view.kind === "withheld") {
    return (
      <section aria-labelledby={titleId} data-company-perks="withheld" data-perks-withheld={view.reason} className={box}>
        <H id={titleId} className="text-base font-semibold text-foreground">{title}</H>
        <p className="text-meta text-muted-foreground mt-1">{withheldLine(t, view.reason, view.share)}</p>
      </section>
    );
  }

  const several = view.groups.length > 1;
  const { minReadable, minStated, minShare } = PERK_ROW_THRESHOLDS;
  return (
    <section aria-labelledby={titleId} data-company-perks="claims" className={box}>
      <H id={titleId} className="text-base font-semibold text-foreground">{title}</H>
      <p className="text-meta text-muted-foreground mt-1 mb-2">
        {t("companyProfile.perks.lead", "Not listed doesn't mean not offered. Tap a perk to see how many postings state it.")}
      </p>
      <div className="space-y-3">
        {view.groups.map((g) => {
          // One heading level per step: a group heading sits under a country
          // heading when there are several, and directly under the section
          // heading when one country qualifies and its heading is left out.
          const GroupHeading = (several ? (sub === "h3" ? "h4" : "h5") : sub) as "h3" | "h4" | "h5";
          const strong = g.checks.filter((c) => perkMark(c) === "check");
          const some = g.checks.filter((c) => perkMark(c) === "some");
          const item = (c: PerkClaim, limit: boolean) => {
            const key = `${g.country}:${c.perk}`;
            return (
              <PerkItem
                key={c.perk}
                claim={c}
                lang={lang}
                limit={limit}
                open={openCheck === key}
                onOpen={() => setOpenCheck(key)}
                onClose={close}
              />
            );
          };
          const CountryHeading = sub;
          return (
            <div key={g.country} data-perks-country={g.country}>
              {several && <CountryHeading className="text-sm font-semibold text-foreground mb-1">{countryName(g.country, lang)}</CountryHeading>}
              {strong.length > 0 && (
                <ul className="grid grid-cols-1 gap-x-4 items-start">
                  {strong.map((c) => item(c, false))}
                </ul>
              )}
              {some.length > 0 && (
                <div className="mt-2" data-perks-some="">
                  <GroupHeading className="text-meta font-semibold text-muted-foreground">
                    {t("companyProfile.perks.someTitle", "In some of their postings")}
                  </GroupHeading>
                  <ul className="grid grid-cols-1 gap-x-4 items-start">
                    {some.map((c) => item(c, false))}
                  </ul>
                </div>
              )}
              {g.limits.length > 0 && (
                <div className="mt-2">
                  <GroupHeading className="text-meta font-semibold text-muted-foreground">
                    {t("jobsPage.perks.limitsTitle", "Stated limits")}
                  </GroupHeading>
                  <ul className="grid grid-cols-1 gap-y-1">
                    {g.limits.map((c) => item(c, true))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-subtle-foreground mt-3">
        {t("companyProfile.perks.basis", "Read from the text of their own open postings written in English; postings in other languages are not read yet. A check means at least {{strongPct}}% of the postings we could read in that country state it; a dot means at least {{minK}} of at least {{minN}} postings, and at least {{minPct}}%, do. We list only perks whose reading we have checked. \"At least\" because our reader can miss a mention.", {
          strongPct: Math.round(PERK_CHECK_MIN_SHARE * 100),
          minN: minReadable,
          minK: minStated,
          minPct: Math.round(minShare * 100),
        })}
      </p>
    </section>
  );
}

/**
 * The perks reader for one board, asked once while a request is in flight
 * (the rail and the phone accordion mount together). null until it answers,
 * and on any failure: an additive block prints nothing and no error.
 */
export function useEmployerPerks(companyToken: string | null | undefined, enabled = true): EmployerPerksAnswer | null {
  const [answer, setAnswer] = useState<EmployerPerksAnswer | null>(null);
  useEffect(() => {
    let cancelled = false;
    setAnswer(null);
    if (!companyToken || !enabled) return;
    inflight(`get_employer_perks:${companyToken}`, async () => {
      const { data } = await (supabase as unknown as {
        rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
      }).rpc("get_employer_perks", { p_token: companyToken });
      return data;
    }).then((data) => { if (!cancelled) setAnswer(readEmployerPerks(data)); })
      .catch(() => { /* additive block: nothing, and no error either */ });
    return () => { cancelled = true; };
  }, [companyToken, enabled]);
  return answer;
}

export function CompanyPerks({ companyToken }: { companyToken: string }) {
  const answer = useEmployerPerks(companyToken);
  return <CompanyPerksView answer={answer} />;
}

export default CompanyPerks;
