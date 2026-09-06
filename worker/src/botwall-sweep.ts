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
 *   npx tsx src/botwall-sweep.ts [vendor,vendor,...] [tenantsThisRun]
 *
 * ── WHY THIS IS A ROLLING SWEEP NOW (2026-09-06) ────────────────────────────
 *
 * The wall table held exactly ONE sweep: 2026-08-07, ~240 tenants, about 240 of
 * ~44,500 boards. The schedule existed and ran weekly — and the table did not
 * grow. TWO separate reasons, and only the second one was obvious:
 *
 *   1. THE CRON SWEPT NOTHING AT ALL. The workflow passes the dispatch inputs
 *      through positionally, and on a `schedule` event they render as the
 *      EMPTY STRING — which `""?.split(",").filter(Boolean) ?? DEFAULT_VENDORS`
 *      resolves to an empty vendor list, not to the defaults, because `??` is
 *      nullish-only. Every scheduled run discovered zero employers, probed
 *      zero pages and exited 0 green. The one sweep in the table is the one
 *      somebody dispatched by hand with the input filled in. See main().
 *   2. Even when it did run, it re-measured essentially the same handful of
 *      tenants, because the tenant list was "whatever the first page of
 *      postings happened to return".
 *
 * So the corpus grew a year of runs and stayed a single dated snapshot.
 *
 * The value in this table is LONGITUDINAL and it cannot be backfilled. "This
 * employer added a CAPTCHA in October" is a fact only if someone looked in
 * September and again in October. Nobody can go back and look at September.
 * That makes coverage-over-time, not sample size on any one night, the thing
 * worth fixing.
 *
 * So the tenant list is now an ORDERED UNIVERSE of employers — biggest first,
 * as far as the board will tell us — and each weekly run walks the next slice
 * of it. A full pass takes a couple of months; then it comes round again, and
 * the second visit is where the signal is.
 *
 * WHAT DID NOT CHANGE, DELIBERATELY. Every politeness knob is exactly where it
 * was: three lanes, the same 45s navigation timeout, the same 2.5s settle and
 * 5s post-click wait, one page load per tenant, nothing submitted. Rolling
 * makes the sweep hit MORE employers over a season and each individual
 * employer LESS often — the old behaviour re-loaded the same ~48 apply pages
 * 52 times a year; this loads a given employer's page roughly six. The run's
 * total page count is the 2026-08-07 sweep's own proven figure, and a
 * wall-clock deadline stops the run rather than letting a slow slice run long.
 *
 * ── AND WHY THE TENANT LIST COMES OFF THE BOARD FUNCTION NOW ────────────────
 *
 * This script reads with the published anon key. It used to read
 * job_board_postings over PostgREST directly — and migration 20260827130000
 * ("The paid API wall had an unlocked door beside it") REVOKED anon SELECT on
 * that table and dropped its policy, on purpose, to stop the corpus being
 * pageable around the /v1 key wall. A revoked grant answers 401/403, which
 * this script turned into "SAMPLE FAILED" per vendor, an `unknown` verdict, an
 * empty observation list and a GREEN run. A census on a schedule, feeding
 * nothing, reporting success — the exact failure this file's own history is
 * about.
 *
 * The direct read is kept as a first attempt (it is cheaper where the grant is
 * still in place) and, when it is denied, the sweep falls through to the
 * board's own `list` action with the same anon key — the supported anon
 * serving path, which reads the table through the edge function's own
 * credential. The fall-through is LOGGED, loudly, because a sweep that
 * silently changed where its sample came from is a sweep nobody can audit.
 *
 * AND IT SAYS WHO IT IS. Those `list` calls are logged into
 * job_board_search_events, whose `caller` column exists to keep our own
 * machine traffic out of the demand numbers — and whose DEFAULT is 'web', so
 * an unstamped self-call is not recorded as unknown, it is recorded as a
 * candidate. Every call below carries caller='maintenance'; see SWEEP_CALLER.
 */
