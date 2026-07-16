// "How we measure" — the collapsible methodology panel on each public data
// page. Native <details> (accessible, zero JS) listing, per page, exactly how
// each published number is computed and what is excluded. The accuracy work
// only builds trust if readers can SEE the method — this is the visible half
// of the measured-not-guessed contract.
import { ChevronRight } from "lucide-react";

export function HowWeMeasure({ items }: { items: Array<{ term: string; method: string }> }) {
  return (
    <details className="group rounded-2xl border border-border bg-card/60 px-5 py-4 mb-8">
      <summary className="flex items-center gap-2 cursor-pointer select-none text-sm font-semibold text-foreground list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-4 h-4 text-primary transition-transform group-open:rotate-90" />
        How we measure — every number's basis, and what we exclude
      </summary>
      <dl className="mt-3 space-y-3">
        {items.map((it) => (
          <div key={it.term}>
            <dt className="text-[13px] font-semibold text-foreground">{it.term}</dt>
            <dd className="text-xs text-muted-foreground leading-relaxed">{it.method}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
