// Sign in / create account (R1, Account UX spec 1-4). Free accounts exist to
// track scan scores over time and surface credits + purchases; the free scan
// itself is never gated.
//
// ONE PAGE, FOUR MODES, NO NEW ROUTES (/auth?mode=...):
//   continue  one screen, email first, no sign-up/sign-in switch. The password
//             leads while the emailed code is switched off (D2).
//   reset     password recovery, behind its switch (components/auth/ResetFlow).
//   confirm   a link from the mail (token_hash + type). It signs in only when
//             the person presses Continue, so a mail scanner fetching the link
//             spends nothing. Lovable's default link (tokens in the fragment)
//             is adopted by AuthContext from the stash.
//   return    a provider's return; AuthContext adopts the stashed session when
//             this browser started the sign-in, and the page goes to the safe
//             next the pending marker carried.
// Every sign-in method other than the password lives in its own component
// behind its own switch (src/config/auth-providers.ts), so this file names
// none of them. No screen says a mail went out: it is "on its way" only if
// the address can sign in, which is as true for an address with no account.

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { EmailOtpType, Session } from "@supabase/supabase-js";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth, termsAcceptance, confirmRedirect } from "@/contexts/AuthContext";
import { PurchaseTerms } from "@/components/PurchaseTerms";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_FLAGS_MARK, AUTH_SUPPORT_EMAIL, CODE_SIGN_IN_LIVE, MIN_PASSWORD_LENGTH, RECOVERY_LIVE } from "@/config/auth-providers";
import { ProviderButtons } from "@/components/auth/ProviderButtons";
import { CodeEntry, CodeSendLabel, CodeSignInToggle } from "@/components/auth/CodeEntry";
import { ForgotPasswordLink, ResetFlow } from "@/components/auth/ResetFlow";
import { SignedInAsInterstitial } from "@/components/auth/SignedInAsInterstitial";
import { Card, EMAIL_RE, Working, explainAuthError, eyeBtn, inputCls, isRateLimited, primaryBtn, quietBtn, trackAuth } from "@/components/auth/shared";
import { useAuthStrings } from "@/i18n/auth/load";
import {
  DEFAULT_AFTER_AUTH,
  clearPendingSignIn,
  maskEmail,
  peekStashed,
  readPendingSignIn,
  safeNextPath,
  setPendingSignIn,
  takeStashed,
} from "@/lib/auth-fragment";

export type AuthMode = "continue" | "reset" | "confirm" | "return";
// eslint-disable-next-line react-refresh/only-export-components
export function parseAuthMode(raw: string | null): AuthMode {
  if (raw === "reset") return RECOVERY_LIVE ? "reset" : "continue";
  if (raw === "confirm" || raw === "return") return raw;
  return "continue";
}

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
function otpType(raw: string | null): EmailOtpType | null {
  return raw && (OTP_TYPES as readonly string[]).includes(raw) ? (raw as EmailOtpType) : null;
}

export default function Auth() {
  useAuthStrings();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const mode = parseAuthMode(params.get("mode"));
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main id="main-content" className="flex-1 flex items-center justify-center px-4 pt-16 pb-16" data-auth-flags={AUTH_FLAGS_MARK}>
        <div className="w-full max-w-sm">
          <AuthBody key={mode} mode={mode} next={next} />
          <AuthFootnote />
        </div>
      </main>
      <Footer />
    </div>
  );
}

function AuthBody({ mode, next }: { mode: AuthMode; next: string }) {
  const [params] = useSearchParams();
  // A recovery underway: reset mode from the start, or a confirmation link of type recovery.
  const [recovery, setRecovery] = useState<{ session: Session | null } | null>(mode === "reset" ? { session: null } : null);
  const [hasTokenHash] = useState(() => !!(peekStashed("token_hash") ?? params.get("token_hash")));
  if (recovery) return <ResetFlow next={next} initialSession={recovery.session} />;
  if (mode === "confirm" && hasTokenHash) return <ConfirmView next={next} onRecovery={(s) => setRecovery({ session: s })} />;
  return <ContinueView next={next} mode={mode} />;
}