import { chromium } from "playwright";
import { signsInUrl, vendorVerdict, isOpportunity, type TenantResult } from "./botwall-detect.js";

// The closed set worth re-checking, largest unlock first. Excluded on purpose:
// the four SENDABLE_VENDORS (already drivable — a wall appearing there is the
// sender's own failure path, not a reach question) and iCIMS/SuccessFactors
// (an unreachable JS shell and a mixed-CAPTCHA vendor, neither a two-hour
// adapter even if a wall lifted).
// bamboohr and rippling were NOT in the original list and had never been
// wall-tested at all — bamboohr is the third-largest non-drivable vendor at
// ~46,000 live postings, so "unknown" there was the biggest blank on the map.
const DEFAULT_VENDORS = ["smartrecruiters", "workable", "recruitee", "greenhouse", "lever", "ashby", "bamboohr", "rippling"];

// HOW MANY APPLY PAGES ONE RUN LOADS. 240 is not a new number: it is the size
// of the 2026-08-07 sweep that produced the snapshot this file exists to keep
// current (8 vendors x 30 tenants), run at the same three lanes with the same
// waits. Override with argv[3] for a hand-run.
//
// It bounds the run's total, not its rate. The rate — three concurrent pages,
// one load each — is unchanged, and the deadline below is what actually stops
// a run, so a slow night costs coverage rather than a 40-minute overrun.
//
// `Number("") || 240` is deliberate and is safe where the vendor argument's
// `??` was not: the workflow passes the EMPTY STRING on a scheduled run, and
// Number("") is 0, which is falsy, so the default takes over. See main().
const PER_RUN = Number(process.argv[3]) || 240;

// The employer list we are trying to cover. "Top ~2,000 by open roles" is the
// goal; see rankedUniverse() for what the anon surface can actually see of
// that ranking, which is less than all of it and is documented rather than
// papered over.
const TARGET_EMPLOYERS = 2000;

// No single vendor may swallow the universe: the target is a TOTAL, so it is
// divided by the vendor count rather than applied to each of them. At eight
// vendors that is 250 apiece. It is a ceiling, not a quota — a small vendor
// contributes what it has, and the slack falls to the others.
//
// This used to be 400, which made the discoverable universe 3,200 against a
// 2,000 goal. That is not a harmless over-collection: the universe's size IS
// the length of a full pass, and a pass that runs 13 weeks instead of 9 is a
// revisit that arrives a month late — and the revisit is the entire reason
// this sweep rolls.
const PER_VENDOR = Math.ceil(TARGET_EMPLOYERS / DEFAULT_VENDORS.length);

// Wall-clock stop for the probing phase. The workflow allows more than this,
// so the sweep ends by its own decision with a reported partial slice rather
// than being killed mid-write by the runner.
const DEADLINE_MS = Number(process.env.SWEEP_DEADLINE_MIN || 20) * 60_000;

// A vendor-level all-clear needs a denominator.
//
// This week's slice is a window over a mixed-vendor universe, so a vendor can
// contribute a handful of tenants to one run — or one. `vendorVerdict` calls a
// vendor `clean` whenever it reached someone and saw no wall, and
// `isOpportunity` treats clean and mixed as findings, so a single apply page
// that happened to load without a Turnstile would print "Bot wall lifted" for
// a vendor the 2026-08-07 census measured 30 of 30 walled. Six is the smallest
// n worth a human's morning; below it the run prints the sample size instead
// of a verdict and the vendor is judged on a later slice.
const MIN_REACHED = 6;

