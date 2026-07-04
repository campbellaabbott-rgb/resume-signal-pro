// Shortlist — employer-side resume screening workspace.
//
// Compliance-first by construction (see COMPLIANCE.md):
// - The AI ranks and recommends; ONLY a human can advance/reject (HITL gate)
// - Every decision and score override is logged append-only with actor+reason
// - Protected-class proxies are redacted server-side before scoring; the
//   exclusion audit is visible per candidate
// - Demographics (optional) live apart from scoring, used only for the
//   impact-ratio audit view
// - Jurisdiction routing drives candidate-notice templates (NYC/IL/EU)

import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Briefcase, Plus, Loader2, ChevronDown, ChevronUp, Scale, FileDown,
  ShieldCheck, UserCheck, UserX, Bell, Accessibility,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { computeImpactAnalysis } from "../../supabase/functions/_shared/impact-ratio";

interface Role {
  id: string;
  title: string;
  jd_text: string;
  jd_version: number;
  jurisdiction: string;
  created_at: string;
}

interface Candidate {
  id: string;
  file_name: string | null;
  score: number | null;
  flags: string[] | null;
  signals: Array<{ factor: string; direction: string; evidence: string }> | null;
  interview_questions: string[] | null;
  level_read: string | null;
  exclusions_applied: Array<{ feature: string; count: number }> | null;
  status: "pending" | "advanced" | "rejected";
  model_version: string | null;
  created_at: string;
}

const JURISDICTIONS = ["OTHER", "NYC", "IL", "CA", "EU"] as const;

// Candidate-notice templates. Informational tooling, not legal advice —
// customers should have counsel confirm final wording.
function noticeTemplate(kind: string, roleTitle: string, employerEmail: string): { type: string; text: string } {
  switch (kind) {
    case "NYC": return {
      type: "nyc_advance",
      text: `NOTICE OF USE OF AN AUTOMATED EMPLOYMENT DECISION TOOL (NYC Local Law 144)

In connection with your application for the position of ${roleTitle}, an automated employment decision tool (AEDT) will be used to assist in assessing your application, no earlier than 10 business days from the date of this notice.

The AEDT assesses the following job-related qualifications and characteristics: relevant skills and experience matched against the posted job description, quantified accomplishments, seniority fit, and required certifications.

You may request an alternative selection process or a reasonable accommodation by replying to ${employerEmail}. Information about the type and source of data collected for the AEDT and our data retention policy is available on request. A summary of the tool's most recent bias audit is posted on our website.

[This template is informational — have counsel confirm final wording.]`,
    };
    case "IL": return {
      type: "il_ai_use",
      text: `NOTICE OF ARTIFICIAL INTELLIGENCE USE (Illinois Human Rights Act, as amended)

We use artificial intelligence to assist in evaluating applications for the position of ${roleTitle}. The AI assists our reviewers by comparing application materials against the posted job requirements; all hiring decisions are made by humans.

Questions or accommodation requests: ${employerEmail}.

[This template is informational — have counsel confirm final wording.]`,
    };
    case "EU": return {
      type: "eu_disclosure",
      text: `TRANSPARENCY DISCLOSURE — AUTOMATED ASSESSMENT (EU AI Act / GDPR)

Your application for ${roleTitle} will be assessed with the assistance of an AI system classified as high-risk under the EU AI Act. The system compares your application against the job requirements and produces a recommendation; a human reviewer makes all decisions (GDPR Art. 22 safeguard — you will not be subject to a solely automated decision).

You have the right to obtain an explanation of how the assessment contributed to the decision, to contest it, and to request deletion of your data: ${employerEmail}.

[This template is informational — have counsel confirm final wording.]`,
    };
    default: return { type: "generic", text: `We use software to assist human reviewers in evaluating applications for ${roleTitle}. All decisions are made by people. Questions: ${employerEmail}.` };
  }
}

