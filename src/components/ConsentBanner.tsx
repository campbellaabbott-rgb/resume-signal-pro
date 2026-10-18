/**
 * THE ANALYTICS CHOICE (S12-011; owner decision 2026-10-12; plan CP-039).
 *
 * Our own analytics (a visitor id kept in this browser, and page and funnel
 * events sent to us) run only after a yes here (src/lib/consent.ts gates the
 * transport). The banner shows until the visitor chooses, on every page; the
 * Privacy page's "Change my analytics choice" opens it again. It says plainly
 * that the host's own analytics script is not controlled by this choice: that
 * script is the host's, and turning it off is the owner's step (decision D5).
 *
 * Mounted from src/main.tsx into its own root, after the app, so no page and
 * no route has to know about it, and the prerendered pages never carry it.
 * Every string goes through t(key, English default).
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { CONSENT_EVENT, analyticsConsent } from "@/lib/consent";
import { chooseAnalytics } from "@/lib/track-transport";

/** Fired by "Change my analytics choice" on the Privacy page. */
export const OPEN_CONSENT_EVENT = "rb:open-analytics-choice";

/** Ask for the banner again (the Privacy page's control). */
export function openConsentChoice(): void {
  try { window.dispatchEvent(new CustomEvent(OPEN_CONSENT_EVENT)); } catch { /* no window */ }
}

export function ConsentBanner() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => analyticsConsent() === "unset");

  useEffect(() => {
    const reopen = () => setOpen(true);
    const chosen = () => setOpen(false);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    window.addEventListener(CONSENT_EVENT, chosen);
    return () => {
      window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
      window.removeEventListener(CONSENT_EVENT, chosen);
    };
  }, []);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t("consent.label", "Analytics choice")}
      data-consent-banner
      className="fixed inset-x-0 bottom-0 z-[60] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 backdrop-blur p-4 shadow-lg">
        <p className="text-sm text-foreground mb-1">{t("consent.title", "May we count how this site is used?")}</p>
        <p className="text-xs text-muted-foreground mb-3">
          {t("consent.body", "If you allow it, we keep an anonymous visitor id in this browser and record which pages and steps you use, so we can see what works. Nothing is stored or sent for this until you choose, and the site works the same either way.")}{" "}
          {t("consent.host", "Our hosting provider runs its own page-visit counter, which this choice does not control.")}{" "}
          <a href="/privacy#cookies" className="text-primary underline">{t("consent.more", "Details")}</a>
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => chooseAnalytics("granted")} className="px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
            {t("consent.allow", "Allow analytics")}
          </button>
          <button type="button" onClick={() => chooseAnalytics("denied")} className="px-3.5 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-secondary/40">
            {t("consent.deny", "No thanks")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mount the banner into its own root beside the app. Never throws. */
export function mountConsentBanner(doc: Document = document): void {
  try {
    if (doc.getElementById("rb-consent-root")) return;
    const el = doc.createElement("div");
    el.id = "rb-consent-root";
    doc.body.appendChild(el);
    createRoot(el).render(<ConsentBanner />);
  } catch {
    /* no DOM: nothing to ask */
  }
}
