// Internal claim-review dashboard (/admin/claims) — the owner approves or
// rejects company-profile claims here instead of flipping status by SQL.
// Same access model as /analytics and /errors: AdminAuthGate stores the
// ADMIN_API_KEY once per browser session; the edge function enforces it via
// the x-admin-key header. EN-only like the other internal dashboards, and
// deliberately absent from the sitemap/prerender.
//
// Review rules recap: email_confirmed = claimant clicked the verification
// link but their email domain didn't obviously match the company — the whole
// reason this page exists. pending = link not clicked yet (usually just
// waiting; approving one manually is possible but defeats the email check).

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Building2, Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { AdminAuthGate } from "@/components/dashboard/AdminAuthGate";
import { adminAuthHeaders } from "@/lib/admin-auth";
import { supabase } from "@/integrations/supabase/client";

interface Claim {
  id: string;
  company_token: string;
  company_name: string | null;
  work_email: string;
  contact_name: string | null;
  website: string | null;
  domain_match: boolean;
  status: "pending" | "email_confirmed" | "verified" | "rejected";
  created_at: string;
  verified_at: string | null;
}

const STATUS_STYLE: Record<Claim["status"], string> = {
  email_confirmed: "bg-warning/10 text-warning border-warning/30",
  pending: "bg-muted text-muted-foreground border-border",
  verified: "bg-success/10 text-success border-success/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
};

const STATUS_LABEL: Record<Claim["status"], string> = {
  email_confirmed: "Email confirmed — needs review",
  pending: "Awaiting email click",
  verified: "Verified",
  rejected: "Rejected",
};

// Review-first ordering: actionable rows before settled ones.
const STATUS_ORDER: Claim["status"][] = ["email_confirmed", "pending", "verified", "rejected"];

function ClaimsDashboard() {
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("company-claim", {
      body: { action: "admin-list" },
      headers: adminAuthHeaders(),
    });
    if (error || data?.error) {
      toast.error(String(data?.error ?? "Could not load claims — is the admin key right?"));
      setClaims([]);
      return;
    }
    setClaims((data?.claims ?? []) as Claim[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = async (claim: Claim, decision: "verified" | "rejected") => {
    if (deciding) return;
    setDeciding(claim.id);
    try {
      const { data, error } = await supabase.functions.invoke("company-claim", {
        body: { action: "admin-decide", id: claim.id, decision },
        headers: adminAuthHeaders(),
      });
      if (error || data?.error) {
        toast.error(String(data?.error ?? "Decision failed."));
        return;
      }
      toast.success(
        decision === "verified"
          ? `${claim.company_name ?? claim.company_token} verified — the claimant was emailed.`
          : `Claim from ${claim.work_email} rejected.`,
      );
      await load();
    } finally {
      setDeciding(null);
    }
  };

  const sorted = [...(claims ?? [])].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || (a.created_at < b.created_at ? 1 : -1),
  );
  const needsReview = sorted.filter((c) => c.status === "email_confirmed").length;

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" /> Company claims
        </h1>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {claims === null
          ? "Loading…"
          : needsReview > 0
          ? `${needsReview} claim${needsReview === 1 ? "" : "s"} waiting on your review.`
          : "Nothing needs review. Domain-matching claims verify themselves; only mismatches land here."}
      </p>

      {claims !== null && sorted.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
          No claims yet. The claim CTA lives on every company lander.
        </div>
      )}

      <div className="space-y-3">
        {sorted.map((claim) => (
          <div key={claim.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <Link
                    to={`/jobs/company/${claim.company_token}`}
                    className="font-semibold hover:text-primary inline-flex items-center gap-1"
                  >
                    {claim.company_name ?? claim.company_token}
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                  </Link>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[claim.status]}`}>
                    {STATUS_LABEL[claim.status]}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${claim.domain_match ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}`}>
                    {claim.domain_match ? "domain matches" : "domain mismatch"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground break-all">
                  {claim.work_email}
                  {claim.contact_name ? ` · ${claim.contact_name}` : ""}
                  {claim.website ? ` · ${claim.website}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Requested {new Date(claim.created_at).toLocaleString()}
                  {claim.verified_at ? ` · verified ${new Date(claim.verified_at).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {claim.status !== "verified" && (
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => void decide(claim, "verified")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-success/15 border border-success/30 text-success text-sm font-medium px-3 py-1.5 hover:bg-success/25 disabled:opacity-50"
                  >
                    {deciding === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Approve
                  </button>
                )}
                {claim.status !== "rejected" && (
                  <button
                    type="button"
                    disabled={deciding !== null}
                    onClick={() => void decide(claim, "rejected")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm font-medium px-3 py-1.5 hover:bg-destructive/20 disabled:opacity-50"
                  >
                    {deciding === claim.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                    {claim.status === "verified" ? "Revoke" : "Reject"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground mt-6 flex items-center gap-1.5">
        <BadgeCheck className="w-3.5 h-3.5" />
        Approving emails the claimant and shows the Verified employer badge on their lander. Rejections are silent. Neither ever changes hiring data.
      </p>
    </div>
  );
}

export default function AdminClaims() {
  return (
    <>
      <SEO title="Company claims — admin" description="Internal claim review." path="/admin/claims" noIndex />
      <Header />
      <main className="min-h-screen pt-20">
        <AdminAuthGate>
          <ClaimsDashboard />
        </AdminAuthGate>
      </main>
      <Footer />
    </>
  );
}