export default function Shortlist() {
  const { session, user, loading } = useAuth();
  const navigate = useNavigate();

  const [roles, setRoles] = useState<Role[]>([]);
  const [activeRole, setActiveRole] = useState<Role | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [demographics, setDemographics] = useState<Record<string, { sex?: string; race_ethnicity?: string }>>({});

  const [newRole, setNewRole] = useState({ title: "", jd: "", jurisdiction: "OTHER" });
  const [showNewRole, setShowNewRole] = useState(false);
  const [candidateText, setCandidateText] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [showBias, setShowBias] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  const loadRoles = useCallback(async () => {
    const { data } = await supabase.from("shortlist_roles").select("*").order("created_at", { ascending: false });
    setRoles((data as Role[] | null) ?? []);
  }, []);

  const loadCandidates = useCallback(async (roleId: string) => {
    const [{ data: cands }, { data: demos }] = await Promise.all([
      supabase.from("shortlist_candidates").select("*").eq("role_id", roleId).order("score", { ascending: false }),
      supabase.from("shortlist_demographics").select("*"),
    ]);
    setCandidates((cands as Candidate[] | null) ?? []);
    const demoMap: typeof demographics = {};
    for (const d of (demos as Array<{ candidate_id: string; sex?: string; race_ethnicity?: string }> | null) ?? []) {
      demoMap[d.candidate_id] = { sex: d.sex, race_ethnicity: d.race_ethnicity };
    }
    setDemographics(demoMap);
  }, []);

  useEffect(() => { if (session) loadRoles(); }, [session, loadRoles]);
  useEffect(() => { if (activeRole) loadCandidates(activeRole.id); }, [activeRole, loadCandidates]);

  const createRole = async () => {
    if (!session || newRole.title.trim().length < 2 || newRole.jd.trim().length < 30) {
      setError("Role title and a job description of at least 30 characters are required.");
      return;
    }
    const { data, error: err } = await supabase.from("shortlist_roles").insert({
      owner_id: session.user.id,
      title: newRole.title.trim(),
      jd_text: newRole.jd.trim(),
      jurisdiction: newRole.jurisdiction,
    }).select().single();
    if (err) { setError(err.message); return; }
    setRoles([data as Role, ...roles]);
    setActiveRole(data as Role);
    setShowNewRole(false);
    setNewRole({ title: "", jd: "", jurisdiction: "OTHER" });
    setError(null);
  };

  const evaluateCandidate = async () => {
    if (!activeRole || candidateText.trim().length < 100) {
      setError("Paste the candidate's resume text (100+ characters).");
      return;
    }
    setEvaluating(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("shortlist-evaluate", {
      body: {
        roleId: activeRole.id,
        jdText: activeRole.jd_text,
        resumeText: candidateText,
        fileName: candidateName.trim() || null,
        jurisdiction: activeRole.jurisdiction,
      },
    }).catch(() => ({ data: null, error: { message: "network" } }));
    setEvaluating(false);
    if (err || !(data as { success?: boolean })?.success) {
      setError((data as { error?: string })?.error ?? "Evaluation failed — try again.");
      return;
    }
    setCandidateText("");
    setCandidateName("");
    loadCandidates(activeRole.id);
  };

  // ── Human-in-the-loop gate: the ONLY path that changes candidate status ──
  const decide = async (candidate: Candidate, action: "advance" | "reject") => {
    if (!session) return;
    if (action === "reject" && decisionReason.trim().length < 3) {
      setError("A brief reason is required to reject (it goes in the audit log).");
      return;
    }
    const newStatus = action === "advance" ? "advanced" : "rejected";
    await supabase.from("shortlist_decisions").insert({
      candidate_id: candidate.id,
      owner_id: session.user.id,
      actor_email: user?.email ?? null,
      action,
      old_value: candidate.status,
      new_value: newStatus,
      reason: decisionReason.trim() || null,
    });
    await supabase.from("shortlist_candidates").update({ status: newStatus }).eq("id", candidate.id);
    setDecisionReason("");
    setError(null);
    if (activeRole) loadCandidates(activeRole.id);
  };

  const overrideScore = async (candidate: Candidate, newScore: number) => {
    if (!session || !Number.isFinite(newScore) || newScore < 0 || newScore > 100) return;
    await supabase.from("shortlist_decisions").insert({
      candidate_id: candidate.id,
      owner_id: session.user.id,
      actor_email: user?.email ?? null,
      action: "override_score",
      old_value: String(candidate.score ?? ""),
      new_value: String(newScore),
      reason: "manual reviewer override",
    });
    await supabase.from("shortlist_candidates").update({ score: newScore }).eq("id", candidate.id);
    if (activeRole) loadCandidates(activeRole.id);
  };

  const saveDemographics = async (candidateId: string, field: "sex" | "race_ethnicity", value: string) => {
    if (!session) return;
    const current = demographics[candidateId] ?? {};
    const next = { ...current, [field]: value };
    setDemographics({ ...demographics, [candidateId]: next });
    await supabase.from("shortlist_demographics").upsert({
      candidate_id: candidateId,
      owner_id: session.user.id,
      sex: next.sex ?? null,
      race_ethnicity: next.race_ethnicity ?? null,
    });
  };

  const requestAltReview = async (candidate: Candidate) => {
    if (!session) return;
    await supabase.from("shortlist_decisions").insert({
      candidate_id: candidate.id,
      owner_id: session.user.id,
      actor_email: user?.email ?? null,
      action: "alt_review_requested",
      reason: "Candidate routed to non-automated alternative review (ADA / accommodation path)",
    });
    setError(null);
    alert("Logged: this candidate is routed to non-automated human review. Their AI score should not be used.");
  };

  // ── Exports: the customer's compliance evidence trail ────────────────────
  const exportAudit = async (format: "json" | "csv") => {
    if (!activeRole) return;
    const { data: decisions } = await supabase
      .from("shortlist_decisions").select("*")
      .in("candidate_id", candidates.map(c => c.id))
      .order("created_at");
    const payload = {
      exportedAt: new Date().toISOString(),
      role: { id: activeRole.id, title: activeRole.title, jd_text: activeRole.jd_text, jd_version: activeRole.jd_version, jurisdiction: activeRole.jurisdiction },
      candidates,
      decisions: decisions ?? [],
      note: "Append-only audit export. Demographics are excluded from this file by design; use the bias-audit export for aggregate analysis.",
    };
    let blob: Blob;
    let name: string;
    if (format === "json") {
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      name = `shortlist-audit-${activeRole.title.replace(/\W+/g, "-")}.json`;
    } else {
      const rows = candidates.map(c => [
        c.id, c.file_name ?? "", c.score ?? "", c.level_read ?? "", c.status,
        (c.flags ?? []).join("; "), c.model_version ?? "", c.created_at,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
      blob = new Blob([["candidate_id,file_name,score,level_read,final_human_decision,flags,model_version,created_at", ...rows].join("\n")], { type: "text/csv" });
      name = `shortlist-audit-${activeRole.title.replace(/\W+/g, "-")}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const biasAnalysis = useMemo(() => {
    const records = candidates.map(c => ({
      advanced: c.status === "advanced",
      sex: demographics[c.id]?.sex ?? null,
      raceEthnicity: demographics[c.id]?.race_ethnicity ?? null,
    }));
    return computeImpactAnalysis(records);
  }, [candidates, demographics]);

  if (loading || !session) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const decided = candidates.filter(c => c.status !== "pending").length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container max-w-4xl pt-24 pb-16">
        <div className="flex items-center gap-3 mb-1">
          <Briefcase className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Shortlist</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wide">Beta</span>
        </div>
        <p className="text-xs text-muted-foreground mb-6 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
          AI ranks and recommends — every advance/reject is a logged human decision. Protected-class proxies are removed before scoring.
          <Link to="/methodology" className="text-primary underline ml-1">How it works</Link>
        </p>

        {error && <p className="text-xs text-destructive mb-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20">{error}</p>}

        {/* Role selector / creator */}
        <div className="rounded-2xl border border-border bg-card p-5 mb-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-semibold text-foreground text-sm">Roles</h2>
            <button onClick={() => setShowNewRole(!showNewRole)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
              <Plus className="w-3.5 h-3.5" /> New role
            </button>
          </div>
          {showNewRole && (
            <div className="space-y-2 mb-3 p-3 rounded-xl border border-border/60 bg-muted/20">
              <input value={newRole.title} onChange={e => setNewRole({ ...newRole, title: e.target.value })} placeholder="Role title (e.g. Senior Data Engineer)"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <textarea value={newRole.jd} onChange={e => setNewRole({ ...newRole, jd: e.target.value })} placeholder="Paste the job description…" rows={4}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Candidate jurisdiction:</label>
                <select value={newRole.jurisdiction} onChange={e => setNewRole({ ...newRole, jurisdiction: e.target.value })}
                  className="px-2 py-1 rounded-lg bg-background border border-border text-xs text-foreground">
                  {JURISDICTIONS.map(j => <option key={j} value={j}>{j === "OTHER" ? "Other / not listed" : j}</option>)}
                </select>
                <button onClick={createRole} className="ml-auto px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">Create</button>
              </div>
              <p className="text-[10px] text-muted-foreground">Jurisdiction drives the required candidate notices and retention rules (NYC LL144 · IL HB 3773 · CA FEHA · EU AI Act).</p>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {roles.length === 0 && !showNewRole && <p className="text-xs text-muted-foreground">Create a role to start screening.</p>}
            {roles.map(r => (
              <button key={r.id} onClick={() => setActiveRole(r)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${activeRole?.id === r.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"}`}>
                {r.title} <span className="opacity-60">· {r.jurisdiction}</span>
              </button>
            ))}
          </div>
        </div>

        {activeRole && (
          <>
            {/* Compliance toolbar */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button onClick={() => setShowNotice(!showNotice)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                <Bell className="w-3.5 h-3.5" /> Candidate notices
              </button>
              <button onClick={() => setShowBias(!showBias)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                <Scale className="w-3.5 h-3.5" /> Bias audit ({decided} decided)
              </button>
              <button onClick={() => exportAudit("csv")} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                <FileDown className="w-3.5 h-3.5" /> Audit CSV
              </button>
              <button onClick={() => exportAudit("json")} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                <FileDown className="w-3.5 h-3.5" /> Audit JSON
              </button>
            </div>

            {/* Notices */}
            {showNotice && (
              <div className="rounded-2xl border border-border bg-card p-5 mb-4">
                <h3 className="font-semibold text-foreground text-sm mb-2">Candidate notice — {activeRole.jurisdiction}</h3>
                {activeRole.jurisdiction === "NYC" && <p className="text-[11px] text-warning mb-2">⚠️ NYC LL144: candidates must receive this ≥10 business days BEFORE the AEDT is used, and the bias-audit summary must be posted publicly.</p>}
                <pre className="text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">{noticeTemplate(activeRole.jurisdiction, activeRole.title, user?.email ?? "[your email]").text}</pre>
                <button
                  onClick={async () => {
                    const t = noticeTemplate(activeRole.jurisdiction, activeRole.title, user?.email ?? "[your email]");
                    await navigator.clipboard.writeText(t.text).catch(() => {});
                    await supabase.from("shortlist_notices").insert({
                      role_id: activeRole.id, owner_id: session.user.id,
                      jurisdiction: activeRole.jurisdiction, notice_type: t.type, content: t.text,
                    });
                  }}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors">
                  Copy + log as sent
                </button>
              </div>
            )}

            {/* Bias audit */}
            {showBias && (
              <div className="rounded-2xl border border-border bg-card p-5 mb-4">
                <h3 className="font-semibold text-foreground text-sm mb-1">Selection rates & impact ratios</h3>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Based on final HUMAN decisions and self-reported demographics ({biasAnalysis.recordsWithDemographics}/{biasAnalysis.totalRecords} candidates have demographics). Demographics are never provided to the scoring model.
                </p>
                {([["By sex", biasAnalysis.bySex], ["By race/ethnicity", biasAnalysis.byRaceEthnicity], ["Intersectional", biasAnalysis.intersectional]] as const).map(([label, stats]) => (
                  <div key={label} className="mb-3">
                    <p className="text-xs font-semibold text-foreground mb-1">{label}</p>
                    {stats.length === 0 ? <p className="text-[11px] text-muted-foreground">No demographic data yet.</p> : (
                      <div className="space-y-1">
                        {stats.map(s => (
                          <div key={s.group} className="flex items-center gap-2 text-xs">
                            <span className="text-foreground capitalize w-40 truncate">{s.group}</span>
                            <span className="text-muted-foreground">n={s.total}</span>
                            <span className="text-muted-foreground">rate {(s.selectionRate * 100).toFixed(1)}%</span>
                            <span className="text-muted-foreground">ratio {s.impactRatio != null ? s.impactRatio.toFixed(2) : "—"}</span>
                            {s.fourFifthsFlag && !s.lowSample && <span className="px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-semibold">below 4/5</span>}
                            {s.lowSample && <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">low sample</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">{biasAnalysis.methodologyNote} NYC LL144 additionally requires an INDEPENDENT annual audit — this view prepares the data; it does not replace the auditor.</p>
              </div>
            )}

            {/* Add candidate */}
            <div className="rounded-2xl border border-border bg-card p-5 mb-4">
              <h3 className="font-semibold text-foreground text-sm mb-2">Add candidate</h3>
              <input value={candidateName} onChange={e => setCandidateName(e.target.value)} placeholder="Reference (e.g. file name or candidate #) — optional"
                className="w-full mb-2 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <textarea value={candidateText} onChange={e => setCandidateText(e.target.value)} rows={5} placeholder="Paste the candidate's resume text…"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <div className="flex items-center gap-3 mt-2">
                <button onClick={evaluateCandidate} disabled={evaluating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors">
                  {evaluating && <Loader2 className="w-4 h-4 animate-spin" />} Evaluate
                </button>
                <p className="text-[10px] text-muted-foreground">Name, age signals, address, and other protected-class proxies are removed before the model sees the text.</p>
              </div>
            </div>

            {/* Ranked candidates */}
            <div className="space-y-2">
              {candidates.map((c, idx) => (
                <div key={c.id} className="rounded-2xl border border-border bg-card">
                  <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="w-full flex items-center gap-3 p-4 text-left">
                    <span className="text-xs text-muted-foreground w-6">#{idx + 1}</span>
                    <span className={`text-xl font-bold w-10 ${(c.score ?? 0) >= 70 ? "text-success" : (c.score ?? 0) >= 50 ? "text-warning" : "text-destructive"}`}>{c.score ?? "—"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.file_name || `Candidate ${c.id.slice(0, 8)}`}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{c.level_read ?? ""}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${c.status === "advanced" ? "bg-success/10 text-success" : c.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{c.status}</span>
                    {expanded === c.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {expanded === c.id && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                      {/* Signals considered — transparency panel */}
                      <div>
                        <p className="text-xs font-semibold text-foreground mb-1">Signals considered</p>
                        {(c.signals ?? []).map((s, i) => (
                          <div key={i} className="text-xs mb-1">
                            <span className={s.direction === "positive" ? "text-success" : s.direction === "negative" ? "text-destructive" : "text-muted-foreground"}>
                              {s.direction === "positive" ? "▲" : s.direction === "negative" ? "▼" : "•"}
                            </span>{" "}
                            <span className="text-foreground">{s.factor}</span>
                            <span className="text-muted-foreground"> — {s.evidence}</span>
                          </div>
                        ))}
                      </div>
                      {(c.flags ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-1">Job-related gaps vs JD</p>
                          {(c.flags ?? []).map((f, i) => <p key={i} className="text-xs text-muted-foreground">• {f}</p>)}
                        </div>
                      )}
                      {(c.interview_questions ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-1">Suggested interview questions</p>
                          {(c.interview_questions ?? []).map((q, i) => <p key={i} className="text-xs text-muted-foreground">{i + 1}. {q}</p>)}
                        </div>
                      )}
                      {/* Redaction audit */}
                      <div>
                        <p className="text-xs font-semibold text-foreground mb-1">Proxy exclusions applied before scoring</p>
                        <p className="text-[11px] text-muted-foreground">
                          {(c.exclusions_applied ?? []).length > 0
                            ? (c.exclusions_applied ?? []).map(e => `${e.feature} (${e.count})`).join(" · ")
                            : "None detected"} · model {c.model_version}
                        </p>
                      </div>

                      {/* Demographics — separate from scoring, audit-only */}
                      <div className="rounded-lg border border-border/50 bg-muted/10 p-2.5">
                        <p className="text-[11px] text-muted-foreground mb-1.5">Optional demographics (bias-audit math only — never seen by the model). Best practice: candidate self-report.</p>
                        <div className="flex gap-2">
                          <input value={demographics[c.id]?.sex ?? ""} onChange={e => saveDemographics(c.id, "sex", e.target.value)} placeholder="Sex"
                            className="flex-1 px-2 py-1 rounded bg-background border border-border text-xs text-foreground" />
                          <input value={demographics[c.id]?.race_ethnicity ?? ""} onChange={e => saveDemographics(c.id, "race_ethnicity", e.target.value)} placeholder="Race/ethnicity"
                            className="flex-1 px-2 py-1 rounded bg-background border border-border text-xs text-foreground" />
                        </div>
                      </div>

                      {/* HITL decision bar */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input value={decisionReason} onChange={e => setDecisionReason(e.target.value)} placeholder="Decision reason (required to reject; logged)"
                          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground" />
                        <button onClick={() => decide(c, "advance")} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-success text-success-foreground text-xs font-semibold hover:bg-success/90 transition-colors">
                          <UserCheck className="w-3.5 h-3.5" /> Advance
                        </button>
                        <button onClick={() => decide(c, "reject")} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 transition-colors">
                          <UserX className="w-3.5 h-3.5" /> Reject
                        </button>
                        <button onClick={() => { const v = prompt("Override score (0-100) — logged with your identity:", String(c.score ?? "")); if (v != null) overrideScore(c, parseInt(v, 10)); }}
                          className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                          Override score
                        </button>
                        <button onClick={() => requestAltReview(c)} title="Route to non-automated review (ADA/accommodation)"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                          <Accessibility className="w-3.5 h-3.5" /> Alt review
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {candidates.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No candidates evaluated yet for this role.</p>
              )}
            </div>
          </>
        )}

        <p className="text-[10px] text-muted-foreground mt-8">
          Shortlist recommends and ranks only; all employment decisions are made by humans. Notice templates and audit views are informational tooling, not legal advice — consult counsel for your jurisdiction. Records retained 4 years by default (CA FEHA).
        </p>
      </main>
      <Footer />
    </div>
  );
}
