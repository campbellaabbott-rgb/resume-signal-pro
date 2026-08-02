// One line at the top of the agent section: what is my agent doing, and what is
// the next thing to do about it?
//
// WHY IT EXISTS. Six gates stand between a posting and a sent application — a
// mandate, an entitlement, a résumé, the apply mode, a live sender, and a
// profile complete enough for the employer's form. Every one of them, when
// shut, produces the same observable: nothing happens. "Working and quiet
// today" and "has never been able to send anything" were the same screen.
//
// The logic lives in src/lib/agentState.ts and is tested there. This file only
// loads the signals and renders the verdict — deliberately, because the
// ordering decisions in that ladder are the part worth locking down, and they
// should not be re-litigated inside a component.
//
// TRINARIES ARE RESPECTED HERE TOO. entitled and senderOnline start as null,
// meaning NOT YET KNOWN, and agentState never renders null as false. Telling a
// paying subscriber their subscription is inactive because a fetch has not
// returned is the worst thing this band could say, so while the checks are in
// flight it says it is checking rather than guessing.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, PauseCircle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { agentState, needsAttention, type AgentSignals, type AgentVerdict } from "@/lib/agentState";
import type { ProfileLike } from "@/lib/applyReadiness";

const sb = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  functions: { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: any }> };
};

export function AgentStatusBand({ userId, email }: { userId: string; email: string | null }) {
  const { t } = useTranslation();
  const [verdict, setVerdict] = useState<AgentVerdict | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // The mandate carries both the profile fields and the apply mode.
    const { data: mandate } = await sb.from("agent_mandates")
      .select("*").eq("user_id", userId).maybeSingle();

    // Entitlement and sender liveness are independent and neither should block
    // the other — a slow Stripe lookup must not hide a known outage.
    //
    // Both DEFAULT TO null, not false. A rejected promise means "we do not
    // know", and agentState treats that as unknown rather than as bad news.
    const [entitled, senderOnline] = await Promise.all([
      (async () => {
        if (!email) return null;
        try {
          const { data } = await sb.functions.invoke("agent-access", { body: { email } });
          return typeof data?.active === "boolean" ? data.active : null;
        } catch { return null; }
      })(),
      (async () => {
        try {
          // Readable by authenticated users as of migration 20260802150000 —
          // before that this was service_role only, which is exactly why an
          // outage on our side looked like a quiet day to the candidate.
          const { data, error } = await sb.rpc("agent_sender_online", { p_max_age_seconds: 900 });
          return !error && typeof data === "boolean" ? data : null;
        } catch { return null; }
      })(),
    ]);

    const signals: AgentSignals = {
      hasMandate: !!mandate,
      entitled,
      senderOnline,
      applyMode: mandate?.apply_mode === "auto" ? "auto" : "review",
      profile: (mandate ?? {}) as ProfileLike,
    };
    setVerdict(agentState(signals));
    setLoading(false);
  }, [userId, email]);

  useEffect(() => { void load(); }, [load]);

  const goToProfile = () => {
    document.getElementById("apply-profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("agentBand.checking", "Checking what your agent can do…")}
      </div>
    );
  }
  if (!verdict) return null;

  // Tone follows BLAME, not severity. Our outage is not styled as a warning the
  // candidate can act on, and "review mode" — the safe default most people
  // should stay on — is never styled as a problem. A band that is always amber
  // is a band nobody reads by the time it means something.
  const attention = needsAttention(verdict);
  const Icon = verdict.gate === "armed" ? CheckCircle2
    : verdict.blame === "on-us" ? PauseCircle
    : attention ? AlertTriangle : Info;
  const tone = verdict.gate === "armed" ? "border-success/40 bg-success/5"
    : attention ? "border-warning/40 bg-warning/5"
    : "border-border bg-muted/30";
  const iconTone = verdict.gate === "armed" ? "text-success"
    : attention ? "text-warning" : "text-muted-foreground";

  const FIX_LABEL: Record<string, string> = {
    setup: t("agentBand.fixSetup", "Set up your agent"),
    subscribe: t("agentBand.fixSubscribe", "See plans"),
    resume: t("agentBand.fixResume", "Upload your CV"),
    profile: t("agentBand.fixProfile", "Complete your profile"),
    mode: t("agentBand.fixMode", "Change how it sends"),
  };

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconTone}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">
            {t("agentBand.title", "Your apply agent")}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t(verdict.key, verdict.fallback)}
          </p>

          {/* Only when there is somewhere genuinely useful to go. `sender-offline`
              deliberately has no action — inventing one would imply the outage
              is theirs to fix. */}
          {verdict.fix && verdict.fix !== "subscribe" && (
            <button
              type="button"
              onClick={goToProfile}
              className="mt-2 text-[13px] font-semibold text-primary hover:underline"
            >
              {FIX_LABEL[verdict.fix]} →
            </button>
          )}
          {verdict.fix === "subscribe" && (
            <a href="/pricing" className="mt-2 inline-block text-[13px] font-semibold text-primary hover:underline">
              {FIX_LABEL.subscribe} →
            </a>
          )}

          {/* The specific gaps, when they are what is stopping it. A count is
              not actionable; the employer's actual question is. */}
          {verdict.gate === "profile-gaps" && verdict.readiness.gaps.length > 0 && (
            <ul className="mt-2 space-y-1">
              {verdict.readiness.gaps
                .filter((g) => g.severity !== "reduces-quality")
                .slice(0, 3)
                .map((g) => (
                  <li key={g.field} className="text-[12px] text-muted-foreground">• {g.consequence}</li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
