/**
 * THE THREE PLAN CARDS: Free, Full Analysis, Pro.
 *
 * Free leads, and carries the page's only filled button ("Create a free
 * account"). Fit is listed under "No account needed": job-fit has no sign-in
 * check, and the board scores against the résumé this browser scanned or
 * dropped. The open-postings figure is the board's one figure, openTotal from
 * get_board_vendor_counts, printed only with the time it was counted.
 *
 * Pro's list is PRO_PERK_ITEMS (pro-perks-mirror.ts) and nothing else; the
 * included Full Analysis line shows only while the Full Analysis is on sale.
 */
import { ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/card";
import { count as fmtCount, isoAttr, money } from "@/lib/format";
import { FullAnalysisBuy, ProBuy, type PreviewFurniture } from "./BuyBlock";
import { utcDate, utcTime } from "./format-utc";
import {
  FULL_ANALYSIS_LINK_DAYS,
  FULL_ANALYSIS_PRICE_USD,
  FREE_SCANS_PER_DAY,
  PRO_PRICE_USD,
  SIGNED_IN_SCANS_PER_DAY,
  WRITING,
} from "./plan-facts";
import { visibleProPerks } from "./pro-perks-mirror";
import type { SaleGates } from "./sale-gates";
import { RichText } from "./RichText";

export interface OpenPostings {
  openTotal: number | null;
  asOf: Date | string | null;
}

function CheckItem({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-foreground">
      <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <span className="min-w-0">
        {children}
        {note ? <small className="block text-xs text-subtle-foreground">{note}</small> : null}
      </span>
    </li>
  );
}

function Amount({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="mt-1 text-4xl font-semibold tracking-tight text-foreground">
      {value}
      {unit ? <small className="ml-2 text-base font-normal tracking-normal text-muted-foreground">{unit}</small> : null}
    </p>
  );
}

const CARD = "flex min-w-0 flex-col p-5";
const GROUP = "mt-4 text-xs font-semibold tracking-wide text-subtle-foreground";

export function FreeCard({ postings }: { postings: OpenPostings }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const hasCount = postings.openTotal !== null && postings.openTotal > 0 && !!isoAttr(postings.asOf);
  return (
    <Surface as="section" id="free" aria-labelledby="plan-free" className={CARD} data-plan="free">
      <h2 id="plan-free" className="text-lg font-semibold">{t("pricingPlans.free.name")}</h2>
      <Amount value={money(0, "USD", { lng })} />
      <p className="mt-1.5 text-base text-muted-foreground">{t("pricingPlans.free.what")}</p>

      <h3 className={GROUP}>{t("pricingPlans.free.groupNoAccount")}</h3>
      <ul className="mt-2 grid gap-2">
        {hasCount ? (
          <CheckItem
            note={
              <time dateTime={isoAttr(postings.asOf)} data-testid="open-postings-stamp">
                {t("pricingPlans.free.counted", { date: utcDate(postings.asOf, lng), time: utcTime(postings.asOf, lng) })}
              </time>
            }
          >
            <span data-testid="open-postings-count">{t("pricingPlans.free.search", { n: fmtCount(postings.openTotal, { lng }) })}</span>
          </CheckItem>
        ) : (
          <CheckItem>{t("pricingPlans.free.searchNoCount")}</CheckItem>
        )}
        <CheckItem>{t("pricingPlans.free.scans", { n: FREE_SCANS_PER_DAY })}</CheckItem>
        <CheckItem note={t("pricingPlans.free.fitNote")}>
          <span data-testid="fit-signed-out">{t("pricingPlans.free.fit")}</span>
        </CheckItem>
        <CheckItem>{t("pricingPlans.free.ai")}</CheckItem>
      </ul>

      <h3 className={GROUP}>{t("pricingPlans.free.groupAccount")}</h3>
      <ul className="mt-2 grid flex-1 content-start gap-2">
        <CheckItem>{t("pricingPlans.free.saved")}</CheckItem>
        <CheckItem>{t("pricingPlans.free.savedResume")}</CheckItem>
        <CheckItem>{t("pricingPlans.free.writing", { perDay: WRITING.freePerToolPerDay })}</CheckItem>
        <CheckItem>{t("pricingPlans.free.scansAccount", { n: SIGNED_IN_SCANS_PER_DAY })}</CheckItem>
      </ul>

      <div className="mt-5">
        <Button asChild size="lg" wrap className="w-full min-h-11 justify-center text-center">
          <Link to="/auth?next=%2Fjobs">{t("pricingPlans.free.cta")}</Link>
        </Button>
      </div>
      <p className="mt-2.5 text-xs text-subtle-foreground">
        <RichText
          text={t("pricingPlans.free.fine")}
          link={(inner, key) => (
            <Link key={key} to="/jobs" className="text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
              {inner}
            </Link>
          )}
        />
      </p>
    </Surface>
  );
}

export function FullAnalysisCard({ gates, preview }: { gates: SaleGates; preview?: PreviewFurniture }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  return (
    <Surface as="section" id="full-analysis" aria-labelledby="plan-fa" className={CARD} data-plan="full-analysis">
      <h2 id="plan-fa" className="text-lg font-semibold">{t("pricingPlans.fa.name")}</h2>
      <Amount value={money(FULL_ANALYSIS_PRICE_USD, "USD", { lng })} unit={t("pricingPlans.fa.unit")} />
      <p className="mt-1.5 text-base text-muted-foreground">{t("pricingPlans.fa.what")}</p>
      <ul className="mt-4 grid flex-1 content-start gap-2">
        <CheckItem>{t("pricingPlans.fa.b1")}</CheckItem>
        <CheckItem>{t("pricingPlans.fa.b2")}</CheckItem>
        <CheckItem>{t("pricingPlans.fa.b3")}</CheckItem>
        <CheckItem>{t("pricingPlans.fa.b4")}</CheckItem>
        <CheckItem>{t("pricingPlans.fa.b5", { days: FULL_ANALYSIS_LINK_DAYS })}</CheckItem>
      </ul>
      <p className="mt-4 text-meta text-muted-foreground">{t("pricingPlans.fa.how")}</p>
      <FullAnalysisBuy gates={gates} preview={preview} />
    </Surface>
  );
}

export function ProCard({ gates, preview, onPreviewPress }: { gates: SaleGates; preview?: PreviewFurniture; onPreviewPress?: () => void }) {
  const { t, i18n } = useTranslation();
  const lng = i18n.language;
  const vars = {
    perDay: WRITING.proPackagesPerDay,
    perMonth: WRITING.proPackagesPerMonth,
    faPrice: money(FULL_ANALYSIS_PRICE_USD, "USD", { lng }),
  };
  const perks = visibleProPerks({ fullAnalysisOnSale: gates.fullAnalysis.onSale });
  return (
    <Surface as="section" id="pro" aria-labelledby="plan-pro" className={CARD} data-plan="pro">
      <h2 id="plan-pro" className="text-lg font-semibold">{t("pricingPlans.pro.name")}</h2>
      <Amount value={money(PRO_PRICE_USD, "USD", { lng })} unit={t("pricingPlans.pro.unit")} />
      <p className="mt-1.5 text-base text-muted-foreground">{t("pricingPlans.pro.what")}</p>

      <div role="group" aria-label={t("pricingPlans.pro.stepLabel")} className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-border px-3 py-2.5 text-meta text-muted-foreground">
        <span className="min-w-0">
          <b className="block text-sm font-semibold text-foreground">{t("pricingPlans.pro.stepFreeAmount", { n: WRITING.freePerToolPerDay })}</b>
          {t("pricingPlans.pro.stepFreeUnit")}
        </span>
        <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <span className="min-w-0">
          <b className="block text-sm font-semibold text-foreground">{t("pricingPlans.pro.stepProAmount", { n: WRITING.proPackagesPerDay })}</b>
          {t("pricingPlans.pro.stepProUnit", { perMonth: WRITING.proPackagesPerMonth })}
        </span>
      </div>

      <ul className="mt-3.5 grid content-start gap-2" data-testid="pro-perks">
        {perks.map((p) => (
          <CheckItem key={p.key}>
            <span data-perk={p.key}>{t(p.key, { ...vars, defaultValue: p.text })}</span>
          </CheckItem>
        ))}
      </ul>
      <p className="mt-3 text-meta text-muted-foreground">{t("pricingPlans.pro.review")}</p>

      <p className="mt-3.5 rounded-md border border-border bg-signal-tint px-3 py-2.5 text-meta text-foreground" data-testid="pro-ai-status">
        <b className="font-semibold">{t("pricingPlans.pro.statusTitle")}</b> {t("pricingPlans.pro.statusBody")}
      </p>
      {/* The buy area sits at the card's foot, level with the other cards'. */}
      <div className="flex-1" aria-hidden="true" />

      <ProBuy gates={gates} preview={preview} onPreviewPress={onPreviewPress} />
    </Surface>
  );
}
