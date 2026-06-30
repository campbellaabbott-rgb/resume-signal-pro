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

  async function submit(rating: boolean) {
    if (submitted || loading) return;
    setLoading(true);
    try {
      await supabase.rpc("record_scan_feedback", {
        p_visitor_id: visitorId ?? null,
        p_rating: rating,
        p_industry: industry,
        p_ats_score: atsScore,
        p_had_job_description: hadJobDescription,
        p_resume_word_count: resumeWordCount ?? null,
        p_feedback_text: null,
      });
      setSubmitted(rating ? "up" : "down");
    } catch {
      // non-critical — don't surface errors to the user
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
    </div>
  );
}
