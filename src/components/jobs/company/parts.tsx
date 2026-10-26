// SMALL PIECES THE COMPANY PAGE IS BUILT FROM, ON THE DESIGN SYSTEM'S PRIMITIVES.
//
// G3 shipped these as stand-ins before the design system's primitives
// landed. Pass B (2026-10-12) swapped them: the status chips are the shared
// Chip (src/components/ui/chip.tsx) at their call sites, and a profile
// section is the shared Surface with its heading. Two pieces stay here:
//
//   - WhyDisclosure keeps its own panel. The shared Disclosure is a Radix
//     Collapsible, which renders nothing inside a closed panel, and a "Why?"
//     reason must stay in the document while folded (hidden, not absent) so a
//     crawler and a screen reader's browse mode can still reach the gate's
//     own words. Its trigger keeps the Disclosure contract: a real button
//     with aria-expanded and aria-controls, opened on click, Enter or Space
//     and never on focus or hover.
//   - ValueBar has no primitive: a labelled bar with its value printed beside
//     it, never in a tooltip alone.
//
// A status is never colour alone: every chip that carries a meaning carries
// an icon or a word that says it.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Surface } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A section of the employer profile: a surface with a heading (h2 on the page
 * and in the desktop rail, h3 inside the phone accordion, whose trigger is
 * the h2). `bare` drops the surface where a parent already draws one.
 */
export function ProfileSection({ title, titleId, children, className, headingLevel = 2, bare = false, ...rest }: {
  title: ReactNode;
  titleId?: string;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  bare?: boolean;
} & Record<`data-${string}`, string | undefined>) {
  const auto = useId();
  const id = titleId ?? `${auto}-title`;
  const H = headingLevel === 3 ? "h3" : "h2";
  const body = (
    <>
      <H id={id} className="text-base font-semibold text-foreground">{title}</H>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </>
  );
  if (bare) return <section aria-labelledby={id} className={className} {...rest}>{body}</section>;
  return <Surface as="section" aria-labelledby={id} className={cn("p-4", className)} {...rest}>{body}</Surface>;
}

/**
 * "Why?": a reason that is on the page but folded. The stub line says what
 * is not printed; the panel says why, in the gate's own words. The panel is
 * in the DOM while closed (hidden), so a crawler and a screen reader's
 * browse mode can still reach it, and the trigger names it.
 */
export function WhyDisclosure({ stub, children, label, className, ...rest }: {
  stub: ReactNode;
  children: ReactNode;
  /** The trigger's text ("Why?"). */
  label: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const panelId = `${id}-why`;
  const stubId = `${id}-stub`;
  return (
    <div className={cn("text-sm", className)} {...rest}>
      <p className="text-muted-foreground">
        {/* Every "Why?" button has the same name, so each is described by the line it explains. */}
        <span id={stubId}>{stub}</span>{" "}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-describedby={stubId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-6 items-center gap-0.5 rounded-sm font-medium text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {label}
          <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </p>
      <div id={panelId} hidden={!open} className="mt-1 border-l-2 border-border-strong pl-3 text-meta text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/** A labelled horizontal bar with its value printed beside it (never in a tooltip alone). */
export function ValueBar({ label, value, share }: { label: string; value: string; share: number }) {
  const w = Math.max(2, Math.min(100, Math.round(share * 100)));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-meta" aria-hidden="true">
      <span className="truncate text-foreground">{label}</span>
      <span className="tabular-nums text-muted-foreground">{value}</span>
      <span className="col-span-2 h-1.5 rounded-sm bg-muted">
        <span className="block h-1.5 rounded-sm bg-primary" style={{ width: `${w}%` }} />
      </span>
    </div>
  );
}
