import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/chip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { count as fmtCount } from "@/lib/format";
import type { FilterBarValue, FilterOption } from "@/components/jobs/FilterBar";

/**
 * EVERY FILTER BEHIND ONE BUTTON. A bottom sheet on a phone, a right sheet
 * from sm up. Each group is a fieldset with a legend, each option a toggle
 * button with aria-pressed; a change applies at once (the board refetches),
 * so "Done" only closes the sheet.
 *
 * Work mode is trinary or nothing: remote, hybrid, on-site, and no fourth
 * option for "not stated" — a filter cannot select what the employer did not
 * say.
 *
 * A count beside an option prints only when the caller passes one the list
 * response measured; nothing here estimates one.
 */
export interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: FilterBarValue;
  onChange: (patch: Partial<FilterBarValue>) => void;
  onClearAll: () => void;
  options: {
    fields: FilterOption[];
    seniority: FilterOption[];
    systems: FilterOption[];
    countries: FilterOption[];
  };
  side?: "right" | "bottom";
}

export const FRESHNESS_VALUES = ["", "1", "3", "7", "14", "30"] as const;
export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;

const WORK_MODE_FALLBACK: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const EMPLOYMENT_FALLBACK: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  temporary: "Temp",
  internship: "Internship",
};

export const listOf = (csv: string): string[] => String(csv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const toggleIn = (csv: string, v: string): string => {
  const set = listOf(csv);
  return (set.includes(v) ? set.filter((x) => x !== v) : [...set, v]).join(",");
};

export function useFreshnessLabel() {
  const { t } = useTranslation();
  return (v: string): string => {
    switch (v) {
      case "1": return t("jobsPage.freshDay", "Today");
      case "3": return t("jobsPage.fresh3", "Last 3 days");
      case "7": return t("jobsPage.freshWeek", "This week");
      case "14": return t("jobsPage.fresh14", "Last 2 weeks");
      case "30": return t("jobsPage.fresh30", "Last 30 days");
      default: return t("jobsPage.freshAll", "Any date");
    }
  };
}

export function useWorkModeLabel() {
  const { t } = useTranslation();
  return (v: string) => t(`jobsPage.workMode.${v}`, WORK_MODE_FALLBACK[v] ?? v);
}

export function useEmploymentLabel() {
  const { t } = useTranslation();
  return (v: string) => t(`jobsPage.employmentType.${v}`, EMPLOYMENT_FALLBACK[v] ?? v);
}

function Group({ legend, children, hint }: { legend: string; children: ReactNode; hint?: string }) {
  return (
    <fieldset className="border-b border-border py-4 first:pt-0 last:border-b-0">
      <legend className="mb-2 text-sm font-semibold text-foreground">{legend}</legend>
      {hint ? <p className="-mt-1 mb-2 text-xs text-subtle-foreground">{hint}</p> : null}
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export function FilterSheet({ open, onOpenChange, value, onChange, onClearAll, options, side = "right" }: FilterSheetProps) {
  const { t, i18n } = useTranslation();
  const freshLabel = useFreshnessLabel();
  const modeLabel = useWorkModeLabel();
  const typeLabel = useEmploymentLabel();
  const n = (c?: number) => (typeof c === "number" && Number.isFinite(c) ? fmtCount(c, { lng: i18n.language }) : undefined);

  const multi = (field: "category" | "experience" | "vendor" | "country" | "workMode" | "employmentType", opts: FilterOption[]) =>
    opts.map((o) => (
      <FilterChip
        key={o.value}
        pressed={listOf(value[field]).includes(o.value)}
        count={n(o.count)}
        onClick={() => onChange({ [field]: toggleIn(value[field], o.value) } as Partial<FilterBarValue>)}
      >
        {o.label}
      </FilterChip>
    ));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        title={t("filterBar.sheetTitle", "Filters")}
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={onClearAll}>{t("filterBar.clearAll", "Clear all filters")}</Button>
            <Button onClick={() => onOpenChange(false)}>{t("filterBar.done", "Done")}</Button>
          </div>
        }
      >
        <Group legend={t("filterBar.postedWithin", "Posted within")} hint={t("jobsPage.freshHint", "Counts company-stated posting dates only")}>
          {FRESHNESS_VALUES.map((v) => (
            <FilterChip key={v || "any"} pressed={value.freshness === v} onClick={() => onChange({ freshness: v })}>
              {freshLabel(v)}
            </FilterChip>
          ))}
        </Group>
        {options.fields.length ? <Group legend={t("filterBar.field", "Field")}>{multi("category", options.fields)}</Group> : null}
        <Group legend={t("jobsPage.workMode.label", "Work mode")}>
          {multi("workMode", WORK_MODES.map((m) => ({ value: m, label: modeLabel(m) })))}
        </Group>
        <Group legend={t("jobsPage.employmentType.label", "Employment type")}>
          {multi("employmentType", EMPLOYMENT_TYPES.map((m) => ({ value: m, label: typeLabel(m) })))}
        </Group>
        {options.seniority.length ? <Group legend={t("filterBar.seniority", "Seniority")}>{multi("experience", options.seniority)}</Group> : null}
        <Group legend={t("filterBar.payStated", "Pay stated")}>
          <FilterChip pressed={value.statedPayOnly} onClick={() => onChange({ statedPayOnly: !value.statedPayOnly })}>
            {t("filterBar.payStatedOnly", "Only postings that state pay")}
          </FilterChip>
        </Group>
        {options.systems.length ? <Group legend={t("filterBar.hiringSystem", "Hiring system")}>{multi("vendor", options.systems)}</Group> : null}
        {options.countries.length ? <Group legend={t("filterBar.country", "Country")}>{multi("country", options.countries)}</Group> : null}
        <Group legend={t("filterBar.agencies", "Staffing agencies")}>
          <FilterChip pressed={value.hideAgencies} onClick={() => onChange({ hideAgencies: !value.hideAgencies })}>
            {t("jobsPage.hideAgencies", "Hide staffing agencies")}
          </FilterChip>
        </Group>
      </SheetContent>
    </Sheet>
  );
}
