// Auth context — free accounts so users can track scores across scans and
// see their credits and purchases. Supabase email auth; session persists
// via the supabase client's built-in storage.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

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

  useEffect(() => {
    // Listener FIRST, then getSession — avoids missing an auth event
    // that fires between the two calls.
    let hadSession = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // A session vanishing without an explicit sign-out = expiry/revocation.
      // Surfacing it lets the auth page say "session expired" instead of
      // silently dumping the user to a logged-out state.
      if (hadSession && !s && event !== "SIGNED_OUT") setSessionExpired(true);
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
      options: { emailRedirectTo: `${window.location.origin}${safeNextPath(next)}` },
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
