/**
 * THE HOMEPAGE PREVIEW: /preview-home.html on the Vite dev server.
 *
 * Mounts src/pages/home/HomePage.tsx with the app's providers, outside App.tsx
 * and its routes, so the new page can be seen, measured and screenshotted
 * before the switch-over. Query parameters:
 *   data=fixture|live   recorded board reads (default) or production
 *   rows=fixture|loading|hidden|slow   the live list's state (fixture data only)
 *   lng=de              the interface language
 *   gates=open          the plan strip as it reads once every sale gate is open
 *                       (no seller identity is invented: the gates are passed
 *                       as booleans)
 */
import "../lib/storage-guard";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import "../index.css";
import i18n from "../i18n";
import { applyTheme, resolveTheme } from "../lib/theme";
import { AuthProvider } from "@/contexts/AuthContext";
import HomePage from "@/pages/home/HomePage";
import type { SaleGates } from "@/lib/home/sale-gates";
import { installFixture, type RowsMode } from "./preview-data";

const params = new URLSearchParams(window.location.search);
applyTheme(resolveTheme(window.location.search));

if (params.get("data") !== "live") {
  installFixture({ rows: (params.get("rows") as RowsMode | null) ?? "fixture" });
}
const lng = params.get("lng");
if (lng) void i18n.changeLanguage(lng);

const OPEN_GATES: SaleGates = { seller: true, fullAnalysisOnSale: true, proOnSale: true, fullAnalysisDelivers: true, alertsStatable: true };
const gates = params.get("gates") === "open" ? OPEN_GATES : undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <BrowserRouter>
            <HomePage loadRowsForAutomation gates={gates} />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </HelmetProvider>
  </StrictMode>,
);
