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
  digest_opt_in?: boolean;
  fit_threshold?: number; // 0 = any new; 10 = possible+; 20 = strong-only
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
      const { data } = await table().select("id,name,params,last_seen_at,digest_opt_in,fit_threshold").order("created_at", { ascending: false }).limit(20);
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

  // Feature 4: opt a saved search into the weekly email digest. Off by
  // default — we never email without an explicit toggle.
  const toggleDigest = async (s: SavedSearch) => {
    const next = !s.digest_opt_in;
    setSearches((prev) => prev.map((x) => (x.id === s.id ? { ...x, digest_opt_in: next } : x)));
    await table().update({ digest_opt_in: next }).eq("id", s.id).then(() => {}, () => {
      setSearches((prev) => prev.map((x) => (x.id === s.id ? { ...x, digest_opt_in: !next } : x)));
    });
  };

  // Fit-threshold alert: only email about roles that clear this résumé-fit bar.
  const setThreshold = async (s: SavedSearch, value: number) => {
    setSearches((prev) => prev.map((x) => (x.id === s.id ? { ...x, fit_threshold: value } : x)));
    await table().update({ fit_threshold: value }).eq("id", s.id).then(() => {}, () => {});
  };

  if (!loaded || searches.length === 0) return null;

  // Aggregate the per-search "new since last visit" counts into one headline —
  // the strongest reason to come back is knowing there's something new waiting.
  const totalNew = Object.values(newCounts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">Saved job searches</h2>
        <span className="ml-auto text-xs text-muted-foreground">{searches.length} saved</span>
      </div>
      {totalNew > 0 && (
        <button
          onClick={() => {
            // Open the search with the most new matches (most worth the click).
            const top = [...searches].sort((a, b) => (newCounts[b.id] ?? 0) - (newCounts[a.id] ?? 0))[0];
            if (top) open(top);
          }}
          className="w-full flex items-center gap-2 mb-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 text-left hover:bg-primary/10 transition-colors"
        >
          <BellRing className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm text-foreground font-medium">
            {totalNew} new {totalNew === 1 ? "job matches" : "jobs match"} your saved searches since your last visit
          </span>
          <span className="ml-auto text-[11px] text-primary font-semibold shrink-0 whitespace-nowrap">View →</span>
        </button>
      )}
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
            {s.digest_opt_in && (
              <select
                value={s.fit_threshold ?? 0}
                onChange={(e) => setThreshold(s, Number(e.target.value))}
                aria-label={`Minimum fit for ${s.name} email alerts`}
                title="Only email me about roles that clear this résumé-fit bar (scored against your latest scan)"
                className="shrink-0 text-[11px] rounded-md border border-border bg-background px-1.5 py-1 text-muted-foreground"
              >
                <option value={0}>Any new</option>
                <option value={10}>Possible fit+</option>
                <option value={20}>Strong fit only</option>
              </select>
            )}
            <button
              onClick={() => toggleDigest(s)}
              aria-label={s.digest_opt_in ? `Turn off weekly email for ${s.name}` : `Email me weekly about ${s.name}`}
              title={s.digest_opt_in ? "Weekly email on — click to turn off" : "Email me weekly when new jobs match"}
              className={`shrink-0 transition-colors ${s.digest_opt_in ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
            >
              <BellRing className="w-3.5 h-3.5" />
            </button>
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
        "New" counts postings published since you last opened each search. Tap the
        <BellRing className="w-3 h-3 inline mx-0.5 align-text-bottom" /> to get a weekly email when fresh jobs match.
      </p>
    </div>
  );
}
