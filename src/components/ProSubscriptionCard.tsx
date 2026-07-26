import { useState } from "react";
import { Crown, Check, Loader2, Sparkles, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useProSubscription } from "@/hooks/use-pro-subscription";

// Scanner-era list predated the job board entirely — the Morning Queue and
// Apply Agent (the subscription's two biggest features) were absent from the
// one surface that sells it. Every line is a shipped, factual capability.
const PRO_PERKS = [
  "Morning Queue — the Apply Agent triages the live job board overnight and hands you ready-to-review picks with reasons",
  "Batch application prep — tailored answers drafted for every saved job at once (you always hit send yourself)",
  "Unlimited scans — tailor a resume version to every job you apply to",
  "Track every application against the exact resume version you sent",
  "See which of your resume versions actually lands interviews",
  "Every paid tool included — Full Analysis, Keyword Fix, Cover Letters, Interview Coach, and all future tools, automatically",
  "Cancel anytime from your account",
];

/**
 * Resume Booster Pro card — $45/month all-access. Shown on /pricing and
 * /account. Renders subscribe CTA (with email input when we don't know the
 * visitor) or active-member state with a manage button.
 */
export function ProSubscriptionCard({ compact = false }: { compact?: boolean }) {
  const { pro, subscribe, manage, actionLoading, knownEmail } = useProSubscription();
  const [email, setEmail] = useState("");

  const needsEmail = !knownEmail;

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-2xl border-2 border-primary bg-card ring-2 ring-primary/20 shadow-xl",
        compact ? "p-5" : "p-6 md:p-8",
      )}
    >
      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground shadow-lg">
        <Sparkles className="w-3 h-3 mr-1" />
        All-access
      </Badge>

      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
          <Crown className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="font-bold text-xl">Resume Booster Pro</h3>
          <p className="text-sm text-muted-foreground">
            Your whole job search in one workspace — plus every tool we make, now and future, included.
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-4xl font-bold">$45</span>
        <span className="text-muted-foreground">/month</span>
      </div>

      {!compact && (
        <ul className="space-y-2 mb-6 flex-1">
          {PRO_PERKS.map((perk) => (
            <li key={perk} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      )}

      {pro.active ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <Check className="w-4 h-4" />
            You're a Pro member — every tool is unlocked.
            {pro.currentPeriodEnd && (
              <span className="text-muted-foreground font-normal">
                Renews {new Date(pro.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={manage} disabled={actionLoading}>
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
            Manage subscription
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {needsEmail && (
            <Input
              type="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email for your Pro subscription"
            />
          )}
          <Button
            className="w-full gap-2 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/30"
            onClick={() => subscribe(needsEmail ? email : undefined)}
            disabled={actionLoading || pro.loading}
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
            Go Pro — $45/month
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Secure checkout via Stripe. Cancel anytime — no lock-in.
          </p>
        </div>
      )}
    </div>
  );
}
