// Opt-in resume version saving for signed-in users. This is the ONLY place
// resume content is ever stored, and only because the user explicitly asked —
// the free scan's "never stored" promise stays intact. Versions power the
// application tracker's "which version lands interviews" view in /account.

import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function SaveResumeVersion({
  resumeText,
  score,
  reportId,
}: {
  resumeText: string;
  score?: number;
  reportId?: string;
}) {
  const { user } = useAuth();
  const [label, setLabel] = useState(
    () => `${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}${score != null ? ` — scored ${score}` : ""}`,
  );
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  if (!user) {
    // The post-scan account hook: concrete features, at peak conviction.
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 mb-6">
        <p className="text-sm font-semibold text-foreground mb-1.5">Keep this scan working for you</p>
        <ul className="text-xs text-muted-foreground space-y-1 mb-3">
          <li>• Save this resume — the job board ranks all ~40,000 live openings against it, every visit</li>
          <li>• Save searches ("remote healthcare") and see how many new postings match since you last looked</li>
          <li>• Bookmark jobs and your application tracker fills itself — fit scores included</li>
        </ul>
        <Link
          to="/auth"
          className="inline-flex items-center px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          Create a free account
        </Link>
      </div>
    );
  }

  const save = async () => {
    setState("saving");
    // Versions ARE user_scans rows (applications already link to them via
    // scan_id and /account computes per-version interview stats). Saving a
    // version = inserting a scan row that also carries the document text —
    // the explicit opt-in exception to "never stored".
    const { error } = await (supabase.from as unknown as (t: string) => {
      insert: (row: object) => PromiseLike<{ error: unknown }>;
    })("user_scans").insert({
      user_id: user.id,
      ats_score: score ?? 0,
      label: label.trim().slice(0, 80) || "Untitled version",
      resume_text: resumeText,
      report_id: reportId ?? null,
    });
    setState(error ? "error" : "saved");
  };

  if (state === "saved") {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-4 mb-6">
        <p className="text-sm font-semibold text-foreground mb-0.5">Version saved</p>
        <p className="text-xs text-muted-foreground">
          Find it under <Link to="/account" className="text-primary underline">your account</Link> — tag your
          applications with it to track which version gets interviews. Delete it any time.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-4 mb-6">
      <p className="text-sm font-semibold text-foreground mb-0.5">Save this resume version</p>
      <p className="text-xs text-muted-foreground mb-3">
        Stored in your account until you delete it — this is the only time we keep resume content, and only
        because you asked. It powers fit-ranking across the job board's ~40,000 openings, automatic fit
        scores on tracked applications, and the which-version-lands-interviews view.
      </p>
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder="Version label"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
        />
        <button
          onClick={save}
          disabled={state === "saving"}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {state === "saving" ? "Saving…" : "Save version"}
        </button>
      </div>
      {state === "error" && (
        <p className="text-xs text-destructive mt-2">Couldn't save — the versions feature may still be deploying. Try again shortly.</p>
      )}
    </div>
  );
}
