import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMinWidth } from "@/lib/home/use-min-width";

/**
 * A DISCLOSURE WHOSE CONTENT STAYS IN THE PAGE (review P9).
 *
 * The design system's Disclosure is Radix Collapsible, which unmounts closed
 * content: once React replaces the baked page, Google's phone render and a
 * reader's Find lose the FAQ answers, the sources table and the sample report.
 * A native <details> keeps its content in the DOM while closed (and Chrome's
 * Find opens it on a match), so every crawl-relevant block on the homepage is
 * one of these, never the Radix primitive.
 *
 * `openFrom` (px): from that width the block is always open and its summary
 * is not shown, so ONE instance serves as the phone disclosure and the
 * desktop card. The open state is read on the first render, so nothing moves
 * when the page mounts.
 */
export interface HomeDetailsProps {
  summary: ReactNode;
  children: ReactNode;
  openFrom?: number;
  className?: string;
  summaryClassName?: string;
  id?: string;
  "data-testid"?: string;
}

export function HomeDetails({ summary, children, openFrom, className, summaryClassName, id, ...rest }: HomeDetailsProps) {
  const wide = useMinWidth(openFrom ?? 100_000);
  const forced = openFrom !== undefined && wide;
  const [open, setOpen] = useState<boolean>(forced);
  useEffect(() => { if (forced) setOpen(true); }, [forced]);

  return (
    <details
      id={id}
      open={open}
      data-forced-open={forced ? "" : undefined}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (forced && !now) {
          (e.currentTarget as HTMLDetailsElement).open = true;
          return;
        }
        setOpen(now);
      }}
      className={cn("group/details", className)}
      data-testid={rest["data-testid"]}
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm font-semibold text-foreground transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden",
          summaryClassName,
          // [hidden] loses to the .flex utility, so a forced-open block hides its summary with !hidden (last, so it is kept).
          forced && "!hidden",
        )}
      >
        <span className="min-w-0">{summary}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base group-open/details:rotate-180" />
      </summary>
      {children}
    </details>
  );
}
