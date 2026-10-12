/**
 * PASSWORD RECOVERY (register CP-001, critical), BEHIND RECOVERY_LIVE.
 *
 * request -> code (or the emailed link) -> checking -> password -> done.
 *
 * THE ACCOUNT GUARD IS AWAITED BEFORE THE PASSWORD FORM EXISTS. A recovery
 * proves the mailbox, and the guard (auth-signed-in) answers that proof by
 * clearing any password set on the address before it was proven (D15). Were
 * the new password saved while the guard was still working, the guard could
 * clear the very password the person just chose and lock them out again. So
 * the form appears only after the guard answered "proven", and the save asks
 * once more (the same single call) before it writes. Then every other device
 * is signed out.
 *
 * Rendered by /auth only for ?mode=reset (which parses to "continue" while
 * RECOVERY_LIVE is false) and for a confirmation link of type recovery (only
 * while RECOVERY_LIVE is true). ForgotPasswordLink renders nothing while the
 * switch is off.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Session } from "@supabase/supabase-js";
import { CheckCircle2, Eye, EyeOff, Lock, Mail, ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_SUPPORT_EMAIL, MIN_PASSWORD_LENGTH, RECOVERY_LIVE } from "@/config/auth-providers";
import { DEFAULT_AFTER_AUTH, clearPendingSignIn, newestAmr, setPendingSignIn } from "@/lib/auth-fragment";
import { CodeEntry } from "@/components/auth/CodeEntry";
import { Card, EMAIL_RE, Working, explainAuthError, eyeBtn, inputCls, isRateLimited, primaryBtn, quietBtn } from "@/components/auth/shared";

/** The "Forgot password?" link under the password field; nothing while recovery is off. */
export function ForgotPasswordLink({ next, emphasis = false }: { next: string; emphasis?: boolean }) {
  const { t } = useTranslation();
  if (!RECOVERY_LIVE) return null;
  const href = `/auth?mode=reset${next !== DEFAULT_AFTER_AUTH ? `&next=${encodeURIComponent(next)}` : ""}`;
  return (
    <div className={`mb-2 text-right ${emphasis ? "font-semibold" : ""}`}>
      <Link to={href} className={`${quietBtn} inline-flex items-center`}>{t("auth.forgot", "Forgot password?")}</Link>
    </div>
  );
}

type Step = "request" | "code" | "checking" | "password" | "done" | "blocked" | "signedIn";

