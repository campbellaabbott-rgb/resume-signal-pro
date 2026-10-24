import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { MapPin, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RemovableChip } from "@/components/ui/chip";
import { SearchField } from "@/components/ui/input";
import { count as fmtCount } from "@/lib/format";
import type { OpenRolesValue } from "@/components/jobs/contracts";
import {
  FilterSheet,
  listOf,
  useEmploymentLabel,
  useFreshnessLabel,
  useWorkModeLabel,
} from "@/components/jobs/FilterSheet";

/**
 * THE BOARD'S ONE FILTER ROW: keyword, location, a "Filters (n)" button and
 * the sort. On a phone the keyword takes its own row and location sits beside
 * the Filters button. Every active filter shows as a chip the visitor can
 * remove, named for what it removes ("Remove filter: Remote").
 *
 * THE COMPANY VARIANT CANNOT FILTER THE COMPANY OFF ITS OWN PAGE. On
 * /jobs/company/<token> the token IS the page's scope: there is no Company
 * control, no company chip, and "Clear all filters" leaves the scope where it
 * is. The audit found the lander's company box reading "CLEAR - Corporat"
 * under an H1 that said "Clear", and a "Remove Blackstone" button on a page
 * whose only reason to exist is Blackstone.
 *
 * A field of BoardFilterState (src/pages/Jobs.tsx) for every control here; the
 * page passes its state in and applies each patch.
 *
 * FOCUS NEVER FALLS TO THE TOP OF THE PAGE (WCAG 2.4.3). Removing a chip, or
 * pressing "Clear all filters", unmounts the button that held focus, and the
 * browser sent focus to <body>. Focus now moves to the chip that took the
 * removed one's place (else the one before it), and after the last chip or
 * "Clear all" to the Filters button.
 *
 * The company variant's row wraps: keyword on a row of its own, then
 * location, Filters and the sort. In the lander's left column (about 560px at
 * 1024) the single row left the location box 50px wide with its placeholder
 * gone, and its label is for screen readers only.
 */
export interface FilterBarValue {
  q: string;
  location: string;
  /** Comma-joined remote|hybrid|onsite; "" = any. */
  workMode: string;
  /** Comma-joined employment types; "" = any. */
  employmentType: string;
  /** Freshness window in days, as the URL carries it; "" = any date. */
  freshness: string;
  /** Comma-joined field slugs. */
  category: string;
  /** Comma-joined experience bands. */
  experience: string;
  statedPayOnly: boolean;
  /** Comma-joined hiring-system keys. */
  vendor: string;
  /** Comma-joined ISO-2 codes. */
  country: string;
  hideAgencies: boolean;
  companyTokens: string[];
}

export interface FilterOption {
  value: string;
  label: string;
  /** A narrowing count the list response measured. Never an estimate. */
  count?: number;
}

export interface FilterBarProps {
  variant: "board" | "company";
  value: FilterBarValue;
  onChange: (patch: Partial<FilterBarValue>) => void;
  options: {
    fields: FilterOption[];
    seniority: FilterOption[];
    systems: FilterOption[];
    countries: FilterOption[];
  };
  /** Board variant: the names to print on company chips, by token. */
  companyLabels?: Record<string, string>;
  /** Company variant: whose page this is. A generic board label is passed with generic: true. */
  company?: { name: string; generic?: boolean; openRoles?: OpenRolesValue | null };
  sort?: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void };
  /** Called when the visitor submits the keyword or location (Enter). */
  onSubmit?: () => void;
  className?: string;
}

export interface ActiveChip {
  key: string;
  label: string;
  remove: Partial<FilterBarValue>;
}

/**
 * The chips a value shows. Pure, so the company rule can be tested without a
 * render: the company variant never yields a company chip.
 */
