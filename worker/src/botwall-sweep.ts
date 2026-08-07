/**
 * "CLOSED ON EVIDENCE FROM 2026-08-01" -> "CLOSED AS OF THIS WEEK."
 *
 * The apply agent can submit to 5.4% of the board. Every route past that
 * ceiling is shut by a CHOICE some vendor made — Workable's Turnstile,
 * SmartRecruiters' Cloudflare challenge, Recruitee's first-party hCaptcha — and
 * choices change. RECON says it plainly about Workable: "otherwise the cleanest
 * vendor seen... if Turnstile ever comes off, this is a two-hour adapter."
 *
 * Nothing re-checked that. A vendor could drop its wall and this project would
 * find out never. This is the sweep that turns a dated note into a live fact,
 * and it is the highest-value reach work that does not involve crossing the
 * line into evasion.
 *
 * WHAT IT DOES NOT DO. It loads a posting's apply page and watches what the
 * page itself requests. It solves nothing, submits nothing, and spoofs nothing
 * — a walled vendor stays walled and is simply recorded as such. The finding it
 * hunts for is a vendor that has REMOVED its own wall.
 *
 *   npx tsx src/botwall-sweep.ts [vendor,vendor,...]
 */
import { chromium } from "playwright";
import { signsInUrl, vendorVerdict, isOpportunity, type TenantResult } from "./botwall-detect.js";

// The closed set worth re-checking, largest unlock first. Excluded on purpose:
// the four SENDABLE_VENDORS (already drivable — a wall appearing there is the
// sender's own failure path, not a reach question) and iCIMS/SuccessFactors
// (an unreachable JS shell and a mixed-CAPTCHA vendor, neither a two-hour
// adapter even if a wall lifted).
const DEFAULT_VENDORS = ["smartrecruiters", "workable", "recruitee", "greenhouse", "lever", "ashby"];
const PER_VENDOR = 6;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

/** Distinct tenants for a vendor, straight from the live board. */
async function sampleTenants(vendor: string): Promise<Array<{ company: string; apply_url: string }>> {
  const url = `${SUPABASE_URL}/rest/v1/job_board_postings`
    + `?select=company,apply_url&source=eq.${vendor}&limit=120`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
  if (!res.ok) throw new Error(`sample ${vendor}: HTTP ${res.status}`);
  const rows = (await res.json()) as Array<{ company: string; apply_url: string | null }>;
  const seen = new Map<string, { company: string; apply_url: string }>();
  for (const r of rows) {
    if (r.apply_url && !seen.has(r.company)) seen.set(r.company, { company: r.company, apply_url: r.apply_url });
  }
  return [...seen.values()].slice(0, PER_VENDOR);
}

async function main() {
  const vendors = (process.argv[2]?.split(",").filter(Boolean)) ?? DEFAULT_VENDORS;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("SUPABASE_URL / SUPABASE_ANON_KEY not set — refusing to report a sweep that measured nothing");
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const summary: Record<string, ReturnType<typeof vendorVerdict>> = {};

  for (const vendor of vendors) {
    let tenants: Array<{ company: string; apply_url: string }> = [];
    try {
      tenants = await sampleTenants(vendor);
    } catch (e) {
      console.log(`  ${vendor.padEnd(16)} SAMPLE FAILED — ${(e as Error).message}`);
      summary[vendor] = { verdict: "unknown", walled: 0, reached: 0, walls: [] };
      continue;
    }

    const rows: TenantResult[] = [];
    for (const t of tenants) {
      const page = await browser.newPage();
      const walls = new Set<string>();
      let reached = false;
      page.on("request", (r) => { for (const s of signsInUrl(r.url())) walls.add(s); });
      try {
        await page.goto(t.apply_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        reached = true;
        await page.waitForTimeout(2_500);
        // Reach the FORM before judging: a wall that loads lazily at submit
        // time is invisible on the posting page.
        const btn = page.getByRole("button", { name: /apply|solliciteer|postuler|bewerben|solicitar/i })
          .or(page.getByRole("link", { name: /apply|solliciteer|postuler|bewerben|solicitar/i })).first();
        if ((await btn.count().catch(() => 0)) > 0) {
          await btn.click({ timeout: 8_000 }).catch(() => {});
          await page.waitForTimeout(5_000);
        }
      } catch { /* keep whatever was seen; `reached` stays false if goto failed */ }
      rows.push({ company: t.company, walls: [...walls], reached });
      await page.close();
    }

    const v = vendorVerdict(rows);
    summary[vendor] = v;
    console.log(`  ${vendor.padEnd(16)} ${v.verdict.padEnd(8)} ${v.walled}/${v.reached} walled  ${v.walls.join(",") || "-"}`);
    for (const r of rows) {
      console.log(`      ${r.company.slice(0, 26).padEnd(26)} ${r.reached ? (r.walls.join(",") || "clean") : "unreachable"}`);
    }
  }

  await browser.close();

  // The only line worth a human's attention. A GitHub annotation so it surfaces
  // in the Actions run without anyone reading the log.
  const opportunities = Object.entries(summary).filter(([, v]) => isOpportunity(v.verdict));
  console.log(`\n${JSON.stringify(summary)}\n`);
  if (opportunities.length) {
    for (const [vendor, v] of opportunities) {
      console.log(`::warning title=Bot wall lifted::${vendor} is ${v.verdict} (${v.walled}/${v.reached} walled). RECON says an adapter here is hours, not weeks — re-read it before building.`);
    }
  } else {
    console.log("  every vendor still walled — nothing to do, which is the expected result");
  }
  // Exit 0 regardless: a red run every week for the expected state is the
  // muted alert this project already has a rule against.
}

main();
