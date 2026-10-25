import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A "Why?" or "Show more" that a reader opens on purpose.
 *
 * The trigger is a real <button> with aria-expanded and aria-controls. It
 * opens on click, Enter or Space and on nothing else: never on focus or
 * hover, because a block that opens as a keyboard user tabs past it pushes
 * the rest of the page out from under them (the perks list did exactly that,
 * audit 2026-10-11).
 */
export interface DisclosureProps {
  /** The trigger's visible text. */
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render the summary inside a heading of this level (h2 for an accordion section). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

function Disclosure({
  summary,
  children,
  defaultOpen,
  open,
  onOpenChange,
  headingLevel,
  className,
  triggerClassName,
  contentClassName,
}: DisclosureProps) {
  const trigger = (
    <CollapsiblePrimitive.Trigger
      className={cn(
        "group inline-flex min-h-8 w-full items-center justify-between gap-2 rounded-sm text-left text-sm font-medium text-foreground transition-colors duration-fast hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:min-h-11",
        triggerClassName,
      )}
    >
      <span className="min-w-0">{summary}</span>
      <ChevronDown
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-base group-data-[state=open]:rotate-180"
      />
    </CollapsiblePrimitive.Trigger>
  );
  const Heading = headingLevel ? (`h${headingLevel}` as "h2" | "h3" | "h4") : null;
  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className={className}>
      {Heading ? <Heading className="m-0">{trigger}</Heading> : trigger}
      <CollapsiblePrimitive.Content
        className={cn(
          "overflow-hidden text-sm text-muted-foreground data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
          contentClassName,
        )}
      >
        <div className="pt-2">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

export { Disclosure };
