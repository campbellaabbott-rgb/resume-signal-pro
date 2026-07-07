// Outcome tracking: the start of the only data moat that matters — measured
// score→interview correlation. Anonymous, keyed to the reproducible report ID
// (no resume content, no PII); one answer per report per visitor, answers can
// be updated (people hear back later). Server side is rate-limited
// (record_scan_outcome RPC, 5/day/visitor).

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const OUTCOMES = [
  { id: "interview", label: "🎉 Got interview(s)" },
  { id: "no_response", label: "📭 No response yet" },
  { id: "rejected", label: "❌ Rejected" },
] as const;

function visitorId(): string {
  try {
    let v = localStorage.getItem("rb_visitor_id");
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem("rb_visitor_id", v);
    }
    return v;
  } catch {
    return "unknown";
  }
}

export function ScanOutcomeAsk({ reportId }: { reportId: string }) {
  const [answered, setAnswered] = useState<string | null>(() => {
    try { return localStorage.getItem(`rb_outcome_${reportId}`); } catch { return null; }
  });
  const [busy, setBusy] = useState(false);

  const record = async (outcome: string) => {
    setBusy(true);
    try {
      await (supabase.rpc as unknown as (fn: string, args: object) => PromiseLike<unknown>)(
        "record_scan_outcome",
        { p_report_id: reportId, p_outcome: outcome, p_ip: visitorId() },
      );
      try { localStorage.setItem(`rb_outcome_${reportId}`, outcome); } catch { /* ignore */ }
      setAnswered(outcome);
    } catch {
      // Recording is best-effort; never surface an error for volunteering data.
      setAnswered(outcome);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 mb-6">
      <p className="text-sm font-semibold text-foreground mb-0.5">
        Applied with this resume? Tell us how it went
      </p>
      <p className="text-xs text-muted-foreground mb-3">
        Anonymous, tied only to report #{reportId}. This is how we measure — rather than guess — which
        scores actually land interviews. You can update your answer if things change.
      </p>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.id}
            disabled={busy}
            onClick={() => record(o.id)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
              answered === o.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {answered && (
        <p className="text-xs text-success mt-2">
          Recorded — thank you. Every answer sharpens the benchmarks we publish.
        </p>
      )}
    </div>
  );
}
