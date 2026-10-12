/**
 * Pieces the sign-in page and its gated parts share: the card, the waiting
 * line, the button and field styles (44px targets), and one sentence for
 * each auth-server refusal. Nothing here names a sign-in method, so nothing
 * here needs a switch.
 */
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { postTrackEvent } from "@/lib/track-transport";
import { AUTH_SUPPORT_EMAIL } from "@/config/auth-providers";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const primaryBtn = "w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";
export const quietBtn = "min-h-[44px] px-2 text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded";
export const inputCls = "w-full min-h-[44px] pl-9 pr-3 py-2.5 rounded-lg bg-background border border-border text-base sm:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
export const eyeBtn = "absolute right-1 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-muted-foreground hover:text-foreground rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-6">{children}</div>;
}

export function Working({ text }: { text: string }) {
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {text}
      </p>
    </Card>
  );
}

export type Tr = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

/**
 * A message kept as the call that writes it, not as its text, so a notice set
 * before the reader's language arrived is written in that language on the
 * next render (S12-183), never frozen in English.
 */
export type Msg = (t: Tr) => string;

/** True for the auth server's "slow down" answers. */
export function isRateLimited(message: string | null | undefined): boolean {
  return /rate limit|too many|429/i.test(String(message ?? ""));
}

/** One sentence for an auth server refusal. Never says whether the address has an account. */
export function explainAuthError(t: Tr, message: string | null | undefined): string {
  const m = String(message ?? "");
  if (isRateLimited(m)) return t("auth.rateLimited", "Too many attempts in a short time. Please wait a few minutes and try again.");
  if (/weak|should be at least|pwned|known to be|easy to guess/i.test(m)) return t("auth.weakPassword", "That password is too weak or too common. Use at least 8 characters that are hard to guess.");
  if (/email not confirmed/i.test(m)) return t("auth.notConfirmed", "This address isn't confirmed yet. Use the link in the confirmation email (it may be in spam).");
  if (/invalid login credentials|invalid_credentials/i.test(m)) return t("auth.mismatch", "We couldn't sign you in with that email and password.");
  if (/should be different|same_password/i.test(m)) return t("auth.samePassword", "Choose a password you haven't used here before.");
  return t("auth.genericError", "Something went wrong. Please try again.");
}

/**
 * ONE SENTENCE FOR A MAIL THE AUTH SERVER DID NOT ACCEPT (review of R1,
 * decision 6). "On its way" shows only after the request was accepted; a
 * refusal that is not a rate limit (the mailer refused, the network failed) is
 * said plainly, with the address that reaches a person. The auth server
 * answers an unknown address like a known one, so this reveals no account.
 */
export function explainSendError(t: Tr, message: string | null | undefined): string {
  if (isRateLimited(message)) return t("auth.rateLimited", "Too many attempts in a short time. Please wait a few minutes and try again.");
  return t("auth.sendFailed", "We couldn't send that just now. Try again in a minute, or email {{support}}.", { support: AUTH_SUPPORT_EMAIL });
}

/** Auth funnel telemetry: sign-ups fail silently in the wild otherwise. */
export function trackAuth(event: string, detail?: string): void {
  try {
    postTrackEvent({ testName: "auth_funnel", variant: event.slice(0, 30), eventType: "conversion", metadata: { detail: detail?.slice(0, 120) ?? null } });
  } catch { /* never block auth on telemetry */ }
}