// WHO ASKED — and it is not a candidate.
//
// Every `list` call below is logged into job_board_search_events, and that
// table just gained a `caller` column for exactly one reason: to stop our own
// machine traffic being counted as candidate demand. An UNSTAMPED call does
// not land as null — the column DEFAULTs to 'web', so an unattributed sweep is
// actively mislabelled as a human browsing the site, which is worse than no
// column at all. And a day written that way can never be re-attributed.
//
// The literals are duplicated here rather than imported on purpose:
// supabase/functions/_shared/search-caller.ts is the single definition, and it
// is a Deno module outside this package's rootDir, so worker's own `tsc` would
// reject the import. Keep the two in step; that file explains why BOTH header
// spellings go out (job-board's resolveCaller reads x-rsp-caller, the column
// comment documents x-rb-caller, and the two are not yet reconciled). The body
// field is the belt to that braces: resolveCaller checks `body.caller` first,
// so the stamp survives a proxy that strips unknown headers.
const SWEEP_CALLER = "maintenance";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

type Tenant = { token: string; company: string; apply_url: string };

/**
 * WHICH WEEK THIS IS. The rolling cursor, and it is deliberately not stored
 * anywhere.
 *
 * A persisted cursor would need somewhere to live: the wall table is
 * service-role only and this worker holds no key for it, and an Actions cache
 * entry silently evaporates after seven days of no hits — which is exactly the
 * cadence this job runs at, so the cursor would reset to zero roughly whenever
 * it mattered and the sweep would re-measure slice 0 forever. That is the bug
 * this change exists to fix, reintroduced by its own bookkeeping.
 *
 * Whole weeks since the epoch instead: no state, no storage, self-healing
 * (a skipped week skips a slice rather than stalling the walk), and derivable
 * after the fact from a run's date, so any row in the table can be traced back
 * to the slice that produced it.
 */
const weekIndex = () => Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));

/** One POST to the board's own `list` action with the anon key.
 *
 * The gateway 429s a burst of self-calls — it once spent a day reporting its
 * own throttling as filter failures elsewhere in this codebase — so a single
 * paced retry honours Retry-After (capped, because a lying header must not
 * stall the sweep) and a residual 429 gives up on that page rather than
 * hammering. */
async function boardList(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const url = `${SUPABASE_URL}/functions/v1/job-board`;
  const send = () => fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      // See SWEEP_CALLER: without this the row defaults to 'web' and this
      // runner's vendor paging is stored as candidate demand.
      "x-rsp-caller": SWEEP_CALLER,
      "x-rb-caller": SWEEP_CALLER,
    },
    body: JSON.stringify({ action: "list", ...body, caller: SWEEP_CALLER }),
  });
  try {
    let res = await send();
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2_000, 5_000)));
      res = await send();
    }
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Rows the board returns, reduced to the three fields a probe needs.
 *  `token` is what the board's row mapper emits for the company feed token —
 *  NOT `companyToken` — and the wall table is keyed on it. */
function tenantsFromJobs(jobs: unknown, into: Map<string, Tenant>) {
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const r = j as { token?: unknown; company?: unknown; applyUrl?: unknown };
    const token = typeof r.token === "string" ? r.token : "";
    const applyUrl = typeof r.applyUrl === "string" ? r.applyUrl : "";
    if (token && applyUrl && !into.has(token)) {
      into.set(token, { token, company: String(r.company ?? token), apply_url: applyUrl });
    }
  }
}

/** True once the direct table read has been refused, so the remaining vendors
 *  do not each spend a request rediscovering the same closed door. */
let restDenied = false;

/** Distinct tenants for a vendor, straight from the live board.
 *
 * KEYED ON company_token, NOT company. The token is apply_tenant_walls' key —
 * the sweep used to sample by display name, which meant its observations could
 * never join the table they exist to feed (and two boards sharing a display
 * name would have collapsed into one sample).
 *
 * Two paths, one meaning. The direct table read is tried first and, when the
 * grant is gone (see the header note on 20260827130000), the board's own list
 * action answers instead. Whichever path runs, the result is the same shape.
 */
