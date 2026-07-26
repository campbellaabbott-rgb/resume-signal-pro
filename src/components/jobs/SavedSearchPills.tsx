// Saved-search pills: a signed-in user's named searches as one-tap chips on
// the board itself (they previously lived only in the Account). Clicking one
// reloads the board with that search's exact params via the same URL mapping
// the Account uses — a full navigation, so every filter state initializes
// cleanly. Renders nothing when signed out, empty, or mid-search.
//
// Wave-2 additions:
// - "+N new" badge per pill from the same new-since count the Account card
//   uses, so returners see at a glance which search moved.
// - WATERMARK HONESTY FIX: clicking a pill now advances last_seen_at. It
//   didn't before, so a user could review a search's results daily via the
//   pill while the Account kept claiming everything was "new since last
//   look" against a stale watermark — a count that read permanently high.

import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { searchToQuery, type JobSearchParams } from "@/lib/job-search-params";

interface SavedSearch { id: string; name: string; params: JobSearchParams; last_seen_at?: string | null }

export function SavedSearchPills() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [newCounts, setNewCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user) { setSearches([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as { from: (t: string) => any })
          .from("user_job_searches")
          .select("id,name,params,last_seen_at")
          .order("created_at", { ascending: false })
          .limit(5);
        if (cancelled || !Array.isArray(data)) return;
        setSearches(data as SavedSearch[]);
        // New-since counts, best-effort and cheap: one countOnly per pill,
        // only for searches that HAVE a watermark (a never-opened search
        // showing "573k new" would be noise, not signal).
        const counts: Record<string, number> = {};
        await Promise.all((data as SavedSearch[]).filter((s) => s.last_seen_at).map(async (s) => {
          try {
            const p = s.params ?? {};
            const { data: res } = await supabase.functions.invoke("job-board", {
              body: {
                action: "list", countOnly: true, includeFacets: false,
                q: p.q || undefined, location: p.location || undefined,
                remote: p.remote || undefined, category: p.category || undefined,
                experience: p.experience || undefined,
                companies: p.company ? [p.company] : undefined,
                salaryFloor: p.salaryFloor || undefined,
                postedAfter: s.last_seen_at,
              },
            });
            const n = (res as { total?: number | null } | null)?.total;
            if (typeof n === "number" && n > 0) counts[s.id] = n;
          } catch { /* badge is sugar — the pill works without it */ }
        }));
        if (!cancelled) setNewCounts(counts);
      } catch { /* pills are optional sugar */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (searches.length === 0) return null;

  const openSearch = (s: SavedSearch) => {
    // Advance the watermark BEFORE navigating (a fire-and-forget write would
    // be killed by the page unload — chain the navigation on the update, and
    // navigate regardless of the write's outcome).
    const go = () => window.location.assign(searchToQuery(s.params));
    (supabase as unknown as { from: (t: string) => any })
      .from("user_job_searches")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", s.id)
      .then(go, go);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <Bookmark className="w-3 h-3" />
        {t("jobsPage.pills.label", "Your searches:")}
      </span>
      {searches.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => openSearch(s)}
          className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors max-w-[240px] truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {s.name}
          {newCounts[s.id] ? (
            <span className="ml-1.5 text-[10px] font-semibold text-primary">
              {t("jobsPage.pills.newBadge", "+{{n}} new", { n: newCounts[s.id] > 999 ? "999+" : newCounts[s.id] })}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
