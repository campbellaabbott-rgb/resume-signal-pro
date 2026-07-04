// Auth context — free accounts so users can track scores across scans and
// see their credits and purchases. Supabase email auth; session persists
// via the supabase client's built-in storage.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
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

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/account` },
    });
    return { error: error?.message ?? null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle = async () => {
    sessionStorage.setItem("auth_redirect_after_login", "/account");
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
