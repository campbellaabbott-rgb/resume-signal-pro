/**
 * THE EMAILED CODE: TYPED, PASTED OR FILLED BY THE PHONE (Account UX spec 1-2).
 *
 * One field rather than six boxes: it takes a pasted code with spaces or
 * dashes, the phone's one-time-code autofill, and any length the project's
 * OTP setting chooses (6 to 10 digits). The copy never claims the mail went
 * out: it says a code is on its way IF the address can sign in, which is true
 * whether or not an account exists (no enumeration), and offers a resend
 * after a minute and the support address after that.
 *
 * Used by the code sign-in (behind CODE_SIGN_IN_LIVE) and the password reset
 * (behind RECOVERY_LIVE). The parent sends the mail and verifies the code;
 * this component owns the field, the countdown and the words.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";
import { AUTH_SUPPORT_EMAIL, RESEND_AFTER_SECONDS } from "@/config/auth-providers";

/** Digits only, at most ten: "123 456" and "123-456" are the code 123456. */
export function normalizeCode(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 10);
}

export const MIN_CODE_LENGTH = 6;

type Props = {
  purpose: "signin" | "recovery";
  busy?: boolean;
  error?: string | null;
  onSubmit: (code: string) => void | Promise<void>;
  onResend: () => void | Promise<void>;
  onBack: () => void;
  onUsePassword?: () => void;
  /** Seconds before resend is offered (tests shorten it). */
  resendAfter?: number;
};

export function CodeEntry({ purpose, busy = false, error = null, onSubmit, onResend, onBack, onUsePassword, resendAfter = RESEND_AFTER_SECONDS }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const inputId = `${id}-code`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [code, setCode] = useState("");
  const [left, setLeft] = useState(resendAfter);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    setLocalError(null);
    if (code.length < MIN_CODE_LENGTH) {
      setLocalError(t("auth.code.tooShort", "Enter the whole code from the email."));
      return;
    }
    void onSubmit(code);
  };

  const resend = async () => {
    setLeft(resendAfter);
    setCode("");
    await onResend();
  };

  const shownError = localError ?? error;
  // The mail may carry a link, a code, or both: until notify.resumebooster.work
  // is verified it comes from Lovable's default sender, whose template prints
  // only a link; ours prints the code above the link. So the copy promises
  // "a link (or a 6-digit code)" and either one works here: the code in this
  // field, the link through the confirm page (lead decision C).
  const onItsWay = purpose === "recovery"
    ? t("auth.reset.onItsWay", "If an account exists for this address, check your email for a link (or a 6-digit code). Either one lets you choose a new password. It usually arrives within a minute.")
    : t("auth.code.onItsWay", "If this address can sign in, check your email for a link (or a 6-digit code). Either one signs you in. It usually arrives within a minute.");

  return (
    <form onSubmit={submit} noValidate>
      <p id={hintId} className="mb-4 text-sm text-muted-foreground" aria-live="polite">{onItsWay}</p>
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-foreground">
        {t("auth.code.label", "Code from the email")}
      </label>
      <div className="relative mb-3">
        <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id={inputId}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 \-]*"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${hintId} ${errorId}` : hintId}
          className="min-h-[44px] w-full rounded-lg border border-border bg-background py-2.5 pl-9 pr-3 text-base tracking-[0.3em] text-foreground placeholder:tracking-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          placeholder={t("auth.code.placeholder", "123456")}
        />
      </div>
      {shownError && <p id={errorId} role="alert" className="mb-3 text-xs text-destructive">{shownError}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {purpose === "recovery" ? t("auth.reset.verify", "Continue") : t("auth.code.verify", "Sign in")}
      </button>
      <div className="mt-3 flex flex-col items-center gap-1 text-xs">
        {left > 0 ? (
          <p className="text-muted-foreground" aria-live="off">
            {t("auth.code.resendIn", "You can ask for a new code in {{seconds}} s.", { seconds: left })}
          </p>
        ) : (
          <>
            <button type="button" onClick={() => void resend()} disabled={busy} className="min-h-[44px] px-2 text-primary hover:underline disabled:opacity-60">
              {t("auth.code.resend", "Ask for a new code")}
            </button>
            <p className="text-center text-muted-foreground">
              {t("auth.code.stillNothing", "Still nothing? Check your spam folder, or email")}{" "}
              <a href={`mailto:${AUTH_SUPPORT_EMAIL}`} className="underline">{AUTH_SUPPORT_EMAIL}</a>
            </p>
          </>
        )}
        <button type="button" onClick={onBack} className="min-h-[44px] px-2 text-primary hover:underline">
          {t("auth.code.wrongAddress", "Wrong address?")}
        </button>
        {onUsePassword && (
          <button type="button" onClick={onUsePassword} className="min-h-[44px] px-2 text-primary hover:underline">
            {t("auth.usePassword", "Use a password instead")}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * The code sign-in's own words on the first screen: the primary button's
 * label while the code leads, and the switch between the code and the
 * password. Rendered by /auth only while CODE_SIGN_IN_LIVE is true.
 */
export function CodeSendLabel() {
  const { t } = useTranslation();
  return <>{t("auth.code.send", "Email me a sign-in code")}</>;
}

export function CodeSignInToggle({ passwordOpen, onToggle, className }: { passwordOpen: boolean; onToggle: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={className} onClick={onToggle}>
      {passwordOpen ? t("auth.code.instead", "Email me a sign-in code instead") : t("auth.usePassword", "Use a password instead")}
    </button>
  );
}
