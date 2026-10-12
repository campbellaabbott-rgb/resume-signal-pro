// Auth context — free accounts so users can track scores across scans and
// see their credits and purchases. Supabase email auth; session persists
// via the supabase client's built-in storage.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import i18next from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { TERMS_VERSION } from "@/config/terms";
import { toast } from "@/hooks/use-toast";
import { clearLocalResumeCopies } from "@/lib/local-resume-copies";
import {
  DEFAULT_AFTER_AUTH,
  clearPendingSignIn,
  clearStash,
  discardStashedSession,
  jwtClaims,
  maskEmail,
  newestAmr,
  peekStashed,
  readPendingSignIn,
  safeNextPath,
  setPendingSignIn,
} from "@/lib/auth-fragment";
import { SignedInAsInterstitial } from "@/components/auth/SignedInAsInterstitial";

/**
 * WHAT A NEW ACCOUNT AGREED TO (commercial-readiness plan item 12). The sign-up
 * button carries "By continuing you agree to the Terms"; the account stores
 * which Terms and when, in its own metadata, with no new table.
 */
export function termsAcceptance(now: Date = new Date()): { terms_version: string; terms_accepted_at: string } {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() };
}

/**
 * WHERE TO GO AFTER SIGNING IN: a same-origin path only (the rule and its
 * reasons live in src/lib/auth-fragment.ts, which the sign-in page and the
 * pending-sign-in marker share). Re-exported here for the pages that already
 * import it from this module.
 */
export { DEFAULT_AFTER_AUTH, safeNextPath };

/**
 * A DELIBERATE SIGN-OUT, SHARED WITH THIS BROWSER'S OTHER TABS (S11-145).
 * auth-js broadcasts SIGNED_OUT to every open tab, and the flag the sign-out
 * button sets lives in one tab's memory, so every other tab called the
 * person's own sign-out (or account deletion) an expiry. The button now also
 * writes the time to localStorage, which every tab of this site reads; a
 * session that vanishes within a minute of that mark is a sign-out.
 */
export const SIGN_OUT_MARK_KEY = "rb_signed_out_at";
const SIGN_OUT_MARK_MS = 60_000;
function markDeliberateSignOut(): void {
  try { localStorage.setItem(SIGN_OUT_MARK_KEY, String(Date.now())); } catch { /* storage blocked: this tab's flag still holds */ }
}
export function signOutWasDeliberate(now: number = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(SIGN_OUT_MARK_KEY));
    return Number.isFinite(at) && at > 0 && now >= at && now - at < SIGN_OUT_MARK_MS;
  } catch {
    return false;
  }
}

/**
 * WHAT A DELIBERATE SIGN-OUT LEAVES BEHIND: NOTHING PERSONAL (register CP-012).
 * On a shared computer the next person used to find the last person's email
 * prefilled at checkout and sign-in, their résumé copies and their cached
 * reports. A sign-out pressed on purpose, or an account deletion, now removes
 * every key below; an expired session removes none (the same person comes
 * back to it). Each key is the one its writer uses: a test holds them equal.
 */
export const PERSONAL_LOCAL_KEYS = [
  "rb_last_email",      // AuthContext, EmailReportCapture: the last address used here
  "scanCreditsEmail",   // use-scan-credits, use-pro-subscription: an address typed at a checkout
  "rb_guard_seen",      // this module: the account guard's last answer
] as const;
export const PERSONAL_SESSION_KEYS = [
  "rb_resume_text", "rb_linkedin_text", "rb_job_description_text", "rb_multi_column_detected", // use-session-resume
  "rb_resume_for_fit", "rb_scan_industry",  // Index
  "rb_board_resume",                        // Jobs
  "rb_scan_fixes",                          // FreeKeywordResults, GapReport
  "rb_boost_insert",                        // ResumeBuilder's hand-off
  "rb_prestored_resume_session", "rb_checkout_retry", // use-product-checkout
  "rb_jd_handoff",                          // jd-handoff
] as const;

