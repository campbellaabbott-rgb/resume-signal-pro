import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholders that hold the space the real thing will take, so nothing
 * jumps when it arrives (CLS < 0.05 on the company page). The only looping
 * animation on the site is this pulse, and reduced-motion stops it.
 * Hidden from assistive technology: the region that loads announces itself.
 */

/** One job card's footprint. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-skeleton="card" className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
      <Skeleton className="mt-3 h-3 w-40" />
    </div>
  );
}

/**
 * The company header while its name and count load. Reserves 168px on a
 * phone and 136px from sm up, the measured height of the loaded header.
 * The 160px bar is where the employer's name lands; a name is never guessed
 * from the board token to fill it.
 */
export function HeaderSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-skeleton="header" className={cn("min-h-[168px] sm:min-h-[136px]", className)}>
      <Skeleton className="hidden h-3 w-48 sm:block" />
      <Skeleton className="mt-3 h-8 w-40" />
      <Skeleton className="mt-3 h-4 w-64 max-w-full" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-9" />
      </div>
    </div>
  );
}

/** The detail pane's footprint. */
export function PaneSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-skeleton="pane" className={cn("rounded-lg border border-border bg-card p-5", className)}>
      <Skeleton className="h-7 w-4/5" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-5 h-11 w-full" />
      <div className="mt-5 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
