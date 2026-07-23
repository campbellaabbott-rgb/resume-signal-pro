// Overview-level bridge to the Morning Queue. Deliberately neutral framing so
// it serves both audiences: subscribers jump to their queue, everyone else
// lands on the panel whose own paywall carries the 7-days-free trial. No
// entitlement query needed up here.

import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export function AgentBridgeCard({ topGap }: { topGap?: string | null }) {
  const { t } = useTranslation();
  return (
    <a
      href="#agent"
      className="block rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-5 mb-6 hover:border-primary/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountPage.bridgeTitle", "Your Morning Queue")}</h2>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {t("accountPage.bridgeBlurb", "The Apply Agent reviews thousands of fresh postings overnight and shortlists the ones worth your morning — churny companies skipped, genuine hirers first, each with its reasons. You always press send.")}
        {topGap && (
          <> {t("accountPage.bridgeGap", "It also knows your current top gap ({{gap}}) and weighs it.", { gap: topGap })}</>
        )}
      </p>
      <span className="inline-block mt-2 text-[12px] font-semibold text-primary">
        {t("accountPage.bridgeCta", "Open the queue ↓")}
      </span>
    </a>
  );
}
