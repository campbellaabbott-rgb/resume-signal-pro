/**
 * ONE ROW PER ORDER, SAYING WHAT BECAME OF IT (S12-002; plan CP-022, CP-050).
 *
 * Account purchase rows had no link, amount, status or receipt (S11-096). Each
 * row now shows the product, the date, the amount when we hold it, and its
 * status as get-account-data derived it from the delivery record: preparing,
 * ready, needs your résumé, couldn't be made, refunded, or included with Pro.
 * A one-off opens with the same link its purchase mail carries
 * (_shared/purchase-links.ts, one definition for both). Receipt asks
 * account-order for the Stripe receipt of an order this account owns; Email
 * it again sends a saved copy to the order's own address, three a day. Report
 * a problem opens a mail to support naming the product, the date and the
 * order's last eight characters: never the whole session id, which opens the
 * purchase for whoever holds it.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { purchaseLinkFor } from "../../../supabase/functions/_shared/purchase-links";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";

export type AccountOrder = {
  id: string;
  sessionId: string | null;
  product: string;
  productType: string | null;
  date: string;
  status: "preparing" | "ready" | "needs_resume" | "failed" | "refunded" | "included";
  amountCents: number | null;
  currency: string | null;
};

const STATUS_STYLE: Record<AccountOrder["status"], string> = {
  preparing: "bg-warning/10 text-warning",
  ready: "bg-success/10 text-success",
  needs_resume: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  refunded: "bg-muted text-muted-foreground",
  included: "bg-primary/10 text-primary",
};

/** The site path a purchase mail's link opens, for a router link. */
export function orderPath(o: Pick<AccountOrder, "productType" | "sessionId">): string | null {
  if (!o.sessionId) return null;
  const href = purchaseLinkFor(o.productType, o.sessionId);
  try {
    const u = new URL(href);
    return `${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/**
 * A mail to support about one order. It names the product, the date and a
 * reference of the order's last eight characters, enough for support to find
 * it, and never the whole session id.
 */
export function reportProblemHref(o: Pick<AccountOrder, "id" | "sessionId" | "product" | "date">, subject: string): string {
  const ref = String(o.sessionId ?? o.id).slice(-8);
  const day = Number.isFinite(Date.parse(o.date)) ? new Date(o.date).toISOString().slice(0, 10) : "";
  const line = [subject, o.product, day, ref].filter(Boolean).join(" · ");
  return `mailto:${AUTH_SUPPORT_EMAIL}?subject=${encodeURIComponent(line)}`;
}

function money(cents: number | null, currency: string | null): string | null {
  if (typeof cents !== "number" || cents <= 0 || !currency) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function OrdersList({ orders }: { orders: AccountOrder[] }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const statusLabel: Record<AccountOrder["status"], string> = {
    preparing: t("orders.statusPreparing", "Preparing"),
    ready: t("orders.statusReady", "Ready"),
    needs_resume: t("orders.statusNeedsResume", "Needs your résumé"),
    failed: t("orders.statusFailed", "Couldn't be made"),
    refunded: t("orders.statusRefunded", "Refunded"),
    included: t("orders.statusIncluded", "Included with Pro"),
  };

  const act = async (o: AccountOrder, action: "receipt" | "mail_again") => {
    if (!o.sessionId) return;
    setBusy(`${o.id}:${action}`);
    try {
      const { data, error } = await supabase.functions.invoke("account-order", { body: { action, sessionId: o.sessionId } });
      const body = data as { url?: string; sent?: boolean; error?: string } | null;
      if (error || !body) {
        let message: string | undefined;
        try { message = ((await (error as { context?: Response } | null)?.context?.clone().json()) as { error?: string } | undefined)?.error; } catch { /* no body */ }
        toast.error(message ?? t("orders.actionFailed", "That didn't work. Try again in a minute."));
        return;
      }
      if (action === "receipt" && body.url) window.open(body.url, "_blank", "noopener");
      if (action === "mail_again" && body.sent) toast.success(t("orders.mailedAgain", "On its way to the address you bought it with."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="space-y-1.5" data-orders>
      {orders.map((o) => {
        const path = orderPath(o);
        const price = money(o.amountCents, o.currency);
        return (
          <li key={o.id} className="text-xs border border-border/50 rounded-lg px-2.5 py-1.5" data-order={o.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground truncate">{o.product}</span>
              <span className="text-muted-foreground shrink-0">{new Date(o.date).toLocaleDateString()}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[o.status]}`} data-status={o.status}>{statusLabel[o.status]}</span>
              {price && <span className="text-muted-foreground">{price}</span>}
              {path && o.status !== "refunded" && (
                <a href={path} className="text-primary hover:underline">{t("orders.open", "Open")}</a>
              )}
              {o.sessionId && o.status === "ready" && (
                <button type="button" disabled={busy !== null} onClick={() => void act(o, "mail_again")} className="text-primary hover:underline disabled:opacity-50">
                  {t("orders.mailAgain", "Email it again")}
                </button>
              )}
              {o.sessionId && (o.amountCents ?? 0) > 0 && (
                <button type="button" disabled={busy !== null} onClick={() => void act(o, "receipt")} className="text-primary hover:underline disabled:opacity-50">
                  {t("orders.receipt", "Receipt")}
                </button>
              )}
              {o.status !== "included" && (
                <a href={reportProblemHref(o, t("orders.reportSubject", "A problem with my order"))} className="text-muted-foreground hover:text-foreground hover:underline" data-report-problem>
                  {t("orders.reportProblem", "Report a problem")}
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
