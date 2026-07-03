// Sign in / create account. Free accounts exist to track scan scores over
// time and surface credits + purchases — no gating of the free scan itself.

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, Loader2, UserPlus, LogIn, Eye, EyeOff } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);

  const sendMagicLink = async () => {
    setError(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError("Enter your email above first, then request the link.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/account` },
    });
    setBusy(false);
    if (err) setError(/rate limit/i.test(err.message)
      ? "Too many email attempts in a short time — please wait a few minutes and try again."
      : err.message);
    else setNotice("Magic link sent — click it in your inbox and you're in. No password needed.");
  };

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
      if (/already registered|already exists/i.test(err) && mode === "signup") {
        // Not an error at all — help them straight into sign-in
        setMode("signin");
        setNotice("You already have an account with this email — enter your password to sign in, or use the sign-in link below.");
        return;
      }
      const friendly = /email not confirmed/i.test(err)
        ? "Your email isn't confirmed yet — check your inbox for the confirmation link (it may be in spam)."
        : /rate limit/i.test(err)
          ? "Too many email attempts in a short time — please wait a few minutes and try again. (If this keeps happening, try the sign-in link option instead.)"
          : /invalid login credentials/i.test(err)
            ? "That email and password don't match. Double-check the password, or use \"Email me a sign-in link\" below — no password needed."
            : /weak password|should be at least/i.test(err)
              ? "That password is too weak — use at least 8 characters."
              : err;
      setError(friendly);
      setShowResend(/email not confirmed/i.test(err));
    } else if (mode === "signup") {
      // With email confirmation disabled, a session arrives immediately and the
      // redirect effect takes over. Only mention the inbox when there's no session.
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) setNotice("Account created! Check your inbox for a confirmation link, then come back and sign in.");
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
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="At least 8 characters"
                className="w-full pl-9 pr-10 py-2.5 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
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
              onClick={sendMagicLink}
              disabled={busy}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-foreground font-medium text-sm hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60 transition-colors"
            >
              <Mail className="w-4 h-4" />
              Email me a sign-in link instead
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