export function activeChips(
  value: FilterBarValue,
  variant: FilterBarProps["variant"],
  labels: {
    freshness: (v: string) => string;
    workMode: (v: string) => string;
    employment: (v: string) => string;
    option: (group: "fields" | "seniority" | "systems" | "countries", v: string) => string;
    payStated: string;
    hideAgencies: string;
    company: (token: string) => string;
  },
): ActiveChip[] {
  const out: ActiveChip[] = [];
  const multi = (field: "workMode" | "employmentType" | "category" | "experience" | "vendor" | "country", label: (v: string) => string) => {
    const vals = listOf(value[field]);
    for (const v of vals) {
      out.push({ key: `${field}:${v}`, label: label(v), remove: { [field]: vals.filter((x) => x !== v).join(",") } as Partial<FilterBarValue> });
    }
  };
  if (value.freshness) out.push({ key: "freshness", label: labels.freshness(value.freshness), remove: { freshness: "" } });
  multi("category", (v) => labels.option("fields", v));
  multi("workMode", labels.workMode);
  multi("employmentType", labels.employment);
  multi("experience", (v) => labels.option("seniority", v));
  if (value.statedPayOnly) out.push({ key: "statedPayOnly", label: labels.payStated, remove: { statedPayOnly: false } });
  multi("vendor", (v) => labels.option("systems", v));
  multi("country", (v) => labels.option("countries", v));
  if (value.hideAgencies) out.push({ key: "hideAgencies", label: labels.hideAgencies, remove: { hideAgencies: false } });
  if (variant === "board") {
    for (const tok of value.companyTokens) {
      out.push({ key: `company:${tok}`, label: labels.company(tok), remove: { companyTokens: value.companyTokens.filter((x) => x !== tok) } });
    }
  }
  return out;
}

/** The patch "Clear all filters" applies. The company variant keeps its scope. */
export function clearAllPatch(variant: FilterBarProps["variant"]): Partial<FilterBarValue> {
  const patch: Partial<FilterBarValue> = {
    location: "",
    workMode: "",
    employmentType: "",
    freshness: "",
    category: "",
    experience: "",
    statedPayOnly: false,
    vendor: "",
    country: "",
    hideAgencies: false,
  };
  if (variant === "board") patch.companyTokens = [];
  return patch;
}

