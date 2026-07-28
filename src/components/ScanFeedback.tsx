import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ScanFeedbackProps {
  industry: string;
  atsScore: number;
  hadJobDescription: boolean;
  resumeWordCount?: number;
  visitorId?: string;
}

export function ScanFeedback({
  industry,
  atsScore,
  hadJobDescription,
  resumeWordCount,
  visitorId,
}: ScanFeedbackProps) {
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(rating: boolean) {
    if (submitted || loading) return;
    setLoading(true);
    try {
      // supabase-js .rpc() RESOLVES with { data, error } — it does NOT throw on a
      // PostgREST 404. So the catch below was dead code and setSubmitted ran
      // unconditionally: record_scan_feedback does not exist in production
      // (migration 20260630000000_scan_feedback.sql is unapplied), which means
      // 100% of submissions were discarded while the UI said "Thanks for the
      // feedback!". Same silent-swallow shape as the analytics-visitor-id
      // incident. Check the error and only claim success when there was one.
      const res = await (supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>)("record_scan_feedback", {
        p_visitor_id: visitorId ?? null,
        p_rating: rating,
        p_industry: industry,
        p_ats_score: atsScore,
        p_had_job_description: hadJobDescription,
        p_resume_word_count: resumeWordCount ?? null,
        p_feedback_text: null,
      });
      if (res?.error) {
        // Never thank someone for something we did not record.
        console.warn("[scan-feedback] not recorded:", res.error);
        setFailed(true);
        return;
      }
      setSubmitted(rating ? "up" : "down");
    } catch (e) {
      console.warn("[scan-feedback] not recorded:", e);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-4">
      <span className="text-sm text-muted-foreground">
        {submitted ? "Thanks for the feedback!" : "Was this analysis helpful?"}
      </span>
      {!submitted && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => submit(true)}
            className="gap-1.5"
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            Yes
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => submit(false)}
            className="gap-1.5"
          >
            <ThumbsDown className="h-3.5 w-3.5" />
            No
          </Button>
        </>
      )}
      {submitted && (
        <span className="text-sm">
          {submitted === "up" ? "👍" : "👎"}
        </span>
      )}
      {failed && (
        // Say so. Silently eating it is what produced a year of phantom
        // "Thanks for the feedback!" against a table that does not exist.
        <span className="text-xs text-muted-foreground">
          Couldn't save that — nothing was recorded.
        </span>
      )}
    </div>
  );
}
