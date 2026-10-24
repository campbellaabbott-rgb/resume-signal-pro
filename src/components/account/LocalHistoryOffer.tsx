/**
 * WHAT THIS BROWSER HOLDS, OFFERED TO THE ACCOUNT, NEVER TAKEN SILENTLY
 * (S12-025, wave 4 round 2 review).
 *
 * Two explicit offers on /account (src/lib/account-history-import.ts):
 *   - the scans this browser ran before signing in: added only on "Add them to
 *     my account", and "Not mine" stops the offer for this account; a scan
 *     another account added is never offered;
 *   - the résumé this tab scanned last: saved as a résumé version only on
 *     "Save it", the opt-in exception to "never stored", with the score of the
 *     scan of that exact text (offered only when there is one).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScanHistoryEntry } from "@/hooks/use-scan-history";
import {
  declineLastScanResume, declineLocalScans, importLocalScans, saveLastScanResume,
} from "@/lib/account-history-import";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

export function LocalHistoryOffer<T>({
  db, userId, offeredScans, offeredResume, mapRow, onScans,
}: {
  db: Db;
  userId: string;
  offeredScans: ScanHistoryEntry[];
  offeredResume: { text: string; score: number } | null;
  mapRow: (row: never) => T;
  onScans: (list: T[]) => void;
}) {
  const { t } = useTranslation();
  const [scansOpen, setScansOpen] = useState(offeredScans.length > 0);
  const [resumeState, setResumeState] = useState<"offer" | "saving" | "saved" | "gone">(offeredResume ? "offer" : "gone");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!scansOpen && resumeState === "gone") return null;

  const addScans = async () => {
    setBusy(true);
    setFailed(false);
    const list = await importLocalScans(db, userId, offeredScans, mapRow);
    setBusy(false);
    if (!list) { setFailed(true); return; }
    if (list.length) onScans(list);
    setScansOpen(false);
  };

  const saveResume = async () => {
    if (!offeredResume) return;
    setResumeState("saving");
    setFailed(false);
    const { text, score } = offeredResume;
    const day = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const label = t("accountPage.lastResumeLabelScored", "Last scan, {{day}}: scored {{score}}", { day, score });
    const ok = await saveLastScanResume(db, userId, text, score, label);
    if (!ok) { setResumeState("offer"); setFailed(true); return; }
    setResumeState("saved");
  };

  return (
    <div className="space-y-3 mb-6" data-local-history-offer>
      {scansOpen && (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4" data-local-scans-offer>
          <p className="text-sm font-semibold text-foreground mb-1">
            {t("accountPage.localScansOfferTitle", "Scans found in this browser: {{count}}", { count: offeredScans.length })}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            {t("accountPage.localScansOfferBody", "They were run on this browser before you signed in. Add them to your account only if they are yours.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void addScans()} data-local-scans-add
              className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
              {t("accountPage.localScansAdd", "Add them to my account")}
            </button>
            <button type="button" disabled={busy} onClick={() => { declineLocalScans(userId); setScansOpen(false); }} data-local-scans-decline
              className="px-3.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">
              {t("accountPage.localScansNotMine", "Not mine")}
            </button>
          </div>
        </div>
      )}
      {resumeState !== "gone" && (
        <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4" data-last-resume-offer>
          {resumeState === "saved" ? (
            <p className="text-sm text-foreground">{t("accountPage.lastResumeSaved", "Saved to your account as a résumé version.")}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-foreground mb-1">{t("accountPage.lastResumeOfferTitle", "Save the résumé from your last scan?")}</p>
              <p className="text-xs text-muted-foreground mb-3">
                {t("accountPage.lastResumeOfferBody", "This tab still holds the résumé you just scanned. Save it to your account to tailor applications and score jobs against it. Nothing is stored unless you choose to.")}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={resumeState === "saving"} onClick={() => void saveResume()} data-last-resume-save
                  className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
                  {t("accountPage.lastResumeSave", "Save it")}
                </button>
                <button type="button" disabled={resumeState === "saving"} onClick={() => { declineLastScanResume(userId); setResumeState("gone"); }} data-last-resume-decline
                  className="px-3.5 py-1.5 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50">
                  {t("accountPage.lastResumeNo", "No thanks")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {failed && <p className="text-xs text-destructive" role="alert">{t("accountPage.localOfferFailed", "That didn't work. Try again in a minute.")}</p>}
    </div>
  );
}
