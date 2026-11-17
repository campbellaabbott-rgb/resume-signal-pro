// Shortlist — employer-side resume screening workspace.
//
// Compliance-first by construction (see COMPLIANCE.md):
// - The AI ranks and recommends; ONLY a human can advance/reject (HITL gate)
// - Every decision and score override is logged append-only with actor+reason
// - Protected-class proxies are redacted server-side before scoring; the
//   exclusion audit is visible per candidate
// - No demographic data is recorded (owner decision D14, 2026-10-12): the sex
//   and race fields recorded special-category data about third parties with
//   no stated basis, so they are gone, and the uploader confirms they may
//   have each resume scored (shortlist-evaluate refuses without it)
// - Jurisdiction routing drives candidate-notice templates (NYC/IL/EU); a
//   notice is logged as sent only when the employer says it went out (S14X-163)
// - A role is read by its role id, in pages; a failed read is shown and
//   nothing is ranked from a partial read (S14X-075)

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
import type { Json } from "@/integrations/supabase/types";
import { rankCandidates, reviewsFromDecisions, type CandidateReview } from "@/lib/shortlist-review";
import { csvDocument } from "@/lib/spreadsheet-safe-csv";
import { readRoleCandidates, readRoleDecisions, readRoleNotices, withoutEmbed } from "@/lib/shortlist-reads";
import { readShortlistRefusal } from "@/lib/shortlist-refusal";
import { readTextFile } from "@/lib/resumeText";
import { SHORTLIST_ATTESTATION_TEXT } from "../../supabase/functions/_shared/shortlist-attestation";
import { PLANTED_INSTRUCTIONS_FLAG } from "../../supabase/functions/_shared/planted-instructions";

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
  jd_version: number | null;
  /** The JD text this candidate was scored against (null before 20261009111000, and for alternative review). */
  jd_text_scored: string | null;
  /** The resume held text addressed to the scoring tool (S12-151): review by hand. */
  steered: boolean;
  /** false when the redactor found no name, so it may have reached the scorer (S14X-072); null on rows from before it was recorded. */
  nameDetected: boolean | null;
  created_at: string;
}

/** What the scorer was shown for one candidate, read when the candidate is opened (S14X-162). */
interface ModelSaw {
  redacted_text: string | null;
  candidate_jurisdiction: string | null;
  matched: string[];
}

/** A logged candidate notice. logged_at and recipients exist once 20261112210000 has applied. */
interface NoticeRow {
  id: string;
  notice_type: string;
  jurisdiction: string;
  content: string;
  sent_at: string;
  logged_at?: string | null;
  recipients?: string | null;
}

/** Weekdays from the day a notice went out to today (NYC LL144 asks for ten business days before use). */
export function businessDaysSince(sentAt: string, now = new Date()): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  let t = day(new Date(sentAt));
  const end = day(now);
  let n = 0;
  while (t < end) {
    t += 864e5;
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}


/** The audit CSV's columns, in order. */
export const SHORTLIST_AUDIT_COLUMNS = ["candidate_id", "file_name", "ai_score", "human_override_score", "alternative_review", "level_read", "final_human_decision", "flags", "model_version", "jd_version", "created_at", "role_notice_sent_at"] as const;

/**
 * The audit CSV (S13-085). The file name is the uploader's and the flags and
 * level read are the model's, so any of them can start with a formula
 * character; every cell goes through csvCell, which quotes it and makes it
 * text in Excel, Sheets and LibreOffice.
 */
export function shortlistAuditCsv(
  candidates: ReadonlyArray<Pick<Candidate, "id" | "file_name" | "score" | "level_read" | "status" | "flags" | "model_version" | "jd_version" | "created_at">>,
  reviews: Record<string, CandidateReview>,
  /** When the role's latest candidate notice went out, as the employer logged it (S14X-163). */
  noticeSentAt: string | null = null,
): string {
  return csvDocument(SHORTLIST_AUDIT_COLUMNS, candidates.map((c) => {
    const alt = reviews[c.id]?.altReview === true;
    return [
      c.id, c.file_name ?? "", alt ? "" : c.score ?? "", alt ? "" : reviews[c.id]?.overrideScore ?? "", alt ? "yes" : "no",
      c.level_read ?? "", c.status, (c.flags ?? []).join("; "), c.model_version ?? "", c.jd_version ?? "", c.created_at, noticeSentAt ?? "",
    ];
  }));
}

const JURISDICTIONS = ["OTHER", "NYC", "IL", "CA", "EU"] as const;

const isStringArray = (value: Json | null): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const toSignals = (value: Json | null): Candidate["signals"] => {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is { factor: string; direction: string; evidence: string } =>
    typeof item === "object" && item !== null && !Array.isArray(item) &&
    typeof item.factor === "string" && typeof item.direction === "string" && typeof item.evidence === "string"
  );
};

const toExclusions = (value: Json | null): Candidate["exclusions_applied"] => {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is { feature: string; count: number } =>
    typeof item === "object" && item !== null && !Array.isArray(item) &&
    typeof item.feature === "string" && typeof item.count === "number"
  );
};

