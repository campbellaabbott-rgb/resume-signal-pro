import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * CHIPS: one meaning per colour, and never colour alone.
 *
 *   neutral   a plain fact (employment type, a count)
 *   outline   a quieter fact
 *   live      read from source, live (success): pair it with a check or dot icon
 *   signal    a gated hiring-record statement
 *   caution   a limit or a partial read (warning)
 *   danger    gone, an error (destructive)
 *   agency    a staffing agency's board: a disclosure, not a warning
 *
 * A status chip takes an `icon`, so the meaning reads without the colour.
 */
const chipVariants = cva(
  "inline-flex h-6 max-w-full items-center gap-1 rounded-sm px-2 text-xs font-medium [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-foreground",
        outline: "border border-border-strong text-muted-foreground",
        live: "bg-success-tint text-success",
        signal: "bg-signal-tint text-signal",
        caution: "bg-warning-tint text-warning",
        danger: "bg-destructive-tint text-destructive",
        agency: "border border-border-strong bg-card text-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof chipVariants> {
  icon?: React.ReactNode;
}

function Chip({ className, variant, icon, children, ...props }: ChipProps) {
  return (
    <span className={cn(chipVariants({ variant }), className)} {...props}>
      {icon ? <span aria-hidden="true" className="inline-flex">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * A FILTER CHIP is a toggle button: aria-pressed carries the state, and the
 * selected look is the tint, the primary border, primary text AND a check,
 * never the tint alone. 36px tall, 44px under a finger.
 */
export interface FilterChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  pressed: boolean;
  /** A measured count for this option, already formatted. Omitted when nothing measured it. */
  count?: string;
}

const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ pressed, count, className, children, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background coarse:h-11 [&_svg]:size-4 [&_svg]:shrink-0",
        pressed
          ? "border-primary bg-primary-tint text-primary"
          : "border-border-strong bg-card text-foreground hover:bg-accent",
        className,
      )}
      {...props}
    >
      {pressed ? <Check aria-hidden="true" /> : null}
      <span>{children}</span>
      {count ? <span className="text-meta text-muted-foreground">{count}</span> : null}
    </button>
  ),
);
FilterChip.displayName = "FilterChip";

/**
 * An active filter, shown as a chip the visitor can remove. Its button's name
 * says what it removes ("Remove filter: Remote"), so a screen reader hears
 * more than "button, X".
 */
export interface RemovableChipProps {
  label: string;
  removeLabel: string;
  onRemove: () => void;
  className?: string;
}

function RemovableChip({ label, removeLabel, onRemove, className }: RemovableChipProps) {
  return (
    <span className={cn("inline-flex h-8 max-w-full items-center gap-1 rounded-md border border-primary bg-primary-tint pl-2.5 text-sm text-primary", className)}>
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        data-chip-remove=""
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11 coarse:w-11"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

export { Chip, FilterChip, RemovableChip, chipVariants };