function AuthFootnote() {
  const { t } = useTranslation();
  return (
    <p className="text-[11px] text-muted-foreground text-center mt-4">
      {t("auth.footnote", "An account keeps your scores, credits and purchases, and a resume only if you save one.")}{" "}
      <Link to="/trust#retention" className="underline">{t("auth.whatWeKeep", "What we keep")}</Link> · <Link to="/privacy" className="underline">{t("auth.privacy", "Privacy")}</Link>
    </p>
  );
}

// ── continue: the one screen ────────────────────────────────────────────────

function ContinueView({ next, mode }: { next: string; mode: AuthMode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, loading, signUp, signIn, signInWithGoogle, sessionExpired, stashState } = useAuth();
  const id = useId();
  const emailId = `${id}-email`, passwordId = `${id}-password`, errorId = `${id}-error`;

  // The address this browser last signed in with survives only an expired
  // session (a deliberate sign-out removes it), and is offered masked.
  const remembered = useMemo(() => { try { return localStorage.getItem("rb_last_email") ?? ""; } catch { return ""; } }, []);
  const [useRemembered, setUseRemembered] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(!CODE_SIGN_IN_LIVE);
  const [step, setStep] = useState<"start" | "code">("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [mismatch, setMismatch] = useState(false);

  // Signed in (now, or by a session adopted from the URL): go where the sign-in was headed.
  useEffect(() => {
    if (loading || !session || stashState.kind === "adopting") return;
    const target = stashState.kind === "adopted" && stashState.next ? stashState.next : next;
    navigate(target, { replace: true });
  }, [session, loading, stashState, next, navigate]);

  useEffect(() => {
    if (sessionExpired) setNotice(t("auth.sessionExpired", "Your session expired. Sign back in to pick up where you left off."));
  }, [sessionExpired, t]);

  useEffect(() => {
    if (stashState.kind === "error" || stashState.kind === "failed") {
      setError(mode === "return"
        ? t("auth.return.failed", "Sign-in didn't finish. Please try again.")
        : t("auth.confirm.expired", "This link has expired or was already used. Sign in again to get a new one."));
    }
  }, [stashState.kind, mode, t]);

  if (stashState.kind === "adopting") return <Working text={t("auth.confirm.working", "Signing you in…")} />;

  const address = () => (useRemembered ? remembered : email).trim();
  const clear = () => { setError(null); setNotice(null); setShowResend(false); };

  const continueWithPassword = async () => {
    clear();
    const addr = address();
    if (!EMAIL_RE.test(addr)) { setError(t("auth.email.invalid", "Enter a valid email address.")); return; }
    if (!password) { setError(t("auth.password.missing", "Enter a password.")); return; }
    setBusy(true);
    setPendingSignIn(next);
    try {
      // A new address becomes an account; an address that already has one
      // goes on to sign in with the same password, and nothing on screen says
      // which of the two it was.
      if (password.length >= MIN_PASSWORD_LENGTH) {
        trackAuth("signup_attempt");
        const up = await signUp(addr, password, next);
        if (!up.error && !up.existing) {
          trackAuth("signup_success");
          if (up.hasSession) clearPendingSignIn();
          else setNotice(t("auth.confirmationOnItsWay", "If this address can sign in, a confirmation email is on its way. It usually arrives within a minute."));
          return;
        }
        if (up.error && !/already registered|already exists|user_already_exists/i.test(up.error)) {
          trackAuth("signup_failure", up.error);
          setError(explainAuthError(t, up.error));
          return;
        }
      }
      trackAuth("signin_attempt");
      const inn = await signIn(addr, password);
      if (!inn.error) { trackAuth("signin_success"); clearPendingSignIn(); return; }
      trackAuth("signin_failure", inn.error);
      if (/email not confirmed/i.test(inn.error)) { setError(explainAuthError(t, inn.error)); setShowResend(true); return; }
      if (/invalid login credentials|invalid_credentials/i.test(inn.error)) {
        // No link is coming for a refused password: the marker would only
        // widen the window a crafted link could ride.
        clearPendingSignIn();
        setMismatch(true);
        setError(password.length < MIN_PASSWORD_LENGTH
          ? t("auth.mismatchShort", "We couldn't sign you in with that email and password. A new account needs at least 8 characters.")
          : t("auth.mismatch", "We couldn't sign you in with that email and password."));
        return;
      }
      setError(explainAuthError(t, inn.error));
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    clear();
    const { error: err } = await supabase.auth.resend({ type: "signup", email: address(), options: { emailRedirectTo: confirmRedirect(next) } });
    if (err && isRateLimited(err.message)) setError(explainAuthError(t, err.message));
    else setNotice(t("auth.confirmationOnItsWay", "If this address can sign in, a confirmation email is on its way. It usually arrives within a minute."));
  };

  const sendCode = async () => {
    clear();
    const addr = address();
    if (!EMAIL_RE.test(addr)) { setError(t("auth.email.invalid", "Enter a valid email address.")); return; }
    setBusy(true);
    setPendingSignIn(next);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: addr,
        // A code can create the account, so it records the Terms the line names.
        options: { shouldCreateUser: true, emailRedirectTo: confirmRedirect(next), data: termsAcceptance() },
      });
      if (err && isRateLimited(err.message)) { setError(explainAuthError(t, err.message)); return; }
      setStep("code");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (code: string) => {
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({ email: address(), token: code, type: "email" });
      if (err || !data?.session) {
        setError(err && isRateLimited(err.message) ? explainAuthError(t, err.message) : t("auth.code.invalid", "That code didn't work. Check it, or ask for a new one."));
        return;
      }
      clearPendingSignIn();
      trackAuth("code_success");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    clear();
    setBusy(true);
    const { error: err } = await signInWithGoogle(next);
    setBusy(false);
    if (err) setError(t("auth.provider.failed", "That sign-in didn't finish. Try again, or use your password."));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (passwordOpen) void continueWithPassword();
    else void sendCode();
  };

  if (step === "code") {
    return (
      <Card>
        <h1 className="text-xl font-bold text-foreground mb-3">{t("auth.checkEmail", "Check your email")}</h1>
        <CodeEntry
          purpose="signin"
          busy={busy}
          error={error}
          onSubmit={verifyCode}
          onResend={sendCode}
          onBack={() => { clear(); setStep("start"); }}
          onUsePassword={() => { clear(); setStep("start"); setPasswordOpen(true); }}
        />
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-bold text-foreground mb-1">{t("auth.title", "Sign in or create your free account")}</h1>
      <p className="text-xs text-muted-foreground mb-5">
        {t("auth.subtitle", "Track your resume scores over time, keep your scan history, and see your credits and purchases in one place. Free forever.")}
      </p>

      <ProviderButtons onGoogle={() => void google()} busy={busy} />

      <form onSubmit={submit} noValidate>
        <label htmlFor={emailId} className="block text-xs font-medium text-foreground mb-1">{t("auth.email.label", "Email")}</label>
        {useRemembered ? (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 min-h-[44px]">
            <output id={emailId} className="text-sm text-foreground">{maskEmail(remembered)}</output>
            <button type="button" className={quietBtn} onClick={() => { setUseRemembered(false); setEmail(""); }}>
              {t("auth.email.useDifferent", "Use a different address")}
            </button>
          </div>
        ) : (
          <div className="relative mb-3">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.email.placeholder", "you@example.com")}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className={inputCls}
            />
          </div>
        )}
        {remembered && !useRemembered && !email && (
          <button type="button" className={`${quietBtn} -mt-2 mb-2 block`} onClick={() => setUseRemembered(true)}>
            {t("auth.email.remembered", "Continue as {{email}}", { email: maskEmail(remembered) })}
          </button>
        )}

        {passwordOpen && (
          <>
            <label htmlFor={passwordId} className="block text-xs font-medium text-foreground mb-1">{t("auth.password.label", "Password")}</label>
            <div className="relative mb-2">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <input
                id={passwordId}
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.password.placeholder", "At least 8 characters")}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={`${inputCls} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("auth.password.hide", "Hide password") : t("auth.password.show", "Show password")}
                aria-pressed={showPassword}
                className={eyeBtn}
              >
                {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
            <ForgotPasswordLink next={next} emphasis={mismatch} />
          </>
        )}

        {error && <p id={errorId} role="alert" className="text-xs text-destructive mb-3">{error}</p>}
        {showResend && (
          <button type="button" onClick={() => void resendConfirmation()} className={`${quietBtn} mb-3 block`}>
            {t("auth.resendConfirmation", "Email the confirmation link again")}
          </button>
        )}
        {notice && <p role="status" className="text-xs text-success mb-3">{notice}</p>}
        {mismatch && error && !RECOVERY_LIVE && (
          <p className="text-xs text-muted-foreground mb-3">
            {t("auth.help", "Can't sign in? Email")} <a className="underline" href={`mailto:${AUTH_SUPPORT_EMAIL}`}>{AUTH_SUPPORT_EMAIL}</a>
          </p>
        )}

        <PurchaseTerms kind="signup" className="mb-3" />
        <button type="submit" disabled={busy} className={primaryBtn}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {passwordOpen ? t("auth.continue", "Continue") : <CodeSendLabel />}
        </button>
        {CODE_SIGN_IN_LIVE && (
          <div className="mt-2 text-center">
            <CodeSignInToggle className={quietBtn} passwordOpen={passwordOpen} onToggle={() => { clear(); setPasswordOpen(!passwordOpen); }} />
          </div>
        )}
      </form>
    </Card>
  );
}

// ── confirm: a link from the mail, spent only by a press ────────────────────

function ConfirmView({ next, onRecovery }: { next: string; onRecovery: (s: Session) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [params] = useSearchParams();
  // Read once: the stash's copy (the first script moved it there), else the address's.
  const [tokenHash] = useState(() => peekStashed("token_hash") ?? params.get("token_hash"));
  const [type] = useState(() => otpType(peekStashed("type") ?? params.get("type")));
  const [phase, setPhase] = useState<"ready" | "working" | "failed" | "emailChanged" | "notYours">("ready");
  const [signedInAs, setSignedInAs] = useState("");

  const press = async () => {
    if (!tokenHash || !type) { setPhase("failed"); return; }
    setPhase("working");
    takeStashed("token_hash");
    takeStashed("type");
    try {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) { setPhase("failed"); return; }
      if (type === "email_change") { setPhase("emailChanged"); return; }
      if (!data?.session) { setPhase("failed"); return; }
      if (type === "recovery" && RECOVERY_LIVE) { onRecovery(data.session); return; }
      const pending = readPendingSignIn();
      clearPendingSignIn();
      if (pending) {
        navigate(pending.next !== DEFAULT_AFTER_AUTH ? pending.next : next, { replace: true });
        return;
      }
      // Not started in this browser: say whose account this is before anything else happens.
      setSignedInAs(maskEmail(data.session.user?.email));
      setPhase("notYours");
    } catch {
      setPhase("failed");
    }
  };

  if (phase === "notYours") {
    return (
      <SignedInAsInterstitial
        inline
        maskedEmail={signedInAs}
        onContinue={() => navigate(next, { replace: true })}
        onSignOut={() => { void signOut().finally(() => navigate("/auth", { replace: true })); }}
      />
    );
  }

  const body = type === "recovery"
    ? t("auth.confirm.recoveryBody", "Press Continue to choose a new password.")
    : type === "email_change"
      ? t("auth.confirm.emailChangeBody", "Press Continue to confirm your new email address.")
      : t("auth.confirm.body", "Press Continue to finish signing in. The link works once.");

  return (
    <Card>
      <h1 className="text-xl font-bold text-foreground mb-2">{t("auth.confirm.title", "Finish signing in")}</h1>
      {phase === "failed" ? (
        <>
          <p role="alert" className="text-sm text-destructive mb-4">{t("auth.confirm.expired", "This link has expired or was already used. Sign in again to get a new one.")}</p>
          <Link to="/auth" className={primaryBtn}>{t("auth.back", "Back to sign in")}</Link>
        </>
      ) : phase === "emailChanged" ? (
        <>
          <p role="status" className="text-sm text-foreground mb-4">{t("auth.confirm.emailChanged", "Your email change is confirmed. If your other address also received a link, use that one too.")}</p>
          <Link to="/account" className={primaryBtn}>{t("auth.continue", "Continue")}</Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">{body}</p>
          <button type="button" onClick={() => void press()} disabled={phase === "working"} className={primaryBtn}>
            {phase === "working" && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            {t("auth.continue", "Continue")}
          </button>
        </>
      )}
    </Card>
  );
}
