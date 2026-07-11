// Saved job searches with "new since your last visit" counts. Counts come
// from the job-board list action (countOnly + postedAfter watermark) — one
// cheap SQL count per search, no AI. Opening a search advances the
// watermark and lands on /jobs with the filters applied.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, ExternalLink, Search, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { searchToQuery, type JobSearchParams } from "@/lib/job-search-params";

interface SavedSearch {
  id: string;
  name: string;
  params: JobSearchParams;
  last_seen_at: string;
}

// user_job_searches postdates the generated DB types — untyped access, same
// pattern as other fresh tables until Lovable regenerates types.ts.
const table = () => (supabase as unknown as { from: (t: string) => any }).from("user_job_searches");

export function SavedSearchesCard() {
  const navigate = useNavigate();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [newCounts, setNewCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await table().select("id,name,params,last_seen_at").order("created_at", { ascending: false }).limit(20);
      const rows: SavedSearch[] = data ?? [];
      setSearches(rows);
      setLoaded(true);
      // New-since counts, best effort, in parallel.
      const counts = await Promise.all(
        rows.map(async (s) => {
          try {
            const { data: res } = await supabase.functions.invoke("job-board", {
              body: { action: "list", ...s.params, countOnly: true, postedAfter: s.last_seen_at },
            });
            return [s.id, (res as { total?: number })?.total ?? 0] as const;
          } catch {
            return [s.id, 0] as const;
          }
        }),
      );
      setNewCounts(Object.fromEntries(counts));
    })();
  }, []);

  const open = async (s: SavedSearch) => {
    table().update({ last_seen_at: new Date().toISOString() }).eq("id", s.id).then(() => {}, () => {});
    navigate(searchToQuery(s.params));
  };

  const remove = async (id: string) => {
    setSearches((prev) => prev.filter((s) => s.id !== id));
    await table().delete().eq("id", id);
  };

  if (!loaded || searches.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">Saved job searches</h2>
        <span className="ml-auto text-xs text-muted-foreground">{searches.length} saved</span>
      </div>
      <div className="space-y-1.5">
        {searches.map((s) => (
          <div key={s.id} className="flex items-center gap-2 border border-border/50 rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <button onClick={() => open(s)} className="flex-1 min-w-0 text-left group">
              <span className="text-sm font-medium text-foreground group-hover:text-primary truncate block">
                {s.name}
              </span>
            </button>
            {(newCounts[s.id] ?? 0) > 0 && (
              <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                {newCounts[s.id]} new
              </span>
            )}
            <button onClick={() => open(s)} aria-label={`Open search ${s.name}`} className="text-muted-foreground hover:text-foreground shrink-0">
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => remove(s.id)} aria-label={`Delete search ${s.name}`} className="text-muted-foreground/50 hover:text-destructive shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">
        "New" counts postings published since you last opened each search.
      </p>
    </div>
  );
}
