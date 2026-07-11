// Account dashboard: score history, target goal, fix checklist, scan compare,
// application tracker, credits, and purchases. Scans/profile/applications come
// straight from RLS-protected tables; credits and purchases key by email in
// service-role tables and are fetched through the get-account-data function.

import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  TrendingUp, Coins, ShoppingBag, LogOut, Loader2, ScanSearch, Target,
  ListChecks, GitCompare, Briefcase, Plus, Trash2, AlertTriangle, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { SavedSearchesCard } from "@/components/account/SavedSearchesCard";
import { ApplyKitPanel } from "@/components/account/ApplyKitPanel";
import { useProSubscription } from "@/hooks/use-pro-subscription";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { ProSubscriptionCard } from "@/components/ProSubscriptionCard";

interface FixItem { step: string; done: boolean }

interface UserScan {
  id: string;
  ats_score: number;
  projected_score: number | null;
  industry: string | null;
  verdict: string | null;
  red_flag_count: number | null;
  fix_plan: FixItem[] | null;
  label: string | null;
  created_at: string;
  // Present only when the user explicitly saved the document with this
  // version (the opt-in exception to "never stored").
  resume_text?: string | null;
  report_id?: string | null;
}

interface Application {
  id: string;
  company: string;
  role: string;
  status: string;
  scan_id: string | null;
  scan_score: number | null;
  applied_at: string;
  job_posting?: string | null;
  fit_pct?: number | null;
  fit_missing?: string[] | null;
  job_id?: string | null;
  apply_url?: string | null;
  location?: string | null;
}

// Display name for a saved scan acting as a resume version.
const versionName = (s: UserScan) =>
  s.label ?? `${(s.industry ?? "resume").replace(/_/g, " ")} · ${new Date(s.created_at).toLocaleDateString()}`;

interface AccountData {
  credits: number;
  purchases: Array<{ product: string; date: string }>;
}

const toFixPlan = (value: Json | null | undefined): FixItem[] | null => {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is { step: string; done?: boolean } =>
    typeof item === "object" && item !== null && !Array.isArray(item) && typeof item.step === "string"
  );
  return items.map((item) => ({ step: item.step, done: item.done === true }));
};

const mapScanRow = (row: { id: string; ats_score: number; projected_score: number | null; industry: string | null; verdict: string | null; red_flag_count: number | null; fix_plan: Json | null; label: string | null; created_at: string; resume_text?: string | null; report_id?: string | null }): UserScan => ({
  id: row.id,
  ats_score: row.ats_score,
  projected_score: row.projected_score,
  industry: row.industry,
  verdict: row.verdict,
  red_flag_count: row.red_flag_count,
  fix_plan: toFixPlan(row.fix_plan),
  label: row.label,
  created_at: row.created_at,
  resume_text: row.resume_text ?? null,
  report_id: row.report_id ?? null,
});

const fixPlanToJson = (items: FixItem[]): Json => items.map((item) => ({ step: item.step, done: item.done }));

const APP_STATUSES = ["saved", "applied", "interviewing", "offer", "rejected", "no_response"] as const;
const STATUS_STYLES: Record<string, string> = {
  saved: "bg-secondary text-secondary-foreground",
  applied: "bg-primary/10 text-primary",
  interviewing: "bg-warning/10 text-warning",
  offer: "bg-success/10 text-success",
  rejected: "bg-muted text-muted-foreground",
  no_response: "bg-muted text-muted-foreground",
};

