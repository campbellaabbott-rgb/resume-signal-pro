/**
 * THE ACCOUNT'S CREDITS AND PURCHASES (platform sweep L3-22, L6-12).
 *
 * L3-22. "Get more credits" linked to /pricing, which sells no scan credits:
 * the only way to buy them was the header's coin widget, which nothing
 * pointed to. The pack dialog now opens here, with the account's address as
 * the receipt address.
 *
 * L6-12. An Agent Pass is an agent_passes row, never a purchased_content row,
 * so a $29 buyer read "No purchases yet. Anything you buy with this email
 * shows up here." get-account-data now returns the account's passes, listed
 * here with their state and a link to the pass page.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Coins, Loader2, ShoppingBag } from "lucide-react";
import { ScanPackPurchase } from "@/components/ScanPackPurchase";

export type AccountPass = { date: string; state: "unactivated" | "live" | "closed" };

type Props = {
  fetching: boolean;
  account: {
    credits: number;
    purchases: Array<{ product: string; date: string }>;
    passes: AccountPass[];
    mailboxProven?: boolean;
  } | null;
  /** The signed-in account's address, offered as the receipt address. */
  email: string;
};

export function CreditsAndPurchases({ fetching, account, email }: Props) {
  const { t } = useTranslation();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const purchases = account?.purchases ?? [];
  const passes = account?.passes ?? [];

  return (
    <div className="grid sm:grid-cols-2 gap-4 mb-6">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <Coins className="w-4 h-4 text-warning" />
          <h2 className="font-semibold text-foreground text-sm">{t("accountPage.credits", "Scan credits")}</h2>
        </div>
        <p className="text-3xl font-bold text-foreground mb-1">{fetching ? "…" : account?.credits ?? 0}</p>
        <p className="text-xs text-muted-foreground mb-3">
          {account?.mailboxProven === false
            ? "Credits bought in a browser where you're signed in follow your account and never expire. Credits under your email address count here once it's confirmed: sign in with Google using it."
            : "Credits are linked to your email and never expire."}
        </p>
        <button
          type="button"
          onClick={() => setCreditsOpen(true)}
          className="inline-block px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          {t("accountPage.getMoreCredits")}
        </button>
        <ScanPackPurchase open={creditsOpen} onOpenChange={setCreditsOpen} defaultEmail={email} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <ShoppingBag className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-foreground text-sm">{t("accountPage.purchases", "Purchases")}</h2>
        </div>
        {fetching ? (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        ) : purchases.length + passes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {account?.mailboxProven === false
              ? "Purchases made under your email address show here once this sign-in confirms the address: sign in with Google using it."
              : t("accountPage.purchasesEmpty")}
          </p>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
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
            {purchases.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs border border-border/50 rounded-lg px-2.5 py-1.5">
                <span className="text-foreground truncate">{p.product}</span>
                <span className="text-muted-foreground shrink-0 ml-2">{new Date(p.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
