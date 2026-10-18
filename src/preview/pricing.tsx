/**
 * THE /pricing PREVIEW (development only; preview-pricing.html at the repo
 * root loads this). It mounts the real PricingPage inside the app's providers
 * so the new page can be seen and screenshotted before App.tsx routes to it.
 *
 *   (default)     the shipped state: src/config/seller.ts as it is (today:
 *                 empty, so no buy button renders and each paid card says
 *                 purchases open soon).
 *   ?state=open   the buy buttons render, as they will once the seller's name
 *                 and address are set. Labelled as a preview in every buy
 *                 block and in the bar: it is not the shipped state, no seller
 *                 value is invented, and Go Pro and Buy start nothing here.
 *   ?lng=de       the page in another of the nine languages.
 *   ?fixture=1    a fixed open-postings figure (preview-network.ts).
 *   ?bare=1       no preview bar (the in-card labels of ?state=open stay).
 */
import "@/lib/storage-guard";
import "./preview-network";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import i18n from "@/i18n";
import { applyTheme, resolveTheme } from "@/lib/theme";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster as Sonner } from "@/components/ui/sonner";
import PricingPage from "@/pages/pricing/PricingPage";

const params = new URLSearchParams(window.location.search);
const open = params.get("state") === "open";
const bare = params.get("bare") === "1";
const lng = params.get("lng");

applyTheme(resolveTheme(window.location.search));

const queryClient = new QueryClient();

function PreviewLabel() {
  return (
    <p className="mb-2.5 rounded-md border border-dashed border-warning px-3 py-2 text-xs text-warning" data-preview-label="">
      Preview only: buttons show as they will once the seller&apos;s name and address are set in src/config/seller.ts. Not the shipped state; nothing starts from here.
    </p>
  );
}

function SellerNote() {
  return (
    <p className="mt-1 rounded-sm border border-dashed border-border-strong px-2 py-1 text-xs text-subtle-foreground" data-preview-seller="">
      Preview: the &quot;Sold by&quot; line, with the seller&apos;s name and address, prints here once both are set.
    </p>
  );
}

const pressListeners = new Set<(s: string) => void>();

function PreviewBar() {
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    pressListeners.add(setSaid);
    return () => {
      pressListeners.delete(setSaid);
    };
  }, []);
  if (bare) return null;
  const href = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(next)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const s = p.toString();
    return `${window.location.pathname}${s ? `?${s}` : ""}`;
  };
  return (
    <div role="region" aria-label="Preview controls" className="fixed inset-x-0 bottom-0 z-toast border-t border-warning bg-background px-4 py-2 text-xs text-foreground">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-1">
        <b className="text-warning">Pricing preview</b>
        <a className="inline-flex min-h-6 items-center underline" href={href({ state: null })} aria-current={!open ? "page" : undefined}>
          Seller details missing (as shipped)
        </a>
        <a className="inline-flex min-h-6 items-center underline" href={href({ state: "open" })} aria-current={open ? "page" : undefined}>
          With buy buttons (preview only)
        </a>
        {said ? <span role="status">{said}</span> : null}
      </div>
    </div>
  );
}

async function start() {
  if (lng) await i18n.changeLanguage(lng);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Sonner />
            <BrowserRouter>
              <PricingPage
                gateInput={open ? { previewOpen: true } : undefined}
                preview={open ? { label: <PreviewLabel />, sellerNote: <SellerNote /> } : undefined}
                onPreviewPress={() => pressListeners.forEach((l) => l("Preview: Go Pro starts nothing here."))}
              />
              <PreviewBar />
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </StrictMode>,
  );
}

void start();
