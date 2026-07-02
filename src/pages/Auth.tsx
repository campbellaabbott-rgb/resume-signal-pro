// Sign in / create account. Free accounts exist to track scan scores over
// time and surface credits + purchases — no gating of the free scan itself.

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, Loader2, UserPlus, LogIn } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export default function Auth() {
  const { session, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);

  const resendConfirmation = async () => {
    const { error: err } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    setNotice(err ? null : "Confirmation email resent — check your inbox.");
    setError(err ? err.message : null);
  };

  useEffect(() => {
    if (session) navigate("/account", { replace: true });
  }, [session, navigate]);

  const submit = async () => {
    setError(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    const fn = mode === "signup" ? signUp : signIn;
    const { error: err } = await fn(email.trim(), password);
    setBusy(false);
    if (err) {
      setError(/email not confirmed/i.test(err)
        ? "Your email isn't confirmed yet — check your inbox for the confirmation link (it may be in spam)."
        : err);
      setShowResend(/email not confirmed/i.test(err));
    } else if (mode === "signup") {
      setNotice("Account created! Check your inbox for a confirmation link, then come back and sign in.");
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4 pt-24 pb-16">
        <div className="w-full max-w-sm">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h1 className="text-xl font-bold text-foreground mb-1">
              {mode === "signup" ? "Create your free account" : "Welcome back"}
            </h1>
            <p className="text-xs text-muted-foreground mb-5">
              Track your resume scores over time, keep your scan history, and see your credits and purchases in one place. Free forever.
            </p>

            <label className="block text-xs font-medium text-foreground mb-1">Email</label>
            <div className="relative mb-3">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <label className="block text-xs font-medium text-foreground mb-1">Password</label>
            <div className="relative mb-4">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="At least 8 characters"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {error && <p className="text-xs text-destructive mb-3">{error}</p>}
            {showResend && (
              <button onClick={resendConfirmation} className="text-xs text-primary hover:underline mb-3 block">
                Resend confirmation email
              </button>
            )}
            {notice && <p className="text-xs text-success mb-3">{notice}</p>}

            <button
              onClick={submit}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === "signup" ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
              {mode === "signup" ? "Create free account" : "Sign in"}
            </button>

            <button
              onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(null); setNotice(null); }}
              className="mt-3 w-full text-center text-xs text-primary hover:underline"
            >
              {mode === "signup" ? "Already have an account? Sign in" : "New here? Create a free account"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground text-center mt-4">
            Your resume is never stored — accounts only keep your scores, credits and purchases.{" "}
            <Link to="/privacy" className="underline">Privacy</Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
