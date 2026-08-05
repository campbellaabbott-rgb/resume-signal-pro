// Morning Queue — the Apply Agent's surface. A standing mandate (query,
// filters, salary floor, resume snapshot) that a nightly runner turns into a
// reviewed morning shortlist: each pick scored against the resume, churny
// companies skipped, genuine hirers boosted, and every pick carries the
// REASONS it was chosen (structured data localized here — the agent shows its
// work).
//
// IN REVIEW MODE the human presses send: picks deep-link into the board's
// apply flow. IN AUTO MODE they do not — apply-agent claims packets in `ready`
// and the worker submits them. This comment used to end "nothing is ever
// submitted on the user's behalf", which was true when it was written and
// false from the moment auto mode shipped. Three separate strings in this one
// file made that same claim; a docstring drifts exactly like copy does, and
// nobody diffs a comment against the runtime.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sunrise, Play, Pause, X, Check, ArrowRight, Sparkles, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAgentSender } from "@/hooks/useAgentSender";
import { EMPTY_PROPOSAL, proposeMandate, toMandateField, type MandateProposal } from "@/lib/mandateProposal";

const sb = supabase as unknown as {
  from: (t: string) => any;
  functions: { invoke: (n: string, o?: { body?: unknown }) => Promise<{ data: any; error: any }> };
};

interface Mandate {
  user_id: string; email: string; active: boolean; q: string; category: string;
  location: string; remote_only: boolean; salary_min: number | null; daily_count: number;
  resume_text: string; last_run_at: string | null; email_opt_in?: boolean;
  apply_mode?: "review" | "auto";
  /** Reach. Absent on rows read before the migration landed; absent means "not set". */
  max_age_days?: number | null; include_uncategorised?: boolean | null;
  last_run_summary: { scanned: number; picked: number; skipped_churn: number; skipped_lowfit: number } | null;
}
/**
 * One saved search. Criteria only — the PROFILE (name, phone, résumé, standing
 * answers) stays on the mandate, one row per person, because two copies of "are
 * you authorised to work" that can disagree is worse than the one-search limit
 * this replaces.
 */
interface Search {
  id: number; label: string; active: boolean;
  q: string; category: string; location: string;
  remote_only: boolean; salary_min: number | null; daily_count: number;
  max_age_days?: number | null; include_uncategorised?: boolean | null;
  last_run_summary: { scanned: number; picked: number } | null;
}
const MAX_SEARCHES = 10; // mirrors the agent_searches_cap trigger

interface QueueItem {
  id: number; posting_id: string; title: string; company: string; location: string;
  salary: string; posted_at: string | null; fit_pct: number | null;
  reasons: Array<{ k: string; pct?: number; top?: string[]; n?: number; days?: number }>;
  status: string; created_at: string;
  /** Which saved search found this. Empty on picks queued before attribution existed. */
  search_label?: string;
}

const CATEGORIES = ["", "engineering", "data_ai", "design", "product", "marketing", "sales", "customer", "finance", "legal", "people_hr", "operations", "healthcare", "science", "education", "hospitality_retail", "security", "admin"];

/**
 * WHAT WE PARSED, SHOWN BACK BEFORE IT IS SAVED.
 *
 * Roles and locations are comma-separated, and a separator you cannot see is a
 * separator people get wrong — "Product Manager, Programme Manager" and
 * "Product Manager Programme Manager" look nearly identical in a text box and
 * mean completely different searches. Rendering the parsed terms as chips makes
 * the split visible at the moment it can still be corrected.
 *
 * Deliberately mirrors the SAME splitter the runner uses, including the
 * 12-term bound, so what is shown is what will actually be searched rather than
 * a hopeful preview of it.
 */
function TermChips({ raw, label }: { raw: string; label: string }) {
  const terms = String(raw ?? "").split(",").map((t) => t.replace(/[,()*]/g, " ").trim())
    .filter((t) => t.length > 0).slice(0, 12);
  if (terms.length < 2) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1" aria-label={label}>
      {terms.map((t, i) => (
        <span key={i} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs text-muted-foreground">
          {t}
        </span>
      ))}
    </div>
  );
}