export function clearPersonalBrowserData(): void {
  try { for (const k of PERSONAL_LOCAL_KEYS) localStorage.removeItem(k); } catch { /* storage blocked: nothing kept */ }
  try { for (const k of PERSONAL_SESSION_KEYS) sessionStorage.removeItem(k); } catch { /* storage blocked: nothing kept */ }
  clearLocalResumeCopies();
  clearPendingSignIn();
  clearStash();
}

// ── the account guard (auth-signed-in) ──────────────────────────────────────

/**
 * WHAT THE ACCOUNT GUARD SAID ABOUT THIS SESSION. auth-signed-in records the
 * first proof that this account's address is its owner's (a code, a link, a
 * provider), and clears a password someone set on the address before that
 * proof (D15). It is asked once per session (keyed by the token's session_id),
 * never blocks the app, and is awaited only by the password reset, which must
 * not set a new password the guard could then clear.
 */
export type GuardResult = {
  state: "idle" | "pending" | "done" | "failed";
  proven: boolean;
  passwordCleared: boolean;
  reason: string | null;
  status: number | null;
};
export const GUARD_IDLE: GuardResult = { state: "idle", proven: false, passwordCleared: false, reason: null, status: null };
const GUARD_CACHE_KEY = "rb_guard_seen";
const GUARD_RECHECK_MS = 60 * 60 * 1000;      // a "not proven" answer is asked again after an hour
const GUARD_FAILED_RECHECK_MS = 10 * 60 * 1000; // a failed ask, after ten minutes

/** The key a session is guarded under: its session_id claim, else user and issue time. */
export function guardKey(session: Session | null | undefined): string | null {
  if (!session?.access_token) return null;
  const claims = jwtClaims(session.access_token);
  const sid = typeof claims?.session_id === "string" ? claims.session_id : null;
  if (sid) return sid;
  const uid = session.user?.id ?? (typeof claims?.sub === "string" ? claims.sub : null);
  return uid ? `${uid}:${String(claims?.iat ?? "")}` : null;
}

type GuardCache = GuardResult & { key: string; at: number };
function readGuardCache(key: string, now = Date.now()): GuardCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(GUARD_CACHE_KEY) ?? "null") as GuardCache | null;
    if (!c || c.key !== key || typeof c.at !== "number") return null;
    if (c.state === "done" && (c.proven || now - c.at < GUARD_RECHECK_MS)) return c;
    if (c.state === "failed" && now - c.at < GUARD_FAILED_RECHECK_MS) return c;
    return null;
  } catch {
    return null;
  }
}
function writeGuardCache(c: GuardCache): void {
  try { localStorage.setItem(GUARD_CACHE_KEY, JSON.stringify(c)); } catch { /* asked again next load */ }
}

