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
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Check, Circle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  done: boolean;
  title: string;
  /** Shown, but never counted — an optional step must not hold the list open. */
  optional?: boolean;
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
        // resume_file_url IS THE ONE THIS STEP READS. PostgREST returns only the
        // columns named here, so omitting it would leave the check reading
        // `undefined` forever and the step permanently unfinished.
        .select("active,consent_to_processing,full_name,phone,blocked_companies,q,resume_file_url")
        .eq("user_id", userId).maybeSingle();
      if (!live) return;

      const m = data ?? null;
      // ONE REQUIRED STEP: the CV. Everything a form needs that a CV states —
      // name, email, phone, LinkedIn — is lifted out of the file on upload, so
      // asking for them again as a checklist item was asking somebody to retype
      // a document they had just handed over.
      //
      // It used to demand name AND phone AND consent before this step went
      // green, which meant a person who had uploaded their CV still saw an
      // unfinished list and no explanation of what more was wanted.
      const profileReady = !!String(m?.resume_file_url ?? "").trim();
      const mandateActive = m?.active === true && !!String(m?.q ?? "").trim();

      setSteps([
        {
          id: "profile", done: profileReady, tab: "settings",
          title: t("agentSetup.profile.title", "Upload your CV"),
          why: t("agentSetup.profile.why",
            "That is the whole of setup. We read your name and contact details straight off it, and ask about anything else only when a form actually needs it."),
        },
        {
          // OPTIONAL, AND HONESTLY LABELLED AS SUCH. This step was previously
          // "done" only once blocked_companies had at least one entry — so for
          // the many people with nobody to exclude, the checklist could NEVER be
          // completed. An unfinishable list is worse than no list: it reads as
          // "you are not set up" forever, which is precisely the feeling that
          // makes setup seem hard.
          //
          // It stays visible because it is the one thing that cannot be undone
          // after the fact, but it no longer gates anything.
          id: "exclusions", done: false, optional: true, tab: "settings",
          title: t("agentSetup.exclusions.title", "Optional: name employers to skip"),
          why: t("agentSetup.exclusions.why",
            "Your current employer above all. Worth a moment now — it is the one thing that cannot be undone afterwards."),
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
  const required = steps.filter((s) => !s.optional);
  if (required.every((s) => s.done)) return null;

  const doneCount = required.filter((s) => s.done).length;
  const next = required.find((s) => !s.done)!;

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">
          {t("agentSetup.title", "Two things before it can start")}
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("agentSetup.progress", { defaultValue: "{{done}} of {{total}}", done: doneCount, total: required.length })}
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

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => onGo(next.tab)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t("agentSetup.continue", "Continue")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* The checklist says what to DO and never what happens afterwards, so
            the moment it is finished is also the moment somebody has the most
            questions and the fewest answers. This is that answer, offered while
            they are still here rather than after the list disappears. */}
        <Link to="/guides/how-the-apply-agent-works" className="text-sm text-primary hover:underline">
          {t("agentSetup.howItWorks", "What happens after this →")}
        </Link>
      </div>
    </section>
  );
}
