/**
 * THE RECEIPT A NEW AGENT SUBSCRIBER LANDS ON, AND THE REASON THE NEXT STEP
 * EXISTS.
 *
 * create-agent-checkout sends a new subscriber to /agent with `welcome` set to
 * "trial" when that checkout carried the first-time trial and "1" when it
 * charged at once. The banner said "7 days free before the first charge" to
 * everyone, so a returning customer who had just been charged was told the
 * charge was a week away (L6-29 review). The trial sentence is now said only
 * on "trial", with its length from the mirror of AGENT_TRIAL_DAYS.
 *
 * The second sentence is the one that matters: buying does not create a
 * mandate, so without the checklist below a paid account sits silent and
 * looks broken.
 */
import { useTranslation } from "react-i18next";
import { SUBSCRIPTIONS } from "@/config/products";

export type AgentWelcome = "trial" | "charged";

/** The banner a `welcome` flag asks for; null when it is absent or unknown. */
export function agentWelcomeFrom(flag: string | null): AgentWelcome | null {
  if (flag === "trial") return "trial";
  if (flag === "1") return "charged";
  return null;
}

export function AgentWelcomeBanner({ welcome }: { welcome: AgentWelcome }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-success/40 bg-success/5 p-4" role="status">
      <p className="text-sm font-semibold text-foreground">
        {welcome === "trial"
          ? t("agentPage.welcomeTitleTrial", "You're subscribed — {{trialDays}} days free before the first charge.", { trialDays: SUBSCRIPTIONS.agent.trialDays })
          : t("agentPage.welcomeTitle", "You're subscribed.")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          "agentPage.welcomeBody",
          "One thing left: the agent needs your CV and an active mandate before it can look for anything. The checklist below takes about a minute, and nothing runs until it is done.",
        )}
      </p>
    </div>
  );
}