async function askGuard(accessToken: string): Promise<GuardResult> {
  try {
    const { data, error } = await supabase.functions.invoke("auth-signed-in", {
      method: "POST",
      body: {},
      // This session's own token, never whatever the client holds by the time the call leaves.
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const d = data as { proven?: unknown; passwordCleared?: unknown; reason?: unknown } | null;
    if (!error && d && typeof d.proven === "boolean") {
      return { state: "done", proven: d.proven, passwordCleared: d.passwordCleared === true, reason: typeof d.reason === "string" ? d.reason : null, status: 200 };
    }
    const ctx = (error as { context?: { status?: number; clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
    let reason: string | null = error ? "error" : "unreadable_answer";
    // A refused proof (409 changed_since_sign_in) can still have cleared the
    // pre-proof password, and the body says so: that is explained like a 200's.
    let passwordCleared = false;
    try {
      const body = ctx?.clone ? (await ctx.clone().json()) as { reason?: unknown; error?: unknown; passwordCleared?: unknown } : null;
      if (typeof body?.reason === "string") reason = body.reason;
      else if (typeof body?.error === "string") reason = body.error;
      passwordCleared = body?.passwordCleared === true;
    } catch { /* no body */ }
    return { state: "failed", proven: false, passwordCleared, reason, status: typeof ctx?.status === "number" ? ctx.status : null };
  } catch {
    return { state: "failed", proven: false, passwordCleared: false, reason: "network", status: null };
  }
}

function tr(key: string, fallback: string): string {
  try { return i18next.isInitialized ? i18next.t(key, fallback) : fallback; } catch { return fallback; }
}

// ── a session that arrived in the URL ───────────────────────────────────────

/**
 * WHAT HAPPENED TO A SESSION THE FIRST SCRIPT FOUND IN THE URL (login-CSRF
 * protection). It is adopted without a question only when this browser
 * started a sign-in in the last hour (the pending marker); otherwise the
 * signed-in-as prompt asks first. A stashed error (an expired link, a
 * cancelled provider) is handed to the sign-in page to explain.
 */
export type StashState =
  | { kind: "none" }
  | { kind: "adopting"; next: string | null; type: string | null }
  | { kind: "adopted"; next: string | null; type: string | null }
  | { kind: "interstitial"; maskedEmail: string; type: string | null }
  | { kind: "failed"; type: string | null }
  | { kind: "error"; code: string | null; description: string | null };

const STASH_MAX_AGE_MS = 60 * 60 * 1000;

function initialStashState(): StashState {
  if (typeof window === "undefined") return { kind: "none" };
  const access = peekStashed("access_token");
  const refresh = peekStashed("refresh_token");
  const at = Number(peekStashed("_at") ?? 0);
  const type = peekStashed("type");
  // A pure read (React may call this twice): what it leaves behind is
  // discarded by the provider's first effect.
  if (access && refresh) {
    if (at && Date.now() - at > STASH_MAX_AGE_MS) return { kind: "none" };
    const pending = readPendingSignIn();
    if (pending) return { kind: "adopting", next: pending.next, type };
    const email = jwtClaims(access)?.email;
    return { kind: "interstitial", maskedEmail: maskEmail(typeof email === "string" ? email : ""), type };
  }
  const code = peekStashed("error_code") ?? peekStashed("error");
  const description = peekStashed("error_description");
  if (code || description) return { kind: "error", code, description };
  return { kind: "none" };
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** `next` is where a confirmation link should land — see safeNextPath. */
  signUp: (email: string, password: string, next?: string) => Promise<{ error: string | null; hasSession?: boolean; existing?: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (next?: string) => Promise<{ error: string | null }>;
  /** This device only unless a scope is named. A deliberate sign-out clears what the person left in this browser. */
  signOut: (opts?: { scope?: "local" | "others" | "global" }) => Promise<void>;
  /** Every device this account is signed in on. */
  signOutEverywhere: () => Promise<void>;
  /** True when a previously-active session disappeared (token expiry/revocation) */
  sessionExpired: boolean;
  /** The account guard's answer for the current session. */
  guardResult: GuardResult;
  /** Ask the account guard about this session (once per session; concurrent callers share one call). */
  ensureGuard: (session?: Session | null, opts?: { fresh?: boolean }) => Promise<GuardResult>;
  /** A session that arrived in the URL, and what became of it. */
  stashState: StashState;
  /** The signed-in-as prompt's Continue. */
  acceptStashedSession: () => Promise<void>;
  /** The signed-in-as prompt's "Not you?". */
  rejectStashedSession: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  signUp: async () => ({ error: "not ready" }),
  signIn: async () => ({ error: "not ready" }),
  signInWithGoogle: async () => ({ error: "not ready" }),
  signOut: async () => {},
  signOutEverywhere: async () => {},
  sessionExpired: false,
  guardResult: GUARD_IDLE,
  ensureGuard: async () => GUARD_IDLE,
  stashState: { kind: "none" },
  acceptStashedSession: async () => {},
  rejectStashedSession: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [guardResult, setGuardResult] = useState<GuardResult>(GUARD_IDLE);
  const [stashState, setStashState] = useState<StashState>(initialStashState);
  const [interstitialBusy, setInterstitialBusy] = useState(false);
  const userSignedOut = useRef(false);
  const inflight = useRef(new Map<string, Promise<GuardResult>>());
  const currentKey = useRef<string | null>(null);

  const ensureGuard = useCallback(async (s?: Session | null, opts?: { fresh?: boolean }): Promise<GuardResult> => {
    const target = s ?? (await supabase.auth.getSession()).data.session;
    const key = guardKey(target);
    if (!target || !key) return GUARD_IDLE;
    const cached = readGuardCache(key);
    if (cached && !(opts?.fresh && cached.state === "failed")) {
      if (currentKey.current === key) setGuardResult(cached);
      return cached;
    }
    const running = inflight.current.get(key);
    if (running) {
      const r = await running;
      if (!(opts?.fresh && r.state === "failed")) return r;
    }
    if (currentKey.current === key) setGuardResult({ ...GUARD_IDLE, state: "pending" });
    const run = askGuard(target.access_token).then((r) => {
      const recovery = newestAmr(target.access_token) === "recovery";
      const showNotice = r.passwordCleared && !recovery;
      writeGuardCache({ ...r, key, at: Date.now() });
      // A failed ask is asked again once its cache window passes; an answer
      // stays this tab's answer for the session (and survives blocked storage).
      if (r.state === "failed") inflight.current.delete(key);
      if (currentKey.current === key) setGuardResult(r);
      if (showNotice) {
        toast({
          title: tr("auth.guard.passwordClearedTitle", "Your old password was cleared"),
          description: tr("auth.guard.passwordCleared", "We cleared a password set on this address before you proved you own it. Set a new one in your account settings if you want one."),
        });
      }
      return r;
    });
    inflight.current.set(key, run);
    return run;
  }, []);

  useEffect(() => {
    // Listener FIRST, then getSession — avoids missing an auth event
    // that fires between the two calls.
    let hadSession = false;
    let heard = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      heard = true;
      // A session vanishing without THE USER signing out = expiry/revocation.
      // auth-js reports a failed refresh as SIGNED_OUT too, so the event name
      // cannot tell the two apart (platform sweep L3-20: this never fired);
      // the sign-out button sets userSignedOut first, and only that is quiet,
      // in this tab and (through its shared mark) in every other one.
      if (hadSession && !s && !userSignedOut.current && !signOutWasDeliberate()) setSessionExpired(true);
      if (!s) { hadSession = false; userSignedOut.current = false; currentKey.current = null; setGuardResult(GUARD_IDLE); }
      if (s) {
        hadSession = true;
        setSessionExpired(false);
        try { if (s.user?.email) localStorage.setItem("rb_last_email", s.user.email); } catch { /* storage blocked */ }
        const key = guardKey(s);
        if (key !== currentKey.current) { currentKey.current = key; setGuardResult(readGuardCache(key ?? "") ?? GUARD_IDLE); }
        // Outside the callback: auth-js holds its lock while it notifies, and
        // a function call reads the session through that same lock.
        const timer = setTimeout(() => { timers.delete(timer); void ensureGuard(s); }, 0);
        timers.add(timer);
      }
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      // An event that arrived meanwhile (a session adopted from the URL, a
      // sign-in) is newer than this read: it is not overwritten.
      if (!heard) setSession(s);
      setLoading(false);
    });
    return () => {
      subscription.unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [ensureGuard]);

  // What the first read left in the stash and will never use: an error it has
  // now taken, or tokens too old to adopt.
  useEffect(() => {
    if (stashState.kind === "error" || (stashState.kind === "none" && peekStashed("access_token"))) discardStashedSession();
    // Once, for the read the provider started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A session the first script found in the URL, from a sign-in this browser
  // started: adopted now, and the marker is spent.
  const adoptStarted = useRef(false);
  useEffect(() => {
    if (stashState.kind !== "adopting" || adoptStarted.current) return;
    adoptStarted.current = true;
    const access = peekStashed("access_token");
    const refresh = peekStashed("refresh_token");
    const { next, type } = stashState;
    discardStashedSession();
    clearPendingSignIn();
    if (!access || !refresh) { setStashState({ kind: "failed", type }); return; }
    void supabase.auth.setSession({ access_token: access, refresh_token: refresh })
      .then(({ error }) => setStashState(error ? { kind: "failed", type } : { kind: "adopted", next, type }))
      .catch(() => setStashState({ kind: "failed", type }));
  }, [stashState]);

  const acceptStashedSession = useCallback(async () => {
    if (stashState.kind !== "interstitial") return;
    const { type } = stashState;
    const access = peekStashed("access_token");
    const refresh = peekStashed("refresh_token");
    discardStashedSession();
    clearPendingSignIn();
    if (!access || !refresh) { setStashState({ kind: "failed", type }); return; }
    setInterstitialBusy(true);
    try {
      const { error } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
      setStashState(error ? { kind: "failed", type } : { kind: "adopted", next: null, type });
    } catch {
      setStashState({ kind: "failed", type });
    } finally {
      setInterstitialBusy(false);
    }
  }, [stashState]);

  const rejectStashedSession = useCallback(() => {
    discardStashedSession();
    setStashState({ kind: "none" });
  }, []);

  const signUp = async (email: string, password: string, next?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: confirmRedirect(next), data: termsAcceptance() },
    });
    // With "Confirm email" on, the auth server answers an existing address
    // with a user that has no identities and no session, instead of an error.
    const user = (data as { user?: { identities?: unknown[] } | null } | null)?.user;
    const existing = !error && !!user && Array.isArray(user.identities) && user.identities.length === 0;
    return { error: error?.message ?? null, hasSession: !!(data as { session?: unknown } | null)?.session, existing };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async (next?: string) => {
    // The return is accepted without a question only because this browser
    // started it: the marker first, then the broker.
    setPendingSignIn(next);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth?mode=return`,
    });
    // A pop-up sign-in (the editor preview) set the session itself, checked
    // against its own state value; the marker has nothing left to protect.
    if (!(result as { redirected?: boolean }).redirected) clearPendingSignIn();
    return { error: result.error?.message ?? null };
  };

  const signOut = async (opts?: { scope?: "local" | "others" | "global" }) => {
    const scope = opts?.scope ?? "local";
    if (scope === "others") {
      // Not a sign-out of this device: nothing here is cleared.
      await supabase.auth.signOut({ scope });
      return;
    }
    userSignedOut.current = true;
    markDeliberateSignOut();
    clearPersonalBrowserData();
    try {
      await supabase.auth.signOut({ scope });
    } finally {
      // The SIGNED_OUT listener runs inside that call; clear once more after it.
      clearPersonalBrowserData();
      setStashState({ kind: "none" });
    }
  };

  const signOutEverywhere = () => signOut({ scope: "global" });

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, loading, signUp, signIn, signInWithGoogle, signOut, signOutEverywhere,
      sessionExpired, guardResult, ensureGuard, stashState, acceptStashedSession, rejectStashedSession,
    }}>
      {children}
      {stashState.kind === "interstitial" && (
        <SignedInAsInterstitial
          maskedEmail={stashState.maskedEmail}
          busy={interstitialBusy}
          onContinue={() => { void acceptStashedSession(); }}
          onSignOut={rejectStashedSession}
        />
      )}
    </AuthContext.Provider>
  );
}

/** Where an emailed confirmation or sign-in link lands: the confirm step, which acts only on a press. */
export function confirmRedirect(next?: string | null): string {
  const safe = safeNextPath(next);
  const tail = safe === DEFAULT_AFTER_AUTH ? "" : `&next=${encodeURIComponent(safe)}`;
  return `${window.location.origin}/auth?mode=confirm${tail}`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
