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
import { CREDIT_SESSIONS_KEY, FREELANCE_PURCHASE_KEY } from "@/lib/purchase-proofs";
import { resolveTokens, revoke, type Probed } from "@/lib/auth-probe";
import {
  DEFAULT_AFTER_AUTH,
  SESSION_ENDED_MARK_KEY,
  clearPendingSignIn,
  clearStash,
  discardStashedSession,
  jwtClaims,
  peekStashed,
  pendingMatches,
  readPendingSignIn,
  safeNextPath,
  setPendingSignIn,
} from "@/lib/auth-fragment";
import { SignedInAsInterstitial } from "@/components/auth/SignedInAsInterstitial";
import { LinkSignInBanner } from "@/components/auth/LinkSignInBanner";
import { loadAuthStrings } from "@/i18n/auth/load";

/**
 * A SESSION THAT ENDED WITHOUT A SIGN-OUT, FOR THE CHECKOUT'S ONE QUESTION
 * (S12-087; lead decision G, third fixer round). Written only when a
 * signed-in session vanishes and nobody pressed sign-out (an expiry, a
 * revocation), cleared by the next sign-in and by a deliberate sign-out. The
 * checkout keys its "Have Pro? Sign in first" question on this mark alone:
 * the last address (rb_last_email) is also written by EmailReportCapture for
 * anyone who asks for their report, and keying on it told visitors with no
 * account that their session had ended. The key lives in auth-fragment.ts so
 * the checkout hook reads it even where a test mocks this module away.
 */
export { SESSION_ENDED_MARK_KEY };

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
 *
 * Two marks: the full one (the person signed out of their own session, so
 * every tab also clears its personal session copies, S12-181), and a quiet
 * one (a session a link put here was turned away, or the account guard ended
 * it), which is no expiry but clears nothing of the visitor's.
 */
export const SIGN_OUT_MARK_KEY = "rb_signed_out_at";
export const QUIET_SIGN_OUT_MARK_KEY = "rb_signed_out_quiet_at";
const SIGN_OUT_MARK_MS = 60_000;
function mark(key: string): void {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* storage blocked: this tab's flag still holds */ }
}
function markedWithin(key: string, now: number): boolean {
  try {
    const at = Number(localStorage.getItem(key));
    return Number.isFinite(at) && at > 0 && now >= at && now - at < SIGN_OUT_MARK_MS;
  } catch {
    return false;
  }
}
export function signOutWasDeliberate(now: number = Date.now()): boolean {
  return markedWithin(SIGN_OUT_MARK_KEY, now) || markedWithin(QUIET_SIGN_OUT_MARK_KEY, now);
}

/**
 * WHAT A DELIBERATE SIGN-OUT LEAVES BEHIND: NOTHING PERSONAL (register CP-012).
 * On a shared computer the next person used to find the last person's email
 * prefilled at checkout and sign-in, their résumé copies, their cached
 * reports, and their purchase proofs (whose credits the next person could
 * spend, beside the buyer's full address). A sign-out pressed on purpose, or
 * an account deletion, now removes every key below, in every open tab; an
 * expired session removes none (the same person comes back to it). Each key
 * is the one its writer uses: a test holds them equal.
 */
export const PERSONAL_LOCAL_KEYS: readonly string[] = [
  "rb_last_email",      // AuthContext, EmailReportCapture: the last address used here
  "scanCreditsEmail",   // use-scan-credits, use-pro-subscription: an address typed at a checkout
  "rb_guard_seen",      // this module: the account guard's last answer
  SESSION_ENDED_MARK_KEY, // this module: a session that ended without a sign-out (use-product-checkout asks once on it)
  CREDIT_SESSIONS_KEY,  // use-scan-credits: the Stripe session ids of credit purchases made here
  FREELANCE_PURCHASE_KEY, // FreelanceBoost: that this browser bought one
];
export const PERSONAL_SESSION_KEYS = [
  "rb_resume_text", "rb_linkedin_text", "rb_job_description_text", "rb_multi_column_detected", // use-session-resume
  "rb_resume_for_fit", "rb_scan_industry",  // Index
  "rb_board_resume",                        // Jobs
  "rb_scan_fixes",                          // FreeKeywordResults, GapReport
  "rb_boost_insert",                        // ResumeBuilder's hand-off
  "rb_prestored_resume_session", "rb_checkout_retry", // use-product-checkout
  "rb_jd_handoff",                          // jd-handoff
] as const;