function useIsSmUp(): boolean {
  const query = "(min-width: 640px)";
  const [up, setUp] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setUp(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return up;
}

export function FilterBar({ variant, value, onChange, options, companyLabels, company, sort, onSubmit, className }: FilterBarProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const smUp = useIsSmUp();
  const freshness = useFreshnessLabel();
  const workMode = useWorkModeLabel();
  const employment = useEmploymentLabel();

  const optionLabel = (group: "fields" | "seniority" | "systems" | "countries", v: string) =>
    options[group].find((o) => o.value === v)?.label ?? v;

  const chips = activeChips(value, variant, {
    freshness,
    workMode,
    employment,
    option: optionLabel,
    payStated: t("filterBar.payStatedChip", "States pay"),
    hideAgencies: t("filterBar.agenciesHiddenChip", "No staffing agencies"),
    company: (tok) => companyLabels?.[tok] ?? tok,
  });

  const lng = i18n.language;
  let keywordPlaceholder = t("filterBar.keywordPlaceholder", "Title or keyword");
  if (variant === "company" && company?.name && !company.generic) {
    const roles = company.openRoles;
    keywordPlaceholder = roles && roles.value > 0
      ? t("filterBar.companyKeywordPlaceholder", {
          count: roles.value,
          n: fmtCount(roles.value, { lng, floor: roles.floor }),
          name: company.name,
          defaultValue: "Search {{n}} roles at {{name}}",
        })
      : t("filterBar.companyKeywordPlaceholderNoCount", { name: company.name, defaultValue: "Search roles at {{name}}" });
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };

  // Where focus goes once the chip row re-renders: a chip's index, or the Filters button.
  const filtersRef = useRef<HTMLButtonElement | null>(null);
  const chipsRef = useRef<HTMLUListElement | null>(null);
  const pendingFocus = useRef<number | "filters" | null>(null);
  const chipKeys = chips.map((c) => c.key).join("|");
  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (want === null) return;
    pendingFocus.current = null;
    // Only where focus was lost with the removed button: never pull it away from wherever the reader went since.
    const active = typeof document !== "undefined" ? document.activeElement : null;
    if (active && active !== document.body && active.isConnected) return;
    const removers = Array.from(chipsRef.current?.querySelectorAll<HTMLButtonElement>("[data-chip-remove]") ?? []);
    const target = want === "filters" || removers.length === 0
      ? filtersRef.current
      : removers[Math.min(want, removers.length - 1)];
    target?.focus();
  }, [chipKeys]);
  const removeChip = (index: number, patch: Partial<FilterBarValue>) => {
    pendingFocus.current = index;
    onChange(patch);
  };
  const clearAll = () => {
    pendingFocus.current = "filters";
    onChange(clearAllPatch(variant));
  };

  const filtersButton = (
    <Button
      ref={filtersRef}
      type="button"
      variant="secondary"
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      className="shrink-0"
    >
      <SlidersHorizontal aria-hidden="true" />
      {chips.length
        ? t("filterBar.filtersCount", { n: fmtCount(chips.length, { lng }), defaultValue: "Filters ({{n}})" })
        : t("filterBar.filters", "Filters")}
    </Button>
  );

  return (
    <div className={cn("space-y-2", className)} data-filter-bar={variant}>
      <form role="search" onSubmit={submit} className={cn("flex flex-col gap-2 sm:flex-row sm:items-end", variant === "company" && "sm:flex-wrap")}>
        <SearchField
          label={t("filterBar.keywordLabel", "Search jobs by title or keyword")}
          placeholder={keywordPlaceholder}
          value={value.q}
          onChange={(e) => onChange({ q: e.target.value })}
          wrapperClassName={variant === "company" ? "sm:basis-full" : "sm:flex-[2]"}
          enterKeyHint="search"
        />
        <div className={cn("flex gap-2 sm:flex-1", variant === "company" && "sm:min-w-[12rem]")}>
          <SearchField
            label={t("filterBar.locationLabel", "Location")}
            placeholder={t("filterBar.locationPlaceholder", "City, region or country")}
            icon={<MapPin />}
            value={value.location}
            onChange={(e) => onChange({ location: e.target.value })}
            wrapperClassName="min-w-0 flex-1"
          />
          {filtersButton}
        </div>
        {sort ? (
          <div className="sm:w-48">
            <label htmlFor="filter-bar-sort" className="sr-only">{t("jobsPage.sortLabel", "Sort")}</label>
            <select
              id="filter-bar-sort"
              value={sort.value}
              onChange={(e) => sort.onChange(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sort.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ) : null}
        {/* Enter submits; the button is for completeness, hidden visually and
            out of the Tab order (a Tab stop on a 1px box is focus nobody can see). */}
        <button type="submit" className="sr-only" tabIndex={-1}>{t("filterBar.search", "Search")}</button>
      </form>

      {chips.length ? (
        <ul ref={chipsRef} className="flex flex-wrap items-center gap-2" aria-label={t("filterBar.activeFilters", "Active filters")}>
          {chips.map((c, i) => (
            <li key={c.key} className="max-w-full">
              <RemovableChip
                label={c.label}
                removeLabel={t("filterBar.removeFilter", { label: c.label, defaultValue: "Remove filter: {{label}}" })}
                onRemove={() => removeChip(i, c.remove)}
              />
            </li>
          ))}
          <li>
            <Button variant="link" size="sm" onClick={clearAll}>
              {t("filterBar.clearAll", "Clear all filters")}
            </Button>
          </li>
        </ul>
      ) : null}

      <FilterSheet
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={onChange}
        onClearAll={() => onChange(clearAllPatch(variant))}
        options={options}
        side={smUp ? "right" : "bottom"}
      />
    </div>
  );
}
