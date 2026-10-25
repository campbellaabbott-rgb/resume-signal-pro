import { cn } from "@/lib/utils";

/**
 * A plain initial standing in for a logo (owner decision D8: no logos in v1).
 * Neutral, never hued: a colour per employer read as a category. Decorative:
 * the employer's name is always printed beside it, so it is hidden from
 * assistive technology.
 */
export interface MonogramProps {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-12 w-12 text-lg",
} as const;

export function monogramLetter(name: string): string {
  const m = String(name ?? "").trim().match(/[\p{L}\p{N}]/u);
  return m ? m[0].toLocaleUpperCase() : "·";
}

export function Monogram({ name, size = "md", className }: MonogramProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-md border border-border bg-muted font-semibold text-muted-foreground",
        SIZES[size],
        className,
      )}
    >
      {monogramLetter(name)}
    </span>
  );
}
