// Closed-application → fresh-replacement loop. When a tracked posting closes
// (Account stamps posting_closed_at), a dead end becomes a reason to keep going:
// live openings for the same role, pulled from the board right now. Turns churn
// into a return trigger.
//
// Depends on a stable `rolesKey` STRING (not an array) so re-renders of the
// parent don't re-fire the board queries — only an actual change in the set of
// closed roles does.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, RefreshCw } from "lucide-react";

interface Replacement {
  id: string;
  title: string;
  company: string;
  location: string;
  applyUrl: string;
}

export function ClosedReplacementsPanel({ closedCount, rolesKey }: { closedCount: number; rolesKey: string }) {
  const [reps, setReps] = useState<Replacement[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const roles = rolesKey ? rolesKey.split("|").filter(Boolean) : [];
    if (roles.length === 0) {
      setReps([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      // One cheap board query per closed role (no AI — a DB read). Best effort.
      const perRole = await Promise.all(
        roles.map(async (role) => {
          try {
            const { data } = await supabase.functions.invoke("job-board", {
              body: { action: "list", q: role, limit: 3 },
            });
            return ((data as { jobs?: Replacement[] })?.jobs ?? []).slice(0, 3);
          } catch {
            return [];
          }
        }),
      );
      if (cancelled) return;
      // Dedupe by id, keep the first few, only rows with a working apply link.
      const seen = new Set<string>();
      const merged: Replacement[] = [];
      for (const j of perRole.flat()) {
        if (j?.id && j.applyUrl && !seen.has(j.id)) {
          seen.add(j.id);
          merged.push(j);
        }
        if (merged.length >= 6) break;
      }
      setReps(merged);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [rolesKey]);

  if (!loaded || closedCount === 0 || reps.length === 0) return null;

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <RefreshCw className="w-4 h-4 text-primary shrink-0" />
        <h2 className="font-semibold text-foreground text-sm">
          {closedCount} of your applied {closedCount === 1 ? "jobs has" : "jobs have"} closed — here are fresh openings
        </h2>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Same roles, live on the board right now — don't lose momentum.
      </p>
      <div className="space-y-1.5">
        {reps.map((j) => (
          <div key={j.id} className="flex items-center gap-2 border border-border/50 rounded-lg px-3 py-2 bg-card">
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate block">{j.title}</span>
              <span className="text-[11px] text-muted-foreground truncate block">
                {j.company}{j.location ? ` · ${j.location}` : ""}
              </span>
            </div>
            <a
              href={j.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
            >
              Apply <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
