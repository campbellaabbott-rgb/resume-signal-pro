// Outcome tracking: the start of the only data moat that matters — measured
// score→interview correlation. Anonymous, keyed to the reproducible report ID
// (no resume content, no PII); one answer per report per visitor, answers can
// be updated (people hear back later). Server side is rate-limited
// (record_scan_outcome RPC: 5 a day per network address, as the platform
// states it -- the visitor id sent as p_ip names the answer, not the budget).
//
// The answer is shown as recorded only when the server says it stored it
// (S13-057). record_scan_outcome answers true for a stored answer and false
// when its budget refused one; supabase-js resolves an error rather than
// throwing. A refusal, an error or no answer at all is "not saved", nothing is
// remembered in this browser, and the buttons stay usable.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getVisitorId } from "@/lib/track-transport";

const OUTCOMES = [
  { id: "interview", labelKey: "scanOutcome.interview" },
  { id: "no_response", labelKey: "scanOutcome.noResponse" },
  { id: "rejected", labelKey: "scanOutcome.rejected" },
] as const;

type RpcAnswer = { data?: unknown; error?: unknown } | null | undefined;

export function ScanOutcomeAsk({ reportId }: { reportId: string }) {
  const { t } = useTranslation();
  const [answered, setAnswered] = useState<string | null>(() => {
    try { return localStorage.getItem(`rb_outcome_${reportId}`); } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const record = async (outcome: string) => {
    setBusy(true);
    setFailed(false);
    try {
      const res = (await (supabase.rpc as unknown as (fn: string, args: object) => PromiseLike<RpcAnswer>)(
        "record_scan_outcome",
        { p_report_id: reportId, p_outcome: outcome, p_ip: getVisitorId() },
      )) as RpcAnswer;
      if (!res || res.error || res.data !== true) {
        setFailed(true);
        return;
      }
      try { localStorage.setItem(`rb_outcome_${reportId}`, outcome); } catch { /* ignore */ }
      setAnswered(outcome);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 mb-6">
      <p className="text-sm font-semibold text-foreground mb-0.5">
        {t("scanOutcome.title")}
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        {t("scanOutcome.body", { reportId })}
      </p>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.id}
            disabled={busy}
            aria-pressed={answered === o.id}
            onClick={() => record(o.id)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              answered === o.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {t(o.labelKey)}
          </button>
        ))}
      </div>
      {failed ? (
        <p className="text-xs text-muted-foreground mt-2" role="status">
          {t("scanOutcome.notSaved")}
        </p>
      ) : answered && (
        <p className="text-xs text-success mt-2" role="status">
          {t("scanOutcome.recorded")}
        </p>
      )}
    </div>
  );
}
