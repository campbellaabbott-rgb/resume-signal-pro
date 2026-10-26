import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A FACT IS A TERM AND ITS VALUE, in a description list, so a screen reader
 * announces "Hiring system, Workday" rather than two loose words. A fact
 * whose value is absent is not rendered at all: no "—", no "unknown"
 * standing in for data the page does not have.
 */
export interface FactItem {
  key: string;
  term: React.ReactNode;
  value: React.ReactNode;
  /** Small print under the value: an <AsOf>, a basis sentence. */
  note?: React.ReactNode;
}

export interface FactListProps {
  items: Array<FactItem | null | undefined | false>;
  /** stacked: term above value, one per row. inline: a wrapping row of "term value" pairs. */
  variant?: "stacked" | "inline";
  className?: string;
}

const present = (v: React.ReactNode) => v !== null && v !== undefined && v !== false && v !== "";

export function FactList({ items, variant = "stacked", className }: FactListProps) {
  const shown = items.filter((i): i is FactItem => !!i && present(i.value));
  if (!shown.length) return null;
  if (variant === "inline") {
    return (
      <dl className={cn("flex flex-wrap gap-x-4 gap-y-1 text-sm", className)}>
        {shown.map((f) => (
          <div key={f.key} className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
            <dt className="text-muted-foreground">{f.term}</dt>
            <dd className="text-foreground">{f.value}</dd>
            {f.note ? <dd className="basis-full text-xs text-subtle-foreground">{f.note}</dd> : null}
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn("grid gap-3 text-sm", className)}>
      {shown.map((f) => (
        <div key={f.key} className="min-w-0">
          <dt className="text-muted-foreground">{f.term}</dt>
          <dd className="mt-0.5 text-foreground">{f.value}</dd>
          {f.note ? <dd className="mt-0.5 text-xs text-subtle-foreground">{f.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** One fact on its own, for a caller that lays out its own list. */
export function Fact({ term, value, note, className }: Omit<FactItem, "key"> & { className?: string }) {
  if (!present(value)) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
      {note ? <dd className="mt-0.5 text-xs text-subtle-foreground">{note}</dd> : null}
    </div>
  );
}
