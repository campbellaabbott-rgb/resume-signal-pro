/**
 * YOUR DATA: EXPORT IT, OR DELETE THE ACCOUNT AND KNOW WHAT STAYS (S12-137,
 * S12-153; owner decision D9; plan CP-048, CP-H).
 *
 * The delete card said "Purchase records are retained for accounting" and
 * nothing more, its buttons were English in every locale, and a deleted
 * account's API keys kept working. delete-account now revokes the keys and
 * removes the mailing-list entries too, and this card lists exactly what goes,
 * what is cancelled and what is kept (payment records only, for the period tax
 * law sets, plus a do-not-mail note so queued mail stops). Every string goes
 * through t(key, English default).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, Loader2 } from "lucide-react";

type Props = {
  onExport: () => void | Promise<void>;
  /** Runs the delete; answers the refusal's message keys, or null when the account is gone. */
  onDelete: () => Promise<string[] | null>;
};

export function DataPrivacyCard({ onExport, onDelete }: Props) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refusal, setRefusal] = useState<string[] | null>(null);

  const run = async () => {
    setDeleting(true);
    setRefusal(null);
    const keys = await onDelete();
    setDeleting(false);
    if (keys) { setRefusal(keys); setConfirming(false); }
  };

  return (
    <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-5" id="privacy" data-privacy-card>
      <h2 className="font-semibold text-foreground text-sm mb-2">{t("accountPrivacy.title", "Your data")}</h2>
      <button type="button" onClick={() => void onExport()} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mb-4">
        <Download className="w-3.5 h-3.5" /> {t("accountPrivacy.export", "Download all my data (JSON)")}
      </button>

      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-destructive" />
        <h3 className="font-semibold text-foreground text-sm">{t("accountPage.deleteAccount", "Delete account")}</h3>
      </div>
      <ul className="text-xs text-muted-foreground space-y-1 mb-3 list-disc pl-4" data-delete-terms>
        <li>
          <span className="text-foreground font-medium">{t("accountPrivacy.deletedLabel", "Deleted:")}</span>{" "}
          {t("accountPrivacy.deletedList", "your account and sign-in; your scan history, checklist, goal, saved résumé versions and tracked applications; saved searches and alerts; any CV file you uploaded; your API and connected-AI keys, which stop working; and, once your address is proven, its mailing-list entries.")}
        </li>
        <li>
          <span className="text-foreground font-medium">{t("accountPrivacy.cancelledLabel", "Cancelled:")}</span>{" "}
          {t("accountPrivacy.cancelledList", "any subscription this account pays for, at once, so nothing more is charged.")}
        </li>
        <li>
          <span className="text-foreground font-medium">{t("accountPrivacy.keptLabel", "Kept:")}</span>{" "}
          {t("accountPrivacy.keptList", "payment records (the Stripe reference, amount, date and the address on the receipt) for as long as tax law requires, and a do-not-mail note for your address so that no mail already queued reaches it. Scan credits bought under your address without an account stay with that address.")}
        </li>
      </ul>
      <p className="text-xs text-muted-foreground mb-3">{t("accountPrivacy.cannotUndo", "This cannot be undone.")}</p>

      {refusal && <p className="text-xs text-destructive mb-3" role="alert" data-delete-refusal>{refusal.map((k) => t(k)).join(" ")}</p>}

      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)}
          className="px-3.5 py-2 rounded-lg border border-destructive/30 text-destructive text-xs font-semibold hover:bg-destructive/10 transition-colors">
          {t("accountPrivacy.deleteStart", "Delete my account")}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void run()} disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 disabled:opacity-60 transition-colors">
            {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
            {t("accountPrivacy.deleteConfirm", "Yes, delete my account")}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={deleting}
            className="px-3.5 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
            {t("accountPrivacy.cancel", "Cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