export function MorningQueuePanel({ userId, email, defaultResume }: {
  userId: string; email: string | null; defaultResume: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Same source the marketing surfaces use. Defaults to false and treats any
  // error as offline, so a first paint can understate the product but never
  // overstate it.
  const { online: senderOnline } = useAgentSender();
  const [agentActive, setAgentActive] = useState<boolean | null>(null);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    q: "", category: "", location: "", remote_only: false, salary_min: "", daily_count: 5,
    // REACH. `max_age_days` empty means no age constraint, which is what every
    // existing mandate has and keeps. `include_uncategorised` off means the
    // category filter behaves exactly as it always did.
    max_age_days: "", include_uncategorised: false,
  });

  // MANY SEARCHES, ONE PROFILE.
  //
  // `searches` null means the table has not answered yet OR is not there — the
  // migration may land after this build. In that case the panel falls back to
  // the single-mandate form it has always shown, rather than rendering an empty
  // list that reads as "the agent forgot your search".
  const [searches, setSearches] = useState<Search[] | null>(null);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [label, setLabel] = useState("");

  // THE RÉSUMÉ THIS PANEL CAN SEE, WHICH ON /agent WAS NOTHING.
  //
  // `defaultResume` is supplied by Account.tsx and hardcoded `null` by the
  // Agent page — so on the agent's own address the matching résumé was always
  // absent, `resumeReady` was always false for anyone who had not first
  // activated from /account, and the Activate button sat disabled under a
  // sentence pointing "above" at a panel that uploads a CV without ever writing
  // resume_text. The page dedicated to the agent was the one page that could
  // not start it.
  //
  // Read here, from the same two places Account reads and in the same order
  // agent-runner prefers them: the pinned matching résumé first, the newest
  // scan second. A failure leaves it null, which is exactly the old behaviour.
  const [ownResume, setOwnResume] = useState<string | null>(null);
  useEffect(() => {
    if (defaultResume) return;                 // the caller already has one
    let live = true;
    void (async () => {
      const [{ data: prof }, { data: scan }] = await Promise.all([
        sb.from("user_profiles").select("matching_resume_text").eq("user_id", userId).maybeSingle(),
        sb.from("user_scans").select("resume_text").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!live) return;
      setOwnResume(prof?.matching_resume_text ?? scan?.resume_text ?? null);
    })();
    return () => { live = false; };
  }, [userId, defaultResume]);

  const loadSearches = useCallback(async () => {
    // TWO SELECTS. PostgREST fails the WHOLE query on an unknown column, and
    // the error path here sets `searches` to null, which renders the old
    // single-mandate form — so naming a column before its migration lands would
    // make everybody's saved searches vanish from the page. The reach columns
    // are asked for first and dropped if they are not there yet.
    const COLS = "id,label,active,q,category,location,remote_only,salary_min,daily_count,last_run_summary";
    const read = (cols: string) => sb.from("agent_searches")
      .select(cols).eq("user_id", userId).order("created_at", { ascending: true });
    let { data, error } = await read(`${COLS},max_age_days,include_uncategorised`);
    if (error) ({ data, error } = await read(COLS));
    if (error) { setSearches(null); return; }
    setSearches((data ?? []) as Search[]);
  }, [userId]);

  useEffect(() => {
    void (async () => {
      const [{ data: m }, { data: qRows }] = await Promise.all([
        sb.from("agent_mandates").select("*").eq("user_id", userId).maybeSingle(),
        sb.from("agent_queue").select("*").eq("user_id", userId).in("status", ["ready", "approved"]).order("created_at", { ascending: false }).limit(30),
      ]);
      if (m) {
        setMandate(m as Mandate);
        setForm({ q: m.q, category: m.category, location: m.location, remote_only: m.remote_only, salary_min: m.salary_min?.toString() ?? "", daily_count: m.daily_count,
          max_age_days: m.max_age_days?.toString() ?? "", include_uncategorised: m.include_uncategorised === true });
      }
      if (Array.isArray(qRows)) setQueue(qRows as QueueItem[]);
      await loadSearches();
    })();
  }, [userId, loadSearches]);

  /**
   * The two reach fields, written the way the runner reads them.
   *
   * The clamp is here as well as in the runner and in a CHECK constraint. That
   * is three copies on purpose: a value the runner has to silently correct is a
   * row that lies about itself, and this is the only one of the three the
   * person can see before it is saved.
   */
  const reachPatch = useCallback(() => {
    const n = parseInt(form.max_age_days, 10);
    return {
      max_age_days: Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : null,
      include_uncategorised: form.include_uncategorised === true,
    };
  }, [form.max_age_days, form.include_uncategorised]);

  /** Insert or update one search. The trigger enforces the ceiling; this only reports it. */
  const saveSearch = useCallback(async () => {
    const row = {
      user_id: userId,
      label: (label.trim() || t("agentQueue.untitledSearch", "My search")).slice(0, 60),
      q: form.q.trim(), category: form.category, location: form.location.trim(),
      remote_only: form.remote_only,
      salary_min: form.salary_min ? parseInt(form.salary_min, 10) || null : null,
      daily_count: Math.max(1, Math.min(10, form.daily_count)),
      ...reachPatch(),
      updated_at: new Date().toISOString(),
    };
    setBusy(true);
    const { error } = editingId === "new" || editingId == null
      ? await sb.from("agent_searches").insert(row)
      : await sb.from("agent_searches").update(row).eq("id", editingId);
    setBusy(false);
    if (error) {
      // The 10-search ceiling lives in a database trigger, so this is where a
      // user meets it. Saying "couldn't save" for a rule we chose would make
      // our limit look like a fault.
      const hit = /at most 10 active searches/i.test(String(error.message ?? ""));
      toast.error(hit
        ? t("agentQueue.searchLimitHit", "You can run up to 10 active searches. Pause one to add another.")
        : t("agentQueue.saveError", "Couldn't save — please try again."));
      return;
    }
    setEditingId(null); setLabel(""); setEditing(false);
    await loadSearches();
    toast.success(t("agentQueue.searchSaved", "Search saved."));
  }, [userId, label, form, editingId, loadSearches, reachPatch, t]);

  const toggleSearch = useCallback(async (s: Search) => {
    const { error } = await sb.from("agent_searches")
      .update({ active: !s.active, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (error) { toast.error(t("agentQueue.saveError", "Couldn't save — please try again.")); return; }
    await loadSearches();
  }, [loadSearches, t]);

  const deleteSearch = useCallback(async (s: Search) => {
    const { error } = await sb.from("agent_searches").delete().eq("id", s.id);
    if (error) { toast.error(t("agentQueue.saveError", "Couldn't save — please try again.")); return; }
    await loadSearches();
    toast.success(t("agentQueue.searchDeleted", "Search removed."));
  }, [loadSearches, t]);

  /** Open the shared criteria form against a specific search, or a blank one. */
  const editSearch = useCallback((s: Search | null) => {
    if (s) {
      setEditingId(s.id); setLabel(s.label);
      setForm({ q: s.q, category: s.category, location: s.location, remote_only: s.remote_only,
        salary_min: s.salary_min?.toString() ?? "", daily_count: s.daily_count,
        max_age_days: s.max_age_days?.toString() ?? "", include_uncategorised: s.include_uncategorised === true });
    } else {
      setEditingId("new"); setLabel("");
      setForm({ q: "", category: "", location: "", remote_only: false, salary_min: "", daily_count: 5,
        max_age_days: "", include_uncategorised: false });
    }
    setEditing(true);
  }, []);

  useEffect(() => {
    if (!email) { setAgentActive(false); return; }
    void (async () => {
      const { data } = await sb.functions.invoke("agent-access", { body: { email } });
      setAgentActive(!!data?.active);
    })();
  }, [email]);

  const subscribe = useCallback(async () => {
    if (!email) return;
    setBusy(true);
    const { data, error } = await sb.functions.invoke("create-agent-checkout", { body: { email } });
    setBusy(false);
    if (error || !data?.url) {
      if (data?.alreadySubscribed) { setAgentActive(true); return; }
      toast.error(t("agentQueue.checkoutError", "Couldn't open checkout — please try again."));
      return;
    }
    window.location.href = data.url;
  }, [email, t]);

  const saveMandate = useCallback(async (activate: boolean) => {
    // Current pinned/default resume FIRST — the old order preferred the
    // mandate's stale snapshot forever, so re-saving never picked up a new
    // resume (audit 2026-07-25).
    const resume = defaultResume?.trim() || mandate?.resume_text?.trim() || "";
    if (activate && resume.length < 100) {
      toast.error(t("agentQueue.needResume", "Save a résumé for matching first (above) — the agent scores every posting against it."));
      return;
    }
    setBusy(true);
    const row = {
      user_id: userId,
      email: (email ?? "").toLowerCase(),
      active: activate,
      q: form.q.trim(),
      category: form.category,
      location: form.location.trim(),
      remote_only: form.remote_only,
      salary_min: form.salary_min ? parseInt(form.salary_min, 10) || null : null,
      daily_count: Math.max(1, Math.min(10, form.daily_count)),
      ...reachPatch(),
      resume_text: resume,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("agent_mandates").upsert(row, { onConflict: "user_id" });
    setBusy(false);
    if (error) { toast.error(t("agentQueue.saveError", "Couldn't save — please try again.")); return; }
    setMandate((prev) => ({ ...(prev ?? {} as Mandate), ...row, last_run_at: prev?.last_run_at ?? null, last_run_summary: prev?.last_run_summary ?? null }));
    setEditing(false);
    toast.success(activate
      ? t("agentQueue.activated", "Mandate active — your first queue arrives after tonight's run.")
      : t("agentQueue.paused", "Mandate paused — no new picks until you resume."));
  }, [mandate, defaultResume, userId, email, form, reachPatch, t]);

  // The morning email is the agent's whole point — it's on by default, but it
  // must be one click to stop, from the same place the mandate lives (not only
  // the unsubscribe link buried in the mail).
  const toggleEmail = useCallback(async (next: boolean) => {
    if (!userId) return;
    setMandate((prev) => (prev ? { ...prev, email_opt_in: next } : prev));
    const { error } = await sb.from("agent_mandates").update({ email_opt_in: next }).eq("user_id", userId);
    if (error) {
      setMandate((prev) => (prev ? { ...prev, email_opt_in: !next } : prev));
      toast.error(t("agentQueue.emailSaveError", "Couldn't change that — please try again."));
    }
  }, [userId, t]);

  const decide = useCallback(async (id: number, status: "approved" | "dismissed") => {
    const { error } = await sb.from("agent_queue").update({ status, decided_at: new Date().toISOString() }).eq("id", id);
    if (!error) setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, status } : it)));
    // Keep means "this enters my pipeline" — create the tracker row the rest
    // of the account already works from, instead of the pick evaporating
    // (2026-07-25 audit upgrade). Duplicates are silently fine; a failed
    // insert never blocks the Keep itself.
    if (!error && status === "approved") {
      const it = queue.find((q) => q.id === id);
      if (it) {
        const { error: insErr } = await sb.from("user_applications").insert({
          user_id: userId,
          company: it.company,
          role: it.title,
          status: "saved",
          job_id: it.posting_id,
          location: it.location,
          fit_pct: it.fit_pct,
        });
        if (!insErr) toast.success(t("agentQueue.keptTracked", "Kept — added to your tracker below."));
      }
    }
  }, [queue, userId, t]);

  const reasonLabel = (r: QueueItem["reasons"][number]): string | null => {
    if (r.k === "fit" && r.pct != null) return t("agentQueue.reasonFit", "{{pct}}% match{{terms}}", { pct: r.pct, terms: r.top?.length ? ` · ${r.top.join(", ")}` : "" });
    if (r.k === "fills") return t("agentQueue.reasonFills", "filled {{n}} roles in our tracking", { n: r.n });
    if (r.k === "fresh") return (r.days ?? 0) === 0 ? t("agentQueue.reasonToday", "posted today") : t("agentQueue.reasonFresh", "posted {{d}}d ago", { d: r.days });
    if (r.k === "salary") return t("agentQueue.reasonSalary", "meets your salary floor");
    // Says what the agent can actually DO with this one. Four vendors have an
    // adapter — 5.3% of the board as measured 2026-08-03, not the "about 2%"
    // this comment asserted from when there were three — so on most rows this
    // chip is absent, and its absence is the honest signal that you finish
    // that one yourself.
    if (r.k === "sendable") return t("agentQueue.reasonSendable", "the agent can submit this one for you");
    return null;
  };

  const ready = queue.filter((q) => q.status === "ready");

  // THE PREREQUISITE THE BUTTON DID NOT ADMIT TO. saveMandate returns BEFORE
  // writing anything when the matching résumé is under 100 characters, so
  // clicking Activate wrote no row and left only a toast. A toast is gone in
  // four seconds; the user is then looking at a form that appears saved and an
  // agent that never runs, with nothing on screen explaining why. Verified live
  // 2026-08-02: agent_mandates was empty after an activate attempt.
  //
  // Same expression as saveMandate deliberately — a second, drifting copy of
  // "is the résumé usable" is how the button and the handler start disagreeing.
  const resumeForMandate = defaultResume?.trim() || ownResume?.trim() || mandate?.resume_text?.trim() || "";
  const resumeReady = resumeForMandate.length >= 100;

  // WHAT THE CV ALREADY SAYS, offered rather than asked for.
  //
  // Recomputed from the résumé, not stored: a proposal is worth exactly as much
  // as the document it was read from, and caching it would let a stale reading
  // of an old CV outlive the CV. Cheap enough to derive on render — it is a
  // handful of regexes over text already in memory.
  //
  // NOTHING HERE IS SAVED BY ITSELF. It fills the form; the person still presses
  // Activate. An agent that starts searching for a role we inferred is the agent
  // doing something nobody asked for, which is the one thing this product cannot
  // afford to do.
  const proposal: MandateProposal = resumeReady ? proposeMandate(resumeForMandate) : EMPTY_PROPOSAL;
  const proposalUseful = proposal.titles.length > 0 || proposal.locations.length > 0;
  // Only offered into an EMPTY field. Overwriting something a person typed is
  // the behaviour that makes autofill infuriating, and re-proposing over their
  // own edit would look like the form fighting them.
  const formIsBlank = !form.q.trim() && !form.location.trim() && !form.category;

  /** Add one term to a comma-separated field, or remove it if it is already there. */
  const toggleTerm = (field: "q" | "location", term: string) => {
    setForm((f) => {
      const current = f[field].split(",").map((x) => x.trim()).filter(Boolean);
      const has = current.some((x) => x.toLowerCase() === term.toLowerCase());
      const next = has
        ? current.filter((x) => x.toLowerCase() !== term.toLowerCase())
        : [...current, term];
      return { ...f, [field]: toMandateField(next) };
    });
  };
  const hasTerm = (field: "q" | "location", term: string) =>
    form[field].split(",").some((x) => x.trim().toLowerCase() === term.toLowerCase());

  /** Fill every blank field from the CV in one press. */
  const applyProposal = () => {
    setForm((f) => ({
      ...f,
      q: f.q.trim() || toMandateField(proposal.titles.map((p) => p.value)),
      location: f.location.trim() || toMandateField(proposal.locations.map((p) => p.value)),
      category: f.category || proposal.category?.slug || "",
    }));
    if (!label.trim() && proposal.titles[0]) {
      setLabel([proposal.titles[0].value, proposal.locations[0]?.value].filter(Boolean).join(", ").slice(0, 60));
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Sunrise className="w-5 h-5 text-primary shrink-0" />
        <h2 className="text-base font-bold text-foreground">{t("agentQueue.title", "Morning Queue")}</h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t("agentQueue.badge", "Apply Agent")}</span>
      </div>
      <p className="text-[13px] text-muted-foreground mb-4">
        {/* Two modes, two different true sentences. "You review, you send" stopped
            being true for auto mode the moment the agent could finish a form on
            its own, and copy that describes something which has since moved is
            the exact way this product tells a lie without anyone editing it. */}
        {mandate?.apply_mode === "auto"
          ? t("agentQueue.subtitleAuto", "Set your search once. Every night the agent scans new postings, scores them against your résumé, skips companies that churn re-listings, and queues the best few — each with its reasons. It submits the ones it can complete on its own and hands you the rest.")
          : t("agentQueue.subtitle", "Set your search once. Every night the agent scans new postings, scores them against your résumé, skips companies that churn re-listings, and queues the best few — each with its reasons. You review, you send.")}
      </p>

      {/* Paywall — the $99/mo Apply Agent tier (includes Pro). */}
      {agentActive === false && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-4">
          <p className="text-sm text-foreground font-medium mb-1">{t("agentQueue.payPitch", "Wake up to a reviewed shortlist instead of another hour of scrolling.")}</p>
          {/* GATED ON THE CAPABILITY, NOT ON SOMEONE REMEMBERING TO EDIT THIS.
              This sentence first said "it never submits for you", which auto
              mode falsified. The replacement described auto submission
              unconditionally — truthful about the design, but a promise the
              product cannot keep on a day when no worker is alive, stated on
              the surface that takes the money.
              AgentSubscriptionCard already solved this: it hides its
              auto-apply bullet behind `online` and swaps its footnote. Same
              rule here. When the sender is down the copy falls back to what is
              unambiguously true — prepared, ready for you to send. */}
          <p className="text-[12px] text-muted-foreground mb-3">
            {senderOnline
              ? t("agentQueue.payBoundary", "The agent prepares, explains, and never invents an answer. In review mode — the default — nothing goes out until you press send. Switch it to auto and it submits the ones it can complete on its own, and hands you the rest. 7 mornings free, then $99/month — everything in Pro included. Cancel anytime.")
              : t("agentQueue.payBoundaryOffline", "The agent prepares, explains, and never invents an answer — every application arrives ready for you to send. Unattended sending is not running right now. 7 mornings free, then $99/month — everything in Pro included. Cancel anytime.")}
          </p>
          <button onClick={() => void subscribe()} disabled={busy || !email}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 hover:bg-primary/90 disabled:opacity-50">
            <Sparkles className="w-4 h-4" /> {t("agentQueue.payCta", "Try the Apply Agent free for 7 days")}
          </button>
        </div>
      )}

      {/* Criteria editor — for one saved search, or for the mandate itself on
          the pre-migration fallback path. */}
      {(editing || !mandate) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {/* Only when editing a SEARCH. A name is what makes a morning queue
              of eight jobs from three searches readable rather than a list. */}
          {editingId != null && (
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60}
              placeholder={t("agentQueue.searchLabelPlaceholder", "Name this search — e.g. Product Manager, NYC")}
              className="sm:col-span-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold" />
          )}

          {/* READ OFF THE CV THEY ALREADY UPLOADED.
              Setup is one step — upload a CV — and then the very next screen is
              a blank box asking for a job title the document names four times.
              Each chip is a substring of a real line, and hovering shows the
              line, because "we read this off your CV" is only a claim worth
              making if you can see where from. */}
          {proposalUseful && (
            <div className="sm:col-span-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden />
                <span className="text-[12px] font-semibold text-foreground">
                  {t("agentQueue.fromCvTitle", "From your CV")}
                </span>
                {formIsBlank && (
                  <button type="button" onClick={applyProposal}
                    className="ml-auto text-[12px] font-semibold text-primary hover:underline">
                    {t("agentQueue.fromCvUseAll", "Use these")}
                  </button>
                )}
              </div>

              {proposal.titles.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground mr-0.5">{t("agentQueue.fromCvRoles", "Roles:")}</span>
                  {proposal.titles.map((p) => (
                    <button key={p.value} type="button" onClick={() => toggleTerm("q", p.value)}
                      title={t("agentQueue.fromCvEvidence", { defaultValue: "Read from: {{line}}", line: p.evidence })}
                      aria-pressed={hasTerm("q", p.value)}
                      className={`rounded-full border px-2 py-0.5 text-xs ${hasTerm("q", p.value)
                        ? "border-primary bg-primary/15 text-primary font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}>
                      {p.value}
                    </button>
                  ))}
                </div>
              )}

              {/* ADJACENT ROLES ARE NOT ON THE CV, and are labelled separately
                  for that reason. Presenting a suggestion as a quotation is the
                  same class of dishonesty as an invented answer on a form —
                  smaller stakes, identical shape. They earn their place because
                  a mandate can now hold several roles at once, so widening no
                  longer costs the search you already had. */}
              {proposal.adjacent.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground mr-0.5">{t("agentQueue.fromCvAlso", "Often a fit too:")}</span>
                  {proposal.adjacent.map((a) => (
                    <button key={a} type="button" onClick={() => toggleTerm("q", a)}
                      title={t("agentQueue.fromCvAdjacentTip", "A career-adjacent role — our suggestion, not something your CV says")}
                      aria-pressed={hasTerm("q", a)}
                      className={`rounded-full border border-dashed px-2 py-0.5 text-xs ${hasTerm("q", a)
                        ? "border-primary bg-primary/15 text-primary font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}>
                      {a}
                    </button>
                  ))}
                </div>
              )}

              {proposal.locations.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground mr-0.5">{t("agentQueue.fromCvPlaces", "Places:")}</span>
                  {proposal.locations.map((p) => (
                    <button key={p.value} type="button" onClick={() => toggleTerm("location", p.value)}
                      title={t("agentQueue.fromCvEvidence", { defaultValue: "Read from: {{line}}", line: p.evidence })}
                      aria-pressed={hasTerm("location", p.value)}
                      className={`rounded-full border px-2 py-0.5 text-xs ${hasTerm("location", p.value)
                        ? "border-primary bg-primary/15 text-primary font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/50"}`}>
                      {p.value}
                    </button>
                  ))}
                </div>
              )}

              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("agentQueue.fromCvNote",
                  "Suggestions only — nothing runs until you activate. We drop the seniority word (“Senior”) on purpose: postings title the same job a dozen ways, and the shorter term finds all of them.")}
              </p>
            </div>
          )}
          <input value={form.q} onChange={(e) => setForm((f) => ({ ...f, q: e.target.value }))}
            placeholder={t("morningQueue.qPlaceholder", "Product Manager, Programme Manager")}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <TermChips raw={form.q} label="Roles being searched" />
          <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c === "" ? t("agentQueue.anyField", "Any field") : t(`jobsPage.categories.${c}`, c)}</option>
            ))}
          </select>
          <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder={t("morningQueue.locPlaceholder", "London, Manchester, Remote")}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          <TermChips raw={form.location} label="Locations being searched" />
          <input value={form.salary_min} onChange={(e) => setForm((f) => ({ ...f, salary_min: e.target.value.replace(/\D/g, "") }))}
            placeholder={t("agentQueue.fieldSalary", "Salary floor, annual (only stated-pay postings match)")}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          {/* POSTING AGE, ON THE DATE THE EMPLOYER STATED.
              The runner's 36-hour window is about when WE first saw a posting,
              which is not how old it is — a feed can surface a role posted five
              months ago and it arrives in the queue as today's find. Same
              column and the same 1–30 clamp as the board's own filter, so the
              two surfaces cannot disagree about one posting. */}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t("agentQueue.fieldMaxAge", "Posted within")}
            <select value={form.max_age_days}
              onChange={(e) => setForm((f) => ({ ...f, max_age_days: e.target.value }))}
              className="rounded-lg border border-border bg-background px-2 py-1 text-sm">
              <option value="">{t("agentQueue.ageAny", "Any age")}</option>
              <option value="1">{t("agentQueue.age1", "24 hours")}</option>
              <option value="3">{t("agentQueue.age3", "3 days")}</option>
              <option value="7">{t("agentQueue.age7", "7 days")}</option>
              <option value="14">{t("agentQueue.age14", "14 days")}</option>
              <option value="30">{t("agentQueue.age30", "30 days")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={form.remote_only} onChange={(e) => setForm((f) => ({ ...f, remote_only: e.target.checked }))} />
            {t("agentQueue.fieldRemote", "Remote only")}
          </label>
          {form.max_age_days !== "" && (
            <p className="sm:col-span-2 text-[11px] text-muted-foreground -mt-1">
              {t("agentQueue.ageNote",
                "Based on the date each employer states on its own feed. Postings that carry no date are left out — we never guess an age.")}
            </p>
          )}

          {/* THE QUARTER OF THE BOARD A CATEGORY CHOICE WAS HIDING.
              `other` is where a posting lands when the title classifier could
              not place it — 162,800 of 590,808 postings on 2026-08-05 — and the
              runner's `.eq()` dropped every one the moment a field was chosen.
              Off by default so an existing mandate keeps behaving identically,
              and only shown when a category is actually set, because with "Any
              field" the bucket is already included. */}
          {form.category && (
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="mt-1"
                checked={form.include_uncategorised}
                onChange={(e) => setForm((f) => ({ ...f, include_uncategorised: e.target.checked }))} />
              <span>
                {t("agentQueue.fieldUncategorised",
                  "Also search uncategorised postings — about a quarter of the board, where the role's field could not be read from its title.")}
                {form.q.trim() ? null : (
                  <em className="block not-italic text-[11px] mt-0.5">
                    {t("agentQueue.uncategorisedNoTerms",
                      "With no job titles above, this widens the search a lot. Add titles and it costs you almost nothing.")}
                  </em>
                )}
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            {t("agentQueue.fieldDaily", "Picks per morning")}
            <input type="number" min={1} max={10} value={form.daily_count}
              onChange={(e) => setForm((f) => ({ ...f, daily_count: parseInt(e.target.value, 10) || 5 }))}
              className="w-16 rounded-lg border border-border bg-background px-2 py-1 text-sm" />
          </label>
          <div className="sm:col-span-2 flex gap-2">
            {/* One button, two jobs. Editing a SEARCH writes agent_searches;
                the fallback path (no searches table yet) still activates the
                mandate exactly as before. */}
            <button onClick={() => void (editingId != null ? saveSearch() : saveMandate(true))} disabled={busy || agentActive !== true || !resumeReady}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 hover:bg-primary/90 disabled:opacity-50">
              <Play className="w-3.5 h-3.5" /> {t("agentQueue.activate", "Activate mandate")}
            </button>
            {mandate && (
              <button onClick={() => { setEditing(false); setEditingId(null); setLabel(""); }} className="text-sm text-muted-foreground px-3 py-2 hover:text-foreground">
                {t("agentQueue.cancel", "Cancel")}
              </button>
            )}
          </div>
          {/* A disabled button with no stated reason is its own dead end. Same
              string the toast used, now permanent and next to the control it
              explains. Entitlement is handled by the paywall above, so this
              only speaks when the résumé is the thing in the way. */}
          {agentActive === true && !resumeReady && (
            <p className="sm:col-span-2 text-[12px] text-muted-foreground -mt-1">
              {t("agentQueue.needResume", "Save a résumé for matching first (above) — the agent scores every posting against it.")}
            </p>
          )}
        </div>
      ) : searches !== null ? (
        /* MANY SEARCHES. A real job hunt is not one set of criteria —
           "Product Manager, NYC, >=140k" and "Program Manager, remote, >=120k"
           are different searches with different floors. Each one is listed with
           its own on/off, because pausing a search you are unsure about is the
           move people actually want, not deleting it.

           `searches === null` (below) means the table has not answered — the
           migration may not have landed yet — so the panel falls back to the
           single-mandate summary rather than showing an empty list that reads
           as "the agent forgot your search". */
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mandate.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
              {mandate.active
                ? (agentActive === false
                  ? t("agentQueue.statusAwaiting", "Active — awaiting subscription")
                  : t("agentQueue.statusActive", "Active"))
                : t("agentQueue.statusPaused", "Paused")}
            </span>
            <button onClick={() => void saveMandate(!mandate.active)} disabled={busy || (agentActive === false && !mandate.active)} className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline disabled:opacity-50">
              {mandate.active ? <><Pause className="w-3 h-3" />{t("agentQueue.pause", "Pause")}</> : <><Play className="w-3 h-3" />{t("agentQueue.resume", "Resume")}</>}
            </button>
          </div>

          <ul className="space-y-2">
            {searches.map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-background/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm text-foreground truncate">{s.label}</span>
                  {!s.active && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {t("agentQueue.statusPaused", "Paused")}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-[13px]">
                    <button onClick={() => editSearch(s)} className="text-primary hover:underline">{t("agentQueue.edit", "Edit")}</button>
                    <button onClick={() => void toggleSearch(s)} className="text-primary hover:underline">
                      {s.active ? t("agentQueue.pause", "Pause") : t("agentQueue.resume", "Resume")}
                    </button>
                    <button onClick={() => void deleteSearch(s)} className="text-muted-foreground hover:text-destructive">
                      {t("agentQueue.deleteSearch", "Delete")}
                    </button>
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground truncate mt-0.5">
                  {/* Reach shows in the summary too. A search whose age floor
                      or uncategorised opt-in is invisible here is one somebody
                      re-opens to check, which is the summary failing at its job. */}
                  {[s.q, s.category && t(`jobsPage.categories.${s.category}`, s.category), s.location,
                    s.remote_only ? t("agentQueue.fieldRemote", "Remote only") : "",
                    s.salary_min ? `$${s.salary_min.toLocaleString()}+` : "",
                    s.max_age_days ? t("agentQueue.summaryAge", "posted within {{d}}d", { d: s.max_age_days }) : "",
                    s.include_uncategorised ? t("agentQueue.summaryUncat", "+ uncategorised") : ""].filter(Boolean).join(" · ")
                    || t("agentQueue.anyRole", "Any role")}
                </p>
                {/* Per-search, because a summary stamped on the user would be
                    last-writer-wins across three searches. */}
                {s.last_run_summary && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {t("agentQueue.searchLastRun", "Last run: scanned {{scanned}}, queued {{picked}}.", {
                      scanned: s.last_run_summary.scanned, picked: s.last_run_summary.picked,
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => editSearch(null)}
              disabled={busy || searches.filter((s) => s.active).length >= MAX_SEARCHES}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline disabled:opacity-50 disabled:no-underline">
              <Plus className="w-3.5 h-3.5" /> {t("agentQueue.addSearch", "Add another search")}
            </button>
            {searches.filter((s) => s.active).length >= MAX_SEARCHES && (
              <span className="text-[12px] text-muted-foreground">
                {t("agentQueue.searchLimitHit", "You can run up to 10 active searches. Pause one to add another.")}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-[13px] text-muted-foreground">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${mandate.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
            {mandate.active
              ? (agentActive === false
                ? t("agentQueue.statusAwaiting", "Active — awaiting subscription")
                : t("agentQueue.statusActive", "Active"))
              : t("agentQueue.statusPaused", "Paused")}
          </span>
          <span className="truncate">
            {[mandate.q, mandate.category && t(`jobsPage.categories.${mandate.category}`, mandate.category), mandate.location, mandate.remote_only ? t("agentQueue.fieldRemote", "Remote only") : "", mandate.salary_min ? `$${mandate.salary_min.toLocaleString()}+` : "",
              mandate.max_age_days ? t("agentQueue.summaryAge", "posted within {{d}}d", { d: mandate.max_age_days }) : "",
              mandate.include_uncategorised ? t("agentQueue.summaryUncat", "+ uncategorised") : ""].filter(Boolean).join(" · ")}
          </span>
          <button onClick={() => setEditing(true)} className="text-primary hover:underline">{t("agentQueue.edit", "Edit")}</button>
          <button onClick={() => void saveMandate(!mandate.active)} disabled={busy || (agentActive === false && !mandate.active)} className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50">
            {mandate.active ? <><Pause className="w-3 h-3" />{t("agentQueue.pause", "Pause")}</> : <><Play className="w-3 h-3" />{t("agentQueue.resume", "Resume")}</>}
          </button>
        </div>
      )}

      {/* Honest run summary — the agent shows its work. */}
      {mandate?.last_run_summary && mandate.last_run_at && (
        <p className="text-[11px] text-muted-foreground mb-3">
          {t("agentQueue.runSummary", "Last run {{when}}: scanned {{scanned}} new postings, picked {{picked}}, skipped {{churn}} from churn-heavy companies and {{lowfit}} weak matches.", {
            when: new Date(mandate.last_run_at).toLocaleString(),
            scanned: mandate.last_run_summary.scanned,
            picked: mandate.last_run_summary.picked,
            churn: mandate.last_run_summary.skipped_churn,
            lowfit: mandate.last_run_summary.skipped_lowfit,
          })}
        </p>
      )}

      {/* Morning email control — same place the mandate lives. */}
      {mandate && (
        <label className="flex items-start gap-2 mb-3 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={mandate.email_opt_in !== false}
            onChange={(e) => void toggleEmail(e.target.checked)}
            className="mt-0.5 accent-[hsl(var(--primary))]"
          />
          <span>
            {t("agentQueue.emailToggle", "Email me the shortlist each morning — only when there's something new, never an empty list.")}
          </span>
        </label>
      )}

      {/* The queue */}
      {queue.length === 0 ? (
        mandate?.active ? (
          <p className="text-sm text-muted-foreground italic">{t("agentQueue.emptyActive", "No picks yet — your first queue arrives after tonight's run.")}</p>
        ) : null
      ) : (
        <ul className="space-y-2.5">
          {queue.map((it) => (
            <li key={it.id} className={`rounded-xl border border-border px-4 py-3 ${it.status === "approved" ? "bg-success/5" : "bg-background"}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-foreground">{it.title}</span>
                <span className="text-[12px] text-muted-foreground">{it.company}{it.location ? ` · ${it.location}` : ""}{it.salary ? ` · ${it.salary}` : ""}</span>
                {/* WHICH SEARCH FOUND IT. Absent on rows queued before
                    attribution existed, and on the pre-migration fallback path
                    — rendered only when the row actually carries one rather
                    than inventing "My search" for a pick we cannot attribute. */}
                {it.search_label ? (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary self-start">
                    {it.search_label}
                  </span>
                ) : null}
                {it.fit_pct != null && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{it.fit_pct}%</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {it.reasons.map((r, i) => {
                  const label = reasonLabel(r);
                  return label ? <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{label}</span> : null;
                })}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button onClick={() => navigate(`/jobs?job=${encodeURIComponent(it.posting_id)}`)}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
                  {t("agentQueue.open", "Open & prep application")} <ArrowRight className="w-3 h-3" />
                </button>
                {it.status === "ready" && (
                  <>
                    <button onClick={() => void decide(it.id, "approved")} className="inline-flex items-center gap-1 text-[12px] text-success hover:underline">
                      <Check className="w-3 h-3" /> {t("agentQueue.keep", "Keep")}
                    </button>
                    <button onClick={() => void decide(it.id, "dismissed")} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:underline">
                      <X className="w-3 h-3" /> {t("agentQueue.skip", "Not for me")}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {ready.length > 0 && (
        <p className="text-[11px] text-muted-foreground mt-3">
          {t("agentQueue.expiryNote", "Unreviewed picks expire after 48 hours — the queue stays fresh, never a backlog.")}
        </p>
      )}
    </div>
  );
}
