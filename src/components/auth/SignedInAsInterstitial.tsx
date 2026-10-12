/**
 * "YOU'RE SIGNED IN AS a***@domain" (login-CSRF protection, Account UX spec 4).
 *
 * Shown when a session arrives from a link or a provider return that this
 * browser did not start (no pending-sign-in marker), and after a confirmation
 * link pressed without one. A crafted link could otherwise sign a person into
 * the sender's account, where anything they then upload is the sender's to
 * read. The address is masked: whoever holds the link learns nothing new.
 *
 * Rendered as a modal over whatever page the link opened, by AuthProvider (a
 * stashed session) or by the sign-in page (a confirmation link).
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, UserCheck } from "lucide-react";
import { useAuthStrings } from "@/i18n/auth/load";

type Props = {
  maskedEmail: string;
  busy?: boolean;
  onContinue: () => void;
  onSignOut: () => void;
  /** Rendered inline (inside the sign-in card) rather than as a modal over the page. */
  inline?: boolean;
};

export function SignedInAsInterstitial({ maskedEmail, busy = false, onContinue, onSignOut, inline = false }: Props) {
  const { t } = useTranslation();
  useAuthStrings();
  const continueRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { continueRef.current?.focus(); }, []);

  // A modal keeps focus on its two choices (WCAG 2.4.3): Tab and Shift+Tab
  // cycle between them, and nothing behind the prompt is reachable.
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (inline || e.key !== "Tab") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    if (buttons.length === 0) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const body = (
    <div
      onKeyDown={trap}
      role={inline ? "region" : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-labelledby="rb-signed-in-as-title"
      aria-describedby="rb-signed-in-as-body"
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-left shadow-xl"
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <UserCheck className="h-6 w-6 text-primary" aria-hidden="true" />
      </div>
      <h2 id="rb-signed-in-as-title" className="mb-2 text-lg font-semibold text-foreground">
        {t("auth.interstitial.title", "You're signed in as {{email}}", { email: maskedEmail || "…" })}
      </h2>
      <p id="rb-signed-in-as-body" className="mb-5 text-sm text-muted-foreground">
        {t("auth.interstitial.body", "This sign-in came from a link this browser didn't ask for. Continue only if this is your account.")}
      </p>
      <button
        ref={continueRef}
        type="button"
        onClick={onContinue}
        disabled={busy}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {t("auth.interstitial.continue", "Continue")}
      </button>
      <button
        type="button"
        onClick={onSignOut}
        disabled={busy}
        className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        {t("auth.interstitial.notYou", "Not you? Sign out")}
      </button>
    </div>
  );

  if (inline) return body;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      {body}
    </div>
  );
}
