// Search-setup checklist for accounts that HAVE a scan but haven't wired up
// the job-search loop (the scan-side checklist already exists for zero-scan
// accounts). Three steps with live completion state; dismissible; gone for
// good once every step is done.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

export function SetupChecklist({ hasScan, hasApplication }: { hasScan: boolean; hasApplication: boolean }) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem("rb_setup_done") === "1"; } catch { return false; }
  });
  const [searches, setSearches] = useState<{ n: number; digestOn: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as { from: (t: string) => any })
          .from("user_job_searches").select("id,digest_opt_in").limit(20);
        if (!cancelled && Array.isArray(data)) {
          setSearches({ n: data.length, digestOn: data.some((r: { digest_opt_in?: boolean }) => r.digest_opt_in) });
        }
      } catch { if (!cancelled) setSearches({ n: 0, digestOn: false }); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (dismissed || !hasScan || searches === null) return null;
  const steps = [
    { done: hasScan, label: t("accountPage.setupScan", "Scan your résumé"), to: "/#upload" },
    { done: searches.n > 0, label: t("accountPage.setupSearch", "Save a job search on the board"), to: "/jobs" },
    { done: searches.digestOn, label: t("accountPage.setupDigest", "Turn on the weekly match email for a search"), to: "#searches" },
    { done: hasApplication, label: t("accountPage.setupTrack", "Save or apply to your first role"), to: "/jobs" },
  ];
  if (steps.every((s) => s.done)) {
    try { localStorage.setItem("rb_setup_done", "1"); } catch { /* ignore */ }
    return null;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <ListChecks className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountPage.setupTitle", "Finish setting up your search")}</h2>
        <button
          type="button"
          onClick={() => { setDismissed(true); try { localStorage.setItem("rb_setup_done", "1"); } catch { /* ignore */ } }}
          aria-label={t("accountPage.setupDismiss", "Dismiss")}
          className="ml-auto text-muted-foreground/60 hover:text-foreground text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded px-1"
        >×</button>
      </div>
      <div className="space-y-1.5">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-2.5 text-[13px]">
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${s.done ? "bg-success text-success-foreground" : "bg-primary/15 text-primary"}`}>
              {s.done ? "✓" : ""}
            </span>
            {s.done ? (
              <span className="text-muted-foreground line-through">{s.label}</span>
            ) : s.to.startsWith("#") ? (
              <a href={s.to} className="text-foreground hover:text-primary">{s.label}</a>
            ) : (
              <Link to={s.to} className="text-foreground hover:text-primary">{s.label}</Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
