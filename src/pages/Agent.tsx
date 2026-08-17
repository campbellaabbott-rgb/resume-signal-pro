/**
 * THE AGENT GETS ITS OWN ADDRESS.
 *
 * Until now it lived as `#agent`, an anchor two thirds of the way down a
 * 1,704-line Account page, below six other panels. That is fine for a setting
 * and wrong for a thing that acts on your behalf overnight: the first question
 * a subscriber has in the morning is "what did it do", and the answer was
 * behind a scroll on a page about something else. It also could not be
 * bookmarked, shared, or opened from a notification.
 *
 * MOBILE FIRST, and not as a slogan — `use-mobile.tsx` existed in this codebase
 * and was imported by NONE of the fifteen account panels. The people most
 * likely to check an overnight queue are checking it on a phone, in bed, before
 * work. So on mobile the segments are a bottom bar within thumb reach, and on
 * desktop they are an ordinary segmented control at the top.
 *
 * THREE SEGMENTS, from the three questions actually being asked:
 *   Today        — what happened overnight, and what needs me
 *   Applications — what has been sent, and what it said
 *   Settings     — the mandate, and where it may not apply
 *
 * The panels themselves are REUSED, not reimplemented. They are already tested
 * and already correct; this file is composition and routing, and it deliberately
 * contains no logic about applications of its own.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Sparkles, Send, SlidersHorizontal, ArrowLeft } from "lucide-react";

import { AgentStatusBand } from "@/components/account/AgentStatusBand";
import { MorningQueuePanel } from "@/components/account/MorningQueuePanel";
import { PendingQuestionsPanel } from "@/components/account/PendingQuestionsPanel";
import { ApplyQueuePanel } from "@/components/account/ApplyQueuePanel";
import { ApplyProfilePanel } from "@/components/account/ApplyProfilePanel";
import { AgentControlsPanel } from "@/components/account/AgentControlsPanel";
import { AgentSetupChecklist } from "@/components/account/AgentSetupChecklist";
import { AgentNightSummary } from "@/components/account/AgentNightSummary";

const AgentReachNote = lazy(() => import("@/components/account/AgentReachNote"));

type Tab = "today" | "applications" | "settings";
const TABS: ReadonlyArray<{ id: Tab; icon: typeof Sparkles; key: string; fallback: string }> = [
  { id: "today", icon: Sparkles, key: "agent.tab.today", fallback: "Today" },
  { id: "applications", icon: Send, key: "agent.tab.applications", fallback: "Applications" },
  { id: "settings", icon: SlidersHorizontal, key: "agent.tab.settings", fallback: "Settings" },
];

const isTab = (v: string | null): v is Tab =>
  v === "today" || v === "applications" || v === "settings";

export default function Agent() {
  const { session, user, loading } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  // The tab lives in the URL, so back works, a link is shareable, and a push
  // notification can open straight onto the thing it is about.
  const [tab, setTab] = useState<Tab>(() => (isTab(params.get("tab")) ? (params.get("tab") as Tab) : "today"));

  useEffect(() => {
    const q = params.get("tab");
    if (isTab(q) && q !== tab) setTab(q);
  }, [params, tab]);

  // Read ONCE, on mount, then strip the flag from the URL. Held in state rather
  // than read from `params` at render time because the banner must survive the
  // tab-switching setParams calls below — reading it live would make the
  // welcome vanish the moment someone touched a tab, and re-appear on back.
  // Stripping it also means a refresh or a shared link is not a second "you
  // just subscribed" to somebody who did not just subscribe.
  const [justSubscribed] = useState(() => params.get("welcome") === "1");
  useEffect(() => {
    if (params.get("welcome") === null) return;
    const p = new URLSearchParams(params);
    p.delete("welcome");
    setParams(p, { replace: true });
  }, [params, setParams]);

  const go = (next: Tab) => {
    setTab(next);
    const p = new URLSearchParams(params);
    p.set("tab", next);
    // replace: a segment switch is not a navigation someone wants to press
    // back through three times to leave the page.
    setParams(p, { replace: true });
  };

  useEffect(() => {
    if (!loading && !session) navigate("/auth", { replace: true });
  }, [loading, session, navigate]);

  if (loading || !session || !user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-16">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-4 h-40 animate-pulse rounded-xl bg-muted" />
        </main>
      </div>
    );
  }

  const userId = user.id;
  const email = user.email ?? null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main
        className={cn(
          "mx-auto w-full max-w-4xl px-4 pt-6",
          // Room for the fixed bottom bar, plus the iOS home indicator. Without
          // this the last card sits under the bar and looks like a cut-off page.
          isMobile ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))]" : "pb-16",
        )}
      >
        <Link
          to="/account"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("agent.backToAccount", "Back to account")}
        </Link>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("agent.title", "Apply agent")}
          </h1>
          {/* THE WAY OUT OF "what is this actually going to do".
              Every explanation on this page is a fragment attached to the
              control it describes — correct, and no use at all to somebody who
              wants the whole shape before handing over their job hunt. On all
              three tabs, because the question does not only arrive on one. */}
          <Link
            to="/guides/how-the-apply-agent-works"
            className="text-sm text-primary hover:underline"
          >
            {t("agent.howItWorks", "How it works")}
          </Link>
        </div>

        <div className="mt-4">
          <AgentStatusBand userId={userId} email={email} />
        </div>

        {/* Desktop segments. On mobile the same control is fixed to the bottom. */}
        {!isMobile && (
          <nav
            className="mt-6 inline-flex rounded-lg border border-border bg-muted/40 p-1"
            aria-label={t("agent.sections", "Agent sections")}
          >
            {TABS.map(({ id, icon: Icon, key, fallback }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  tab === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(key, fallback)}
              </button>
            ))}
          </nav>
        )}

        <div className="mt-6 space-y-6">
          {tab === "today" && (
            <>
              {/* THE RECEIPT, AND THE REASON THE NEXT STEP EXISTS.
                  Stripe returns a new subscriber here with ?welcome=1 (see
                  create-agent-checkout). Two things have to be said in that
                  moment: the payment worked, and the agent is NOT yet running.
                  The second is the one that matters — buying does not create a
                  mandate, so without the checklist below a paid account sits
                  silent and looks broken. Says "checklist below", not "all set". */}
              {justSubscribed && (
                <div
                  className="rounded-xl border border-success/40 bg-success/5 p-4"
                  role="status"
                >
                  <p className="text-sm font-semibold text-foreground">
                    {t("agentPage.welcomeTitle", "You're subscribed — 7 days free before the first charge.")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      "agentPage.welcomeBody",
                      "One thing left: the agent needs your CV and an active mandate before it can look for anything. The checklist below takes about a minute, and nothing runs until it is done.",
                    )}
                  </p>
                </div>
              )}
              {/* Setup first, and only while it is genuinely unfinished. An
                  empty queue below an unexplained empty page is how a paid
                  product gets mistaken for a broken one. */}
              <AgentSetupChecklist userId={userId} onGo={go} />
              {/* Then last night, which is the question a returning subscriber
                  actually has — before the queue that answers it obliquely. */}
              <AgentNightSummary userId={userId} />
              <MorningQueuePanel userId={userId} email={email} defaultResume={null} />
              <PendingQuestionsPanel userId={userId} />
            </>
          )}

          {tab === "applications" && <ApplyQueuePanel userId={userId} />}

          {tab === "settings" && (
            <>
              {/* Controls BEFORE the profile. "Where it may not apply" is the
                  anxious question a new subscriber has, and it should not be
                  below a long form about their phone number. */}
              <AgentControlsPanel userId={userId} />
              <ApplyProfilePanel userId={userId} />
              <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-muted" />}>
                <AgentReachNote />
              </Suspense>
            </>
          )}
        </div>
      </main>

      {/* THUMB REACH. Fixed, not sticky: a queue is a long scroll and the
          segments have to stay put while it moves. */}
      {isMobile && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
          aria-label={t("agent.sections", "Agent sections")}
        >
          <div className="mx-auto flex max-w-md">
            {TABS.map(({ id, icon: Icon, key, fallback }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={tab === id ? "page" : undefined}
                className={cn(
                  // 56px min target: comfortably above the 44px floor, because
                  // these are pressed one-handed.
                  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  tab === id ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {t(key, fallback)}
              </button>
            ))}
          </div>
        </nav>
      )}

      {!isMobile && <Footer />}
    </div>
  );
}
