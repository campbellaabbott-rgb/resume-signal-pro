/**
 * THE FIRST FIVE MINUTES, WHICH DECIDE EVERYTHING ELSE.
 *
 * A new subscriber lands on /agent and sees three tabs and an empty queue.
 * Nothing tells them that the agent needs a profile, an exclusion list and a
 * mandate before it can do anything — so the most likely outcome of paying is
 * an empty screen, and the most likely conclusion is that it is broken.
 *
 * `SetupChecklist` already exists but asks a different question (has this person
 * scanned a résumé, have they tracked an application). The agent's prerequisites
 * are its own, and each one has a real consequence if skipped:
 *
 *   consent + profile   without it EVERY packet blocks, silently, forever
 *   exclusions          without it the agent may apply to their own employer
 *   an active mandate   without it there is nothing to prepare
 *
 * ORDER IS DELIBERATE and it is not the order of least effort. Exclusions come
 * before the mandate because the mandate is what starts the machine, and the
 * blocklist is what stops it going somewhere unrecoverable. Setting them the
 * other way round leaves a window — small, but real — in which a packet for the
 * candidate's own employer can be prepared.
 *
 * It reads live state rather than remembering that you clicked something, and it
 * disappears when genuinely finished. A checklist that ticks itself on visit is
 * a progress bar, not a checklist.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Check, Circle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  done: boolean;
  title: string;
  why: string;
  tab: "today" | "settings";
}

export function AgentSetupChecklist({
  userId, onGo,
}: { userId: string; onGo: (tab: "today" | "settings") => void }) {
  const { t } = useTranslation();
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await supabase
        .from("agent_mandates")
        .select("active,consent_to_processing,full_name,phone,blocked_companies,q")
        .eq("user_id", userId).maybeSingle();
      if (!live) return;

      const m = data ?? null;
      // Consent is the hard gate — buildPacket refuses without it — so it is
      // grouped with the identity fields rather than listed as its own step. A
      // person does not think of "consent" as a task; they think of "my details".
      const profileReady = !!m?.consent_to_processing
        && !!String(m?.full_name ?? "").trim()
        && !!String(m?.phone ?? "").trim();
      const exclusionsSet = Array.isArray(m?.blocked_companies) && m.blocked_companies.length > 0;
      const mandateActive = m?.active === true && !!String(m?.q ?? "").trim();

      setSteps([
        {
          id: "profile", done: profileReady, tab: "settings",
          title: t("agentSetup.profile.title", "Add your details and give consent"),
          why: t("agentSetup.profile.why",
            "Without these every application is prepared and then blocked, with nothing to show for it."),
        },
        {
          id: "exclusions", done: exclusionsSet, tab: "settings",
          title: t("agentSetup.exclusions.title", "Name the employers to skip"),
          why: t("agentSetup.exclusions.why",
            "Your current employer above all. This is the one that cannot be undone afterwards."),
        },
        {
          id: "mandate", done: mandateActive, tab: "today",
          title: t("agentSetup.mandate.title", "Tell it what you're looking for"),
          why: t("agentSetup.mandate.why",
            "Job titles, location and how many a day. Start with one a day until you've seen its work."),
        },
      ]);
    })();
    return () => { live = false; };
  }, [userId, t]);

  if (!steps) return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  // Genuinely finished — not "dismissed", not "visited".
  if (steps.every((s) => s.done)) return null;

  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)!;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">
          {t("agentSetup.title", "Three things before it can start")}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("agentSetup.progress", { defaultValue: "{{done}} of {{total}}", done: doneCount, total: steps.length })}
        </span>
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((s) => (
          <li key={s.id} className="flex gap-3">
            {s.done
              ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <div className="min-w-0">
              <div className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through")}>
                {s.title}
              </div>
              {/* The consequence, not the instruction. "Add your phone number"
                  is a chore; "otherwise every application blocks" is a reason. */}
              {!s.done && <p className="mt-0.5 text-sm text-muted-foreground">{s.why}</p>}
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => onGo(next.tab)}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        {t("agentSetup.continue", "Continue")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}
