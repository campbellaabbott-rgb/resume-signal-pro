import { useMemo } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * A FILTER THE SERVER HAS ACCEPTED ALL ALONG AND THE PAGE COULD NOT EXPRESS.
 *
 * The board has unioned comma-joined fields since the unsorted bucket shipped —
 * measured live against the deployed function, science 7,420 + education 7,439
 * returns exactly 14,859 — and countries joined the same way after the split
 * landed. Both were reachable by anyone calling the API directly and by nobody
 * using the site, because the controls were single-value `<select>` elements.
 *
 * The value stays a COMMA-JOINED STRING rather than an array, which is not a
 * shortcut: it is what the URL carries, what the request body sends, what the
 * SQL splits, and what every downstream consumer of `applied.category` already
 * reads. Introducing an array here would mean a second shape to keep in step
 * with the first.
 *
 * THE CAP IS A MEASURED COST LIMIT, NOT A ROUND NUMBER, and it is enforced
 * where the visitor can see it rather than silently on the server: options past
 * the limit disable and say why, instead of being accepted and dropped.
 */
export type MultiOption = { value: string; label: string; count?: number };

export function MultiSelectFilter({
  value,
  onChange,
  options,
  allLabel,
  ariaLabel,
  title,
  max,
  atMaxNote,
  clearLabel,
  selectedLabel,
}: {
  /** Comma-joined selection, exactly as the URL and the request body carry it. */
  value: string;
  onChange: (next: string) => void;
  options: MultiOption[];
  /** Shown on the trigger when nothing is selected. */
  allLabel: string;
  ariaLabel: string;
  title?: string;
  max: number;
  /** Explains why further options are disabled. Rendered only at the cap. */
  atMaxNote: string;
  clearLabel: string;
  /** Trigger text for 2+ selections, already interpolated with the count. */
  selectedLabel: (n: number) => string;
}) {
  const selected = useMemo(
    () => value.split(",").map((v) => v.trim()).filter(Boolean),
    [value],
  );
  const atMax = selected.length >= max;

  const toggle = (v: string) => {
    const has = selected.includes(v);
    if (!has && selected.length >= max) return;
    const picked = has ? selected.filter((x) => x !== v) : [...selected, v];
    // CANONICAL ORDER = the options' own order, so one selection produces one
    // stored string whatever the click sequence. Pick-order stored "US,GB" and
    // "GB,US" as different values, which minted two saved-search NAMES for the
    // same query and slipped past the UNIQUE(user_id, name) guard — the hole
    // just closed for workMode/employmentType (see EMPLOYMENT_TYPE_KEYS). A
    // value not in `options` (a country rarer than the facet lists) keeps its
    // place at the end rather than being dropped, and the stored order is stable
    // so the chip and the URL do not churn.
    const rank = new Map(options.map((o, i) => [o.value, i]));
    picked.sort((a, b) => (rank.get(a) ?? options.length) - (rank.get(b) ?? options.length));
    onChange(picked.join(","));
  };

  const triggerText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : selectedLabel(selected.length);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          title={title}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <span className={selected.length ? "text-foreground" : "text-muted-foreground"}>{triggerText}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="max-h-72 overflow-y-auto py-1" role="group" aria-label={ariaLabel}>
          {options.map((o) => {
            const on = selected.includes(o.value);
            // Disabled only for ADDING past the cap — an already-chosen option
            // must always be removable, or the visitor is stuck at the limit.
            const blocked = !on && atMax;
            return (
              <button
                key={o.value}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={blocked}
                onClick={() => toggle(o.value)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                }`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                  {on && <Check className="h-3 w-3" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {typeof o.count === "number" && o.count > 0 && (
                  <span className="text-xs text-muted-foreground">{o.count.toLocaleString()}</span>
                )}
              </button>
            );
          })}
        </div>
        {atMax && (
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground" role="status">
            {atMaxNote}
          </p>
        )}
        {selected.length > 0 && (
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={() => onChange("")}
              className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
            >
              {clearLabel}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
