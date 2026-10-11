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
// focus open the panel. A tap or click pins it open and a second one closes
// it; a keyboard (or screen reader) activation always flips what is shown, so
// every Enter or Space changes aria-expanded. Focus moving into the panel (its
// posting link) keeps it open.
//
// ONE PANEL AT A TIME, IN THE FLOW. The open check is held by the list, not
// by each item, so opening one closes any other. The panel sits in normal
// flow at every width and pushes the list down: it never covers another
// check, a stated limit or another country's group. Escape anywhere on the
// page closes it (focus goes back to the check when it was inside the item),
// and so does a press anywhere outside the open item, so a panel opened by
// hover or a tap can always be dismissed without moving to it (WCAG 1.4.13).
//
// NOTHING IS A PLACEHOLDER. Until a key passes its audit the block renders
// nothing at all; an expired key is a key the reader no longer names. On a
// board two vendors share, an agency's board, a franchise board or a vendor
// whose benefits text our ingest drops, the block prints only the reason, and
// only while some key is live elsewhere.

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  type PerkStatute,
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
        className="text-primary hover:underline"
      >
        {law.statute}
        <ExternalLink className="inline w-3 h-3 ml-0.5 align-[-1px]" aria-hidden="true" />
      </a>
      {law.appliesIn ? <>{" "}({law.appliesIn})</> : null}
    </>
  );
}

/** Which check is open, and whether a tap, click or keyboard pinned it. Held by the list: one at a time. */
interface OpenCheck { id: string; pinned: boolean }

function PerkItem({
  claim, lang, limit, open, pinned, onOpen, onClose,
}: {
  claim: PerkClaim;
  lang: string;
  limit: boolean;
  open: boolean;
  pinned: boolean;
  onOpen: (pin: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const item = useRef<HTMLLIElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Whether this check was open when the press that is about to click it
  // began. A tap focuses the button (which opens it) before its click lands,
  // so the click must judge the state the person saw, not the one focus made.
  const press = useRef<boolean | null>(null);
  // Set while Escape hands focus back to the check, so that focus does not
  // reopen the panel Escape just closed.
  const refocusing = useRef(false);
  const id = useId();
  const panelId = `${id}-basis`;
  const countId = `${id}-count`;

  const country = countryName(claim.country, lang);
  const date = readDate(claim.asOf, lang);
  const conditions = showsConditions(claim);
  const label = perkLabel(t, claim);
  const hoverable = (pointerType: string) => pointerType === "mouse" || pointerType === "pen";

  // While open: Escape anywhere closes it (focus returns to the check when it
  // was inside this item), and a press anywhere outside this item closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = item.current?.contains(document.activeElement) ?? false;
      onClose();
      if (inside) {
        refocusing.current = true;
        try { button.current?.focus(); } finally { refocusing.current = false; }
      }
    };
    const onDown = (e: PointerEvent) => {
      if (item.current && e.target instanceof Node && item.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);

  return (
    <li
      ref={item}
      data-perk={claim.perk}
      onPointerEnter={(e) => { if (hoverable(e.pointerType) && !open) onOpen(false); }}
      onPointerLeave={(e) => { if (hoverable(e.pointerType) && open && !pinned) onClose(); }}
      onFocus={() => { if (!open && !refocusing.current) onOpen(false); }}
      onBlur={(e) => {
        if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) onClose();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={countId}
        onPointerDown={() => { press.current = open; }}
        onClick={() => {
          const pointer = press.current;
          press.current = null;
          if (pointer === null) {
            // Keyboard or assistive technology: every activation flips it.
            if (open) onClose();
            else onOpen(true);
            return;
          }
          // A tap or click: open (or opened by the hover or the focus this
          // same press caused) and not yet pinned pins it; pinned closes it.
          if (pointer && pinned) onClose();
          else onOpen(true);
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
        className="mt-1 rounded-lg border border-border bg-popover text-popover-foreground p-3 text-[12px] leading-snug shadow-sm space-y-1.5"
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
            <StatuteLink law={claim.baseline} />
            {claim.baseline.also && <>; <StatuteLink law={claim.baseline.also} /></>}
          </p>
        )}
      </div>
    </li>
  );
}

export function CompanyPerksView({ answer }: { answer: EmployerPerksAnswer | null }) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [openCheck, setOpenCheck] = useState<OpenCheck | null>(null);
  const close = useCallback(() => setOpenCheck(null), []);
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
        {t("jobsPage.perks.notListed", "A perk not listed here doesn't mean it isn't offered. We list only perks whose reading we have checked, and only where enough of the postings we could read state them.")}
      </p>
      <p className="text-[11px] text-muted-foreground mt-0.5 mb-2">
        {t("jobsPage.perks.howTo", "Tap, hover or focus a perk to see how many postings state it and the line they use.")}
      </p>
      <div className="space-y-3">
        {view.groups.map((g) => {
          // One heading level per step: the limits heading sits under a
          // country h3 when there are several, and directly under the h2
          // when one country qualifies and its h3 is left out.
          const LimitsHeading = several ? "h4" : "h3";
          const item = (c: PerkClaim, limit: boolean) => {
            const key = `${g.country}:${c.perk}`;
            const isOpen = openCheck?.id === key;
            return (
              <PerkItem
                key={c.perk}
                claim={c}
                lang={lang}
                limit={limit}
                open={isOpen}
                pinned={isOpen && openCheck!.pinned}
                onOpen={(pin) => setOpenCheck({ id: key, pinned: pin })}
                onClose={close}
              />
            );
          };
          return (
            <div key={g.country} data-perks-country={g.country}>
              {several && <h3 className="text-[12px] font-semibold text-foreground mb-1">{countryName(g.country, lang)}</h3>}
              {g.checks.length > 0 && (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 items-start">
                  {g.checks.map((c) => item(c, false))}
                </ul>
              )}
              {g.limits.length > 0 && (
                <div className="mt-2">
                  <LimitsHeading className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    {t("jobsPage.perks.limitsTitle", "Stated limits")}
                  </LimitsHeading>
                  <ul className="grid grid-cols-1 gap-y-1">
                    {g.limits.map((c) => item(c, true))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        {t("jobsPage.perks.basis", "Read from the text of their own open postings written in English; postings in other languages are not read yet. A check needs at least {{minN}} postings in a country that we could read, with the perk stated in at least {{minK}} of them and in at least {{minPct}}% of them. \"At least\" because our reader can miss a mention.", {
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
