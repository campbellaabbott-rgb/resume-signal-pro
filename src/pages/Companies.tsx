// /companies — the human half of the directory. The crawler half is a
// prerendered A–Z page (prerender-seo.mjs) linking every company page, built
// because 387 of them sat in the sitemap linked from no page at all. This
// React page takes over after hydration: the board's live top employers plus
// the full count, each linking into the board filtered to that employer.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

interface CompanyChip { token: string; name: string; count: number }

export default function Companies() {
  const [companies, setCompanies] = useState<CompanyChip[]>([]);
  const [totalCompanies, setTotalCompanies] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.functions
      .invoke("job-board", { body: { action: "list", limit: 1, includeFacets: true } })
      .then(({ data }) => {
        if (cancelled) return;
        const d = data as { companies?: CompanyChip[]; companiesCount?: number } | null;
        if (Array.isArray(d?.companies)) setCompanies(d.companies.filter((c) => c?.token && c?.name));
        if (typeof d?.companiesCount === "number" && d.companiesCount > 0) setTotalCompanies(d.companiesCount);
      })
      .catch(() => { /* the count-free copy below stands */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <SEO
        title="Companies Hiring Now — Verified Job Boards"
        description="Every employer on the board pulls straight from its own official career system and is re-verified all day. Browse the largest, or search the live board."
        path="/companies"
      />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-4xl">
          <h1 className="text-3xl font-bold mb-3">
            {totalCompanies ? `${totalCompanies.toLocaleString()} companies hiring now` : "Companies hiring now"}
          </h1>
          <p className="text-muted-foreground mb-8">
            Every posting comes from the employer's own hiring system — no aggregators, no reposts.
            The largest boards are below;{" "}
            <Link to="/jobs" className="text-primary underline">search the live board</Link>{" "}
            to filter any employer by role, pay, or location.
          </p>
          {companies.length > 0 && (
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 text-sm">
              {companies.map((c) => (
                <li key={c.token}>
                  <Link to={`/jobs?company=${encodeURIComponent(c.token)}`} className="text-primary hover:underline">
                    {c.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">— {c.count.toLocaleString()} openings</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
