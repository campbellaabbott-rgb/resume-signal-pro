/**
 * "IS THIS YOUR ACCOUNT?" (login-CSRF protection, Account UX spec 4; review
 * of R1, decision 3).
 *
 * Shown when a link or a provider return that this browser did not start (no
 * pending-sign-in marker for that address) would sign the visitor in. A
 * crafted link could otherwise sign a person into the sender's account, where
 * anything they then upload is the sender's to read. It is asked BEFORE any
 * session exists here: the link was resolved through a client that keeps
 * nothing (src/lib/auth-probe.ts), and the address shown is the one the auth
 * server named for it, in full. Whoever holds the link already holds that
 * account, so the address tells them nothing new, while a masked one could be
 * matched by a look-alike address. "Not me" signs nothing in and touches
 * nothing of the visitor's.
 *
 * Rendered as a modal over whatever page the link opened, by AuthProvider (a
 * stashed session), or inline in the sign-in card (a confirmation link).
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, UserCheck } from "lucide-react";
import { useAuthStrings } from "@/i18n/auth/load";

type Props = {
  /** The account's full address, as the auth server named it. */
  email: string;
  busy?: boolean;
  onContinue: () => void;
  onCancel: () => void;
  /** Rendered inline (inside the sign-in card) rather than as a modal over the page. */
  inline?: boolean;
};

export function SignedInAsInterstitial({ email, busy = false, onContinue, onCancel, inline = false }: Props) {
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
        {t("auth.linkCheck.title", "Is this your account?")}
      </h2>
      <p id="rb-signed-in-as-body" className="mb-2 text-sm text-muted-foreground">
        {t("auth.linkCheck.body", "This link signs in to the account below. This browser didn't ask for it, so nothing is signed in until you say so.")}
      </p>
      <p className="mb-5 break-all text-sm font-medium text-foreground" data-testid="link-check-email">{email}</p>
      <button
        ref={continueRef}
        type="button"
        onClick={onContinue}
        disabled={busy}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {t("auth.linkCheck.continue", "Yes, continue")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        {t("auth.linkCheck.cancel", "Not me, cancel")}
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
