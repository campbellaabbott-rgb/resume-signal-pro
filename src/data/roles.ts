// Role-level programmatic SEO (/roles/:slug), derived from the same live
// detection data as the industry pages. One page per recognized job title —
// "nurse resume keywords" etc. are higher-volume, lower-competition queries
// than industry-level terms. Capped at the first 3 titles per industry (the
// canonical ones lead each list) to keep pages substantive, not thin.

import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { displayTitle } from "../lib/seo/display-case";

export interface RolePage {
  slug: string;
  title: string; // display-cased role name
  industry: string; // industry slug
  /**
   * Set when this page's title is another role page's title written shorter
   * or spelled another way, in the same field ("vet tech" beside "veterinary
   * technician"): the slug of the page it defers to. Every role page prints
   * its field's lists, so two spellings of one name are one page of text; the
   * deferring page keeps its address and names this one as canonical
   * (SEO check 2026-11-15, F06).
   */
  canonicalSlug?: string;
}

export const slugifyRole = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const TITLES_PER_INDUSTRY = 3;

// Seniority-prefixed variants ("senior data engineer") and abbreviation pairs
// ("sales rep" beside "sales representative") would produce near-duplicate
// pages — Google treats those as thin content, which hurts the whole domain.
const SENIORITY_PREFIX = /^(senior|staff|lead|principal|junior|associate|assistant|entry.level)\s/i;

const nameWords = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
const nameLetters = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * True when `short`, word by word, is `long` written shorter: each word is the
 * same word, the start of it (three letters or more: "vet" for "veterinary",
 * "lab" for "laboratory"), or the initials of a run of its words ("rn" for
 * "registered nurse", "ml" for "machine learning"), with at least one word
 * actually shortened.
 */
function shortens(short: string[], long: string[], i = 0, j = 0, cut = false): boolean {
  if (i === short.length) return j === long.length && cut;
  const w = short[i];
  if (j < long.length) {
    if (w === long[j] && shortens(short, long, i + 1, j + 1, cut)) return true;
    if (w.length >= 3 && w.length < long[j].length && long[j].startsWith(w) && shortens(short, long, i + 1, j + 1, true)) return true;
  }
  if (w.length >= 2 && j + w.length <= long.length) {
    const initials = long.slice(j, j + w.length).map((x) => x[0]).join("");
    if (initials === w && shortens(short, long, i + 1, j + w.length, true)) return true;
  }
  return false;
}

/**
 * Whether two job titles are one name: the same letters ("ecommerce manager",
 * "e-commerce manager"), the same words in another order ("project manager
 * construction"), or one written shorter than the other ("vet tech", "RN",
 * "ML engineer", "HR manager"). Two different roles are two names even where
 * the field prints the same lists for both: "plumber" and "HVAC technician",
 * "software engineer" and "software developer", "captain" and "ship captain".
 */
export function sameRoleName(a: string, b: string): boolean {
  if (nameLetters(a) === nameLetters(b)) return true;
  const wa = nameWords(a);
  const wb = nameWords(b);
  if ([...wa].sort().join(" ") === [...wb].sort().join(" ")) return true;
  return shortens(wa, wb) || shortens(wb, wa);
}

/**
 * Of the spellings of one name, the page the others defer to: the fullest
 * spelling (most letters: "veterinary technician" over "vet tech"); between
 * two of one length, the one that does not end in its field's own word (the
 * tables write "project manager construction" with the field as a trailing
 * tag, which is not how anyone writes the title); then the one the field's
 * table lists first.
 */
function fullestSpelling(group: RolePage[], titleOrder: (p: RolePage) => number): RolePage {
  const tagged = (p: RolePage) => {
    const words = nameWords(p.title);
    const last = words[words.length - 1] ?? "";
    return p.industry.split("_").includes(last) ? 1 : 0;
  };
  return [...group].sort(
    (x, y) => nameLetters(y.title).length - nameLetters(x.title).length || tagged(x) - tagged(y) || titleOrder(x) - titleOrder(y),
  )[0];
}

function buildRoles(): Record<string, RolePage> {
  const out: Record<string, RolePage> = {};
  for (const [industry, data] of Object.entries(INDUSTRY_KEYWORDS)) {
    const chosen: string[] = [];
    const pages: { page: RolePage; raw: string; at: number }[] = [];
    for (const [at, raw] of data.titles.entries()) {
      if (chosen.length >= TITLES_PER_INDUSTRY) break;
      if (SENIORITY_PREFIX.test(raw)) continue;
      const lower = raw.toLowerCase();
      if (chosen.some((c) => c.includes(lower) || lower.includes(c))) continue;
      const slug = slugifyRole(raw);
      if (!slug || out[slug]) continue; // first industry claiming a title wins
      chosen.push(lower);
      out[slug] = {
        slug,
        // Acronyms stay acronyms: "RN", "CPA", "VP of Product", "UI Designer"
        // — it upper-cased every word's first letter ("Rn", "Vp Of Product").
        title: displayTitle(raw),
        industry,
      };
      pages.push({ page: out[slug], raw, at });
    }
    // Spellings of one name in this field are one page (F06): the short ones
    // keep their address and defer to the fullest. Found by comparing the
    // titles, so a new pair in the tables is caught without a list to edit.
    const done = new Set<string>();
    for (const first of pages) {
      if (done.has(first.page.slug)) continue;
      const group = [first];
      done.add(first.page.slug);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of pages) {
          if (done.has(p.page.slug) || !group.some((g) => sameRoleName(g.raw, p.raw))) continue;
          group.push(p);
          done.add(p.page.slug);
          grew = true;
        }
      }
      if (group.length < 2) continue;
      const order = new Map(group.map((p) => [p.page.slug, p.at]));
      const keep = fullestSpelling(group.map((p) => p.page), (p) => order.get(p.slug) ?? 0);
      for (const p of group) if (p.page.slug !== keep.slug) p.page.canonicalSlug = keep.slug;
    }
  }
  return out;
}


export const ROLE_PAGES: Record<string, RolePage> = buildRoles();

/** Every role page in a field, in the order its table lists them, deferring ones included. */
export const rolesForIndustry = (industry: string): RolePage[] =>
  Object.values(ROLE_PAGES).filter((r) => r.industry === industry);

/** The role pages in a field that stand as their own page: the ones to link. */
export const indexableRolesForIndustry = (industry: string): RolePage[] =>
  rolesForIndustry(industry).filter((r) => !r.canonicalSlug);

/**
 * The other role pages a role page links: its field's indexable ones, less
 * itself and the page it defers to, so two spellings of one page link the
 * same set.
 */
export const siblingRolePages = (role: RolePage): RolePage[] =>
  indexableRolesForIndustry(role.industry).filter((r) => r.slug !== role.slug && r.slug !== role.canonicalSlug);