const toCandidate = (row: {
  id: string; file_name: string | null; score: number | null; flags: Json | null;
  signals: Json | null; interview_questions: Json | null; level_read: string | null;
  exclusions_applied: Json | null; status: string; model_version: string | null; created_at: string;
  jd_version?: number | null; jd_text_scored?: string | null; parsed_fields?: Json | null;
}): Candidate => ({
  id: row.id,
  file_name: row.file_name,
  score: row.score,
  flags: isStringArray(row.flags) ? row.flags : null,
  signals: toSignals(row.signals),
  interview_questions: isStringArray(row.interview_questions) ? row.interview_questions : null,
  level_read: row.level_read,
  exclusions_applied: toExclusions(row.exclusions_applied),
  status: row.status === "advanced" || row.status === "rejected" ? row.status : "pending",
  model_version: row.model_version,
  jd_version: row.jd_version ?? null,
  jd_text_scored: row.jd_text_scored ?? null,
  steered: (row.parsed_fields as { scoringIntegrity?: { plantedInstructions?: unknown } } | null | undefined)?.scoringIntegrity?.plantedInstructions === true,
  nameDetected: (() => {
    const v = (row.parsed_fields as { redaction?: { nameDetected?: unknown } } | null | undefined)?.redaction?.nameDetected;
    return typeof v === "boolean" ? v : null;
  })(),
  created_at: row.created_at,
});

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
  const [reviews, setReviews] = useState<Record<string, CandidateReview>>({});
  /** The uploader's confirmation for the resume in the box (D14); cleared after each candidate. */
  const [attested, setAttested] = useState(false);

  const [newRole, setNewRole] = useState({ title: "", jd: "", jurisdiction: "OTHER" });
  const [showNewRole, setShowNewRole] = useState(false);
  const [candidateText, setCandidateText] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [decisionLog, setDecisionLog] = useState<Record<string, Array<{ action: string; actor_email: string | null; old_value: string | null; new_value: string | null; reason: string | null; created_at: string }>>>({});

  // PDF/DOCX upload → existing parser functions → text into the evaluate box
  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > 10 * 1024 * 1024) { setError("File too large (10MB max)."); return; }
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "txt") {
      // Read in the encoding it was saved in: a Notepad "Unicode" file is
      // UTF-16 (S14X-283), which a UTF-8 read turned into NULs.
      const { text, garbled } = await readTextFile(file);
      if (garbled) {
        setError("Couldn't extract enough text from that file — try DOCX or paste the text directly.");
        return;
      }
      setCandidateText(text);
      setCandidateName(file.name);
      return;
    }
    const fnName = ext === "pdf" ? "parse-pdf" : (ext === "docx" || ext === "doc") ? "parse-docx" : null;
    if (!fnName) { setError("Supported formats: PDF, DOCX, TXT — or paste the text."); return; }
    setParsing(true);
    const formData = new FormData();
    formData.append("file", file);
    const { data, error: err } = await supabase.functions.invoke(fnName, { body: formData })
      .catch(() => ({ data: null, error: { message: "parse failed" } }));
    setParsing(false);
    const text = (data as { text?: string })?.text;
    if (err || !text || text.trim().length < 100) {
      setError("Couldn't extract enough text from that file — try DOCX or paste the text directly.");
      return;
    }
    setCandidateText(text);
    setCandidateName(file.name);
  };

  // Per-candidate decision history — the audit trail, visible in the UI
  const loadDecisionLog = async (candidateId: string) => {
    if (decisionLog[candidateId]) return;
    const { data } = await supabase.from("shortlist_decisions")
      .select("action, actor_email, old_value, new_value, reason, created_at")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    setDecisionLog(prev => ({ ...prev, [candidateId]: (data as never[]) ?? [] }));
  };
  const [evaluating, setEvaluating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [showBias, setShowBias] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A 401 from the evaluator: the banner offers a sign-in (S14X-197). */
  const [signInNeeded, setSignInNeeded] = useState(false);
  /** A role's candidates or decisions could not be read in full: nothing is ranked (S14X-075). */
  const [readError, setReadError] = useState<string | null>(null);
  const [modelSaw, setModelSaw] = useState<Record<string, ModelSaw | { error: string }>>({});
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [noticeSentOn, setNoticeSentOn] = useState("");
  const [noticeRecipients, setNoticeRecipients] = useState("");
  /**
   * S14X-073, rule A: the employer deletes a candidate or a role, and what is
   * four years old is purged. True only once the deletions log answers, so the
   * controls and the sentences about them stay hidden until 20261112211000
   * has applied.
   */
  const [deleteReady, setDeleteReady] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "candidate" | "role"; id: string; label: string } | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    // Back here after signing in, query intact (/agent?welcome=1 after Stripe; L3-20).
    if (!loading && !session) navigate(`/auth?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, { replace: true });
  }, [loading, session, navigate]);

  const loadRoles = useCallback(async () => {
    const { data } = await supabase.from("shortlist_roles").select("*").order("created_at", { ascending: false });
    setRoles((data as Role[] | null) ?? []);
  }, []);

  // The role's candidates and the decisions that change their ranking, read
  // by role in pages. A failed read ranks nothing (S14X-075): an
  // alternative-review candidate must never be ranked by its AI score.
  const loadCandidates = useCallback(async (roleId: string) => {
    const [cands, logged] = await Promise.all([
      readRoleCandidates<Parameters<typeof toCandidate>[0]>(supabase, roleId),
      readRoleDecisions<never>(supabase, roleId, ["override_score", "alt_review_requested"]),
    ]);
    const failed = cands.error ?? logged.error;
    setReadError(failed ? `This role's candidates and decisions could not be read in full (${failed}). Nothing is ranked until they are; reload to try again.` : null);
    setCandidates(failed ? [] : cands.rows.map(toCandidate));
    setReviews(failed ? {} : reviewsFromDecisions(logged.rows));
  }, []);

  const loadNotices = useCallback(async (roleId: string) => {
    const read = await readRoleNotices<NoticeRow>(supabase, roleId);
    if (read.error) setNoticeMsg(`Logged notices could not be read: ${read.error}`);
    setNotices(read.rows);
  }, []);

  useEffect(() => { if (session) loadRoles(); }, [session, loadRoles]);
  useEffect(() => {
    if (!session) return;
    let live = true;
    // The deletions log exists only once the delete and the purge do (it is not in the generated types).
    const untyped = supabase as unknown as { from: (t: string) => { select: (c: string) => { limit: (n: number) => PromiseLike<{ error: unknown }> } } };
    Promise.resolve(untyped.from("shortlist_deletions").select("id").limit(1))
      .then(({ error: err }) => { if (live) setDeleteReady(!err); }, () => { if (live) setDeleteReady(false); });
    return () => { live = false; };
  }, [session]);

  const confirmDelete = async () => {
    if (!deleteTarget || deleteTyped.trim() !== "DELETE") return;
    setDeleting(true);
    setDeleteMsg(null);
    const { kind, id } = deleteTarget;
    const { error: err } = kind === "candidate"
      ? await supabase.rpc("shortlist_delete_candidate" as never, { p_candidate_id: id } as never)
      : await supabase.rpc("shortlist_delete_role" as never, { p_role_id: id } as never);
    setDeleting(false);
    if (err) { setDeleteMsg(`Nothing was deleted: ${(err as { message?: string }).message ?? "the request failed"}`); return; }
    setDeleteTarget(null);
    setDeleteTyped("");
    if (kind === "candidate") {
      setDeleteMsg("The candidate, its evaluation and its decisions were deleted. The deletion is logged without the résumé.");
      setExpanded(null);
      if (activeRole) await loadCandidates(activeRole.id);
    } else {
      setDeleteMsg("The role, its candidates, their decisions and its notices were deleted. The deletion is logged without any résumé.");
      setActiveRole(null);
      setCandidates([]);
      setNotices([]);
      await loadRoles();
    }
  };
  useEffect(() => { if (activeRole) { loadCandidates(activeRole.id); loadNotices(activeRole.id); } }, [activeRole, loadCandidates, loadNotices]);

  // What the scorer was shown for one candidate, read when it is opened (S14X-162).
  const loadModelSaw = async (candidateId: string) => {
    if (modelSaw[candidateId]) return;
    const { data, error: err } = await supabase.from("shortlist_candidates")
      .select("redacted_text, candidate_jurisdiction, parsed_fields").eq("id", candidateId).maybeSingle();
    const row = data as { redacted_text?: string | null; candidate_jurisdiction?: string | null; parsed_fields?: { scoringIntegrity?: { matched?: unknown } } | null } | null;
    const matched = row?.parsed_fields?.scoringIntegrity?.matched;
    setModelSaw(prev => ({
      ...prev,
      [candidateId]: err || !row
        ? { error: err?.message ?? "not found" }
        : { redacted_text: row.redacted_text ?? null, candidate_jurisdiction: row.candidate_jurisdiction ?? null, matched: Array.isArray(matched) ? matched.filter((m): m is string => typeof m === "string") : [] },
    }));
  };

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
    if (!attested) { setError("Confirm you are allowed to have this resume scored first."); return; }
    setEvaluating(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("shortlist-evaluate", {
      body: {
        roleId: activeRole.id,
        resumeText: candidateText,
        fileName: candidateName.trim() || null,
        jurisdiction: activeRole.jurisdiction,
        attested: true,
      },
    }).catch((e: unknown) => ({ data: null, error: e ?? { message: "network" } }));
    setEvaluating(false);
    if (err || !(data as { success?: boolean })?.success) {
      // The server's own sentence and when to try again, never one line for every refusal (S14X-197).
      const refusal = await readShortlistRefusal(data, err, "The evaluation did not complete, and nothing was stored.");
      setSignInNeeded(refusal.signIn);
      setError(refusal.message);
      return;
    }
    setSignInNeeded(false);
    setCandidateText("");
    setCandidateName("");
    setAttested(false);
    loadCandidates(activeRole.id);
  };

  // Alternative review before any scoring: a record and its logged request, no model call.
  const routeToAltReview = async () => {
    if (!activeRole) return;
    if (!attested) { setError("Confirm you are allowed to have this resume scored first."); return; }
    setEvaluating(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("shortlist-evaluate", {
      body: { roleId: activeRole.id, altReview: true, fileName: candidateName.trim() || null, jurisdiction: activeRole.jurisdiction, attested: true },
    }).catch((e: unknown) => ({ data: null, error: e ?? { message: "network" } }));
    setEvaluating(false);
    if (err || !(data as { success?: boolean })?.success) {
      const refusal = await readShortlistRefusal(data, err, "The alternative review was not recorded.");
      setSignInNeeded(refusal.signIn);
      setError(refusal.message);
      return;
    }
    setSignInNeeded(false);
    setCandidateText("");
    setCandidateName("");
    setAttested(false);
    loadCandidates(activeRole.id);
  };

  // ── Human-in-the-loop gate: the ONLY path that changes candidate status ──
  const decide = async (candidate: Candidate, action: "advance" | "reject") => {
    if (!session) return;
    if (action === "reject" && decisionReason.trim().length < 3) {
      setError("A brief reason is required to reject (it goes in the audit log).");
      return;
    }
    // One transaction: the decision row and the status it sets, or neither
    // (shortlist_decide, 20261009111000). Its error is shown, never swallowed.
    const { error: err } = await supabase.rpc("shortlist_decide" as never, {
      p_candidate_id: candidate.id, p_action: action, p_reason: decisionReason.trim() || null,
    } as never);
    if (err) { setError(`Decision not recorded: ${err.message}`); return; }
    setDecisionReason("");
    setError(null);
    setDecisionLog(prev => { const n = { ...prev }; delete n[candidate.id]; return n; });
    if (activeRole) loadCandidates(activeRole.id);
    loadDecisionLog(candidate.id);
  };

  const overrideScore = async (candidate: Candidate, newScore: number) => {
    if (!session) return;
    if (!Number.isFinite(newScore) || newScore < 0 || newScore > 100) { setError("An override is a whole number from 0 to 100."); return; }
    // The override is a decision; the AI's score stays as it was scored.
    const { error: err } = await supabase.from("shortlist_decisions").insert({
      candidate_id: candidate.id,
      owner_id: session.user.id,
      actor_email: user?.email ?? null,
      action: "override_score",
      old_value: String(reviews[candidate.id]?.overrideScore ?? candidate.score ?? ""),
      new_value: String(newScore),
      reason: "manual reviewer override",
    });
    if (err) { setError(`Override not recorded: ${err.message}`); return; }
    setError(null);
    setDecisionLog(prev => { const n = { ...prev }; delete n[candidate.id]; return n; });
    if (activeRole) loadCandidates(activeRole.id);
    loadDecisionLog(candidate.id);
  };

  const requestAltReview = async (candidate: Candidate) => {
    if (!session) return;
    const { error: err } = await supabase.from("shortlist_decisions").insert({
      candidate_id: candidate.id,
      owner_id: session.user.id,
      actor_email: user?.email ?? null,
      action: "alt_review_requested",
      reason: "Candidate routed to non-automated alternative review (ADA / accommodation path)",
    });
    if (err) { setError(`Alternative review not recorded: ${err.message}`); return; }
    setError(null);
    // The candidate leaves the ranking and its score is hidden from here on.
    setReviews(prev => ({ ...prev, [candidate.id]: { overrideScore: prev[candidate.id]?.overrideScore ?? null, altReview: true } }));
    setDecisionLog(prev => { const n = { ...prev }; delete n[candidate.id]; return n; });
    loadDecisionLog(candidate.id);
  };

  // ── Exports: the customer's compliance evidence trail ────────────────────
  // The role's full rows, every decision and every logged notice, read by
  // role in pages: a file with a missing part is never downloaded (S14X-075),
  // and the JSON carries what the model saw for each candidate (S14X-162).
  const latestNoticeSentAt = (list: NoticeRow[]) => list.reduce<string | null>((a, n) => (a == null || n.sent_at > a ? n.sent_at : a), null);
  const exportAudit = async (format: "json" | "csv") => {
    if (!activeRole) return;
    const [full, decisions, logged] = await Promise.all([
      format === "json" ? readRoleCandidates<Record<string, unknown>>(supabase, activeRole.id, "*") : Promise.resolve({ rows: [], error: null }),
      readRoleDecisions<Record<string, unknown>>(supabase, activeRole.id),
      readRoleNotices<NoticeRow>(supabase, activeRole.id),
    ]);
    const failed = full.error ?? decisions.error ?? logged.error;
    if (failed) { setError(`The audit export was not downloaded: part of it could not be read (${failed}). Try again.`); return; }
    const rowById = new Map(full.rows.map((r) => [String(r.id), r]));
    let blob: Blob;
    let name: string;
    if (format === "json") {
      const payload = {
        exportedAt: new Date().toISOString(),
        role: { id: activeRole.id, title: activeRole.title, jd_text: activeRole.jd_text, jd_version: activeRole.jd_version, jurisdiction: activeRole.jurisdiction },
        // Each candidate carries the JD version and text it was scored against,
        // the text the model was shown, and whether it was routed to
        // alternative review (its score not to be used).
        candidates: candidates.map(c => {
          const row = rowById.get(c.id) ?? {};
          return {
            ...c,
            redacted_text: row.redacted_text ?? null,
            candidate_jurisdiction: row.candidate_jurisdiction ?? null,
            parsed_fields: row.parsed_fields ?? null,
            jd_text_scored: row.jd_text_scored ?? c.jd_text_scored,
            alt_review: reviews[c.id]?.altReview === true,
            human_override_score: reviews[c.id]?.overrideScore ?? null,
          };
        }),
        decisions: decisions.rows.map(withoutEmbed),
        notices: logged.rows.map(n => ({ ...n, logged_at: n.logged_at ?? n.sent_at })),
        note: "Append-only audit export. Shortlist records no demographic data about candidates. A notice's sent_at is the date the employer said it went out; logged_at is when it was logged.",
      };
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      name = `shortlist-audit-${activeRole.title.replace(/\W+/g, "-")}.json`;
    } else {
      blob = new Blob([shortlistAuditCsv(candidates, reviews, latestNoticeSentAt(logged.rows))], { type: "text/csv" });
      name = `shortlist-audit-${activeRole.title.replace(/\W+/g, "-")}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Candidate notices: copying is not sending (S14X-163) ─────────────────
  const copyNotice = async (text: string) => {
    setNoticeMsg(null);
    try {
      await navigator.clipboard.writeText(text);
      setNoticeMsg("Copied. Nothing is logged until you log the notice as sent.");
    } catch (e) {
      setNoticeMsg(`Could not copy the notice: ${e instanceof Error ? e.message : "the clipboard refused"}. Select the text and copy it by hand.`);
    }
  };

  const logNoticeSent = async () => {
    if (!activeRole || !session) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(noticeSentOn)) { setNoticeMsg("Enter the date the notice went out before logging it."); return; }
    const sentAt = new Date(`${noticeSentOn}T12:00:00Z`);
    if (Number.isNaN(sentAt.getTime()) || sentAt.getTime() > Date.now() + 864e5) { setNoticeMsg("A notice can be logged only once it has gone out: the date cannot be in the future."); return; }
    const t = noticeTemplate(activeRole.jurisdiction, activeRole.title, user?.email ?? "[your email]");
    const row = {
      role_id: activeRole.id, owner_id: session.user.id, jurisdiction: activeRole.jurisdiction,
      notice_type: t.type, content: t.text, sent_at: sentAt.toISOString(),
    };
    const recipients = noticeRecipients.trim().slice(0, 2000);
    let { error: err } = await supabase.from("shortlist_notices").insert({ ...row, ...(recipients ? { recipients } : {}) } as never);
    let note = "";
    // Before 20261112210000 applies the column is absent (PGRST204): log the notice without it, and say so.
    if (err && (err as { code?: string }).code === "PGRST204" && recipients) {
      ({ error: err } = await supabase.from("shortlist_notices").insert(row as never));
      note = " The recipient list is kept only after the database update; it was not saved.";
    }
    if (err) { setNoticeMsg(`Notice not logged: ${err.message}`); return; }
    setNoticeMsg(`Notice logged as sent on ${noticeSentOn}.${note}`);
    setNoticeSentOn("");
    setNoticeRecipients("");
    loadNotices(activeRole.id);
  };

  /** NYC LL144: a notice logged at least ten business days before the tool is used. */
  const nycNoticeReady = notices.some(n => businessDaysSince(n.sent_at) >= 10);

  const ranked = useMemo(() => rankCandidates(candidates, reviews), [candidates, reviews]);

  if (loading || !session) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const decided = candidates.filter(c => c.status !== "pending").length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 container max-w-4xl pt-16 pb-16">
        <div className="flex items-center gap-3 mb-1">
          <Briefcase className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Shortlist</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold uppercase tracking-wide">Beta</span>
        </div>
        <p className="text-xs text-muted-foreground mb-6 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
          AI ranks and recommends — every advance/reject is a logged human decision. Protected-class proxies are removed before scoring.
        </p>
        {/* How Shortlist works, on this page: the seeker scan's methodology page never mentions Shortlist (S14X-233). */}
        <details className="mb-6 rounded-xl border border-border/60 bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground" data-how-shortlist-works>
          <summary className="cursor-pointer text-xs font-semibold text-foreground">How Shortlist works</summary>
          <div className="space-y-2 mt-2">
            <p><span className="text-foreground font-medium">What is removed before scoring.</span> The candidate&apos;s name as read from the top of the résumé (or from the file name when the text shows it), contact details and street addresses, labelled personal fields (birth date, age, sex, family, religion, nationality, ethnicity, visa status, health) in English, German, French, Spanish, Portuguese, Dutch, Chinese and Japanese, education years, and phrases that point at age, sex, family, disability, origin, faith or group membership. The model sees one neutral [REDACTED] mark; which category was hidden is recorded only in the audit. A leave reads as a career break.</p>
            <p><span className="text-foreground font-medium">What can pass.</span> Detection is pattern-based: a name the header does not show, an unusual layout, another language, or a proxy in words the rules do not know can reach the model. Each candidate says when no name was found; open it to read exactly what the model saw.</p>
            <p><span className="text-foreground font-medium">What is stored.</span> For each candidate: the redacted text the model saw, the score, signals and flags, the job description scored, the model and prompt version, which exclusions fired, your confirmation that you may have the résumé scored, and every decision with who made it and when; for each role, the notices you log as sent. Nothing about a candidate&apos;s sex, race or other demographics is recorded.</p>
            {deleteReady ? (
              <p data-retention-rule-a><span className="text-foreground font-medium">For how long.</span> Until you delete the candidate, the role or your account. Anything still held four years after it was uploaded is deleted automatically. Each deletion is logged with its date and ids, never the résumé.</p>
            ) : (
              <p><span className="text-foreground font-medium">For how long.</span> There is no automatic deletion yet: records stay until the account is closed. To have a role&apos;s records removed sooner, write to the address in the footer.</p>
            )}
          </div>
        </details>

        {error && (
          <p className="text-xs text-destructive mb-4 p-3 rounded-lg bg-destructive/5 border border-destructive/20" data-error>
            {error}
            {signInNeeded && <> <Link to={`/auth?next=${encodeURIComponent("/shortlist")}`} className="underline font-semibold" data-sign-in>Sign in again</Link></>}
          </p>
        )}

        {deleteMsg && <p className="text-xs text-muted-foreground mb-4 p-3 rounded-lg bg-muted/30 border border-border/60" data-delete-msg>{deleteMsg}</p>}

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
              <p className="text-[10px] text-muted-foreground">Jurisdiction drives the required candidate notices (NYC LL144 · IL HB 3773 · CA FEHA · EU AI Act).</p>
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
              {deleteReady && (
                <button onClick={() => { setDeleteTarget({ kind: "role", id: activeRole.id, label: activeRole.title }); setDeleteTyped(""); setDeleteMsg(null); }}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 text-xs text-destructive hover:bg-destructive/5 transition-colors" data-delete-role>
                  Delete role
                </button>
              )}
            </div>
            {deleteTarget && (
              <div className="mb-4 p-3 rounded-xl border border-destructive/40 bg-destructive/5 space-y-2" data-delete-confirm>
                <p className="text-xs text-foreground">
                  {deleteTarget.kind === "role"
                    ? <>Delete the role &ldquo;{deleteTarget.label}&rdquo; with all its candidates, their evaluations and decisions, and its logged notices?</>
                    : <>Delete {deleteTarget.label}, its evaluation and its decisions?</>}
                  {" "}This cannot be undone. Export the audit first if you need to keep a copy. A record that it was deleted, with dates and ids and no résumé, stays in your account.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input value={deleteTyped} onChange={e => setDeleteTyped(e.target.value)} aria-label="Type DELETE to confirm" placeholder="Type DELETE to confirm"
                    className="px-3 py-1.5 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground" />
                  <button onClick={confirmDelete} disabled={deleting || deleteTyped.trim() !== "DELETE"}
                    className="px-3 py-1.5 rounded-lg bg-destructive text-white text-xs font-semibold hover:bg-destructive/90 transition-colors disabled:opacity-50" data-delete-go>
                    {deleting ? "Deleting…" : "Delete for good"}
                  </button>
                  <button onClick={() => { setDeleteTarget(null); setDeleteTyped(""); }} className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Notices */}
            {showNotice && (
              <div className="rounded-2xl border border-border bg-card p-5 mb-4">
                <h3 className="font-semibold text-foreground text-sm mb-2">Candidate notice — {activeRole.jurisdiction}</h3>
                {activeRole.jurisdiction === "NYC" && <p className="text-[11px] text-warning mb-2">⚠️ NYC LL144: candidates must receive this ≥10 business days BEFORE the AEDT is used, and the bias-audit summary must be posted publicly.</p>}
                <pre className="text-xs text-muted-foreground bg-muted/20 border border-border/50 rounded-lg p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">{noticeTemplate(activeRole.jurisdiction, activeRole.title, user?.email ?? "[your email]").text}</pre>
                <div className="flex flex-wrap items-end gap-2 mt-2">
                  <button onClick={() => copyNotice(noticeTemplate(activeRole.jurisdiction, activeRole.title, user?.email ?? "[your email]").text)}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors" data-notice-copy>
                    Copy
                  </button>
                  <label className="text-[11px] text-muted-foreground">Sent on
                    <input type="date" value={noticeSentOn} onChange={e => setNoticeSentOn(e.target.value)} aria-label="Date the notice was sent"
                      className="ml-1 px-2 py-1 rounded-lg bg-background border border-border text-xs text-foreground" />
                  </label>
                  <input value={noticeRecipients} onChange={e => setNoticeRecipients(e.target.value)} maxLength={2000} aria-label="Sent to"
                    placeholder="Sent to (candidate references) — optional"
                    className="flex-1 min-w-[180px] px-2 py-1 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground" />
                  <button onClick={logNoticeSent}
                    className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors" data-notice-log>
                    Log as sent
                  </button>
                </div>
                {noticeMsg && <p className="text-[11px] mt-2 text-foreground" data-notice-msg>{noticeMsg}</p>}
                {notices.length > 0 && (
                  <div className="mt-3" data-notice-list>
                    <p className="text-xs font-semibold text-foreground mb-1">Logged notices</p>
                    {notices.map(n => (
                      <p key={n.id} className="text-[11px] text-muted-foreground">
                        {n.notice_type.replace(/_/g, " ")} · sent {new Date(n.sent_at).toLocaleDateString()} · logged {new Date(n.logged_at ?? n.sent_at).toLocaleString()}
                        {n.recipients ? ` · to ${n.recipients}` : ""}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Bias audit: no demographic data is recorded here (D14) */}
            {showBias && (
              <div className="rounded-2xl border border-border bg-card p-5 mb-4" data-bias-note>
                <h3 className="font-semibold text-foreground text-sm mb-1">Bias audit</h3>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Shortlist does not record candidates' sex, race or other demographic data. An impact-ratio audit needs candidates' own self-reported data, held in your applicant system or by your auditor: join it to the Audit CSV by candidate ID there. {decided} of {candidates.length} candidates here have a final human decision.
                </p>
                <p className="text-[10px] text-muted-foreground">NYC LL144 requires an independent annual bias audit; this export prepares the decision data, it does not replace the auditor.</p>
              </div>
            )}

            {/* Add candidate */}
            <div className="rounded-2xl border border-border bg-card p-5 mb-4">
              <h3 className="font-semibold text-foreground text-sm mb-2">Add candidate</h3>
              <input value={candidateName} onChange={e => setCandidateName(e.target.value)} placeholder="Reference (e.g. file name or candidate #) — optional"
                className="w-full mb-2 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <div className="flex items-center gap-2 mb-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 cursor-pointer transition-colors">
                  {parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Upload PDF / DOCX / TXT
                  <input type="file" accept=".pdf,.docx,.doc,.txt" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
                </label>
                <span className="text-[10px] text-muted-foreground">or paste below</span>
              </div>
              <textarea value={candidateText} onChange={e => setCandidateText(e.target.value)} rows={5} placeholder="Paste the candidate's resume text…"
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <label className="flex items-start gap-2 mt-2 text-[11px] text-muted-foreground" data-attestation>
                <input type="checkbox" className="mt-0.5" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                <span>{SHORTLIST_ATTESTATION_TEXT}</span>
              </label>
              {activeRole.jurisdiction === "NYC" && !nycNoticeReady && (
                <p className="text-[11px] text-warning mt-2" data-nyc-notice-warning>
                  NYC LL144: no candidate notice is logged as sent at least 10 business days ago for this role. Evaluating now may be too early; log the notice under Candidate notices once it has gone out.
                </p>
              )}
              <div className="flex items-center gap-3 mt-2">
                <button onClick={evaluateCandidate} disabled={evaluating || !attested}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors">
                  {evaluating && <Loader2 className="w-4 h-4 animate-spin" />} Evaluate
                </button>
                <button onClick={routeToAltReview} disabled={evaluating || !attested} title="Record the candidate for non-automated review without any AI scoring (ADA / accommodation)"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-60 transition-colors">
                  <Accessibility className="w-3.5 h-3.5" /> Alternative review, no AI
                </button>
                <p className="text-[10px] text-muted-foreground">The name (when one is found), age signals, address and other protected-class proxies are removed before the model sees the text; see How Shortlist works for what can pass.</p>
              </div>
            </div>

            {/* Ranked candidates: nothing is ranked from a partial read (S14X-075) */}
            {readError && <p className="text-xs text-destructive mb-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20" data-read-error>{readError}</p>}
            <div className="space-y-2">
              {!readError && ranked.map((c) => (
                <div key={c.id} className="rounded-2xl border border-border bg-card" data-candidate={c.id}>
                  <button onClick={() => { const next = expanded === c.id ? null : c.id; setExpanded(next); if (next) { loadDecisionLog(c.id); loadModelSaw(c.id); } }} className="w-full flex items-center gap-3 p-4 text-left">
                    <span className="text-xs text-muted-foreground w-6" data-rank>{c.rank != null ? `#${c.rank}` : ""}</span>
                    {c.rank == null ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold" data-alt-review>Alternative review</span>
                    ) : (
                      <span className={`text-xl font-bold w-10 ${(c.shownScore ?? 0) >= 70 ? "text-success" : (c.shownScore ?? 0) >= 50 ? "text-warning" : "text-destructive"}`} data-score>{c.shownScore ?? "—"}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.file_name || `Candidate ${c.id.slice(0, 8)}`}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {c.rank != null && reviews[c.id]?.overrideScore != null ? `Reviewer score · AI scored ${c.score ?? "—"} · ` : ""}{c.level_read ?? ""}
                      </p>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${c.status === "advanced" ? "bg-success/10 text-success" : c.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{c.status}</span>
                    {expanded === c.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </button>

                  {expanded === c.id && (
                    <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                      {reviews[c.id]?.altReview && (
                        <p className="text-[11px] text-primary">Routed to non-automated review: the AI evaluation is not shown or ranked, and exports mark it.</p>
                      )}
                      {/* Signals considered — transparency panel */}
                      {!reviews[c.id]?.altReview && <div>
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
                      </div>}
                      {c.steered && (
                        <p className="text-xs text-destructive font-medium" data-steered>{PLANTED_INSTRUCTIONS_FLAG}</p>
                      )}
                      {c.nameDetected === false && (
                        <p className="text-xs text-warning" data-name-not-found>No name was found at the top of this résumé, so the candidate&apos;s name may have reached the model. Check what the model saw below.</p>
                      )}
                      {!reviews[c.id]?.altReview && (c.flags ?? []).filter((f) => f !== PLANTED_INSTRUCTIONS_FLAG).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-1">Job-related gaps vs JD</p>
                          {(c.flags ?? []).filter((f) => f !== PLANTED_INSTRUCTIONS_FLAG).map((f, i) => <p key={i} className="text-xs text-muted-foreground">• {f}</p>)}
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

                      {/* What the model saw: the redacted text, as stored with the evaluation (S14X-162) */}
                      {modelSaw[c.id] && (
                        <details className="rounded-lg border border-border/50 bg-muted/20 p-2" data-model-saw>
                          <summary className="cursor-pointer text-xs font-semibold text-foreground">What the model saw</summary>
                          {"error" in modelSaw[c.id] ? (
                            <p className="text-[11px] text-destructive mt-1">Could not read it: {(modelSaw[c.id] as { error: string }).error}</p>
                          ) : (
                            <>
                              <p className="text-[11px] text-muted-foreground mt-1">Candidate jurisdiction: {(modelSaw[c.id] as ModelSaw).candidate_jurisdiction ?? "not recorded"}</p>
                              {(modelSaw[c.id] as ModelSaw).matched.length > 0 && (
                                <p className="text-[11px] text-destructive">Text addressed to the scorer: {(modelSaw[c.id] as ModelSaw).matched.join("; ")}</p>
                              )}
                              <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto mt-1">{(modelSaw[c.id] as ModelSaw).redacted_text ?? "No text was scored (alternative review)."}</pre>
                            </>
                          )}
                        </details>
                      )}

                      {/* Decision history — the audit trail, human-readable */}
                      {(decisionLog[c.id] ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-1">Decision history</p>
                          <div className="space-y-0.5 max-h-32 overflow-y-auto">
                            {(decisionLog[c.id] ?? []).map((d, i) => (
                              <p key={i} className="text-[11px] text-muted-foreground">
                                <span className="text-foreground font-medium">{d.action.replace(/_/g, " ")}</span>
                                {d.old_value && d.new_value ? ` (${d.old_value} → ${d.new_value})` : ""}
                                {d.reason ? ` — "${d.reason}"` : ""}
                                {" · "}{d.actor_email ?? "unknown"} · {new Date(d.created_at).toLocaleString()}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

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
                        <button onClick={() => requestAltReview(c)} disabled={reviews[c.id]?.altReview === true} title="Route to non-automated review (ADA/accommodation)"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
                          <Accessibility className="w-3.5 h-3.5" /> Alt review
                        </button>
                        {deleteReady && (
                          <button onClick={() => { setDeleteTarget({ kind: "candidate", id: c.id, label: "this candidate" }); setDeleteTyped(""); setDeleteMsg(null); window.scrollTo?.({ top: 0, behavior: "smooth" }); }}
                            className="ml-auto px-3 py-1.5 rounded-lg border border-destructive/40 text-xs text-destructive hover:bg-destructive/5 transition-colors" data-delete-candidate>
                            Delete candidate
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!readError && candidates.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">No candidates evaluated yet for this role.</p>
              )}
            </div>
          </>
        )}

        <p className="text-[10px] text-muted-foreground mt-8">
          Shortlist recommends and ranks only; all employment decisions are made by humans. Notice templates and audit views are informational tooling, not legal advice — consult counsel for your jurisdiction. {deleteReady
            ? "Records are kept until you delete the candidate, the role or your account, and anything still held four years after it was uploaded is deleted (How Shortlist works, above)."
            : "Records are kept until the account is closed; there is no automatic deletion yet (How Shortlist works, above)."}
        </p>
      </main>
      <Footer />
    </div>
  );
}