export default function Account() {
  const { session, user, loading, signOut } = useAuth();
  const { pro } = useProSubscription();
  const navigate = useNavigate();
  const [scans, setScans] = useState<UserScan[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [targetScore, setTargetScore] = useState<number | null>(null);
  const [fetching, setFetching] = useState(true);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [newApp, setNewApp] = useState({ company: "", role: "" });
  const [newAppScanId, setNewAppScanId] = useState<string>("latest");
  const [fitOpenId, setFitOpenId] = useState<string | null>(null);
  const [fitPosting, setFitPosting] = useState("");
  const [fitLoading, setFitLoading] = useState(false);

  // Per-application posting fit: deterministic keyword coverage of the sent
  // version, computed by the application-fit function and stored on the row.
  const runFitCheck = async (a: Application, version: UserScan) => {
    if (!version.resume_text || fitPosting.trim().length < 100) return;
    setFitLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("application-fit", {
        body: { jobPosting: fitPosting, resumeText: version.resume_text },
      });
      if (error || !data?.success) {
        toast.error("Fit check failed — the feature may still be deploying. Try again shortly.");
        return;
      }
      const { pct, missing } = data.data as { pct: number | null; missing: string[] };
      setApplications(applications.map(x => x.id === a.id ? { ...x, fit_pct: pct, fit_missing: missing, job_posting: fitPosting } : x));
      await supabase.from("user_applications").update({
        job_posting: fitPosting.slice(0, 20000), fit_pct: pct, fit_missing: missing,
      } as never).eq("id", a.id);
    } finally {
      setFitLoading(false);
    }
  };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const loadAll = useCallback(async () => {
    if (!session) return;
    setFetching(true);
    const [scansRes, accountRes, appsRes, profileRes] = await Promise.all([
      supabase.from("user_scans").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.functions.invoke("get-account-data").catch(() => ({ data: null })),
      supabase.from("user_applications").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("user_profiles").select("target_score").eq("user_id", session.user.id).maybeSingle(),
    ]);
    let cloudScans = scansRes.data?.map(mapScanRow) ?? [];

    // One-time import: local scan history from before the account existed.
    // Runs when the cloud is empty and localStorage has entries; marks itself
    // done so it never duplicates.
    try {
      const importedFlag = localStorage.getItem("scan_history_imported");
      const rawLocal = localStorage.getItem("rb_scan_history");
      if (!importedFlag && cloudScans.length === 0 && rawLocal) {
        const parsed = JSON.parse(rawLocal);
        const entries: Array<{ atsScore?: number; industry?: string | null; timestamp?: number | string }> =
          Array.isArray(parsed?.entries) ? parsed.entries : [];
        const rows = entries
          .filter(e => typeof e.atsScore === "number")
          .slice(0, 25)
          .map(e => ({
            user_id: session.user.id,
            ats_score: e.atsScore as number,
            industry: e.industry ?? null,
            created_at: e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString(),
          }));
        if (rows.length > 0) {
          const { error } = await supabase.from("user_scans").insert(rows);
          if (!error) {
            localStorage.setItem("scan_history_imported", "1");
            const refreshed = await supabase.from("user_scans").select("*").order("created_at", { ascending: false }).limit(50);
            cloudScans = refreshed.data?.map(mapScanRow) ?? cloudScans;
          }
        } else {
          localStorage.setItem("scan_history_imported", "1");
        }
      }
    } catch (e) {
      console.warn("[Account] history import skipped:", e);
    }

    setScans(cloudScans);
    setApplications((appsRes.data as unknown as Application[] | null) ?? []);
    setTargetScore((profileRes.data as { target_score?: number } | null)?.target_score ?? null);
    const acc = (accountRes as { data?: { credits?: number; purchases?: AccountData["purchases"] } }).data;
    setAccount({ credits: acc?.credits ?? 0, purchases: acc?.purchases ?? [] });
    setFetching(false);
  }, [session]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const saveTarget = async (value: number) => {
    if (!session) return;
    setTargetScore(value);
    await supabase.from("user_profiles").upsert({ user_id: session.user.id, target_score: value, updated_at: new Date().toISOString() });
  };

  const toggleFixItem = async (scanId: string, index: number) => {
    const scan = scans.find(s => s.id === scanId);
    if (!scan?.fix_plan) return;
    const updated = (scan.fix_plan ?? []).map((f, i) => i === index ? { ...f, done: !f.done } : f);
    setScans(scans.map(s => s.id === scanId ? { ...s, fix_plan: updated } : s));
    await supabase.from("user_scans").update({ fix_plan: fixPlanToJson(updated) }).eq("id", scanId);
  };

  const addApplication = async () => {
    if (!session || !newApp.company.trim()) return;
    const version = newAppScanId === "latest"
      ? scans[0]
      : scans.find(s => s.id === newAppScanId);
    const { data } = await supabase.from("user_applications").insert({
      user_id: session.user.id,
      company: newApp.company.trim(),
      role: newApp.role.trim(),
      scan_id: version?.id ?? null,
      scan_score: version?.ats_score ?? null,
    }).select().single();
    if (data) setApplications([data as unknown as Application, ...applications]);
    setNewApp({ company: "", role: "" });
  };

  const updateAppStatus = async (id: string, status: string) => {
    setApplications(applications.map(a => a.id === id ? { ...a, status } : a));
    await supabase.from("user_applications").update({ status }).eq("id", id);
  };

  const deleteApplication = async (id: string) => {
    setApplications(applications.filter(a => a.id !== id));
    await supabase.from("user_applications").delete().eq("id", id);
  };

  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [labelEditing, setLabelEditing] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const changePassword = async () => {
    if (newPassword.length < 8) { setSettingsMsg("Password must be at least 8 characters."); return; }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSettingsMsg(error ? error.message : "Password updated ✓");
    if (!error) setNewPassword("");
  };

  const changeEmail = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail.trim())) { setSettingsMsg("Enter a valid new email address."); return; }
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setSettingsMsg(error
      ? error.message
      : "Email change requested — check BOTH inboxes for confirmation links. Note: credits and purchases stay linked to your old email.");
    if (!error) setNewEmail("");
  };

  const exportData = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      account: { email: user?.email, memberSince: user?.created_at },
      targetScore,
      scans,
      applications,
      credits: account?.credits ?? 0,
      purchases: account?.purchases ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-booster-data.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveLabel = async (scanId: string) => {
    const label = labelDraft.trim().slice(0, 60) || null;
    setScans(scans.map(s => s.id === scanId ? { ...s, label } : s));
    setLabelEditing(null);
    await supabase.from("user_scans").update({ label }).eq("id", scanId);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("delete-account").catch(() => ({ data: null, error: true }));
    if (!error && (data as { success?: boolean })?.success) {
      await signOut();
      navigate("/");
    } else {
      setDeleting(false);
      setConfirmDelete(false);
      alert("Account deletion failed — please contact support.");
    }
  };

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
  const goal = targetScore ?? 80;
  const goalProgress = latest ? Math.min(100, Math.round((latest.ats_score / goal) * 100)) : 0;
  const goalHit = latest != null && latest.ats_score >= goal;
  const latestFixPlan = scans.find(s => s.fix_plan && s.fix_plan.length > 0);
  const doneFixes = latestFixPlan?.fix_plan?.filter(f => f.done).length ?? 0;

  const compareScans = compareIds
    .map(id => scans.find(s => s.id === id))
    .filter((s): s is UserScan => !!s)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const toggleCompare = (id: string) => {
    setCompareIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev.slice(-1), id]);
  };

  // Score-over-time chart (oldest → newest)
  const chartScans = [...scans].reverse();
  const W = 560, H = 120;
  const points = chartScans.map((s, i) => {
    const x = chartScans.length > 1 ? (i / (chartScans.length - 1)) * (W - 20) + 10 : W / 2;
    const y = H - 12 - (s.ats_score / 100) * (H - 28);
    return { x, y, score: s.ats_score };
  });
  const goalY = H - 12 - (goal / 100) * (H - 28);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container max-w-3xl pt-16 pb-16">
        {/* Identity */}
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 mb-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-primary uppercase">{user?.email?.[0] ?? "?"}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">{user?.email}</h1>
            <p className="text-xs text-muted-foreground">
              Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "today"}
            </p>
          </div>
          <button
            onClick={async () => { await signOut(); navigate("/"); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>

        {/* First-visit activation checklist — an empty dashboard should feel
            like a starting line, not a broken page */}
        {scans.length === 0 && !fetching && (
          <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-6 mb-6">
            <h2 className="text-lg font-bold text-foreground mb-1">Welcome! Let's get your first score 🎯</h2>
            <p className="text-xs text-muted-foreground mb-4">Three steps and your dashboard comes alive:</p>
            <div className="space-y-2 mb-4">
              {[
                { n: 1, text: "Run a free scan — it saves here automatically", done: false },
                { n: 2, text: "Set your target score (we've suggested 80)", done: targetScore != null },
                { n: 3, text: "Work the fix checklist, then rescan to watch your score climb", done: false },
              ].map(step => (
                <div key={step.n} className="flex items-center gap-2.5 text-sm">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${step.done ? "bg-success text-success-foreground" : "bg-primary/15 text-primary"}`}>
                    {step.done ? "✓" : step.n}
                  </span>
                  <span className={step.done ? "text-muted-foreground line-through" : "text-foreground"}>{step.text}</span>
                </div>
              ))}
            </div>
            <Link to="/#upload" className="inline-block px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
              Scan my resume free →
            </Link>
          </div>
        )}

        {/* Stat tiles */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <p className={`text-3xl font-bold ${latest ? (latest.ats_score >= 70 ? "text-success" : latest.ats_score >= 50 ? "text-warning" : "text-destructive") : "text-muted-foreground/40"}`}>
              {latest ? latest.ats_score : "?"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Latest score{delta != null && (
              <span className={delta >= 0 ? "text-success font-semibold" : "text-destructive font-semibold"}> ({delta >= 0 ? "+" : ""}{delta})</span>
            )}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <p className={`text-3xl font-bold ${best != null ? "text-foreground" : "text-muted-foreground/40"}`}>{best ?? "?"}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">🏆 Best score</p>
          </div>
          <div className={`rounded-2xl border p-4 text-center ${(account?.credits ?? 0) > 0 ? "border-warning/25 bg-warning/5" : "border-border bg-card"}`}>
            <p className="text-3xl font-bold text-foreground">{fetching ? "…" : account?.credits ?? 0}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">🪙 Scan credits</p>
          </div>
        </div>

        {/* Target score goal */}
        <div className={`rounded-2xl border p-5 mb-6 ${goalHit ? "border-success/40 bg-success/5" : "border-border bg-card"}`}>
          <div className="flex items-center gap-2 mb-2">
            <Target className={`w-4 h-4 ${goalHit ? "text-success" : "text-primary"}`} />
            <h2 className="font-semibold text-foreground text-sm">Target score</h2>
            <div className="ml-auto flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={100}
                value={goal}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v >= 1 && v <= 100) saveTarget(v);
                }}
                className="w-16 px-2 py-1 rounded-lg bg-background border border-border text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Target ATS score"
              />
            </div>
          </div>
          {goalHit ? (
            <p className="text-sm text-success font-semibold">🎉 Goal hit — your latest scan beat your target. Raise the bar?</p>
          ) : (
            <>
              {latest ? (
                <>
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden mb-1">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${goalProgress}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {latest.ats_score} of {goal} — {Math.max(0, goal - latest.ats_score)} points to go.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Your first scan starts the progress bar toward {goal}.</p>
              )}
            </>
          )}
        </div>

        {/* Fix checklist */}
        {latestFixPlan?.fix_plan && (
          <div className="rounded-2xl border border-border bg-card p-5 mb-6">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-foreground text-sm">Your fix checklist</h2>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                {doneFixes}/{latestFixPlan.fix_plan.length} done
              </span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">From your scan on {new Date(latestFixPlan.created_at).toLocaleDateString()}. Check items off as you fix them, then rescan to see the lift.</p>
            <div className="space-y-1.5">
              {(latestFixPlan.fix_plan ?? []).map((f, i) => (
                <label key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-border/50 cursor-pointer hover:bg-muted/20 transition-colors">
                  <input
                    type="checkbox"
                    checked={f.done}
                    onChange={() => toggleFixItem(latestFixPlan.id, i)}
                    className="mt-0.5 accent-primary"
                  />
                  <span className={`text-sm ${f.done ? "text-muted-foreground line-through" : "text-foreground"}`}>{f.step}</span>
                </label>
              ))}
            </div>
            {doneFixes === latestFixPlan.fix_plan.length && (
              <Link to="/#upload" className="mt-3 inline-block px-4 py-2 rounded-lg bg-success text-success-foreground text-xs font-semibold hover:bg-success/90 transition-colors">
                All done — rescan to see your new score →
              </Link>
            )}
          </div>
        )}

        {/* Score history + compare */}
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
                  <line x1={10} y1={goalY} x2={W - 10} y2={goalY} className="stroke-success/40" strokeWidth={1} strokeDasharray="4 4" />
                  <text x={W - 12} y={goalY - 4} textAnchor="end" className="fill-current text-[9px] text-success/70">goal {goal}</text>
                  <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} className="fill-none stroke-primary" strokeWidth={2} />
                  {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={3} className={p.score >= 70 ? "fill-success" : p.score >= 50 ? "fill-warning" : "fill-destructive"} />
                  ))}
                </svg>
              )}
              {scans.length >= 2 && (
                <p className="text-[11px] text-muted-foreground mb-2 flex items-center gap-1">
                  <GitCompare className="w-3 h-3" /> Select two scans to compare them.
                </p>
              )}
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {scans.map((s) => (
                  <label key={s.id} className={`flex items-center gap-3 text-sm border rounded-lg px-3 py-2 cursor-pointer transition-colors ${compareIds.includes(s.id) ? "border-primary/50 bg-primary/5" : "border-border/50 hover:bg-muted/20"}`}>
                    {scans.length >= 2 && (
                      <input
                        type="checkbox"
                        checked={compareIds.includes(s.id)}
                        onChange={() => toggleCompare(s.id)}
                        className="accent-primary"
                      />
                    )}
                    <span className={`font-bold w-8 ${s.ats_score >= 70 ? "text-success" : s.ats_score >= 50 ? "text-warning" : "text-destructive"}`}>{s.ats_score}</span>
                    <span className="text-muted-foreground text-xs flex-1 truncate">
                      {labelEditing === s.id ? (
                        <input
                          autoFocus
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onBlur={() => saveLabel(s.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveLabel(s.id); if (e.key === "Escape") setLabelEditing(null); }}
                          onClick={(e) => e.preventDefault()}
                          maxLength={60}
                          placeholder="Name this version…"
                          className="w-full bg-background border border-border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      ) : (
                        <button
                          onClick={(e) => { e.preventDefault(); setLabelEditing(s.id); setLabelDraft(s.label ?? ""); }}
                          className="text-left hover:text-foreground transition-colors"
                          title="Click to name this version"
                        >
                          {s.label
                            ? <span className="text-foreground font-medium">{s.label}</span>
                            : <span className="capitalize">{(s.industry ?? "").replace(/_/g, " ")}</span>}
                          <span className="text-muted-foreground/40 ml-1">✎</span>
                        </button>
                      )}
                    </span>
                    {s.resume_text && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          navigator.clipboard?.writeText(s.resume_text!).then(
                            () => toast.success("Copied — the exact document you saved with this version."),
                            () => { /* clipboard unavailable */ },
                          );
                        }}
                        className="text-[11px] text-primary shrink-0 hover:underline"
                        title="You saved the document with this version — copy its text"
                      >
                        📄 copy
                      </button>
                    )}
                    <span className="text-[11px] text-muted-foreground shrink-0">{new Date(s.created_at).toLocaleDateString()}</span>
                  </label>
                ))}
              </div>

              {/* Compare panel */}
              {compareScans.length === 2 && (() => {
                const [a, b] = compareScans;
                const rows = [
                  { label: "ATS score", a: a.ats_score, b: b.ats_score },
                  { label: "Projected score", a: a.projected_score ?? "—", b: b.projected_score ?? "—" },
                  { label: "Red flags", a: a.red_flag_count ?? "—", b: b.red_flag_count ?? "—", invert: true },
                ];
                return (
                  <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
                    <p className="text-xs font-semibold text-foreground mb-2">
                      {new Date(a.created_at).toLocaleDateString()} → {new Date(b.created_at).toLocaleDateString()}
                    </p>
                    <div className="space-y-1.5">
                      {rows.map((r, i) => {
                        const diff = typeof r.a === "number" && typeof r.b === "number" ? r.b - r.a : null;
                        const good = diff != null && (r.invert ? diff < 0 : diff > 0);
                        const bad = diff != null && (r.invert ? diff > 0 : diff < 0);
                        return (
                          <div key={i} className="flex items-center text-sm">
                            <span className="text-muted-foreground text-xs w-32">{r.label}</span>
                            <span className="text-foreground font-medium">{r.a}</span>
                            <span className="text-muted-foreground mx-2">→</span>
                            <span className="text-foreground font-medium">{r.b}</span>
                            {diff != null && diff !== 0 && (
                              <span className={`ml-2 text-xs font-semibold ${good ? "text-success" : bad ? "text-destructive" : "text-muted-foreground"}`}>
                                ({diff > 0 ? "+" : ""}{diff})
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Application tracker */}
        <SavedSearchesCard />

        <div className="rounded-2xl border border-border bg-card p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground text-sm">Application tracker</h2>
            <span className="ml-auto text-xs text-muted-foreground">{applications.length} tracked</span>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              value={newApp.company}
              onChange={(e) => setNewApp({ ...newApp, company: e.target.value })}
              placeholder="Company"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <input
              value={newApp.role}
              onChange={(e) => setNewApp({ ...newApp, role: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") addApplication(); }}
              placeholder="Role"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={addApplication}
              disabled={!newApp.company.trim()}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          {scans.length > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] text-muted-foreground shrink-0">Resume version sent:</span>
              <select
                value={newAppScanId}
                onChange={(e) => setNewAppScanId(e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Resume version used for this application"
              >
                <option value="latest">Latest scan ({scans[0].ats_score}{scans[0].label ? ` · ${scans[0].label}` : ""})</option>
                {scans.map((s) => (
                  <option key={s.id} value={s.id}>{versionName(s)} — score {s.ats_score}</option>
                ))}
              </select>
            </div>
          )}
          {applications.length === 0 ? (
            <p className="text-xs text-muted-foreground">Track where you've applied — status, dates, and the score you applied with, all in one place.</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {applications.map((a) => {
                const version = a.scan_id ? scans.find(s => s.id === a.scan_id) : null;
                return (
                <div key={a.id} className="border border-border/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{a.company}{a.role ? <span className="text-muted-foreground font-normal"> · {a.role}</span> : null}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(a.applied_at).toLocaleDateString()}
                      {version ? ` · sent "${versionName(version)}" (score ${a.scan_score ?? version.ats_score})` : (a.scan_score ? ` · applied with score ${a.scan_score}` : "")}
                    </p>
                  </div>
                  {version?.resume_text && (
                    <button
                      onClick={() => { setFitOpenId(fitOpenId === a.id ? null : a.id); setFitPosting(a.job_posting ?? ""); }}
                      className={`text-[11px] px-2 py-1 rounded-full border shrink-0 transition-colors ${a.fit_pct != null ? (a.fit_pct >= 20 ? "border-success/40 text-success" : "border-warning/40 text-warning") : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {a.fit_pct != null ? `fit ${a.fit_pct}%` : "check fit"}
                    </button>
                  )}
                  {a.apply_url && (
                    <a
                      href={a.apply_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open the job posting"
                      className="text-muted-foreground hover:text-primary shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <select
                    value={a.status}
                    onChange={(e) => updateAppStatus(a.id, e.target.value)}
                    className={`text-xs px-2 py-1 rounded-full border-0 font-semibold cursor-pointer ${STATUS_STYLES[a.status] ?? STATUS_STYLES.applied}`}
                    aria-label="Application status"
                  >
                    {APP_STATUSES.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <button onClick={() => deleteApplication(a.id)} aria-label="Delete application" className="text-muted-foreground/50 hover:text-destructive transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  </div>
                  {(a.job_posting || version?.resume_text) && (
                    <ApplyKitPanel
                      jobPosting={a.job_posting ?? ""}
                      resumeText={version?.resume_text ?? scans[0]?.resume_text ?? ""}
                      proActive={pro.active}
                    />
                  )}
                  {fitOpenId === a.id && version?.resume_text && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-[11px] text-muted-foreground mb-1.5">
                        Paste the job posting — we check which recognized keywords the version you sent actually covers. Deterministic, no AI.
                      </p>
                      <textarea
                        value={fitPosting}
                        onChange={(e) => setFitPosting(e.target.value)}
                        rows={3}
                        placeholder="Paste the job posting here…"
                        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground mb-1.5"
                      />
                      <button
                        onClick={() => runFitCheck(a, version)}
                        disabled={fitLoading || fitPosting.trim().length < 100}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50"
                      >
                        {fitLoading ? "Checking…" : "Check fit"}
                      </button>
                      {a.fit_pct != null && (a.fit_missing?.length ?? 0) > 0 && (
                        <div className="mt-2">
                          <p className="text-[11px] text-muted-foreground mb-1">Missing from the version you sent:</p>
                          <div className="flex flex-wrap gap-1">
                            {(a.fit_missing ?? []).slice(0, 12).map(k => (
                              <span key={k} className="px-2 py-0.5 rounded-full border border-warning/40 text-warning text-[11px]">{k}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* Which resume gets interviews: outcomes grouped by the version sent */}
          {(() => {
            const linked = applications.filter(a => a.scan_id);
            if (linked.length === 0) return null;
            const byVersion = new Map<string, { sent: number; interviews: number; offers: number }>();
            for (const a of linked) {
              const stat = byVersion.get(a.scan_id!) ?? { sent: 0, interviews: 0, offers: 0 };
              stat.sent += 1;
              if (a.status === "interviewing" || a.status === "offer") stat.interviews += 1;
              if (a.status === "offer") stat.offers += 1;
              byVersion.set(a.scan_id!, stat);
            }
            const rows = [...byVersion.entries()]
              .map(([id, stat]) => ({ scan: scans.find(s => s.id === id), ...stat }))
              .filter((r): r is typeof r & { scan: UserScan } => !!r.scan)
              .sort((x, y) => y.interviews / y.sent - x.interviews / x.sent || y.sent - x.sent);
            if (rows.length === 0) return null;
            return (
              <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
                <p className="text-xs font-semibold text-foreground mb-2">Which resume gets interviews</p>
                <div className="space-y-1.5">
                  {rows.map((r) => (
                    <div key={r.scan.id} className="flex items-center gap-2 text-xs">
                      <span className="text-foreground font-medium flex-1 truncate">{versionName(r.scan)}</span>
                      <span className="text-muted-foreground shrink-0">{r.sent} sent</span>
                      <span className={`shrink-0 font-semibold ${r.interviews > 0 ? "text-success" : "text-muted-foreground"}`}>
                        {r.interviews} interview{r.interviews !== 1 ? "s" : ""}{r.offers > 0 ? ` · ${r.offers} offer${r.offers !== 1 ? "s" : ""}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Update application statuses above — this table learns which version of your resume actually lands interviews.</p>
              </div>
            );
          })()}

          {/* Personal outcome analytics: YOUR interview rate by score band —
              the outcome dataset paying each user back individually. Only
              shown once there's enough signal to mean anything. */}
          {(() => {
            const decided = applications.filter(a => a.scan_score != null && a.status !== "applied");
            if (decided.length < 5) return null;
            const bands: Array<{ label: string; min: number; max: number }> = [
              { label: "80+", min: 80, max: 101 },
              { label: "65–79", min: 65, max: 80 },
              { label: "50–64", min: 50, max: 65 },
              { label: "under 50", min: 0, max: 50 },
            ];
            const rows = bands
              .map(b => {
                const apps = decided.filter(a => (a.scan_score as number) >= b.min && (a.scan_score as number) < b.max);
                const wins = apps.filter(a => a.status === "interviewing" || a.status === "offer").length;
                return { ...b, sent: apps.length, wins };
              })
              .filter(r => r.sent > 0);
            if (rows.length < 2) return null;
            return (
              <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
                <p className="text-xs font-semibold text-foreground mb-2">Your interview rate by score band</p>
                <div className="space-y-1.5">
                  {rows.map(r => (
                    <div key={r.label} className="flex items-center gap-2 text-xs">
                      <span className="text-foreground font-medium w-20 shrink-0">Score {r.label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                        <div className="h-full bg-success" style={{ width: `${Math.round((r.wins / r.sent) * 100)}%` }} />
                      </div>
                      <span className="text-muted-foreground shrink-0">{r.wins}/{r.sent} interviews</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Measured from your own applications — small samples, so read direction, not decimals.</p>
              </div>
            );
          })()}
        </div>

        {/* Pro subscription */}
        <div className="mb-6">
          <ProSubscriptionCard compact />
        </div>

        {/* Credits + purchases */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-4 h-4 text-warning" />
              <h2 className="font-semibold text-foreground text-sm">Scan credits</h2>
            </div>
            <p className="text-3xl font-bold text-foreground mb-1">{fetching ? "…" : account?.credits ?? 0}</p>
            <p className="text-xs text-muted-foreground mb-3">Credits are linked to your email and never expire.</p>
            <Link to="/pricing" className="inline-block px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
              Get more credits →
            </Link>
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

        {/* Cross-link: the employer-side product */}
        <div className="rounded-2xl border border-border bg-gradient-to-r from-primary/5 to-transparent p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground mb-0.5">Hiring? Screen candidates with Shortlist <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase align-middle ml-1">Beta</span></p>
            <p className="text-xs text-muted-foreground">Paste a job description and a stack of resumes — get a ranked, explainable shortlist with a built-in compliance audit trail. Free during beta.</p>
          </div>
          <Link to="/shortlist" className="shrink-0 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
            Open Shortlist →
          </Link>
        </div>

        {/* Settings: password / email / export */}
        <div className="rounded-2xl border border-border bg-card p-5 mb-6">
          <h2 className="font-semibold text-foreground text-sm mb-3">⚙️ Account settings</h2>
          <div className="grid sm:grid-cols-2 gap-4 mb-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Change password</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (8+ chars)"
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button onClick={changePassword} disabled={!newPassword} className="shrink-0 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">Update</button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Change email</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="new@email.com"
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button onClick={changeEmail} disabled={!newEmail} className="shrink-0 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">Update</button>
              </div>
            </div>
          </div>
          {settingsMsg && <p className={`text-xs mb-3 ${/✓/.test(settingsMsg) ? "text-success" : "text-muted-foreground"}`}>{settingsMsg}</p>}
          <button onClick={exportData} className="text-xs text-primary hover:underline">
            ⬇️ Download all my data (JSON)
          </button>
        </div>

        {/* Danger zone */}
        <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h2 className="font-semibold text-foreground text-sm">Delete account</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Permanently deletes your account, scan history, checklist, goal, and applications. Purchase records are retained for accounting. This cannot be undone.
          </p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-3.5 py-2 rounded-lg border border-destructive/30 text-destructive text-xs font-semibold hover:bg-destructive/10 transition-colors"
            >
              Delete my account
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={deleteAccount}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 disabled:opacity-60 transition-colors"
              >
                {deleting && <Loader2 className="w-3 h-3 animate-spin" />}
                Yes, permanently delete everything
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3.5 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
