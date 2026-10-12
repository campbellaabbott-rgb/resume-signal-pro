import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Something failed, said as what failed, in a live region.
 *
 * "Try again" appears ONLY when a retry can help: pass `onRetry` for a
 * transient failure and leave it out for a refusal that a retry cannot
 * change (a used-up daily allowance, CP16 — the page said "Try again" under
 * a sentence saying the allowance resets at 8 PM). The status is never
 * colour alone: the icon and the words carry it.
 */
export interface ErrorStateProps {
  title: React.ReactNode;
  body?: React.ReactNode;
  /** Present only when retrying can succeed. */
  onRetry?: () => void;
  retryLabel?: string;
  /** "assertive" for a failure that interrupts the task; polite otherwise. */
  live?: "polite" | "assertive";
  actions?: React.ReactNode;
  className?: string;
}

export function ErrorState({ title, body, onRetry, retryLabel, live = "polite", actions, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <section
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live}
      className={cn("rounded-lg border border-destructive/40 bg-destructive-tint px-5 py-4", className)}
      data-error-state=""
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {body ? <div className="mt-1 text-sm text-muted-foreground">{body}</div> : null}
          {onRetry || actions ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry ? (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  {retryLabel ?? t("ds.tryAgain", "Try again")}
                </Button>
              ) : null}
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