/** The "signed in from a link" banner, per tab (LinkSignInBanner). */
export const LINK_BANNER_KEY = "rb_link_banner";

/** What one tab holds for the person: its session copies and its stash. */
function clearThisTabsPersonalData(): void {
  try { for (const k of PERSONAL_SESSION_KEYS) sessionStorage.removeItem(k); } catch { /* storage blocked: nothing kept */ }
  try { sessionStorage.removeItem(LINK_BANNER_KEY); } catch { /* nothing kept */ }
  clearStash();
}

export function clearPersonalBrowserData(): void {
  try { for (const k of PERSONAL_LOCAL_KEYS) localStorage.removeItem(k); } catch { /* storage blocked: nothing kept */ }
  clearThisTabsPersonalData();
  clearLocalResumeCopies();
  clearPendingSignIn();
}

/**
 * WHAT A SESSION TURNED AWAY LEFT HERE, AND NOTHING ELSE (review of R1). The
 * person who presses "Not you?" after a link signed them in is NOT that
 * account's owner: their own builder draft, scans and reports stay. Only what
 * the rejected session wrote goes: the address it recorded, the guard's
 * answer for it, the link's parts in the stash, the marker and the banner.
 */
function forgetSessionTraces(): void {
  try { localStorage.removeItem("rb_last_email"); localStorage.removeItem("rb_guard_seen"); } catch { /* storage blocked */ }
  try { sessionStorage.removeItem(LINK_BANNER_KEY); } catch { /* storage blocked */ }
  discardStashedSession();
  clearPendingSignIn();
}

// ── the account guard (auth-signed-in) ──────────────────────────────────────

/**
 * WHAT THE ACCOUNT GUARD SAID ABOUT THIS SESSION. auth-signed-in records the
 * first proof that this account's address is its owner's (a code, a link, a
 * provider), and clears a password someone set on the address before that
 * proof (D15). It is asked once per session (keyed by the token's session_id),
 * never blocks the app, and is awaited only by the password reset, which must
 * not set a new password the guard could then clear. signedOut: the guard
 * had to end every session, this one included (the person signs in again).
 */
export type GuardResult = {
  state: "idle" | "pending" | "done" | "failed";
  proven: boolean;
  passwordCleared: boolean;
  signedOut: boolean;
  reason: string | null;
  status: number | null;
};
export const GUARD_IDLE: GuardResult = { state: "idle", proven: false, passwordCleared: false, signedOut: false, reason: null, status: null };
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
    const r = { ...c, signedOut: c.signedOut === true };
    if (r.state === "done" && (r.proven || now - r.at < GUARD_RECHECK_MS)) return r;
    if (r.state === "failed" && now - r.at < GUARD_FAILED_RECHECK_MS) return r;
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
    const d = data as { proven?: unknown; passwordCleared?: unknown; signedOut?: unknown; reason?: unknown } | null;
    if (!error && d && typeof d.proven === "boolean") {
      return { state: "done", proven: d.proven, passwordCleared: d.passwordCleared === true, signedOut: d.signedOut === true, reason: typeof d.reason === "string" ? d.reason : null, status: 200 };
    }
    const ctx = (error as { context?: { status?: number; clone?: () => { json: () => Promise<unknown> } } } | null)?.context;
    let reason: string | null = error ? "error" : "unreadable_answer";
    // A refused proof (409 changed_since_sign_in) can still have cleared the
    // pre-proof password, and the body says so: that is explained like a 200's.
    let passwordCleared = false;
    let signedOut = false;
    try {
      const body = ctx?.clone ? (await ctx.clone().json()) as { reason?: unknown; error?: unknown; passwordCleared?: unknown; signedOut?: unknown } : null;
      if (typeof body?.reason === "string") reason = body.reason;
      else if (typeof body?.error === "string") reason = body.error;
      passwordCleared = body?.passwordCleared === true;
      signedOut = body?.signedOut === true;
    } catch { /* no body */ }
    return { state: "failed", proven: false, passwordCleared, signedOut, reason, status: typeof ctx?.status === "number" ? ctx.status : null };
  } catch {
    return { state: "failed", proven: false, passwordCleared: false, signedOut: false, reason: "network", status: null };
  }
}

