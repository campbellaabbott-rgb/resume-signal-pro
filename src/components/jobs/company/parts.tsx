// SMALL PIECES THE COMPANY PAGE IS BUILT FROM.
//
// The design system group ships the shared primitives (Chip, Surface,
// Disclosure) in src/components/ui in parallel with this group. These are
// the company page's own minimal equivalents, written in the same token
// vocabulary (bg-card, text-subtle-foreground, bg-signal-tint, text-meta,
// border-border-strong), so the page renders before those land and the
// wiring pass can swap each one for its primitive without a visual change.
//
// Two behaviours every piece here keeps:
//   - a disclosure opens on click, Enter or Space and on nothing else, never
//     on focus or hover, and its trigger is a real button with aria-expanded
//     and aria-controls naming its panel;
//   - a status is never colour alone: every chip that carries a meaning
//     carries an icon or a word that says it.
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "outline" | "live" | "signal" | "caution" | "danger" | "agency";

const TONE: Record<ChipTone, string> = {
  neutral: "bg-muted text-foreground",
  outline: "border border-border-strong text-muted-foreground",
  live: "bg-success-tint text-success",
  signal: "bg-signal-tint text-signal",
  caution: "bg-warning-tint text-warning",
  danger: "bg-destructive-tint text-destructive",
  agency: "border border-border-strong bg-card text-foreground",
};

export function CompanyChip({ tone = "neutral", icon, children, className, title, ...rest }: {
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <span
      title={title}
      className={cn("inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm px-2 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0", TONE[tone], className)}
      {...rest}
    >
      {icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : null}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

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
  return (
    <section aria-labelledby={id} className={cn(!bare && "rounded-lg border border-border bg-card p-4", className)} {...rest}>
      <H id={id} className="text-base font-semibold text-foreground">{title}</H>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
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
