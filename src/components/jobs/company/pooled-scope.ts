// WHOSE ROLES THE COMPANY INTEL COUNTS: THIS PAGE'S, OR THE WHOLE HIRING
// SYSTEM'S.
//
// get_company_intel pools every career site an employer runs on one hiring
// system (a multi-site Workday tenant), so on one site's page its counts are
// the tenant's. PwC's US Experienced Careers page served 282 roles while the
// reader answered India 595, US 284, United Kingdom 110 and 285 USD postings
// (2026-11-15), and the same figures for PwC's Global page.
//
// S13-116 taught the Hiring mix to say so; the header's "Most roles in" and
// the Pay card's "median across N USD postings" still printed the tenant's
// figures as the page's own (S14X-195). Every surface now asks the one test
// below: when the reader's counts add up to more roles than the page serves,
// they are the employer's whole hiring system, and each says so.
//
// The test can only prove pooling, never rule it out: a count no larger than
// the page leaves today's wording, and a page whose figure is a floor
// ("10,000+") or has not arrived cannot be judged, so it leaves today's
// wording too.
import { createContext } from "react";
import type { CompanyIntel } from "@/components/jobs/CompanyIntelPanel";
import type { LanderModel } from "@/lib/company/lander-model";

/** Whose roles the intel counted: the employer's whole hiring system, possibly this page, or unjudged. */
export type IntelScope = "pooled" | "page" | null;

/** The smallest total the counts prove, and this page's own figure. */
export interface PooledTotal { atLeast: number; page: number }

/**
 * The counts cover more roles than the page serves: the largest of them is
 * the smallest total they prove, and above `page` they cannot be the page's.
 * Null when every count fits inside the page.
 */
export function pooledBeyondPage(counts: number[], page: number): PooledTotal | null {
  const atLeast = counts.reduce((m, n) => (Number.isFinite(n) && n > m ? n : m), 0);
  return atLeast > page ? { atLeast, page } : null;
}

/** The reader's own totals: roles placed in a country, roles in a field, postings stating USD pay. */
export function intelTotals(intel: CompanyIntel): { placed: number; inFields: number; usd: number } {
  const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return {
    placed: intel.countries.reduce((s, c) => s + pos(c.n), 0),
    inFields: intel.categories.reduce((s, c) => s + pos(c.n), 0),
    usd: pos(intel.usd_n ?? 0),
  };
}

/**
 * The page's own exact figure to judge against: none on a zero page, the
 * open-roles figure when it is exact, and null when it cannot be judged (a
 * floor, or no figure yet).
 */
export function pageFigure(model: Pick<LanderModel, "variant" | "openRoles">): number | null {
  if (model.variant === "zero") return 0;
  const o = model.openRoles;
  return o && !o.floor && Number.isFinite(o.value) && o.value >= 0 ? o.value : null;
}

/**
 * "pooled" when the intel's counts are the employer's whole hiring system,
 * "page" when they may be this page's, null with no intel or no figure to
 * judge them by (both of which keep today's wording).
 */
export function intelScope(intel: CompanyIntel | null | undefined, model: Pick<LanderModel, "variant" | "openRoles">): IntelScope {
  if (!intel) return null;
  const page = pageFigure(model);
  if (page === null) return null;
  const t = intelTotals(intel);
  return pooledBeyondPage([t.placed, t.inFields, t.usd], page) ? "pooled" : "page";
}

/**
 * The scope of the intel the About sections read, set by the company lander
 * around its rail and accordion (CompanyLander.tsx), so the Pay card can say
 * whose postings its median covers. Null outside a lander: today's wording.
 */
export const IntelScopeContext = createContext<IntelScope>(null);