async function sampleTenants(vendor: string, want: number): Promise<Tenant[]> {
  const seen = new Map<string, Tenant>();

  if (!restDenied) {
    const url = `${SUPABASE_URL}/rest/v1/job_board_postings`
      // Capped: the universe wants up to PER_VENDOR distinct tokens and rows
      // repeat per employer, so ask for a multiple — but not an unbounded one.
      // A 4,800-row projection is a page nobody needs to fetch to find 400
      // employers.
      + `?select=company_token,company,apply_url&source=eq.${vendor}&limit=${Math.min(Math.max(120, want * 12), 2000)}`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } })
      .catch(() => null);
    if (res && (res.status === 401 || res.status === 403)) {
      restDenied = true;
      console.log(`  direct table read is denied (HTTP ${res.status}) — anon SELECT on the corpus was revoked by design; sampling through the board's list action instead`);
    } else if (res && res.ok) {
      const rows = (await res.json().catch(() => [])) as Array<{ company_token: string | null; company: string; apply_url: string | null }>;
      for (const r of rows) {
        if (r.apply_url && r.company_token && !seen.has(r.company_token)) {
          seen.set(r.company_token, { token: r.company_token, company: r.company, apply_url: r.apply_url });
        }
      }
      if (seen.size) return [...seen.values()].slice(0, want);
    } else if (res) {
      console.log(`  direct table read for ${vendor}: HTTP ${res.status} — falling through to the board's list action`);
    }
  }

  // Keyset-paged, not offset-paged: the corpus inserts tens of thousands of
  // rows a day above the reader, and offset windows over it demonstrably
  // duplicate and skip. The board hands back a cursor; follow it.
  // Eight pages of 200 is up to 1,600 postings per vendor — enough to surface
  // several hundred distinct employers, and bounded so that discovery cannot
  // quietly eat the probing budget it exists to fill.
  let cursor: unknown = null;
  for (let page = 0; page < 8 && seen.size < want; page++) {
    const body: Record<string, unknown> = { vendor: [vendor], limit: 200, includeFacets: false, groupSimilar: false };
    if (cursor) body.cursor = cursor;
    else if (page > 0) body.offset = page * 200;
    const out = await boardList(body);
    if (!out) break;
    const before = seen.size;
    tenantsFromJobs(out.jobs, seen);
    cursor = out.nextCursor ?? null;
    // No cursor and no new tenants means paging further only costs requests.
    if (!cursor && seen.size === before) break;
  }
  if (!seen.size) throw new Error(`no tenants reachable for ${vendor} (direct read ${restDenied ? "denied" : "empty"}, list action returned none)`);
  return [...seen.values()].slice(0, want);
}

/**
 * Employers by open roles, as far as the anon surface can see the ranking.
 *
 * THE HONEST LIMIT, stated because a half-covered universe reported as a full
 * one is worse than a small one reported accurately: the complete
 * employer-by-size facet (~23,500 rows) lives in a service-role-only meta row,
 * and the list response carries only its head — the top 150 by open roles.
 * That head is a real ranking and is used as one. Beneath it, ordering falls
 * back to what the board's own paging implies: postings are walked
 * recency-first, so employers with more live roles surface more often and the
 * tail is size-BIASED rather than size-SORTED. Ties break on token, which is
 * stable between weeks, so consecutive runs walk a list that mostly holds
 * still rather than reshuffling under the cursor.
 *
 * Building a read surface that would expose the full ranking is deliberately
 * not done here.
 */
