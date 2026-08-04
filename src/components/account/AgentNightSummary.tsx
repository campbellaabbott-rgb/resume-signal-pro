/**
 * WHAT HAPPENED LAST NIGHT — in a sentence, before the queue that implies it.
 *
 * A returning subscriber has exactly one question in the morning, and the Today
 * tab answered it obliquely: here is a list, work it out. Worse, the most common
 * real answer — "nothing went out, and here is precisely why" — looked identical
 * to "nothing happened", which is the failure mode this whole product is built
 * to avoid.
 *
 * decideRelease already writes a REASON on every packet it refuses, and there
 * are ten of them, each meaning something different:
 *
 *   sender-offline      our fault. The machine that submits was not running.
 *   daily-cap           your setting, working.
 *   fit-below-floor     your setting, working.
 *   review-mode         waiting for you, which is the default and correct.
 *   vendor-needs-human  the employer's form cannot be driven.
 *   already-submitted   you had already applied.
 *
 * Collapsing those into "0 applications" throws away the only information that
 * tells a candidate whether to change a setting, wait, or ask for help. So this
 * counts them separately and leads with the one that is OURS to fix.
 *
 * Counted from agent_submissions directly rather than a stored summary blob:
 * a per-user count of real rows cannot drift from what the queue below shows,
 * and a summary written by one function and read by another can.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Night {
  sent: number;
  waitingOnYou: number;
  blocked: number;
  /** Refusal code -> count, for the ones worth naming. */
  reasons: Record<string, number>;
}

/** Ours to fix vs yours to decide — the distinction that changes what you do. */
const OUR_FAULT = new Set(["sender-offline", "vendor-needs-human"]);

const REASON_TEXT: Record<string, string> = {
  "sender-offline": "our sender was offline",
  "vendor-needs-human": "the employer's form needs a person",
  "daily-cap": "your daily limit was reached",
  "fit-below-floor": "below your fit threshold",
  "fit-unknown": "we couldn't score the fit",
  "review-mode": "waiting for your approval",
  "already-submitted": "you had already applied",
  duplicate: "a duplicate of one already prepared",
  "not-ready": "still being prepared",
  "vendor-not-allowed": "this employer's system isn't supported",
};

export function AgentNightSummary({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [n, setN] = useState<Night | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { data } = await supabase
        .from("agent_submissions")
        .select("status,release_refusal,submitted_at,created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .limit(200);
      if (!live || !data) return;

      const reasons: Record<string, number> = {};
      let sent = 0, waitingOnYou = 0, blocked = 0;
      for (const r of data as Array<{ status: string; release_refusal: string | null }>) {
        if (r.status === "submitted") { sent++; continue; }
        const why = r.release_refusal ?? "";
        if (why) reasons[why] = (reasons[why] ?? 0) + 1;
        // review-mode is not a failure — it is the product working as designed
        // and waiting for a decision. Counting it as "blocked" would tell the
        // candidate something is wrong when the next move is simply theirs.
        if (why === "review-mode") waitingOnYou++;
        else if (r.status === "blocked" || why) blocked++;
      }
      setN({ sent, waitingOnYou, blocked, reasons });
    })();
    return () => { live = false; };
  }, [userId]);

  // Nothing at all in 24h means no run has touched this account yet. The setup
  // checklist above is already saying what to do; a second empty card would
  // just be noise.
  if (!n || (n.sent === 0 && n.waitingOnYou === 0 && n.blocked === 0)) return null;

  const ourProblems = Object.entries(n.reasons).filter(([k]) => OUR_FAULT.has(k));

  return (
    <section className="rounded-xl border border-border p-5">
      <h2 className="text-sm font-semibold">
        {t("agentNight.title", "Since yesterday")}
      </h2>

      <div className="mt-3 flex flex-wrap gap-4">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <strong>{n.sent}</strong> {t("agentNight.sent", "applied")}
        </span>
        {n.waitingOnYou > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <strong>{n.waitingOnYou}</strong> {t("agentNight.waiting", "waiting for you")}
          </span>
        )}
        {n.blocked > 0 && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <strong>{n.blocked}</strong> {t("agentNight.skipped", "skipped")}
          </span>
        )}
      </div>

      {/* OURS FIRST, and marked as ours. A candidate should never have to work
          out that the reason nothing went out was our machine and not their
          settings. */}
      {ourProblems.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm">
            {t("agentNight.ourFault", "On us:")}{" "}
            {ourProblems.map(([k, v]) => `${v} × ${REASON_TEXT[k] ?? k}`).join(", ")}
          </p>
        </div>
      )}

      {Object.keys(n.reasons).length > 0 && (
        <ul className="mt-3 space-y-1">
          {Object.entries(n.reasons)
            .filter(([k]) => !OUR_FAULT.has(k))
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <li key={k} className="text-sm text-muted-foreground">
                <strong className="text-foreground">{v}</strong> · {REASON_TEXT[k] ?? k}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
