/**
 * SIGN-IN PROVIDERS, EACH BEHIND ITS OWN SWITCH (src/config/auth-providers.ts).
 *
 * Google only, and only while GOOGLE_SIGN_IN_LIVE is true: a Google sign-in
 * proves the mailbox, so it ships after the account guard serves. There is
 * no Apple or Microsoft control at all (owner decisions D10, D11). The press
 * sets the pending-sign-in marker before leaving for the provider (inside
 * AuthContext.signInWithGoogle), so the return is accepted without a question.
 */
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { GOOGLE_SIGN_IN_LIVE } from "@/config/auth-providers";

type Props = { onGoogle: () => void; busy?: boolean };

export function ProviderButtons({ onGoogle, busy = false }: Props) {
  const { t } = useTranslation();
  if (!GOOGLE_SIGN_IN_LIVE) return null;
  return (
    <div className="mb-4">
      <GoogleButton onGoogle={onGoogle} busy={busy} />
      <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {t("auth.or", "or")}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

/**
 * A RESET FOR AN ACCOUNT THAT SIGNS IN WITH GOOGLE (second recheck of R1).
 * The account guard refuses a reset's proof with no_email_identity when the
 * account has no email sign-in: there is no password to change, and every
 * new reset link is refused the same way, so the way in is Google. Nothing
 * while the switch is off (the reset page then offers support alone).
 */
export function GoogleOnlyAccount({ onGoogle, busy = false }: Props) {
  const { t } = useTranslation();
  if (!GOOGLE_SIGN_IN_LIVE) return null;
  return (
    <div>
      <p role="alert" className="text-sm text-foreground mb-4">
        {t("auth.google.onlyGoogle", "This account signs in with Google, so it has no password to change here. Continue with Google to sign in.")}
      </p>
      <GoogleButton onGoogle={onGoogle} busy={busy} />
    </div>
  );
}

function GoogleButton({ onGoogle, busy }: { onGoogle: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onGoogle}
      disabled={busy}
      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <GoogleMark />}
      {t("auth.google.continue", "Continue with Google")}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.8Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29V6.6H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.6l4.01 3.11C6.23 6.87 8.88 4.76 12 4.76Z" />
    </svg>
  );
}
