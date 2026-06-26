import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { FloatingHelpButton } from "./components/FloatingHelpButton";
import { ScrollToTop } from "./components/ScrollToTop";
import { LanguageDebugBanner } from "./components/LanguageDebugBanner";

// Index is the landing page almost every visitor hits first, so it stays eagerly
// imported. Every other route is lazy-loaded so visitors to "/" aren't downloading
// code for /pricing, /terms, internal dashboards, etc. — these were all previously
// bundled into one ~3.3MB chunk regardless of which route was actually visited.
import Index from "./pages/Index";
const Success = lazy(() => import("./pages/Success"));
const ProductSuccess = lazy(() => import("./pages/ProductSuccess"));
const PaymentFailed = lazy(() => import("./pages/PaymentFailed"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Methodology = lazy(() => import("./pages/Methodology"));
const DevCheckoutTest = lazy(() => import("./pages/DevCheckoutTest"));
const Affiliates = lazy(() => import("./pages/Affiliates"));
const AffiliateRedirect = lazy(() => import("./pages/AffiliateRedirect"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const ErrorDashboard = lazy(() => import("./pages/ErrorDashboard"));
const HealthCheck = lazy(() => import("./pages/HealthCheck"));
const ScanMetrics = lazy(() => import("./pages/ScanMetrics"));
const Trust = lazy(() => import("./pages/Trust"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/success" element={<Success />} />
          <Route path="/product-success" element={<ProductSuccess />} />
          <Route path="/payment-failed" element={<PaymentFailed />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/affiliates" element={<Affiliates />} />
          <Route path="/r/:code" element={<AffiliateRedirect />} />
          <Route path="/dev/checkout-test" element={<DevCheckoutTest />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/errors" element={<ErrorDashboard />} />
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/scan-metrics" element={<ScanMetrics />} />
          <Route path="/trust" element={<Trust />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <FloatingHelpButton />
      <LanguageDebugBanner />
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
