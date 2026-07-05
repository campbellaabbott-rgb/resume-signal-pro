// Role-level programmatic SEO (/roles/:slug), derived from the same live
// detection data as the industry pages. One page per recognized job title —
// "nurse resume keywords" etc. are higher-volume, lower-competition queries
// than industry-level terms. Capped at the first 3 titles per industry (the
// canonical ones lead each list) to keep pages substantive, not thin.

import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";

export interface RolePage {
  slug: string;
  title: string; // display-cased role name
  industry: string; // industry slug
}

export const slugifyRole = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const TITLES_PER_INDUSTRY = 3;

// Seniority-prefixed variants ("senior data engineer") and abbreviation pairs
// ("sales rep" beside "sales representative") would produce near-duplicate
// pages — Google treats those as thin content, which hurts the whole domain.
const SENIORITY_PREFIX = /^(senior|staff|lead|principal|junior|associate|assistant|entry.level)\s/i;

function buildRoles(): Record<string, RolePage> {
  const out: Record<string, RolePage> = {};
  for (const [industry, data] of Object.entries(INDUSTRY_KEYWORDS)) {
    const chosen: string[] = [];
    for (const raw of data.titles) {
      if (chosen.length >= TITLES_PER_INDUSTRY) break;
      if (SENIORITY_PREFIX.test(raw)) continue;
      const lower = raw.toLowerCase();
      if (chosen.some((c) => c.includes(lower) || lower.includes(c))) continue;
      const slug = slugifyRole(raw);
      if (!slug || out[slug]) continue; // first industry claiming a title wins
      chosen.push(lower);
      out[slug] = {
        slug,
        title: raw.replace(/\b\w/g, (c) => c.toUpperCase()),
        industry,
      };
    }
  }
  return out;
}


export const ROLE_PAGES: Record<string, RolePage> = buildRoles();

export const rolesForIndustry = (industry: string): RolePage[] =>
  Object.values(ROLE_PAGES).filter((r) => r.industry === industry);
