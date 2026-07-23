// Saved-search pills: a signed-in user's named searches as one-tap chips on
// the board itself (they previously lived only in the Account). Clicking one
// reloads the board with that search's exact params via the same URL mapping
// the Account uses — a full navigation, so every filter state initializes
// cleanly. Renders nothing when signed out, empty, or mid-search.

import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { searchToQuery, type JobSearchParams } from "@/lib/job-search-params";

interface SavedSearch { id: string; name: string; params: JobSearchParams }

export function SavedSearchPills() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searches, setSearches] = useState<SavedSearch[]>([]);

  useEffect(() => {
    if (!user) { setSearches([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as { from: (t: string) => any })
          .from("user_job_searches")
          .select("id,name,params")
          .order("created_at", { ascending: false })
          .limit(5);
        if (!cancelled && Array.isArray(data)) setSearches(data as SavedSearch[]);
      } catch { /* pills are optional sugar */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (searches.length === 0) return null;

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
          onClick={() => window.location.assign(searchToQuery(s.params))}
          className="text-xs px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors max-w-[220px] truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
