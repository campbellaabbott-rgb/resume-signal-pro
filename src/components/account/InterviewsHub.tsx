// Upcoming interviews, stitched into one glance. Interview dates already live
// on tracker rows; this surfaces the next ones at the top of the account with
// a jump to the full row (where prep and the apply kit live). Renders nothing
// without upcoming dates.
//
// AND WHAT HAPPENED AFTER THE ONES ALREADY SAT. An interview goes quiet and the
// candidate has nothing at all to go on — that silence is the worst part of a
// job hunt and it is the one place this platform holds an observation nobody
// else can make. `job_board_closures` records the day the exact posting came
// down, `get_application_lifecycle` already joins it to the tracker row, and
// Account.tsx already fetches it. Placing it against the interview date costs
// one pure function and no query.
//
// It reports the POSTING, never the outcome. A takedown is consistent with
// somebody else being hired and with the req being cancelled; see
// interviewAttribution for the four things this must not imply.

import { CalendarClock, History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { interviewSignals, type InterviewSignal, type TrackedApplication } from "@/lib/interviewAttribution";

interface AppRow extends TrackedApplication {
  id: string;
  company: string;
  role?: string | null;
  interview_at?: string | null;
}

export function InterviewsHub({ applications }: { applications: AppRow[] }) {
  const { t } = useTranslation();
  const now = Date.now() - 86_400_000; // include today regardless of timezone
  const upcoming = applications
    .filter((a) => a.interview_at && Date.parse(a.interview_at) >= now)
    .sort((a, b) => Date.parse(a.interview_at!) - Date.parse(b.interview_at!))
    .slice(0, 4);

  // Past interviews with something measured to say. `not-observed` is dropped
  // from the LIST while staying in the model: a row whose only content is "we
  // do not know" is noise here, and the tracker row itself already says it.
  const past = interviewSignals(applications).filter((s) => s.kind !== "not-observed").slice(0, 3);

  if (upcoming.length === 0 && past.length === 0) return null;

  const dayLabel = (iso: string) => {
    const d = Math.round((Date.parse(iso) - Date.now()) / 86_400_000);
    if (d <= 0) return t("accountPage.ivhToday", "Today");
    if (d === 1) return t("accountPage.ivhTomorrow", "Tomorrow");
    return t("accountPage.ivhInDays", "In {{n}} days", { n: d });
  };

  /**
   * Every string here describes the posting and nothing else.
   *
   * "Came down" is not "you got it" and not "they moved on" — both readings are
   * available to the candidate and neither is ours to make for them. What is
   * ours is the fact, and the fact is genuinely useful: a req that came down
   * eleven days after an interview and has not reappeared is an employer who
   * has stopped looking, which is worth knowing while waiting.
   */
  const signalLine = (s: InterviewSignal): { text: string; tone: string } => {
    switch (s.kind) {
      case "closed-after":
        return {
          tone: "text-success",
          text: t("accountPage.ivhClosedAfter",
            "This posting came down {{d}} days after your interview, and hasn't gone back up.",
            { d: s.days }),
        };
      case "relisted-after":
        return {
          tone: "text-warning",
          text: t("accountPage.ivhRelistedAfter",
            "This posting came down after your interview — but the same role has since gone back up.",
            { d: s.days }),
        };
      case "still-open":
        return {
          tone: "text-muted-foreground",
          text: t("accountPage.ivhStillOpen",
            "Still live on the company's own feed, {{d}} days after your interview.",
            { d: s.days }),
        };
      case "closed-before":
        return {
          tone: "text-muted-foreground",
          text: t("accountPage.ivhClosedBefore",
            "We recorded this posting coming down before the interview date you saved — worth checking the date.",
          ),
        };
      default:
        return { tone: "text-muted-foreground", text: "" };
    }
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 mb-6">
      {upcoming.length > 0 && (
        <>
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
                  {dayLabel(a.interview_at!.slice(0, 10) + "T00:00:00")} · {new Date(a.interview_at!.slice(0, 10) + "T00:00:00").toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <div className={upcoming.length > 0 ? "mt-4 border-t border-primary/20 pt-3" : ""}>
          <div className="flex items-center gap-2 mb-2">
            <History className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-foreground text-sm">
              {t("accountPage.ivhSinceTitle", "Since your interview")}
            </h2>
          </div>
          <ul className="space-y-2">
            {past.map((s) => {
              const line = signalLine(s);
              return (
                <li key={s.application.id} className="text-[13px]">
                  <span className="text-foreground">
                    {s.application.company}
                    {s.application.role ? <span className="text-muted-foreground"> · {s.application.role}</span> : null}
                  </span>
                  <p className={`text-[12px] leading-snug ${line.tone}`}>{line.text}</p>
                </li>
              );
            })}
          </ul>
          {/* The provenance, in one sentence, because the claim is unusual
              enough that a reader is entitled to ask how we could possibly
              know — and because it states the limit at the same time. */}
          <p className="text-[11px] text-muted-foreground mt-2">
            {t("accountPage.ivhSinceProvenance",
              "From our own daily record of this exact posting on the company's careers feed. A posting coming down means the ad was withdrawn — it doesn't tell us who was hired.")}
          </p>
        </div>
      )}

      <a href="#pipeline" className="inline-block mt-2.5 text-[12px] text-primary hover:underline">
        {t("accountPage.ivhOpen", "Open the tracker for prep and details ↓")}
      </a>
    </div>
  );
}