async function rankedUniverse(vendors: string[]): Promise<Array<Tenant & { vendor: string }>> {
  const ranks = new Map<string, number>();
  const facetProbe = await boardList({ limit: 1, includeFacets: true });
  for (const c of (Array.isArray(facetProbe?.companies) ? facetProbe!.companies : []) as Array<{ token?: unknown; count?: unknown }>) {
    if (typeof c.token === "string" && typeof c.count === "number") ranks.set(c.token, c.count);
  }
  console.log(`  ranking head: ${ranks.size} employers with a published open-role count`);

  const universe: Array<Tenant & { vendor: string }> = [];
  for (const vendor of vendors) {
    try {
      const tenants = await sampleTenants(vendor, PER_VENDOR);
      for (const t of tenants) universe.push({ ...t, vendor });
      console.log(`  ${vendor.padEnd(16)} ${String(tenants.length).padStart(4)} tenants discovered`);
    } catch (e) {
      console.log(`  ${vendor.padEnd(16)} DISCOVERY FAILED — ${(e as Error).message}`);
    }
  }
  // Ranked head first; beneath it, ties break on token — stable between weeks,
  // so consecutive runs walk a list that mostly holds still rather than
  // reshuffling under the cursor. NOTHING IS TRUNCATED HERE. A fixed prefix
  // would be dropped identically every week (the tie-break is deterministic),
  // so an employer sorting past the cut would be discovered every run and
  // probed never; the size of the universe is bounded where it belongs, at
  // discovery, by PER_VENDOR. The caller's window wraps over all of it.
  universe.sort((a, b) => (ranks.get(b.token) ?? 0) - (ranks.get(a.token) ?? 0) || a.token.localeCompare(b.token));
  return universe;
}

/**
 * Persist reached observations through the broker — the only write path.
 *
 * The table these feed (apply_tenant_walls) is what lets the agent submit to
 * individual employers on vendors it cannot drive wholesale: recruitee 24% of
 * tenants measured clean, ashby 17%, greenhouse 7%. Until this function
 * existed the sweep measured all of that and threw it away — a census, run
 * weekly, feeding nothing.
 *
 * Fail-safe by construction: only REACHED tenants are reported (an unreachable
 * probe writes no row — the table's founding rule), and with no broker
 * credentials this is a dry run that says so, never a silent success.
 */
async function reportObservations(obs: Array<{ vendor: string; token: string; walled: boolean; walls: string[] }>) {
  const brokerUrl = (process.env.APPLY_BROKER_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.APPLY_WORKER_SECRET ?? "";
  if (!brokerUrl || !secret) {
    console.log(`  DRY RUN: ${obs.length} observations NOT persisted (APPLY_BROKER_URL/APPLY_WORKER_SECRET unset)`);
    return;
  }
  try {
    const res = await fetch(brokerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action: "wall", observations: obs }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log(`::warning title=Wall observations not persisted::broker HTTP ${res.status} — ${JSON.stringify(body).slice(0, 120)}`);
      return;
    }
    console.log(`  persisted ${body.written ?? "?"} wall observations` +
      (Array.isArray(body.rejected) && body.rejected.length ? ` (rejected: ${body.rejected.join(", ").slice(0, 200)})` : ""));
  } catch (e) {
    console.log(`::warning title=Wall observations not persisted::${String(e).slice(0, 160)}`);
  }
}

