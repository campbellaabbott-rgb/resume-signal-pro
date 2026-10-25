// Company intel on the lander: headcount (with its basis, scale band and the
// date it was true), this company's stated-salary median, and its top
// fields. Every clause renders only when its data exists — absent data shows
// nothing, never a guess.
//
// ONE READ, SHARED. get_company_intel answers the employer profile's pay
// summary, its hiring mix, the header's countries and, on a board name two
// hiring systems share, each board's open-role count. useCompanyIntel asks it
// once per token while a request is in flight and stamps the answer with the
// moment it arrived: the reader computes live, so that moment is the date
// basis every figure drawn from it prints.
//
// NO UNDATED HEADCOUNT (owner decision D11, 2026-10-11). company_profiles has
// no column saying when a count was true, so the headcount clause renders only
// through datedHeadcount, which needs a plain calendar date beside the count.
// Until the reader returns one (employees_as_of, from company_profiles.as_of,
// added by 20261012102000 and left null) the clause renders nothing.
//
// NO NET-NEW FIGURE. This strip printed "+N net-new roles this week" from
// get_company_intel.net_7d -- the difference of raw stored-row counts across a
// week of snapshots, with no read-quality, size or tenure gate -- right above
// the Hiring Health card, whose own growth line (get_company_growth) refuses
// to read a rate on exactly those boards: careers.orlandohealth.com showed
// "+52 net-new roles this week" beside "No posting rate yet: windowed read"
// (register L11-03). The board's growth reading lives in one place, the card,
// on the gates that make it a reading.

import { useEffect, useState } from "react";
import { Users, BadgeDollarSign, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { datedHeadcount } from "@/lib/headcount";
import { inflight } from "@/lib/company/inflight";

export interface CompanyIntel {
  employees: number | null;
  /** The day the count was true. Not returned by today's reader, so the count stays hidden. */
  employees_as_of?: string | null;
  employee_basis: string | null;
  yc_batch: string | null;
  median_usd_floor: number | null;
  usd_n: number | null;
  categories: Array<{ category: string; n: number }>;
  countries: Array<{ country: string; n: number }>;
  /** Still returned by the RPC; deliberately never rendered (see header). */
  net_7d: number | null;
  /** Open roles on THIS token per hiring system (20261012101000). */
  open_by_source?: Array<{ source: string; open_roles: number }>;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const rows = <T,>(v: unknown, ok: (r: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v) ? v.map((r) => (r && typeof r === "object" ? ok(r as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : [];

/** The reader's answer, or null when it is not one. Malformed rows are dropped, never zeroed. */
export function readCompanyIntel(data: unknown): CompanyIntel | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  return {
    employees: num(d.employees),
    employees_as_of: typeof d.employees_as_of === "string" ? d.employees_as_of : null,
    employee_basis: typeof d.employee_basis === "string" ? d.employee_basis : null,
    yc_batch: typeof d.yc_batch === "string" ? d.yc_batch : null,
    median_usd_floor: num(d.median_usd_floor),
    usd_n: num(d.usd_n),
    categories: rows(d.categories, (r) => (typeof r.category === "string" && num(r.n) !== null ? { category: r.category, n: num(r.n)! } : null)),
    countries: rows(d.countries, (r) => (typeof r.country === "string" && num(r.n) !== null ? { country: r.country, n: num(r.n)! } : null)),
    net_7d: num(d.net_7d),
    ...(Array.isArray(d.open_by_source)
      ? { open_by_source: rows(d.open_by_source, (r) => (typeof r.source === "string" && num(r.open_roles) !== null ? { source: r.source, open_roles: num(r.open_roles)! } : null)) }
      : {}),
  };
}

export interface CompanyIntelState {
  intel: CompanyIntel | null;
  loading: boolean;
  /** When the answer arrived: the date basis of every figure read from it. */
  readAt: string | null;
}

/** get_company_intel for one token, asked once while in flight. */
export function useCompanyIntel(companyToken: string | null | undefined, enabled = true): CompanyIntelState {
  const [state, setState] = useState<CompanyIntelState>({ intel: null, loading: !!companyToken && enabled, readAt: null });
  useEffect(() => {
    let cancelled = false;
    if (!companyToken || !enabled) { setState({ intel: null, loading: false, readAt: null }); return; }
    setState({ intel: null, loading: true, readAt: null });
    inflight(`get_company_intel:${companyToken}`, async () => {
      const { data, error } = await (supabase as unknown as {
        rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error?: unknown }>;
      }).rpc("get_company_intel", { p_token: companyToken });
      return error ? null : data;
    }).then((data) => {
      if (!cancelled) setState({ intel: readCompanyIntel(data), loading: false, readAt: new Date().toISOString() });
    }).catch(() => {
      if (!cancelled) setState({ intel: null, loading: false, readAt: null });
    });
    return () => { cancelled = true; };
  }, [companyToken, enabled]);
  return state;
}

export function CompanyIntelPanel({ companyToken }: { companyToken: string }) {
  const { t } = useTranslation();
  const { intel, loading } = useCompanyIntel(companyToken);

  // Shimmer during the fetch — the intel line otherwise pops in seconds late.
  if (loading && !intel) {
    return (
      <div className="flex items-center gap-3 mb-2" aria-hidden="true">
        <div className="h-3 w-44 rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-32 rounded bg-muted animate-pulse motion-reduce:animate-none hidden sm:block" />
      </div>
    );
  }
  if (!intel) return null;

  const head = datedHeadcount(intel);
  const band = head == null ? null
    : head.n >= 1000 ? t("jobsPage.intel.bandEnterprise", "enterprise")
    : head.n >= 100 ? t("jobsPage.intel.bandMid", "mid-market")
    : t("jobsPage.intel.bandSmall", "startup-size");

  const items: Array<{ icon: typeof Users; text: string }> = [];
  if (head) {
    items.push({
      icon: Users,
      text: `${t("jobsPage.intel.employees", "≈{{n}} employees ({{basis}}) · {{band}}", {
        n: head.n.toLocaleString(),
        basis: intel.employee_basis === "yc_self_reported"
          ? t("jobsPage.intel.basisYc", "YC profile")
          : t("jobsPage.intel.basisPr", "public records"),
        band,
      })} · ${t("jobsPage.intel.asOf", "as of {{date}}", { date: head.asOf })}`,
    });
  }
  if (intel.median_usd_floor != null && (intel.usd_n ?? 0) >= 10) {
    items.push({
      icon: BadgeDollarSign,
      text: t("jobsPage.intel.salary", "median stated salary floor ${{m}} ({{n}} USD postings)", {
        m: Math.round(intel.median_usd_floor).toLocaleString(), n: (intel.usd_n ?? 0).toLocaleString(),
      }),
    });
  }
  if ((intel.categories ?? []).length > 0) {
    items.push({
      icon: Layers,
      text: t("jobsPage.intel.fields", "hires mostly in {{fields}}", {
        fields: intel.categories.slice(0, 3)
          .map((c) => t(`jobsPage.categories.${c.category}`, c.category)).join(", "),
      }),
    });
  }
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-meta text-muted-foreground">
      {items.map(({ icon: Icon, text }) => (
        <span key={text} className="inline-flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
          {text}
        </span>
      ))}
    </div>
  );
}
