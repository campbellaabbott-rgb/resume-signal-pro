import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * One headline figure: the value, what it counts, and its date basis.
 * The value arrives already formatted (src/lib/format.ts), so a floor reads
 * "10,000+" here exactly as it does in every other place on the page.
 */
export interface StatProps {
  value: React.ReactNode;
  label: React.ReactNode;
  /** An <AsOf> or a basis sentence. A figure without one is a figure without a date. */
  basis?: React.ReactNode;
  className?: string;
}

export function Stat({ value, label, basis, className }: StatProps) {
  return (
    <div className={cn("min-w-0", className)} data-stat="">
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
      {basis ? <div className="mt-0.5">{basis}</div> : null}
    </div>
  );
}