async function main() {
  // AN EMPTY ARGUMENT IS "NOT SUPPLIED", NOT "NO VENDORS".
  //
  // This is the bug that made the whole cadence a fiction. The workflow runs
  // `npx tsx src/botwall-sweep.ts "${{ github.event.inputs.vendors }}"`, and on
  // a `schedule` event github.event.inputs is null, so that renders as the
  // empty STRING — argv[2] === "", not undefined. The previous line was
  // `(process.argv[2]?.split(",").filter(Boolean)) ?? DEFAULT_VENDORS`, and
  // optional chaining only guards nullish: `""` is not nullish, so it
  // evaluated `"".split(",").filter(Boolean)` === `[]`, and `[] ?? DEFAULT`
  // is `[]`. Every scheduled run therefore swept ZERO vendors while exiting 0
  // and green — which is the likeliest reason apply_tenant_walls has held
  // exactly one sweep since 2026-08-07, the one that was dispatched by hand
  // with the input filled in.
  //
  // Test LENGTH, never nullishness, on anything parsed out of argv.
  const asked = (process.argv[2] ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  const vendors = asked.length ? asked : DEFAULT_VENDORS;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("SUPABASE_URL / SUPABASE_ANON_KEY not set — refusing to report a sweep that measured nothing");
    process.exit(2);
  }

  const universe = await rankedUniverse(vendors);
  if (universe.length === 0) {
    // Nothing to probe is not "everything is walled" and must not read as a
    // completed sweep. Same rule as an unreachable tenant, one level up.
    console.error("no employers reachable from either sampling path — refusing to report a sweep that measured nothing");
    process.exit(2);
  }

  // THE ROLLING WINDOW, and it genuinely wraps.
  //
  // Two failures the obvious form has, both of which cost coverage silently:
  //
  //   - `weekIndex() % ceil(universe.length / PER_RUN)` derives the STEP from
  //     this week's discovery yield. A week that discovers 1,900 employers has
  //     8 slices and a week that discovers 2,000 has 9, so the cursor does not
  //     advance by one run's worth — it jumps, repeating some slices and
  //     skipping others, and a skipped slice is an employer nobody looks at.
  //   - `universe.slice(start, start + PER_RUN)` with a start past the end
  //     returns an EMPTY array. That is a run that probes nothing, persists
  //     nothing, and still exits 0 green — the exact silent-success shape this
  //     file's own history is about.
  //
  // A fixed step of PER_RUN per week taken modulo the universe's length does
  // neither: it advances exactly one run's worth every week, wraps off the end
  // into the front so the walk continues into the next pass rather than
  // stopping at it, and — because the window is taken over the WHOLE
  // discovered universe rather than a fixed prefix of it — every employer
  // discovery surfaces is eventually probed. Under the old fixed-prefix form,
  // anything sorting past position 2,000 was dropped before the cursor ever
  // saw it, every week, forever; the tail of that ordering is alphabetical by
  // token (see rankedUniverse), so "late in the alphabet" meant "measured
  // never".
  //
  // The second visit to an employer is the observation that makes the first
  // one worth anything, so the pass length is reported: it is how long until
  // that second visit.
  const start = (weekIndex() * PER_RUN) % universe.length;
  const take = Math.min(PER_RUN, universe.length);
  const todays = Array.from({ length: take }, (_, i) => universe[(start + i) % universe.length]!);
  const passWeeks = Math.max(1, Math.ceil(universe.length / PER_RUN));
  console.log(`\n  universe ${universe.length} employers; ${todays.length} tenants this run from offset ${start}` +
    ` (a full pass takes ${passWeeks} week${passWeeks === 1 ? "" : "s"})\n`);

  const browser = await chromium.launch({ headless: true });
  const summary: Record<string, ReturnType<typeof vendorVerdict>> = {};
  // Every REACHED tenant becomes one observation; unreachable probes write
  // nothing (no third state — the table refuses a guess).
  const observations: Array<{ vendor: string; token: string; walled: boolean; walls: string[] }> = [];
  const deadline = Date.now() + DEADLINE_MS;
  let skippedForTime = 0;

  // PROBE ORDER IS ROUND-ROBIN ACROSS VENDORS, NOT VENDOR BY VENDOR.
  //
  // The deadline below is one wall-clock check, so whatever it cuts, it cuts
  // off the END of the probe order. Walking vendor by vendor made that end the
  // same vendors every time — the last entries of DEFAULT_VENDORS, which are
  // bamboohr and rippling: the two this file's own header calls the biggest
  // blank on the map. Every run that went long sacrificed exactly those and
  // always measured smartrecruiters and workable, so the truncation was not
  // random loss, it was a permanent hole in the same place.
  //
  // Interleaving makes an overrun cost every vendor the same fraction. Same
  // page count, same three lanes, same waits — only the order changes.
  const byVendor = new Map<string, Array<Tenant & { vendor: string }>>();
  for (const t of todays) {
    const bucket = byVendor.get(t.vendor);
    if (bucket) bucket.push(t); else byVendor.set(t.vendor, [t]);
  }
  const order: Array<Tenant & { vendor: string }> = [];
  for (let i = 0; order.length < todays.length; i++) {
    for (const bucket of byVendor.values()) {
      const t = bucket[i];
      if (t) order.push(t);
    }
  }

  const rowsByVendor = new Map<string, TenantResult[]>();
  // Three at a time. Sequential is too slow at this size (~90 min); higher
  // would be discourteous to real employer pages for no measurement benefit.
  // Tenants are independent of one another, so this changes throughput only,
  // never the result — and it is three lanes TOTAL, exactly as it was when the
  // vendors ran one after another.
  const LANES = 3;
  let next = 0;
  const lane = async () => {
    while (next < order.length) {
      const t = order[next++];
      if (!t) break; // races the length check under concurrency; also satisfies noUncheckedIndexedAccess
      const vendor = t.vendor;
      // Out of time: leave the rest of the slice unmeasured rather than
      // running the workflow into its own kill. An unprobed tenant writes
      // nothing, exactly like an unreachable one.
      if (Date.now() > deadline) { skippedForTime++; continue; }
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
      const rows = rowsByVendor.get(vendor) ?? [];
      rows.push({ company: t.company, walls: [...walls], reached });
      rowsByVendor.set(vendor, rows);
      if (reached) observations.push({ vendor, token: t.token, walled: walls.size > 0, walls: [...walls] });
      await page.close();
    }
  };
  await Promise.all(Array.from({ length: LANES }, lane));

  for (const vendor of vendors) {
    const rows = rowsByVendor.get(vendor);
    if (!rows || rows.length === 0) continue;
    const v = vendorVerdict(rows);
    summary[vendor] = v;
    console.log(`  ${vendor.padEnd(16)} ${v.verdict.padEnd(8)} ${v.walled}/${v.reached} walled  ${v.walls.join(",") || "-"}`);
    for (const r of rows) {
      console.log(`      ${r.company.slice(0, 26).padEnd(26)} ${r.reached ? (r.walls.join(",") || "clean") : "unreachable"}`);
    }
  }

  await browser.close();

  if (skippedForTime) {
    console.log(`  ${skippedForTime} tenant(s) left unprobed at the ${DEADLINE_MS / 60_000}-minute deadline — next week's slice moves on regardless`);
  }

  await reportObservations(observations);

  // The only line worth a human's attention. A GitHub annotation so it surfaces
  // in the Actions run without anyone reading the log.
  //
  // GATED ON A DENOMINATOR. The old runs probed a fixed 30 tenants per vendor,
  // so `isOpportunity` alone was enough. A rolling window over a mixed-vendor
  // universe does not promise that: a vendor can land one tenant in this
  // week's slice, and `clean (0/1 walled)` is not a finding — it is one apply
  // page. Publishing it as "Bot wall lifted" would be the muted alert this
  // file's own header refuses to create, pointed the other way. Below
  // MIN_REACHED the run states the sample size and judges nothing.
  const findings = Object.entries(summary).filter(([, v]) => isOpportunity(v.verdict));
  const opportunities = findings.filter(([, v]) => v.reached >= MIN_REACHED);
  const tooSmall = findings.filter(([, v]) => v.reached < MIN_REACHED);
  console.log(`\n${JSON.stringify(summary)}\n`);
  for (const [vendor, v] of tooSmall) {
    console.log(`  ${vendor}: ${v.walled}/${v.reached} walled — n too small to judge (needs ${MIN_REACHED} reached); carried to a later slice`);
  }
  if (opportunities.length) {
    for (const [vendor, v] of opportunities) {
      console.log(`::warning title=Bot wall lifted::${vendor} is ${v.verdict} (${v.walled}/${v.reached} walled). RECON says an adapter here is hours, not weeks — re-read it before building.`);
    }
  } else if (tooSmall.length) {
    console.log("  no vendor cleared the minimum sample this week — nothing conclusive, which is not the same as still walled");
  } else {
    console.log("  every vendor still walled — nothing to do, which is the expected result");
  }
  // Exit 0 regardless: a red run every week for the expected state is the
  // muted alert this project already has a rule against.
}

main();
