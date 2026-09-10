import { useMemo, useRef } from "react";
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
export type MultiOption = { value: string; label: string; count?: number; capped?: boolean };

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
  note,
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
  /** THE BASIS FOR THE NUMBERS, stated once, under the rows that print them.
   *  A count beside a name is a claim about the board; the sentence that says
   *  which board, under which rule, as of when, belongs where the count is
   *  read — not in a tooltip on the trigger. Omit it when the options carry
   *  no counts: a basis line over no numbers is a sentence about nothing. */
  note?: string;
}) {
  const selected = useMemo(
    () => value.split(",").map((v) => v.trim()).filter(Boolean),
    [value],
  );
  const atMax = selected.length >= max;
  // WHERE FOCUS LANDS ON OPEN. Radix moves focus to the first tabbable thing
  // inside the content, which is the first row — and the global focus ring
  // (2px outline, 2px offset) drawn around a row inside a list that scrolls
  // is clipped on both sides by that overflow, leaving two bars above and
  // below the row and, on this theme, no visible box beside them. Focus goes
  // to the list itself instead: still inside the menu, so Tab reaches every
  // row and Escape closes it, but no row is pre-selected by a ring.
  const listRef = useRef<HTMLDivElement>(null);

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
      <PopoverContent
        align="start"
        className="w-64 p-0"
        onOpenAutoFocus={(e) => { e.preventDefault(); listRef.current?.focus(); }}
      >
        <div ref={listRef} tabIndex={-1} className="max-h-72 overflow-y-auto py-1 focus:outline-none" role="group" aria-label={ariaLabel}>
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
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm focus-visible:outline-offset-[-2px] ${
                  blocked ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                }`}
              >
                {/* The unselected box borders in the muted-foreground token at
                    70%, not the border token: --border is 14% lightness on a
                    9% popover surface and the box could not be seen at all on
                    the dark theme. The selected rendering is unchanged. */}
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/70"}`}>
                  {on && <Check className="h-3 w-3" aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {typeof o.count === "number" && o.count > 0 && (
                  <span className="text-xs text-muted-foreground">{o.count.toLocaleString()}{o.capped ? "+" : ""}</span>
                )}
              </button>
            );
          })}
        </div>
        {note && (
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground" data-testid="multi-select-note">
            {note}
          </p>
        )}
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
