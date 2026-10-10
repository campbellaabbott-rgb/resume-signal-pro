/**
 * THE 14-DAY WITHDRAWAL, ON THE ACCOUNT PAGE (owner decision 3, 2026-10-08).
 *
 * Renders nothing while the EU/UK switch is off (VITE_EU_UK_SALES, off until
 * the owner registers for VAT). With it on, the page first asks the function
 * for a preview, and the panel shows only when a plan qualifies (bought in the
 * last 14 days by a buyer billed in the EU, the EEA or the UK) or one on the
 * address is not linked: a buyer elsewhere has no such right and is offered
 * none. Then one button that asks withdraw-subscription to cancel every plan
 * that qualifies and refund what was paid less the days provided, and says
 * what happened from the server's answer, never from a guess.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Undo2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EU_UK_SALES_ON, WITHDRAWAL_DAYS } from "@/config/eu-consumer";

type Withdrawn = { subscription: string; refunded: number; currency: string };
type Outcome =
  | { kind: "done"; withdrawn: Withdrawn[] }
  | { kind: "none" | "notLinked" | "outsideTerritory" | "failed" };

const outcomeOf = (reason: unknown): Outcome =>
  ({ kind: reason === "plan_not_linked" ? "notLinked" : reason === "outside_territory" ? "outsideTerritory" : "none" });

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};

export function WithdrawalPanel() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // What the preview found: offer the button, say a plan is not linked, or show nothing.
  const [offer, setOffer] = useState<"withdraw" | "notLinked" | null>(null);
  useEffect(() => {
    if (!EU_UK_SALES_ON) return;
    let live = true;
    supabase.functions.invoke("withdraw-subscription", { body: { preview: true } })
      .then(({ data, error }) => {
        const d = data as { eligible?: number; reason?: string } | null;
        if (!live || error || !d) return;
        setOffer((d.eligible ?? 0) > 0 ? "withdraw" : d.reason === "plan_not_linked" ? "notLinked" : null);
      })
      .catch(() => { /* no preview: no panel */ });
    return () => { live = false; };
  }, []);
  if (!EU_UK_SALES_ON || !offer) return null;

  const withdraw = async () => {
    if (!window.confirm(t("accountPage.withdraw.confirm"))) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("withdraw-subscription", { body: {} });
      const d = data as { withdrawn?: Withdrawn[]; reason?: string } | null;
      if (error || !d || !Array.isArray(d.withdrawn)) setOutcome({ kind: "failed" });
      else if (d.withdrawn.length) setOutcome({ kind: "done", withdrawn: d.withdrawn });
      else setOutcome(outcomeOf(d.reason));
    } catch {
      setOutcome({ kind: "failed" });
    } finally {
      setBusy(false);
    }
  };

  const refunded = outcome?.kind === "done" ? outcome.withdrawn.filter((w) => w.refunded > 0) : [];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6" data-testid="withdrawal-panel">
      <div className="flex items-center gap-2 mb-2">
        <Undo2 className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountPage.withdraw.title", { days: WITHDRAWAL_DAYS })}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{t("accountPage.withdraw.body", { days: WITHDRAWAL_DAYS })}</p>
      {outcome || offer === "notLinked" ? (
        <p className="text-xs text-foreground" role="status">
          {!outcome
            ? t("accountPage.withdraw.notLinked")
            : outcome.kind === "done"
            ? refunded.length
              ? t("accountPage.withdraw.done", { amount: refunded.map((w) => money(w.refunded, w.currency)).join(", ") })
              : t("accountPage.withdraw.doneNoRefund")
            : t(`accountPage.withdraw.${outcome.kind}`, { days: WITHDRAWAL_DAYS })}
        </p>
      ) : (
        <button
          type="button"
          onClick={withdraw}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-secondary/40 disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {t("accountPage.withdraw.button")}
        </button>
      )}
    </div>
  );
}
