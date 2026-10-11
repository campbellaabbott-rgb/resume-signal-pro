// Auth context — free accounts so users can track scores across scans and
// see their credits and purchases. Supabase email auth; session persists
// via the supabase client's built-in storage.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { TERMS_VERSION } from "@/config/terms";

/**
 * WHAT A NEW ACCOUNT AGREED TO (commercial-readiness plan item 12). The sign-up
 * button carries "By continuing you agree to the Terms"; the account stores
 * which Terms and when, in its own metadata, with no new table.
 */
export function termsAcceptance(now: Date = new Date()): { terms_version: string; terms_accepted_at: string } {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() };
}

/**
 * WHERE TO GO AFTER SIGNING IN. Every sign-in path used to hard-navigate to
 * /account, which is wrong for the two pages that send a person to sign in
 * mid-task: the OAuth consent page (an agent host is waiting on the other
 * side of it) and the post-purchase pass page (the receipt is in the URL).
 * Both pass `?next=` to /auth, and /auth hands it back to every sign-in
 * method here.
 *
 * ONLY A SAME-ORIGIN RELATIVE PATH IS HONOURED. `next` arrives in a URL
 * anyone can write, so an absolute URL, a scheme, a protocol-relative
 * `//host` or a backslash (browsers read `/\host` as `//host`) would turn
 * the sign-in page into an open redirect. Anything that is not a plain path
 * starting with a single slash falls back to the account page.
 */
export const DEFAULT_AFTER_AUTH = "/account";
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_AFTER_AUTH;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || /[\\\s]/.test(s) || /^\/[^/?#]*:/.test(s)) return DEFAULT_AFTER_AUTH;
  return s;
}

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

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** `next` is where a confirmation link should land — see safeNextPath. */
  signUp: (email: string, password: string, next?: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: (next?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** True when a previously-active session disappeared (token expiry/revocation) */
  sessionExpired: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  loading: true,
  signUp: async () => ({ error: "not ready" }),
  signIn: async () => ({ error: "not ready" }),
  signInWithGoogle: async () => ({ error: "not ready" }),
  signOut: async () => {},
  sessionExpired: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const userSignedOut = useRef(false);

  useEffect(() => {
    // Listener FIRST, then getSession — avoids missing an auth event
    // that fires between the two calls.
    let hadSession = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // A session vanishing without THE USER signing out = expiry/revocation.
      // auth-js reports a failed refresh as SIGNED_OUT too, so the event name
      // cannot tell the two apart (platform sweep L3-20: this never fired);
      // the sign-out button sets userSignedOut first, and only that is quiet,
      // in this tab and (through its shared mark) in every other one.
      if (hadSession && !s && !userSignedOut.current && !signOutWasDeliberate()) setSessionExpired(true);
      if (!s) { hadSession = false; userSignedOut.current = false; }
      if (s) {
        hadSession = true;
        setSessionExpired(false);
        if (s.user?.email) localStorage.setItem("rb_last_email", s.user.email);
      }
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string, next?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${safeNextPath(next)}`, data: termsAcceptance() },
    });
    return { error: error?.message ?? null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async (next?: string) => {
    sessionStorage.setItem("auth_redirect_after_login", safeNextPath(next));
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    return { error: result.error?.message ?? null };
  };

  const signOut = async () => {
    userSignedOut.current = true;
    markDeliberateSignOut();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signUp, signIn, signInWithGoogle, signOut, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
