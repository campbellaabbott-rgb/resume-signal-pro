/**
 * THE SAVE LINK (APPLY-1107-03, 2026-11-07).
 *
 * Nothing on the AI path kept a record of what a person applied to. The site
 * already has a free tracker (a 'saved' row in the same application tracker
 * Account shows), so a link of the form /jobs?job=<id>&save=1 opens that
 * posting with one question: save it to your tracker? It is a question and
 * never an action: a link anyone can send must not write to the reader's
 * account on load, so nothing is saved until the person presses Save. A
 * signed-out reader is sent to sign in first, and comes back to the same
 * question (the sign-in page returns to `next`).
 *
 * The board captures the request once, when it mounts: the board rewrites its
 * own address as filters change and keeps only the posting's id, so the
 * request is read before that and held in state until it is answered.
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The posting a save link asks about, or null when the address asks for no save. */
export function saveRequestFrom(search: string): string | null {
  const p = new URLSearchParams(search);
  const id = p.get("job");
  return p.get("save") === "1" && id ? id : null;
}

/** The board address that asks to save `jobId`: what the sign-in page returns to. */
export function saveLinkPath(jobId: string): string {
  return `/jobs?job=${encodeURIComponent(jobId)}&save=1`;
}

/** The sign-in address for a signed-out reader, returning to the same question. */
export function saveSignInPath(jobId: string): string {
  return `/auth?next=${encodeURIComponent(saveLinkPath(jobId))}`;
}

export function SaveFromLinkPrompt({ signedIn, onSave, onDismiss, jobId }: {
  signedIn: boolean;
  jobId: string;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("jobsPage.saveAskTitle", "Save this posting to your tracker?")} className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm space-y-2" data-save-ask="">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <Bookmark className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
        {t("jobsPage.saveAskTitle", "Save this posting to your tracker?")}
      </p>
      <p className="text-muted-foreground">
        {t("jobsPage.saveAskBody", "Your free tracker keeps what you applied to, where and when. Nothing is saved until you choose to.")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {signedIn ? (
          <Button size="sm" onClick={onSave}>{t("jobsPage.saveAskSave", "Save to my tracker")}</Button>
        ) : (
          <Button size="sm" asChild>
            <Link to={saveSignInPath(jobId)}>{t("jobsPage.saveAskSignIn", "Sign in to save it")}</Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDismiss}>{t("jobsPage.saveAskDismiss", "Not now")}</Button>
      </div>
    </div>
  );
}
