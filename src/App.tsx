import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Success from "./pages/Success";
import ProductSuccess from "./pages/ProductSuccess";
import PaymentFailed from "./pages/PaymentFailed";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Pricing from "./pages/Pricing";
import Methodology from "./pages/Methodology";
import DevCheckoutTest from "./pages/DevCheckoutTest";
import Affiliates from "./pages/Affiliates";
import AnalyticsDashboard from "./pages/AnalyticsDashboard";
import ErrorDashboard from "./pages/ErrorDashboard";
import HealthCheck from "./pages/HealthCheck";
import ScanMetrics from "./pages/ScanMetrics";
import Trust from "./pages/Trust";
import NotFound from "./pages/NotFound";
import { FloatingHelpButton } from "./components/FloatingHelpButton";
import { ScrollToTop } from "./components/ScrollToTop";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <ScrollToTop />
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
        <Route path="/dev/checkout-test" element={<DevCheckoutTest />} />
        <Route path="/analytics" element={<AnalyticsDashboard />} />
        <Route path="/errors" element={<ErrorDashboard />} />
        <Route path="/health-check" element={<HealthCheck />} />
        <Route path="/scan-metrics" element={<ScanMetrics />} />
        <Route path="/trust" element={<Trust />} />
        
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <FloatingHelpButton />
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
