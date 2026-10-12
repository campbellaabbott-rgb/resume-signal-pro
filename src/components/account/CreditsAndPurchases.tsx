/**
 * THE ACCOUNT'S CREDITS AND ORDERS (platform sweep L3-22, L6-12; S12-002,
 * S12-155; plan CP-H).
 *
 * L6-12. An Agent Pass is an agent_passes row, never a purchased_content row,
 * so a $29 buyer read "No purchases yet". get-account-data returns the
 * account's passes, listed here with their state and a link to the pass page.
 *
 * S12-002. The copy told every unproven account to "sign in with Google"
 * while no Google control existed. It now names only what is live: when a
 * sign-in that proves the mailbox is switched on (src/config/auth-providers.ts)
 * it says to sign back in with it, and while none is, it says how to open a
 * purchase meanwhile. Orders carry their status, amount and a link
 * (OrdersList).
 *
 * S12-155. A failed get-account-data read used to show "0 credits, no
 * purchases": a buyer was told they owned nothing. A failed read now says so,
 * with Try again.
 *
 * Scan packs are no longer sold (owner decision 2026-10-12), so the card
 * offers no pack: credits already bought stay spendable.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Coins, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { AUTH_SUPPORT_EMAIL, CODE_SIGN_IN_LIVE, GOOGLE_SIGN_IN_LIVE, RECOVERY_LIVE } from "@/config/auth-providers";
import { OrdersList, type AccountOrder } from "@/components/account/OrdersList";

export type AccountPass = { date: string; state: "unactivated" | "live" | "closed" };

type Props = {
  fetching: boolean;
  account: {
    credits: number;
    purchases: Array<{ product: string; date: string }>;
    passes: AccountPass[];
    orders?: AccountOrder[];
    mailboxProven?: boolean;
  } | null;
  /** The signed-in account's address. */
  email: string;
  /** get-account-data failed: say so, never "nothing". */
  failed?: boolean;
  onRetry?: () => void;
};

/** True while some sign-in that proves the mailbox is live on /auth. */
export const MAILBOX_PROOF_LIVE: boolean = GOOGLE_SIGN_IN_LIVE || CODE_SIGN_IN_LIVE || RECOVERY_LIVE;

export function CreditsAndPurchases({ fetching, account, failed = false, onRetry }: Props) {
  const { t } = useTranslation();
  const purchases = account?.purchases ?? [];
  const passes = account?.passes ?? [];
  const orders = account?.orders ?? null;
  const unproven = account?.mailboxProven === false;
  const proveHow = MAILBOX_PROOF_LIVE
    ? t("accountPage.proveLive", "Sign out, then sign back in with that address using an option on the sign-in page that emails you or that your provider verifies: either one proves the address is yours.")
    : t("accountPage.proveNotYet", "Until this page can check that the address is yours, open each purchase from the link in its email, or write to {{support}} from that address.", { support: AUTH_SUPPORT_EMAIL });

  if (failed) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.03] p-5 mb-6" role="alert" data-account-load-failed>
        <p className="text-sm font-semibold text-foreground mb-1">{t("accountPage.loadFailedTitle", "We couldn't load your credits and purchases")}</p>
        <p className="text-xs text-muted-foreground mb-3">
          {t("accountPage.loadFailedBody", "Nothing is lost: this is a problem reading them, not what you own. Try again in a moment.")}
        </p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-secondary/40">
            <RefreshCw className="w-3.5 h-3.5" /> {t("accountPage.tryAgain", "Try again")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4 mb-6" id="orders">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <Coins className="w-4 h-4 text-warning" />
          <h2 className="font-semibold text-foreground text-sm">{t("accountPage.credits", "Scan credits")}</h2>
        </div>
        <p className="text-3xl font-bold text-foreground mb-1">{fetching ? "…" : account?.credits ?? 0}</p>
        <p className="text-xs text-muted-foreground">
          {unproven
            ? `${t("accountPage.creditsUnproven", "Credits bought in a browser where you're signed in follow your account and never expire. Credits bought under your email address count here once the address is proven.")} ${proveHow}`
            : t("accountPage.creditsProven", "Credits bought on this account or under its email address count here and never expire.")}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <ShoppingBag className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">{t("accountPage.purchases", "Purchases")}</h2>
        </div>
        {fetching ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : (orders ? orders.length : purchases.length) + passes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {unproven
              ? `${t("accountPage.purchasesUnproven", "Purchases made under your email address show here once the address is proven.")} ${proveHow}`
              : t("accountPage.purchasesEmpty")}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {passes.map((p, i) => (
              <Link
                key={`pass-${i}`}
                to="/agents/pass"
                className="flex items-center justify-between text-xs border border-border/50 rounded-lg px-2.5 py-1.5 hover:bg-secondary/40"
              >
                <span className="text-foreground truncate">
                  {t("accountPage.passRow")} · {t(`accountPage.passState.${p.state}`)}
                </span>
                <span className="text-muted-foreground shrink-0 ml-2">{new Date(p.date).toLocaleDateString()}</span>
              </Link>
            ))}
            {orders ? (
              <OrdersList orders={orders} />
            ) : (
              purchases.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs border border-border/50 rounded-lg px-2.5 py-1.5">
                  <span className="text-foreground truncate">{p.product}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">{new Date(p.date).toLocaleDateString()}</span>
                </div>
              ))
            )}
            {unproven && (
              <p className="text-[11px] text-muted-foreground pt-1">
                {t("accountPage.ordersMoreOnProof", "Purchases made under your email address are added once the address is proven.")} {proveHow}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
