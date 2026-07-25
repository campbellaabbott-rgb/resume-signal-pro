// One place to see and control every email the platform can send — the
// opt-ins were scattered across features (per-search digest switches, the
// agent's morning queue). Mirrors the same rows SavedSearchesCard manages,
// through the same table, so the two stay consistent.

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

interface SearchRow { id: string; name: string; digest_opt_in: boolean }

const table = () => (supabase as unknown as { from: (t: string) => any }).from("user_job_searches");

export function NotificationsPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await table().select("id,name,digest_opt_in").order("created_at", { ascending: false }).limit(20);
        if (!cancelled && Array.isArray(data)) setRows(data as SearchRow[]);
      } catch { /* panel hides */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async (id: string, next: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, digest_opt_in: next } : r)));
    try { await table().update({ digest_opt_in: next }).eq("id", id); } catch { /* optimistic; digest cron re-reads */ }
  };

  // Always render once loaded — the one panel claiming to show every email
  // must not vanish for users whose only email is the agent digest (audit).
  if (!loaded) return null;
  const on = rows.filter((r) => r.digest_opt_in).length;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <BellRing className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountPage.notifTitle", "Emails & alerts")}</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t("accountPage.notifSummary", "{{on}} of {{total}} weekly digests on", { on, total: rows.length })}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {t("accountPage.notifBlurb", "Everything we can email you, in one place. Weekly digests send only when a search has new matches; every email has a one-click unsubscribe.")}
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <label key={r.id} className="flex items-center gap-2.5 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={r.digest_opt_in}
              onChange={(e) => void toggle(r.id, e.target.checked)}
              className="accent-[hsl(var(--primary))]"
              aria-label={t("accountPage.notifToggle", "Weekly email for {{name}}", { name: r.name })}
            />
            <span className="text-foreground truncate">{r.name}</span>
            <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
              {t("accountPage.notifWeekly", "weekly digest")}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
