import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Nothing to show, said plainly, with the way out beside it. Sits in the
 * list column inside the first screen; the page hides the detail pane while
 * an empty state shows (no "Select a posting" beside nothing).
 */
export interface EmptyStateProps {
  title: React.ReactNode;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  /** Buttons or links: the next step. */
  actions?: React.ReactNode;
  /** Anything after the actions: similar employers, say. */
  children?: React.ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}

export function EmptyState({ title, body, icon, actions, children, headingLevel = 2, className }: EmptyStateProps) {
  const H = headingLevel === 3 ? "h3" : "h2";
  return (
    <section className={cn("rounded-lg border border-border bg-card px-5 py-6", className)} data-empty-state="">
      {icon ? <div aria-hidden="true" className="mb-3 text-muted-foreground [&_svg]:size-6">{icon}</div> : null}
      <H className="text-lg font-semibold text-foreground">{title}</H>
      {body ? <div className="mt-1 max-w-reading text-sm text-muted-foreground">{body}</div> : null}
      {actions ? <div className="mt-4 flex flex-wrap gap-2">{actions}</div> : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
