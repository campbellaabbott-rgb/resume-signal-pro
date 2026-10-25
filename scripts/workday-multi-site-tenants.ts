/**
 * Writes src/lib/company/workday-multi-site-tenants.ts from the catalogue:
 * every Workday tenant with more than one catalogued site, grouped as
 * job-board's Workday cross-site dedupe groups them (the token's first
 * segment, matched with the dedupe's own LIKE pattern, tenant then "~" then
 * anything, against every catalogued Workday token).
 *
 *   npx tsx scripts/workday-multi-site-tenants.ts          rewrite the module
 *   npx tsx scripts/workday-multi-site-tenants.ts --check  exit 1 when it is stale
 *
 * The guard src/test/pd-hotfix-a-watch-on-a-workday-site-whose-tenant-has-another-promises-nothing.test.tsx
 * recomputes the same list through the test catalogue reader and fails when
 * the module has drifted, so a census merge that adds a second site to a
 * Workday tenant is told to run this.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_SOURCES } from "../supabase/functions/job-board/sources.ts";

const OUT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../src/lib/company/workday-multi-site-tenants.ts");

/** A Postgres LIKE pattern as a RegExp: "_" is one character, "%" any run, case-sensitive. */
export function likeRegExp(pattern: string): RegExp {
  const body = [...pattern].map((c) => (c === "%" ? "[\\s\\S]*" : c === "_" ? "[\\s\\S]" : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
  return new RegExp(`^${body}$`);
}

/**
 * The tenants (a Workday token's first segment) whose LIKE pattern, as the
 * dedupe writes it, matches more than one catalogued Workday token. Sorted.
 */
export function multiSiteTenants(entries: ReadonlyArray<{ source: string; token: string }>): string[] {
  const tokens = entries.filter((e) => e.source === "workday").map((e) => e.token);
  const tenants = [...new Set(tokens.map((t) => t.split("~")[0]))];
  const out = tenants.filter((tenant) => {
    const re = likeRegExp(`${tenant}~%`);
    let n = 0;
    for (const t of tokens) if (re.test(t) && ++n > 1) return true;
    return false;
  });
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function renderModule(tenants: string[]): string {
  const lines: string[] = [];
  let line = " ";
  for (const t of tenants) {
    const item = ` ${JSON.stringify(t)},`;
    if (line.length + item.length > 100) { lines.push(line); line = " "; }
    line += item;
  }
  if (line.trim()) lines.push(line);
  return `/**
 * WORKDAY TENANTS WITH MORE THAN ONE CATALOGUED SITE -- GENERATED, do not edit by hand.
 *
 *   npx tsx scripts/workday-multi-site-tenants.ts
 *
 * job-board's Workday cross-site dedupe (supabase/functions/job-board/index.ts,
 * the block logged as "workday cross-site dedupe") skips a site's new
 * requisition copy, an id with a one- or two-digit suffix such as R31339-1,
 * whenever a stored row of any site of the same tenant holds its base id
 * (R31339). So on a tenant with a second site, a watch on one site can count
 * nothing of a posting the employer lists there: strayer~wd1~CU_Careers listed
 * 9 roles dated this month on 2026-10-25 and served none, and 7 of the 9 were
 * copies of requisitions strayer~wd1~SEI serves. The zero page withholds its
 * watch promise on these tenants (lander-model's watchPromiseOf). ${tenants.length} tenants.
 *
 * The guard pd-hotfix-a-watch-on-a-workday-site-whose-tenant-has-another-promises-nothing.test.tsx
 * recomputes this list from supabase/functions/job-board/sources.ts.
 */

const TENANTS: ReadonlyArray<string> = [
${lines.join("\n")}
];

/** The tenants as generated, for the guard. */
export const WORKDAY_MULTI_SITE_TENANT_LIST = TENANTS;

/** A Workday tenant (a Workday token's first segment) with more than one catalogued site. */
export const WORKDAY_MULTI_SITE_TENANTS: ReadonlySet<string> = new Set(TENANTS);
`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = renderModule(multiSiteTenants(JOB_SOURCES));
  if (process.argv.includes("--check")) {
    let cur = "";
    try { cur = readFileSync(OUT, "utf8"); } catch { /* missing reads as stale */ }
    if (cur !== next) { console.error("src/lib/company/workday-multi-site-tenants.ts is stale: run npx tsx scripts/workday-multi-site-tenants.ts"); process.exit(1); }
    console.log("src/lib/company/workday-multi-site-tenants.ts matches the catalogue");
  } else {
    writeFileSync(OUT, next);
    console.log(`wrote ${OUT}`);
  }
}
