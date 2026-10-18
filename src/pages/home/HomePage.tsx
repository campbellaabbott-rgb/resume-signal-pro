import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/seo/SEO";
import { useAuth } from "@/contexts/AuthContext";
import { useBoardVendorCounts } from "@/hooks/useBoardVendorCounts";
import { useBoardFreshness } from "@/lib/home/use-board-freshness";
import { useHomeRows } from "@/lib/home/use-home-rows";
import { saleGates, type SaleGates } from "@/lib/home/sale-gates";
import { useHomeStrings } from "@/lib/home/strings";
import { HomeSearchHero } from "@/components/home/HomeSearchHero";
import { HomeBoardRows } from "@/components/home/HomeBoardRows";
import { HomeBoardRail } from "@/components/home/HomeBoardRail";
import { HomeAccountStrip } from "@/components/home/HomeAccountStrip";
import { HomeScanSection } from "@/components/home/HomeScanSection";
import { HomeAiSection } from "@/components/home/HomeAiSection";
import { HomeSources } from "@/components/home/HomeSources";
import { HomePlanStrip } from "@/components/home/HomePlanStrip";
import { HomeFaq } from "@/components/home/HomeFaq";

/**
 * "/" — THE JOB SEARCH, WITH LIVE POSTINGS (board-first; corrected spec of
 * 2026-10-17, section 4). The free résumé scanner moves to /resume-checker.
 *
 * Supabase data calls on this page, at most four: get_board_vendor_counts
 * (every count and the hiring-system table, one as_of), get_freshness_stats
 * (the rail), one job-board list and one get_company_fill_curve (the rows).
 * mcp-tools.ts, the scanner page, the uploader and the checkout hook never
 * load here.
 *
 * No scroll-depth or time-on-page events: the visitor budget's journey
 * (a-budget-that-charged-the-office-for-one-visitors-loop.test.ts) counts
 * every page that sends them, and the scanner page keeps its own. Whether /
 * takes them over is a switch-over decision (docs/homepage-pricing/README.md).
 */
export interface HomePageProps {
  /** The preview harness drives a browser on purpose; production never sets this. */
  loadRowsForAutomation?: boolean;
  /** Tests pass gates; the page reads src/config/seller.ts and the sale switches otherwise. */
  gates?: SaleGates;
}

export default function HomePage({ loadRowsForAutomation = false, gates }: HomePageProps) {
  const { t } = useTranslation();
  useHomeStrings();
  const { session } = useAuth();
  const counts = useBoardVendorCounts();
  const freshness = useBoardFreshness();
  const rows = useHomeRows({ allowAutomation: loadRowsForAutomation });
  const sale = gates ?? saleGates();
  const openTotal = counts.ready ? counts.openTotal : null;
  const asOf = counts.ready ? counts.asOf : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO title={t("home.seo.title")} description={t("home.seo.description")} path="/" />
      <Header />
      <main id="main-content" className="pt-14 lg:pt-16">
        <HomeSearchHero openTotal={openTotal} asOf={asOf} />

        <div className="container grid gap-5 pb-11 pt-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-8 lg:gap-y-5 lg:pb-16 lg:pt-8">
          <HomeBoardRows state={rows} openTotal={openTotal} asOf={asOf} />
          <HomeBoardRail freshness={freshness} />
          {!session && <HomeAccountStrip alertsStatable={sale.alertsStatable} />}
        </div>

        <HomeScanSection />
        <HomeAiSection counts={counts.counts} openTotal={openTotal} asOf={asOf} />
        <HomeSources counts={counts.counts} openTotal={openTotal} asOf={asOf} />
        <HomePlanStrip gates={sale} />
        <HomeFaq counts={counts.counts} />
      </main>
      <Footer />
    </div>
  );
}
