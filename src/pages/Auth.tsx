// Sign in / create account (R1, Account UX spec 1-4). Free accounts exist to
// track scan scores over time and surface credits + purchases; the free scan
// itself is never gated.
//
// ONE PAGE, FOUR MODES, NO NEW ROUTES (/auth?mode=...):
//   continue  one screen, email first. The password leads while the emailed
//             code is switched off (D2). Continue SIGNS IN; only when the
//             auth server refuses that email and password is a new account
//             offered, as a second, explicit step for the address typed (no
//             silent account for a typo, and a returning member whose old
//             password fails today's strength rule still signs in).
//   reset     password recovery, behind its switch (components/auth/ResetFlow).
//   confirm   a link from the mail (token_hash + type). It is spent only when
//             the person presses Continue (a mail scanner's fetch spends
//             nothing), through a client that keeps nothing, and a link this
//             browser did not start asks "Is this your account?" BEFORE any
//             session exists here. Lovable's default link (tokens in the
//             fragment) is resolved the same way by AuthContext.
//   return    a provider's return; AuthContext adopts the stashed session when
//             this browser started the sign-in, and the page goes to the safe
//             next the pending marker carried.
// Every sign-in method other than the password lives in its own component
// behind its own switch (src/config/auth-providers.ts), so this file names
// none of them. No screen says a mail went out: it is "on its way" only once
// the auth server accepted the request, and only if the address can sign in,
// which is as true for an address with no account.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
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
import { ForgotPasswordLink, ResetFlow, WrongPasswordLink } from "@/components/auth/ResetFlow";
import { SignedInAsInterstitial } from "@/components/auth/SignedInAsInterstitial";
import {
  Card, EMAIL_RE, Working, explainAuthError, explainSendError, eyeBtn, inputCls, isRateLimited, primaryBtn, quietBtn, trackAuth,
  type Msg,
} from "@/components/auth/shared";
import { useAuthStrings } from "@/i18n/auth/load";
import { revoke, verifyLink, type Probed } from "@/lib/auth-probe";
import {
  DEFAULT_AFTER_AUTH,
  clearAddresslessPendingSignIn,
  clearPendingSignIn,
  maskEmail,
  peekStashed,
  pendingMatches,
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

/** A message slot that holds the call writing it (see Msg), rendered at render time. */
function useMsg(): [Msg | null, (m: Msg | null) => void] {
  const [m, set] = useState<Msg | null>(null);
  return [m, (next: Msg | null) => set(() => next)];
}

export default function Auth() {
  useAuthStrings();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const mode = parseAuthMode(params.get("mode"));
  // A provider marker (Google pressed, no address known) is spent by its
  // return. The sign-in page opening any other way (Back from Google, a new
  // visit) means that return is not coming: the marker is forgotten, so no
  // later token pair rides it (lead decision E). A marker naming a typed
  // address stays: its link may still arrive from the mail.
  useEffect(() => {
    if (mode !== "return" && !peekStashed("access_token")) clearAddresslessPendingSignIn();
  }, [mode]);
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

/** "Can't sign in? Email ..." under any refusal on the sign-in card. */
function SupportLine() {
  const { t } = useTranslation();
  return (
    <p className="text-xs text-muted-foreground mb-3">
      {t("auth.help", "Can't sign in? Email")} <a className="underline" href={`mailto:${AUTH_SUPPORT_EMAIL}`}>{AUTH_SUPPORT_EMAIL}</a>
    </p>
  );
}

// ── continue: the one screen ────────────────────────────────────────────────

function ContinueView({ next, mode }: { next: string; mode: AuthMode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session, loading, signUp, signIn, signInWithGoogle, sessionExpired, stashState, clearStashOutcome } = useAuth();
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
  const [error, setError] = useMsg();
  const [notice, setNotice] = useMsg();
  const [showResend, setShowResend] = useState(false);
  // The address a refused password may become a new account for (an explicit second step).
  const [offerCreate, setOfferCreate] = useState<string | null>(null);
  const [wrongPassword, setWrongPassword] = useState(false);

  // Signed in (now, or by a session adopted from the URL): go where the sign-in was headed.
  useEffect(() => {
    if (loading || !session || stashState.kind === "adopting") return;
    const target = stashState.kind === "adopted" && stashState.next ? stashState.next : next;
    navigate(target, { replace: true });
  }, [session, loading, stashState, next, navigate]);

  useEffect(() => {
    if (sessionExpired) setNotice((t) => t("auth.sessionExpired", "Your session expired. Sign back in to pick up where you left off."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionExpired]);

  // A link's error or a failed adoption is shown once, then forgotten (S12-182).
  useEffect(() => {
    if (stashState.kind === "error" || stashState.kind === "failed") {
      setError(mode === "return"
        ? (t) => t("auth.return.failed", "Sign-in didn't finish. Please try again.")
        : (t) => t("auth.confirm.expired", "This link has expired or was already used. Sign in again to get a new one."));
      clearStashOutcome();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stashState.kind, mode, clearStashOutcome]);

  if (stashState.kind === "adopting") return <Working text={t("auth.confirm.working", "Signing you in…")} />;

  const address = () => (useRemembered ? remembered : email).trim();
  const clear = () => { setError(null); setNotice(null); setShowResend(false); setWrongPassword(false); };

  const continueWithPassword = async () => {
    clear();
    setOfferCreate(null);
    const addr = address();
    if (!EMAIL_RE.test(addr)) { setError((t) => t("auth.email.invalid", "Enter a valid email address.")); return; }
    if (!password) { setError((t) => t("auth.password.missing", "Enter a password.")); return; }
    setBusy(true);
    try {
      // Sign-in first, whatever the password's length or strength: a member
      // whose old password fails today's strength rule still signs in (the
      // auth server only reports a weak password at sign-in).
      trackAuth("signin_attempt");
      const inn = await signIn(addr, password);
      // A password sign-in is answered here; no link is coming that a marker would vouch for.
      clearPendingSignIn();
      if (!inn.error) { trackAuth("signin_success"); return; }
      trackAuth("signin_failure", inn.error);
      if (/email not confirmed/i.test(inn.error)) { const m = inn.error; setError((t) => explainAuthError(t, m)); setShowResend(true); return; }
      if (/invalid login credentials|invalid_credentials/i.test(inn.error)) {
        setError((t) => t("auth.mismatch", "We couldn't sign you in with that email and password."));
        setOfferCreate(addr);
        return;
      }
      const m = inn.error;
      setError((t) => explainAuthError(t, m));
    } finally {
      setBusy(false);
    }
  };

  // The explicit second step: a new account for the address the person typed.
  const createAccount = async () => {
    const addr = offerCreate;
    clear();
    if (!addr) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError((t) => t("auth.create.tooShort", "A new account needs a password of at least 8 characters."));
      return;
    }
    setBusy(true);
    // With "Confirm email" on, a confirmation link follows: it is this browser's.
    setPendingSignIn(next, undefined, addr);
    try {
      trackAuth("signup_attempt");
      const up = await signUp(addr, password, next);
      if (!up.error && !up.existing) {
        trackAuth("signup_success");
        setOfferCreate(null);
        if (up.hasSession) clearPendingSignIn();
        else setNotice((t) => t("auth.confirmationOnItsWay", "If this address can sign in, a confirmation email is on its way. It usually arrives within a minute."));
        return;
      }
      clearPendingSignIn();
      setOfferCreate(null);
      if (up.existing || (up.error && /already registered|already exists|user_already_exists/i.test(up.error))) {
        // Said without saying whether an account exists: the way on is the reset.
        trackAuth("signup_refused");
        setError((t) => t("auth.create.refused", "We couldn't create an account with that email and password."));
        setWrongPassword(true);
        return;
      }
      trackAuth("signup_failure", up.error ?? "");
      const m = up.error;
      setError((t) => explainAuthError(t, m));
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    clear();
    const addr = address();
    setPendingSignIn(next, undefined, addr);
    const { error: err } = await supabase.auth.resend({ type: "signup", email: addr, options: { emailRedirectTo: confirmRedirect(next) } });
    if (err) { clearPendingSignIn(); const m = err.message; setError((t) => explainSendError(t, m)); return; }
    setNotice((t) => t("auth.confirmationOnItsWay", "If this address can sign in, a confirmation email is on its way. It usually arrives within a minute."));
  };

  const sendCode = async () => {
    clear();
    const addr = address();
    if (!EMAIL_RE.test(addr)) { setError((t) => t("auth.email.invalid", "Enter a valid email address.")); return; }
    setBusy(true);
    setPendingSignIn(next, undefined, addr);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: addr,
        // A code can create the account, so it records the Terms the line names.
        options: { shouldCreateUser: true, emailRedirectTo: confirmRedirect(next), data: termsAcceptance() },
      });
      // "On its way" only once the auth server took the request.
      if (err) { clearPendingSignIn(); const m = err.message; setError((t) => explainSendError(t, m)); return; }
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
        const m = err?.message ?? "";
        setError(err && isRateLimited(m) ? (t) => explainAuthError(t, m) : (t) => t("auth.code.invalid", "That code didn't work. Check it, or ask for a new one."));
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
    if (err) setError((t) => t("auth.provider.failed", "That sign-in didn't finish. Try again, or use your password."));
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
          error={error ? error(t) : null}
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
            <button type="button" className={quietBtn} onClick={() => { setUseRemembered(false); setEmail(""); setOfferCreate(null); }}>
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
              onChange={(e) => { setEmail(e.target.value); setOfferCreate(null); setWrongPassword(false); }}
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
            <ForgotPasswordLink next={next} emphasis={!!offerCreate || wrongPassword} />
          </>
        )}

        {error && <p id={errorId} role="alert" className="text-xs text-destructive mb-3">{error(t)}</p>}
        {wrongPassword && <WrongPasswordLink next={next} />}
        {offerCreate && (
          <div className="mb-3 rounded-lg border border-border p-3" data-testid="offer-create">
            <p className="text-xs text-muted-foreground mb-2">
              {t("auth.create.offer", "New here? You can create an account for {{email}} with this password.", { email: offerCreate })}
            </p>
            <button type="button" disabled={busy} onClick={() => void createAccount()} className={`${quietBtn} border border-border w-full`}>
              {t("auth.create.button", "Create a new account")}
            </button>
          </div>
        )}
        {showResend && (
          <button type="button" onClick={() => void resendConfirmation()} className={`${quietBtn} mb-3 block`}>
            {t("auth.resendConfirmation", "Email the confirmation link again")}
          </button>
        )}
        {notice && <p role="status" className="text-xs text-success mb-3">{notice(t)}</p>}
        {error && <SupportLine />}

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
  const { adoptSession } = useAuth();
  const [params] = useSearchParams();
  // Read once: the stash's copy (the first script moved it there), else the address's.
  const [tokenHash] = useState(() => peekStashed("token_hash") ?? params.get("token_hash"));
  const [type] = useState(() => otpType(peekStashed("type") ?? params.get("type")));
  const [phase, setPhase] = useState<"ready" | "working" | "failed" | "unreachable" | "emailChanged" | "ask" | "cancelled">("ready");
  const [askEmail, setAskEmail] = useState("");
  const held = useRef<{ probed: Probed; target: string } | null>(null);

  // The session goes to the site's client only now: the person said yes, or this browser started it.
  const finish = async (p: Probed, target: string, banner: boolean) => {
    setPhase("working");
    const ok = await adoptSession(p, { recovery: type === "recovery", banner });
    if (!ok) { setPhase("failed"); return; }
    if (type === "recovery" && RECOVERY_LIVE) { onRecovery(p.session); return; }
    if (type === "email_change") { setPhase("emailChanged"); return; }
    navigate(target, { replace: true });
  };

  // THE LINK IS SPENT ONLY BY AN ANSWER (lead decision D). The hash stays in
  // the stash until the auth server answers: a transient failure (unreachable,
  // a 5xx, a timeout) keeps it and offers Try again in this tab, and only a
  // definite refusal (expired, already used) or a success takes it.
  const spend = () => { takeStashed("token_hash"); takeStashed("type"); };
  const press = async () => {
    if (!tokenHash || !type) { spend(); setPhase("failed"); return; }
    setPhase("working");
    const r = await verifyLink(tokenHash, type);
    if ("error" in r) {
      if (r.transient) { setPhase("unreachable"); return; }
      spend();
      clearPendingSignIn();
      setPhase("failed");
      return;
    }
    spend();
    if ("verified" in r) { setPhase("emailChanged"); return; }
    const pending = readPendingSignIn();
    if (pendingMatches(pending, r.email)) {
      clearPendingSignIn();
      await finish(r, pending && pending.next !== DEFAULT_AFTER_AUTH ? pending.next : next, !pending?.email);
      return;
    }
    // Not started in this browser (or for another address): ask BEFORE any session exists here.
    held.current = { probed: r, target: next };
    setAskEmail(r.email);
    setPhase("ask");
  };

  if (phase === "ask") {
    return (
      <SignedInAsInterstitial
        inline
        email={askEmail}
        onContinue={() => { const h = held.current; held.current = null; if (h) void finish(h.probed, h.target, false); else setPhase("failed"); }}
        onCancel={() => { void revoke(held.current?.probed.session); held.current = null; setPhase("cancelled"); }}
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
      ) : phase === "unreachable" ? (
        <>
          <p role="alert" className="text-sm text-destructive mb-4">{t("auth.confirm.unreachable", "We couldn't reach the sign-in server. Check your connection and try again; the link is still valid.")}</p>
          <button type="button" onClick={() => void press()} className={primaryBtn}>{t("auth.confirm.retry", "Try again")}</button>
        </>
      ) : phase === "cancelled" ? (
        <>
          <p role="status" className="text-sm text-foreground mb-4">{t("auth.linkCheck.cancelled", "Nothing was signed in. If you meant to sign in, ask for a new link from the sign-in page.")}</p>
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