export function ResetFlow({ next, initialSession }: { next: string; initialSession: Session | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, loading, stashState, ensureGuard } = useAuth();
  const id = useId();
  const emailId = `${id}-email`, passwordId = `${id}-password`, errorId = `${id}-error`;
  const [step, setStep] = useState<Step>(initialSession ? "checking" : "request");
  const [recoverySession, setRecoverySession] = useState<Session | null>(initialSession);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [othersSignedOut, setOthersSignedOut] = useState(false);

  // A recovery session that came from the emailed link (adopted from the
  // stash, or accepted at the signed-in-as prompt). Any other session here is
  // an ordinary sign-in: its password is changed from the account page.
  useEffect(() => {
    if (recoverySession || loading || !session) return;
    if (stashState.kind === "adopting" || stashState.kind === "interstitial") return;
    const fromLink = stashState.kind === "adopted" && stashState.type === "recovery";
    if (fromLink || newestAmr(session.access_token) === "recovery") { setRecoverySession(session); setStep("checking"); return; }
    if (step === "request") setStep("signedIn");
  }, [session, loading, stashState, recoverySession, step]);

  useEffect(() => {
    if (step !== "checking" || !recoverySession) return;
    let live = true;
    void ensureGuard(recoverySession).then((r) => { if (live) setStep(r.state === "done" && r.proven ? "password" : "blocked"); });
    return () => { live = false; };
  }, [step, recoverySession, ensureGuard]);

  const request = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) { setError(t("auth.email.invalid", "Enter a valid email address.")); return; }
    setBusy(true);
    setPendingSignIn(next);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/auth?mode=reset` });
      if (err && isRateLimited(err.message)) { setError(explainAuthError(t, err.message)); return; }
      setStep("code");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (code: string) => {
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: "recovery" });
      if (err || !data?.session) { setError(t("auth.code.invalid", "That code didn't work. Check it, or ask for a new one.")); return; }
      clearPendingSignIn();
      setRecoverySession(data.session);
      setStep("checking");
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) { setError(t("auth.reset.tooShort", "Use at least 8 characters.")); return; }
    if (!recoverySession) { setStep("request"); return; }
    setBusy(true);
    try {
      const g = await ensureGuard(recoverySession);
      if (!(g.state === "done" && g.proven)) { setStep("blocked"); return; }
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) { setError(explainAuthError(t, err.message)); return; }
      try {
        const { error: outErr } = await supabase.auth.signOut({ scope: "others" });
        setOthersSignedOut(!outErr);
      } catch { setOthersSignedOut(false); }
      setStep("done");
    } finally {
      setBusy(false);
    }
  };

  const retryGuard = async () => {
    if (!recoverySession) { setStep("request"); return; }
    setStep("checking");
    const r = await ensureGuard(recoverySession, { fresh: true });
    setStep(r.state === "done" && r.proven ? "password" : "blocked");
  };

  const finishTarget = stashState.kind === "adopted" && stashState.next ? stashState.next : next;
  const backHref = `/auth${next !== DEFAULT_AFTER_AUTH ? `?next=${encodeURIComponent(next)}` : ""}`;

  if (step === "checking") return <Working text={t("auth.reset.checking", "Checking your account…")} />;
  if (stashState.kind === "adopting" && !recoverySession) return <Working text={t("auth.confirm.working", "Signing you in…")} />;

  return (
    <Card>
      <h1 className="text-xl font-bold text-foreground mb-3">{t("auth.reset.title", "Reset your password")}</h1>

      {step === "request" && (
        <form onSubmit={request} noValidate>
          <p className="text-xs text-muted-foreground mb-4">{t("auth.reset.intro", "Enter your email. If it has an account, we'll email a code you can use to choose a new password.")}</p>
          <label htmlFor={emailId} className="block text-xs font-medium text-foreground mb-1">{t("auth.email.label", "Email")}</label>
          <div className="relative mb-3">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input id={emailId} type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.email.placeholder", "you@example.com")} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={inputCls} />
          </div>
          {error && <p id={errorId} role="alert" className="text-xs text-destructive mb-3">{error}</p>}
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {t("auth.reset.send", "Email me a reset code")}
          </button>
        </form>
      )}

      {step === "code" && (
        <CodeEntry
          purpose="recovery"
          busy={busy}
          error={error}
          onSubmit={verify}
          onResend={() => request()}
          onBack={() => { setError(null); setStep("request"); }}
        />
      )}

      {step === "password" && (
        <form onSubmit={save} noValidate>
          <p className="flex items-start gap-2 text-xs text-muted-foreground mb-4">
            <ShieldCheck className="w-4 h-4 shrink-0 text-success" aria-hidden="true" />
            {t("auth.reset.proven", "This address is confirmed. Choose a new password.")}
          </p>
          <label htmlFor={passwordId} className="block text-xs font-medium text-foreground mb-1">{t("auth.reset.newPassword", "New password")}</label>
          <div className="relative mb-3">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input id={passwordId} type={showPassword ? "text" : "password"} name="new-password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH}
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.password.placeholder", "At least 8 characters")}
              aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className={`${inputCls} pr-12`} />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword}
              aria-label={showPassword ? t("auth.password.hide", "Hide password") : t("auth.password.show", "Show password")} className={eyeBtn}>
              {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
            </button>
          </div>
          {error && <p id={errorId} role="alert" className="text-xs text-destructive mb-3">{error}</p>}
          <button type="submit" disabled={busy} className={primaryBtn}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {t("auth.reset.save", "Set new password")}
          </button>
        </form>
      )}

      {step === "done" && (
        <div role="status">
          <p className="flex items-start gap-2 text-sm text-foreground mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-success mt-0.5" aria-hidden="true" />
            {othersSignedOut
              ? t("auth.reset.doneOthers", "Your new password is set, and every other device was signed out.")
              : t("auth.reset.done", "Your new password is set.")}
          </p>
          <button type="button" className={primaryBtn} onClick={() => navigate(finishTarget, { replace: true })}>{t("auth.continue", "Continue")}</button>
        </div>
      )}

      {step === "blocked" && (
        <div>
          <p role="alert" className="text-sm text-foreground mb-4">
            {t("auth.reset.blocked", "We couldn't confirm this address just now, so no password was set. Try again in a few minutes, or email")}{" "}
            <a className="underline" href={`mailto:${AUTH_SUPPORT_EMAIL}`}>{AUTH_SUPPORT_EMAIL}</a>
          </p>
          <button type="button" className={primaryBtn} onClick={() => void retryGuard()}>{t("auth.reset.retry", "Try again")}</button>
        </div>
      )}

      {step === "signedIn" && (
        <p className="text-sm text-foreground mb-2">
          {t("auth.reset.signedIn", "You're signed in. You can change your password in your account settings.")}{" "}
          <Link to="/account" className="underline">{t("auth.reset.toAccount", "Go to your account")}</Link>
        </p>
      )}

      {(step === "request" || step === "code") && (
        <div className="mt-3 text-center">
          <Link to={backHref} className={`${quietBtn} inline-flex items-center`}>{t("auth.back", "Back to sign in")}</Link>
        </div>
      )}
    </Card>
  );
}
