// Company intel strip on the lander: verified headcount (with its basis and
// scale band), 7-day net-new trend from the daily snapshots, this company's
// stated-salary median, and its top fields. Every clause renders only when
// its data exists — absent data shows nothing, never a guess.

import { useEffect, useState } from "react";
import { Users, TrendingUp, BadgeDollarSign, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

interface Intel {
  employees: number | null;
  employee_basis: string | null;
  yc_batch: string | null;
  median_usd_floor: number | null;
  usd_n: number | null;
  categories: Array<{ category: string; n: number }>;
  countries: Array<{ country: string; n: number }>;
  net_7d: number | null;
}

export function CompanyIntelPanel({ companyToken }: { companyToken: string }) {
  const { t } = useTranslation();
  const [intel, setIntel] = useState<Intel | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as unknown as {
          rpc: (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown }>;
        }).rpc("get_company_intel", { p_token: companyToken });
        if (!cancelled && data && typeof data === "object") setIntel(data as Intel);
      } catch { /* intel is additive; the lander stands without it */ }
    })();
    return () => { cancelled = true; };
  }, [companyToken]);

  if (!intel) return null;

  const band = intel.employees == null ? null
    : intel.employees >= 1000 ? t("jobsPage.intel.bandEnterprise", "enterprise")
    : intel.employees >= 100 ? t("jobsPage.intel.bandMid", "mid-market")
    : t("jobsPage.intel.bandSmall", "startup-size");

  const items: Array<{ icon: typeof Users; text: string }> = [];
  if (intel.employees != null) {
    items.push({
      icon: Users,
      text: t("jobsPage.intel.employees", "≈{{n}} employees ({{basis}}) · {{band}}", {
        n: intel.employees.toLocaleString(),
        basis: intel.employee_basis === "yc_self_reported"
          ? t("jobsPage.intel.basisYc", "YC profile")
          : t("jobsPage.intel.basisPr", "public records"),
        band,
      }),
    });
  }
  if (intel.net_7d != null && intel.net_7d > 0) {
    items.push({ icon: TrendingUp, text: t("jobsPage.intel.net7d", "+{{n}} net-new roles this week", { n: intel.net_7d }) });
  }
  if (intel.median_usd_floor != null && (intel.usd_n ?? 0) >= 10) {
    items.push({
      icon: BadgeDollarSign,
      text: t("jobsPage.intel.salary", "median stated salary floor ${{m}} ({{n}} USD postings)", {
        m: Math.round(intel.median_usd_floor).toLocaleString(), n: intel.usd_n,
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-[12px] text-muted-foreground">
      {items.map(({ icon: Icon, text }) => (
        <span key={text} className="inline-flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
          {text}
        </span>
      ))}
    </div>
  );
}