function tr(key: string, fallback: string): string {
  try { return i18next.isInitialized ? i18next.t(key, fallback) : fallback; } catch { return fallback; }
}

// ── a session that arrived in the URL ───────────────────────────────────────

/**
 * WHAT HAPPENED TO A SESSION THE FIRST SCRIPT FOUND IN THE URL (login-CSRF
 * protection). The tokens are first resolved through a client that keeps
 * nothing (src/lib/auth-probe.ts), so the account is the one the auth server
 * names, never the one the token claims. They are adopted without a question
 * only when this browser started a sign-in in the last hour for that same
 * address (the pending marker); otherwise "Is this your account?" asks first,
 * BEFORE any session exists here. A stashed error (an expired link, a
 * cancelled provider) is handed to the sign-in page, or explained where the
 * link landed, once.
 */
export type StashState =
  | { kind: "none" }
  | { kind: "adopting"; next: string | null; type: string | null }
  | { kind: "adopted"; next: string | null; type: string | null }
  | { kind: "interstitial"; email: string; type: string | null }
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
    return { kind: "adopting", next: readPendingSignIn()?.next ?? null, type };
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
  /**
   * This device only unless a scope is named. A deliberate sign-out clears
   * what the person left in this browser; keepLocalWork (a session a link put
   * here, turned away) clears only what that session wrote.
   */
  signOut: (opts?: { scope?: "local" | "others" | "global"; keepLocalWork?: boolean }) => Promise<void>;
  /** Every device this account is signed in on. */
  signOutEverywhere: () => Promise<void>;
  /** True when a previously-active session disappeared (token expiry/revocation) */
  sessionExpired: boolean;
  /** The account guard's answer for the current session. */
  guardResult: GuardResult;
  /** Ask the account guard about this session (once per session; concurrent callers share one call). */
  ensureGuard: (session?: Session | null, opts?: { fresh?: boolean }) => Promise<GuardResult>;
  /** A password reset is on screen: the guard's "password cleared" notice would only confuse it. */
  setResetUnderway: (on: boolean) => void;
  /** Hand a session resolved by src/lib/auth-probe.ts to the site's client (the person said yes, or started it). */
  adoptSession: (p: Probed, opts?: { recovery?: boolean; banner?: boolean }) => Promise<boolean>;
  /** A session that arrived in the URL, and what became of it. */
  stashState: StashState;
  /** The sign-in page showed the stash's error or failure: it is not shown again. */
  clearStashOutcome: () => void;
  /** The "Is this your account?" prompt's Continue. */
  acceptStashedSession: () => Promise<void>;
  /** The prompt's "Not me": nothing was signed in, and the link's session is ended. */
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
  setResetUnderway: () => {},
  adoptSession: async () => false,
  stashState: { kind: "none" },
  clearStashOutcome: () => {},
  acceptStashedSession: async () => {},
  rejectStashedSession: () => {},
});

