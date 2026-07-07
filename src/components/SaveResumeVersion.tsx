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
    return (
      <div className="rounded-2xl border border-border bg-card/60 p-4 mb-6">
        <p className="text-sm font-semibold text-foreground mb-0.5">Save this resume version</p>
        <p className="text-xs text-muted-foreground">
          <Link to="/auth" className="text-primary underline">Sign in free</Link> to save versions, tag each
          application with the exact version you sent, and see which version actually lands interviews.
        </p>
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
        because you asked. Tag applications with a version to see which one lands interviews.
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
