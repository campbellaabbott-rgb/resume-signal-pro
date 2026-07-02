// Account dashboard: score history over time, scan credits, and purchases.
// Scans come straight from user_scans (RLS: own rows). Credits and purchases
// key by email in service-role tables, so they're fetched through the
// get-account-data edge function using the caller's JWT.

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { TrendingUp, Coins, ShoppingBag, LogOut, Loader2, ScanSearch } from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface UserScan {
  id: string;
  ats_score: number;
  projected_score: number | null;
  industry: string | null;
  verdict: string | null;
  created_at: string;
}

interface AccountData {
  credits: number;
  purchases: Array<{ product: string; date: string }>;
}

export default function Account() {
  const { session, user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [scans, setScans] = useState<UserScan[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      setFetching(true);
      const [scansRes, accountRes] = await Promise.all([
        supabase.from("user_scans").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.functions.invoke("get-account-data").catch(() => ({ data: null, error: true })),
      ]);
      if (scansRes.data) setScans(scansRes.data as UserScan[]);
      const acc = (accountRes as { data?: { credits?: number; purchases?: AccountData["purchases"] } }).data;
      setAccount({ credits: acc?.credits ?? 0, purchases: acc?.purchases ?? [] });
      setFetching(false);
    })();
  }, [session]);

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const best = scans.length ? Math.max(...scans.map(s => s.ats_score)) : null;
  const latest = scans[0] ?? null;
  const delta = scans.length >= 2 ? scans[0].ats_score - scans[1].ats_score : null;

  // Simple inline score-over-time chart (oldest → newest)
  const chartScans = [...scans].reverse();
  const W = 560, H = 120;
  const points = chartScans.map((s, i) => {
    const x = chartScans.length > 1 ? (i / (chartScans.length - 1)) * (W - 20) + 10 : W / 2;
    const y = H - 12 - (s.ats_score / 100) * (H - 28);
    return { x, y, score: s.ats_score };
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container max-w-3xl pt-24 pb-16">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Your account</h1>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <button
            onClick={async () => { await signOut(); navigate("/"); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{latest ? latest.ats_score : "—"}</p>
            <p className="text-[11px] text-muted-foreground">Latest score{delta != null && (
              <span className={delta >= 0 ? "text-success" : "text-destructive"}> ({delta >= 0 ? "+" : ""}{delta})</span>
            )}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{best ?? "—"}</p>
            <p className="text-[11px] text-muted-foreground">Best score</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{fetching ? "…" : account?.credits ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">Scan credits</p>
          </div>
        </div>

        {/* Score history */}
        <div className="rounded-2xl border border-border bg-card p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground text-sm">Score history</h2>
            <span className="ml-auto text-xs text-muted-foreground">{scans.length} scan{scans.length !== 1 ? "s" : ""}</span>
          </div>
          {scans.length === 0 ? (
            <div className="text-center py-8">
              <ScanSearch className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">No scans saved yet — run a free scan while signed in and it lands here automatically.</p>
              <Link to="/#upload" className="inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                Scan my resume
              </Link>
            </div>
          ) : (
            <>
              {points.length >= 2 && (
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28 mb-3" role="img" aria-label="ATS score over time">
                  <polyline
                    points={points.map(p => `${p.x},${p.y}`).join(" ")}
                    className="fill-none stroke-primary"
                    strokeWidth={2}
                  />
                  {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} className={p.score >= 70 ? "fill-success" : p.score >= 50 ? "fill-warning" : "fill-destructive"} />
                  ))}
                </svg>
              )}
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {scans.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 text-sm border border-border/50 rounded-lg px-3 py-2">
                    <span className={`font-bold w-8 ${s.ats_score >= 70 ? "text-success" : s.ats_score >= 50 ? "text-warning" : "text-destructive"}`}>{s.ats_score}</span>
                    <span className="text-muted-foreground text-xs capitalize flex-1 truncate">{(s.industry ?? "").replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{new Date(s.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Credits + purchases */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-warning" />
              <h2 className="font-semibold text-foreground text-sm">Scan credits</h2>
            </div>
            <p className="text-3xl font-bold text-foreground mb-1">{fetching ? "…" : account?.credits ?? 0}</p>
            <p className="text-xs text-muted-foreground mb-3">Credits are linked to your email and never expire.</p>
            <Link to="/pricing" className="text-xs text-primary hover:underline">Get more credits →</Link>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <ShoppingBag className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground text-sm">Purchases</h2>
            </div>
            {fetching ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            ) : (account?.purchases.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No purchases yet. Anything you buy with this email shows up here.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {account!.purchases.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border border-border/50 rounded-lg px-2.5 py-1.5">
                    <span className="text-foreground truncate">{p.product}</span>
                    <span className="text-muted-foreground shrink-0 ml-2">{new Date(p.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
