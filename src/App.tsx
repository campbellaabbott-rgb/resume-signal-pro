import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { FloatingHelpButton } from "./components/FloatingHelpButton";
import { ScrollToTop } from "./components/ScrollToTop";
import { LanguageDebugBanner } from "./components/LanguageDebugBanner";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Index is the landing page almost every visitor hits first, so it stays eagerly
// imported. Every other route is lazy-loaded so visitors to "/" aren't downloading
// code for /pricing, /terms, internal dashboards, etc. — these were all previously
// bundled into one ~3.3MB chunk regardless of which route was actually visited.
// Index is now lazy like every other route: the homepage chain (Hero,
// ResumeUploader, AnalysisPreview, CheckoutOverlay — measured ~60-70KB gz)
// was riding the entry bundle to every /jobs visitor and all 872 SEO landers.
// First paint on / is covered by the prerendered HTML, so the tradeoff is
// a spinner-flash on client-side nav to the homepage, not a blank landing.
const Index = lazy(() => import("./pages/Index"));
import { TOOL_LANDINGS } from "@/data/tool-landings";
const Auth = lazy(() => import("./pages/Auth"));
const Account = lazy(() => import("./pages/Account"));
const Agent = lazy(() => import("./pages/Agent"));
const Shortlist = lazy(() => import("./pages/Shortlist"));
const Success = lazy(() => import("./pages/Success"));
const ProductSuccess = lazy(() => import("./pages/ProductSuccess"));
const PaymentFailed = lazy(() => import("./pages/PaymentFailed"));
const Terms = lazy(() => import("./pages/Terms"));
const Jobs = lazy(() => import("./pages/Jobs"));
const GhostJobIndex = lazy(() => import("./pages/GhostJobIndex"));
const EntryLevelIndex = lazy(() => import("./pages/EntryLevelIndex"));
const Explore = lazy(() => import("./pages/Explore"));
const HiringTrends = lazy(() => import("./pages/HiringTrends"));
const DataApi = lazy(() => import("./pages/DataApi"));
const PayTransparencyIndex = lazy(() => import("./pages/PayTransparencyIndex"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Methodology = lazy(() => import("./pages/Methodology"));
const DevCheckoutTest = lazy(() => import("./pages/DevCheckoutTest"));
const Affiliates = lazy(() => import("./pages/Affiliates"));
const AffiliateRedirect = lazy(() => import("./pages/AffiliateRedirect"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const ErrorDashboard = lazy(() => import("./pages/ErrorDashboard"));
const AdminClaims = lazy(() => import("./pages/AdminClaims"));
const HealthCheck = lazy(() => import("./pages/HealthCheck"));
const ScanMetrics = lazy(() => import("./pages/ScanMetrics"));
const Trust = lazy(() => import("./pages/Trust"));
const ResumeBuilder = lazy(() => import("./pages/ResumeBuilder"));
const Changelog = lazy(() => import("./pages/Changelog"));
const FreelanceBoost = lazy(() => import("./pages/FreelanceBoost"));
const IndustriesIndex = lazy(() => import("./pages/IndustriesIndex"));
const IndustryKeywords = lazy(() => import("./pages/IndustryKeywords"));
const AtsVendorGuide = lazy(() => import("./pages/AtsVendorGuide"));
const VsCompetitor = lazy(() => import("./pages/VsCompetitor"));
const IndustryKeywordsEs = lazy(() => import("./pages/IndustryKeywordsEs"));
const RoleKeywords = lazy(() => import("./pages/RoleKeywords"));
const CvStandards = lazy(() => import("./pages/CvStandards"));
const CvStandardsIndex = lazy(() => import("./pages/CvStandards").then((m) => ({ default: m.CvStandardsIndex })));
const GuidesIndex = lazy(() => import("./pages/GuidesIndex"));
const GuideArticle = lazy(() => import("./pages/GuideArticle"));
const ScoreStudy = lazy(() => import("./pages/ScoreStudy"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Companies = lazy(() => import("./pages/Companies"));

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
  <AuthProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/account" element={<Account />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/shortlist" element={<Shortlist />} />
          <Route path="/success" element={<Success />} />
          <Route path="/product-success" element={<ProductSuccess />} />
          <Route path="/payment-failed" element={<PaymentFailed />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/field/:category" element={<Jobs />} />
          <Route path="/jobs/company/:companyToken" element={<Jobs />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/ghost-job-index" element={<GhostJobIndex />} />
          <Route path="/entry-level-index" element={<EntryLevelIndex />} />
          <Route path="/hiring-trends" element={<HiringTrends />} />
          <Route path="/data-api" element={<DataApi />} />
          <Route path="/pay-transparency" element={<PayTransparencyIndex />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/affiliates" element={<Affiliates />} />
          <Route path="/r/:code" element={<AffiliateRedirect />} />
          <Route path="/dev/checkout-test" element={<DevCheckoutTest />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/errors" element={<ErrorDashboard />} />
          <Route path="/admin/claims" element={<AdminClaims />} />
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/scan-metrics" element={<ScanMetrics />} />
          <Route path="/trust" element={<Trust />} />
          <Route path="/builder" element={<ResumeBuilder />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/freelance-boost" element={<FreelanceBoost />} />
          <Route path="/industries" element={<IndustriesIndex />} />
          <Route path="/industries/:slug" element={<IndustryKeywords />} />
          <Route path="/ats/:vendor" element={<AtsVendorGuide />} />
          <Route path="/vs/:slug" element={<VsCompetitor />} />
          <Route path="/es/industrias/:slug" element={<IndustryKeywordsEs />} />
          <Route path="/roles/:slug" element={<RoleKeywords />} />
          {/* Per-country CV standards — EN for every country, localized per CV_LOCALES */}
          <Route path="/cv-standards" element={<CvStandardsIndex />} />
          <Route path="/cv-standards/:country" element={<CvStandards />} />
          <Route path="/es/normas-cv/:country" element={<CvStandards locale="es" />} />
          <Route path="/fr/normes-cv/:country" element={<CvStandards locale="fr" />} />
          <Route path="/de/lebenslauf-standards/:country" element={<CvStandards locale="de" />} />
          <Route path="/pt/padroes-cv/:country" element={<CvStandards locale="pt" />} />
          <Route path="/nl/cv-normen/:country" element={<CvStandards locale="nl" />} />
          <Route path="/guides" element={<GuidesIndex />} />
          <Route path="/guides/:slug" element={<GuideArticle />} />
          <Route path="/research/ats-score-benchmarks" element={<ScoreStudy />} />
          {/* Head-term landing pages: the real scanner under query-specific SEO
              copy (see src/data/tool-landings.ts) */}
          <Route path="/resume-checker" element={<Index landing={TOOL_LANDINGS["resume-checker"]} />} />
          <Route path="/ats-resume-test" element={<Index landing={TOOL_LANDINGS["ats-resume-test"]} />} />
          <Route path="/resume-score" element={<Index landing={TOOL_LANDINGS["resume-score"]} />} />
          <Route path="/es/revisar-curriculum" element={<Index landing={TOOL_LANDINGS["revisar-curriculum"]} />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <FloatingHelpButton />
      <LanguageDebugBanner />
    </BrowserRouter>
  </AuthProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
