// Upcoming interviews, stitched into one glance. Interview dates already live
// on tracker rows; this surfaces the next ones at the top of the account with
// a jump to the full row (where prep and the apply kit live). Renders nothing
// without upcoming dates.

import { CalendarClock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AppRow { id: string; company: string; role: string | null; interview_at?: string | null }

export function InterviewsHub({ applications }: { applications: AppRow[] }) {
  const { t } = useTranslation();
  const now = Date.now() - 86_400_000; // include today regardless of timezone
  const upcoming = applications
    .filter((a) => a.interview_at && Date.parse(a.interview_at) >= now)
    .sort((a, b) => Date.parse(a.interview_at!) - Date.parse(b.interview_at!))
    .slice(0, 4);
  if (upcoming.length === 0) return null;

  const dayLabel = (iso: string) => {
    const d = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
    if (d <= 0) return t("accountPage.ivhToday", "Today");
    if (d === 1) return t("accountPage.ivhTomorrow", "Tomorrow");
    return t("accountPage.ivhInDays", "In {{n}} days", { n: d });
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <CalendarClock className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">
          {t("accountPage.ivhTitle", "Upcoming interviews")}
        </h2>
      </div>
      <ul className="space-y-1.5">
        {upcoming.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-foreground min-w-0 truncate">
              {a.company}{a.role ? <span className="text-muted-foreground"> · {a.role}</span> : null}
            </span>
            <span className="shrink-0 text-[11px] font-semibold text-primary">
              {dayLabel(a.interview_at!)} · {new Date(a.interview_at!).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
      <a href="#pipeline" className="inline-block mt-2.5 text-[12px] text-primary hover:underline">
        {t("accountPage.ivhOpen", "Open the tracker for prep and details ↓")}
      </a>
    </div>
  );
}