function readBanner(): { email: string } | null {
  try {
    const b = JSON.parse(sessionStorage.getItem(LINK_BANNER_KEY) ?? "null") as { email?: unknown } | null;
    return b && typeof b.email === "string" && b.email.includes("@") ? { email: b.email } : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [guardResult, setGuardResult] = useState<GuardResult>(GUARD_IDLE);
  const [stashState, setStashState] = useState<StashState>(initialStashState);
  const [interstitialBusy, setInterstitialBusy] = useState(false);
  const [banner, setBannerState] = useState<{ email: string } | null>(readBanner);
  const userSignedOut = useRef(false);
  const inflight = useRef(new Map<string, Promise<GuardResult>>());
  const currentKey = useRef<string | null>(null);
  const resetUnderway = useRef(false);
  const resolved = useRef<Probed | null>(null);

  const setBanner = useCallback((b: { email: string } | null) => {
    try {
      if (b) sessionStorage.setItem(LINK_BANNER_KEY, JSON.stringify(b));
      else sessionStorage.removeItem(LINK_BANNER_KEY);
    } catch { /* the banner still shows in this page */ }
    setBannerState(b);
  }, []);

  const setResetUnderway = useCallback((on: boolean) => { resetUnderway.current = on; }, []);

  /** The guard ended every session, this one too: leave quietly, keeping the visitor's work. */
  const leaveEndedSession = useCallback(() => {
    userSignedOut.current = true;
    mark(QUIET_SIGN_OUT_MARK_KEY);
    void supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }, []);

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
      // Kept only while that session is still this tab's: an answer arriving
      // after a sign-out is not left behind for the next person.
      if (currentKey.current === key) writeGuardCache({ ...r, key, at: Date.now() });
      // A failed ask is asked again once its cache window passes; an answer
      // stays this tab's answer for the session (and survives blocked storage).
      if (r.state === "failed") inflight.current.delete(key);
      if (currentKey.current === key) setGuardResult(r);
      // Read when the answer arrives, not when the ask left: a reset screen
      // that mounted meanwhile still silences the notice (live recovery
      // sessions carry amr "otp", so the token cannot say it is a reset).
      const quiet = resetUnderway.current;
      // These notices show wherever the sign-in landed, which may be a page
      // that never loads the auth strings: they are loaded first (lead
      // decision G), and the answer itself is not held back for them.
      if (r.signedOut) {
        if (!quiet) {
          void loadAuthStrings().then(() => {
            toast({
              title: tr("auth.guard.signedOutTitle", "Please sign in again"),
              description: tr("auth.guard.signedOut", "We cleared a password set on this address before you proved you own it, and that signed out every device, this one too."),
            });
          });
        }
        if (currentKey.current === key) leaveEndedSession();
      } else if (r.passwordCleared && !quiet) {
        void loadAuthStrings().then(() => {
          toast({
            title: tr("auth.guard.passwordClearedTitle", "Your old password was cleared"),
            description: tr("auth.guard.passwordCleared", "We cleared a password set on this address before you proved you own it. Set a new one in your account settings if you want one."),
          });
        });
      }
      return r;
    });
    inflight.current.set(key, run);
    return run;
  }, [leaveEndedSession]);

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
      if (hadSession && !s && !userSignedOut.current && !signOutWasDeliberate()) {
        setSessionExpired(true);
        // The one event the checkout's "Have Pro? Sign in first" question keys on.
        mark(SESSION_ENDED_MARK_KEY);
      }
      // Another tab's deliberate sign-out: this tab's own copies go too (S12-181).
      if (hadSession && !s && !userSignedOut.current && markedWithin(SIGN_OUT_MARK_KEY, Date.now())) clearThisTabsPersonalData();
      if (!s) {
        hadSession = false; userSignedOut.current = false; currentKey.current = null; setGuardResult(GUARD_IDLE);
        try { sessionStorage.removeItem(LINK_BANNER_KEY); } catch { /* storage blocked */ }
        setBannerState(null);
      }
      if (s) {
        hadSession = true;
        setSessionExpired(false);
        try { if (s.user?.email) localStorage.setItem("rb_last_email", s.user.email); } catch { /* storage blocked */ }
        try { localStorage.removeItem(SESSION_ENDED_MARK_KEY); } catch { /* storage blocked */ }
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

  // Another tab's deliberate sign-out, heard through the shared mark even
  // when this tab held no session (S12-181): its personal copies go too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SIGN_OUT_MARK_KEY && e.newValue) clearThisTabsPersonalData();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // What the first read left in the stash and will never use: an error it has
  // now taken, or tokens too old to adopt. An error that landed anywhere but
  // the sign-in page is explained where it landed, once (S12-182).
  useEffect(() => {
    if (stashState.kind === "error" || (stashState.kind === "none" && peekStashed("access_token"))) discardStashedSession();
    // A return that failed (a cancelled or refused provider sign-in) spends
    // the marker that was waiting for it (lead decision E).
    if (stashState.kind === "error") clearPendingSignIn();
    if (stashState.kind === "error" && window.location.pathname.replace(/\/+$/, "") !== "/auth") {
      // The auth strings load lazily and this notice shows on pages that
      // never load them: they are in before it is worded.
      void loadAuthStrings().then(() => {
        toast({
          title: tr("auth.return.failed", "Sign-in didn't finish. Please try again."),
          description: tr("auth.confirm.expired", "This link has expired or was already used. Sign in again to get a new one."),
        });
      });
      setStashState({ kind: "none" });
    }
    // Once, for the read the provider started with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Hand a resolved session to the site's own client. */
  const adoptSession = useCallback(async (p: Probed, opts?: { recovery?: boolean; banner?: boolean }): Promise<boolean> => {
    if (opts?.recovery) resetUnderway.current = true;
    try {
      const { error } = await supabase.auth.setSession({ access_token: p.session.access_token, refresh_token: p.session.refresh_token });
      if (error) return false;
      if (opts?.banner) setBanner({ email: p.email });
      return true;
    } catch {
      return false;
    }
  }, [setBanner]);

  // A session the first script found in the URL: resolved first, then adopted
  // only when this browser started a sign-in for that same address.
  const adoptStarted = useRef(false);
  useEffect(() => {
    if (stashState.kind !== "adopting" || adoptStarted.current) return;
    adoptStarted.current = true;
    const access = peekStashed("access_token");
    const refresh = peekStashed("refresh_token");
    const { type } = stashState;
    discardStashedSession();
    if (!access || !refresh) { setStashState({ kind: "failed", type }); return; }
    void (async () => {
      const r = await resolveTokens(access, refresh);
      // A return the auth server refused spends the marker that waited for it.
      if ("error" in r) { clearPendingSignIn(); setStashState({ kind: "failed", type }); return; }
      const pending = readPendingSignIn();
      if (!pendingMatches(pending, r.email)) {
        resolved.current = r;
        setStashState({ kind: "interstitial", email: r.email, type });
        return;
      }
      clearPendingSignIn();
      // A session adopted under a marker that could not name the address (a
      // provider press) ALWAYS shows the address until dismissed, whatever
      // the link type says or does not say: a crafted token pair carries no
      // type at all (lead decision E).
      const banner = !pending?.email;
      const ok = await adoptSession(r, { recovery: type === "recovery", banner });
      setStashState(ok ? { kind: "adopted", next: pending?.next ?? null, type } : { kind: "failed", type });
    })();
  }, [stashState, adoptSession]);

  const acceptStashedSession = useCallback(async () => {
    if (stashState.kind !== "interstitial") return;
    const { type } = stashState;
    const r = resolved.current;
    resolved.current = null;
    discardStashedSession();
    if (!r) { setStashState({ kind: "failed", type }); return; }
    setInterstitialBusy(true);
    try {
      const ok = await adoptSession(r, { recovery: type === "recovery" });
      setStashState(ok ? { kind: "adopted", next: null, type } : { kind: "failed", type });
    } finally {
      setInterstitialBusy(false);
    }
  }, [stashState, adoptSession]);

  const rejectStashedSession = useCallback(() => {
    void revoke(resolved.current?.session);
    resolved.current = null;
    discardStashedSession();
    // "Not me": whatever sign-in this browser had pending is not this one, and is over.
    clearPendingSignIn();
    setStashState({ kind: "none" });
  }, []);

  const clearStashOutcome = useCallback(() => {
    setStashState((s) => (s.kind === "error" || s.kind === "failed" ? { kind: "none" } : s));
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
    // started it: the marker first, then the broker. A provider marker lives
    // ten minutes, is spent by any return, and what it adopts carries the
    // "Signed in as" banner (lead decision E).
    setPendingSignIn(next, undefined, null, { provider: true });
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth?mode=return`,
    });
    // A pop-up sign-in (the editor preview) set the session itself, checked
    // against its own state value; the marker has nothing left to protect.
    if (!(result as { redirected?: boolean }).redirected) clearPendingSignIn();
    return { error: result.error?.message ?? null };
  };

  const signOut = async (opts?: { scope?: "local" | "others" | "global"; keepLocalWork?: boolean }) => {
    const scope = opts?.scope ?? "local";
    if (scope === "others") {
      // Not a sign-out of this device: nothing here is cleared.
      await supabase.auth.signOut({ scope });
      return;
    }
    userSignedOut.current = true;
    // A guard answer still in flight for this session is no longer kept.
    currentKey.current = null;
    if (opts?.keepLocalWork) {
      mark(QUIET_SIGN_OUT_MARK_KEY);
      forgetSessionTraces();
      try {
        await supabase.auth.signOut({ scope: "local" });
      } finally {
        forgetSessionTraces();
        setStashState({ kind: "none" });
        setBanner(null);
      }
      return;
    }
    mark(SIGN_OUT_MARK_KEY);
    clearPersonalBrowserData();
    try {
      await supabase.auth.signOut({ scope });
    } finally {
      // The SIGNED_OUT listener runs inside that call; clear once more after it.
      clearPersonalBrowserData();
      setStashState({ kind: "none" });
      setBanner(null);
    }
  };

  const signOutEverywhere = () => signOut({ scope: "global" });

  return (
    <AuthContext.Provider value={{
      session, user: session?.user ?? null, loading, signUp, signIn, signInWithGoogle, signOut, signOutEverywhere,
      sessionExpired, guardResult, ensureGuard, setResetUnderway, adoptSession, stashState, clearStashOutcome,
      acceptStashedSession, rejectStashedSession,
    }}>
      {children}
      {stashState.kind === "interstitial" && (
        <SignedInAsInterstitial
          email={stashState.email}
          busy={interstitialBusy}
          onContinue={() => { void acceptStashedSession(); }}
          onCancel={rejectStashedSession}
        />
      )}
      {banner && session && stashState.kind !== "interstitial" && (
        <LinkSignInBanner
          email={banner.email}
          onDismiss={() => setBanner(null)}
          onNotYou={() => { void signOut({ keepLocalWork: true }); }}
        />
      )}
    </AuthContext.Provider>
  );
}

/** Where an emailed confirmation or sign-in link lands: the confirm step, which acts only on a press. */
export function confirmRedirect(next?: string | null): string {
  const safe = safeNextPath(next);
  const tail = safe === DEFAULT_AFTER_AUTH ? "" : `&next=${encodeURIComponent(safe)}`;
  return `${window.location.origin}/auth?mode=confirm${tail}${mailLanguageParam()}`;
}

/**
 * THE LANGUAGE THE AUTH MAIL IS WRITTEN IN (S12-180). The mail is built by the
 * auth hook from the auth server's payload, which carries no locale, only the
 * link the page asked for. So the page names its language in that link, and
 * the hook reads it back from the redirect. English needs no parameter.
 */
export const MAIL_LANGUAGES: readonly string[] = ["en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
export function mailLanguageParam(lng: string | null | undefined = i18next.language): string {
  const want = String(lng ?? "");
  const code = MAIL_LANGUAGES.includes(want) ? want : MAIL_LANGUAGES.includes(want.split("-")[0]) ? want.split("-")[0] : null;
  return code ? `&lng=${encodeURIComponent(code)}` : "";
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
