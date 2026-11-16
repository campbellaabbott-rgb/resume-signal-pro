// One place to see and control every email the platform can send — the
// opt-ins were scattered across features (per-search digest switches, the
// agent's morning queue). Mirrors the same rows SavedSearchesCard manages,
// through the same table, so the two stay consistent.

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { writeWithDigestLocale } from "@/lib/saved-search-locale";

interface SearchRow { id: string; name: string; digest_opt_in: boolean; digest_cadence?: string | null }
interface MandateRow { user_id: string; active: boolean; email_opt_in: boolean }

const table = () => (supabase as unknown as { from: (t: string) => any }).from("user_job_searches");
const mandates = () => (supabase as unknown as { from: (t: string) => any }).from("agent_mandates");

export function NotificationsPanel() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [mandate, setMandate] = useState<MandateRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await table().select("id,name,digest_opt_in,digest_cadence").order("created_at", { ascending: false }).limit(20);
        if (!cancelled && Array.isArray(data)) setRows(data as SearchRow[]);
        // The agent's morning email belongs in the same panel (2026-07-25
        // audit) — RLS scopes this to the signed-in user's own mandate.
        const { data: m } = await mandates().select("user_id,active,email_opt_in").maybeSingle();
        if (!cancelled && m) setMandate(m as MandateRow);
      } catch { /* panel hides */ }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // THE RHYTHM CAN BE CHANGED WHERE IT IS SHOWN (RC-S13-083): the label
  // that said "daily digest" or "weekly digest" is the switch between them,
  // written as SavedSearchesCard writes it. A refused write puts it back.
  const setCadence = async (id: string, value: "daily" | "weekly") => {
    const was = rows.find((r) => r.id === id)?.digest_cadence ?? null;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, digest_cadence: value } : r)));
    const undo = () => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, digest_cadence: was } : r)));
    try {
      const res = await writeWithDigestLocale(i18n.language, (lang) => table().update({ digest_cadence: value, ...lang }).eq("id", id));
      if ((res as { error?: unknown } | null | undefined)?.error) undo();
    } catch { undo(); }
  };

  const toggle = async (id: string, next: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, digest_opt_in: next } : r)));
    // The digest is written in the language the page is read in (S13-102).
    try { await writeWithDigestLocale(i18n.language, (lang) => table().update({ digest_opt_in: next, ...lang }).eq("id", id)); } catch { /* optimistic; digest cron re-reads */ }
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
          {t("accountPage.notifSummaryEmails", "{{on}} of {{total}} search emails on", { on, total: rows.length })}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        {/* THE RHYTHM EACH ROW MAILS ON (S13-083): "Alert me" and watch-company
            saves are daily, the rest weekly; the row says which. */}
        {t("accountPage.notifBlurbCadence", "Everything we can email you, in one place. A search email goes out only when the search has new matches, daily or weekly as shown beside it; every email has a one-click unsubscribe.")}
      </p>
      <div className="space-y-1.5">
        {mandate && (
          <label className="flex items-center gap-2.5 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              checked={mandate.email_opt_in}
              onChange={(e) => {
                const next = e.target.checked;
                setMandate((m) => (m ? { ...m, email_opt_in: next } : m));
                void mandates().update({ email_opt_in: next }).eq("user_id", mandate.user_id);
              }}
              className="accent-[hsl(var(--primary))]"
            />
            <span className="text-foreground">{t("accountPage.notifAgentEmail", "Apply Agent morning shortlist email")}</span>
            {!mandate.active && (
              <span className="text-[11px] text-muted-foreground">{t("accountPage.notifAgentPaused", "(mandate paused — no sends)")}</span>
            )}
          </label>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2.5 text-[13px]">
            <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
              <input
                type="checkbox"
                checked={r.digest_opt_in}
                onChange={(e) => void toggle(r.id, e.target.checked)}
                className="accent-[hsl(var(--primary))]"
                aria-label={r.digest_cadence === "daily"
                  ? t("accountPage.notifToggleDaily", "Daily email for {{name}}", { name: r.name })
                  : t("accountPage.notifToggle", "Weekly email for {{name}}", { name: r.name })}
              />
              <span className="text-foreground truncate">{r.name}</span>
            </label>
            <select
              value={r.digest_cadence === "daily" ? "daily" : "weekly"}
              onChange={(e) => void setCadence(r.id, e.target.value === "daily" ? "daily" : "weekly")}
              aria-label={t("mailPrefs.cadenceAria", "How often to email about {{name}}", { name: r.name })}
              data-cadence-select
              className="ml-auto shrink-0 text-[11px] rounded-md border border-border bg-background px-1.5 py-0.5 text-muted-foreground"
            >
              <option value="daily">{t("accountPage.notifDaily", "daily digest")}</option>
              <option value="weekly">{t("accountPage.notifWeekly", "weekly digest")}</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
