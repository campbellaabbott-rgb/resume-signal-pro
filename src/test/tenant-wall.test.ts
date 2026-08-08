/**
 * THE AGENT MAY SUBMIT WHERE THE EMPLOYER LEFT THE DOOR OPEN — AND NOWHERE ELSE.
 *
 * Measured 2026-08-07, 30 tenants per vendor, by loading each employer's own
 * apply form and recording what the page requested:
 *
 *     recruitee 24% clean · ashby 17% · bamboohr 10% · greenhouse 7%
 *     workable / rippling / lever / smartrecruiters — 30/30 walled
 *
 * ~14,100 postings sit on employers who never deployed protection, against a
 * drivable inventory of 34,265. This file guards the rule that turns that into
 * reach without turning it into a lie.
 *
 * TWO PROPERTIES, both of which fail SAFE:
 *
 *   Absence is not clean. No observation means unknown means no. The entire
 *   argument for sending to these tenants is that somebody actually looked.
 *
 *   Observations expire. A tenant can enable protection any morning, so a stale
 *   "clean" reading reverts to false rather than to its last value. This is the
 *   same shape as every other fix this week: a measurement that stops being
 *   current must stop being believed, not quietly keep its old answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  tenantSendable,
  isSendableVendor,
  TENANT_WALL_TTL_DAYS,
} from "../../supabase/functions/_shared/apply-automation";

const NOW = Date.parse("2026-08-08T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const DIR = resolve(__dirname, "../../supabase/migrations");
// The migration that CREATES the table, not merely one that mentions it.
// Selecting "the latest file containing the name" picks up the follow-up that
// fixed the grant, and every assertion about the schema then fails for the
// wrong reason. Third time this exact slip has cost a green run today, so:
// match on the DDL, never on the identifier.
const mig = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => t.includes("CREATE TABLE IF NOT EXISTS public.apply_tenant_walls")).pop() ?? "";

describe("a drivable vendor needs no per-tenant question", () => {
  it("stays sendable with no observation at all", () => {
    for (const v of ["breezy", "personio", "pinpoint", "teamtailor"]) {
      expect(tenantSendable(`${v}:acme:123`, null, NOW), v).toBe(true);
    }
  });

  it("stays sendable even if that tenant was observed WALLED", () => {
    // We have an adapter and the worker's own refusal path handles a wall at
    // send time. Letting a stale observation veto a vendor we can drive would
    // shrink reach on the strength of an old reading.
    expect(tenantSendable("breezy:acme:1", { walled: true, checked_at: daysAgo(1) }, NOW)).toBe(true);
  });
});

describe("everything else needs a fresh, explicit clean reading", () => {
  it("is NOT sendable with no observation", () => {
    // The failure that matters. Unknown must never read as open.
    expect(tenantSendable("greenhouse:acme:1", null, NOW)).toBe(false);
    expect(tenantSendable("greenhouse:acme:1", undefined, NOW)).toBe(false);
  });

  it("is sendable when observed clean and recent", () => {
    expect(tenantSendable("greenhouse:acme:1", { walled: false, checked_at: daysAgo(1) }, NOW)).toBe(true);
  });

  it("is NOT sendable when observed walled", () => {
    expect(tenantSendable("greenhouse:acme:1", { walled: true, checked_at: daysAgo(1) }, NOW)).toBe(false);
  });

  it("expires: a clean reading past the TTL reverts to false, not to its last answer", () => {
    expect(tenantSendable("greenhouse:acme:1", { walled: false, checked_at: daysAgo(TENANT_WALL_TTL_DAYS - 1) }, NOW)).toBe(true);
    expect(tenantSendable("greenhouse:acme:1", { walled: false, checked_at: daysAgo(TENANT_WALL_TTL_DAYS + 1) }, NOW)).toBe(false);
  });

  it("treats a corrupt or future timestamp as unknown", () => {
    expect(tenantSendable("greenhouse:acme:1", { walled: false, checked_at: "not a date" }, NOW)).toBe(false);
    expect(tenantSendable("greenhouse:acme:1", { walled: false, checked_at: daysAgo(-3) }, NOW)).toBe(false);
  });

  it("does not accept a truthy non-false as clean", () => {
    // `walled` arrives from JSON. Only an explicit false counts.
    for (const bad of [null, undefined, 0, "", "false"]) {
      expect(tenantSendable("greenhouse:acme:1", { walled: bad as never, checked_at: daysAgo(1) }, NOW), String(bad)).toBe(false);
    }
  });
});

describe("the vendor list is untouched", () => {
  it("still means 'we wrote an adapter', not 'this employer is open'", () => {
    // Two different questions. Widening SENDABLE_VENDORS would point the queue
    // at postings the worker has no adapter for — a queue that looks productive
    // and sends nothing.
    expect(isSendableVendor("greenhouse:acme:1")).toBe(false);
    expect(isSendableVendor("breezy:acme:1")).toBe(true);
  });
});

describe("the public badge does not consume this", () => {
  it("the board filter and card badge stay vendor-level", () => {
    // A user-facing "agent can apply" mark whose truth depends on a probe that
    // can go stale between page view and send is a claim we cannot keep. The
    // agent gets the extra reach; the badge keeps under-promising.
    const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    expect(jobs).toMatch(/isSendableVendor/);
    expect(jobs).not.toMatch(/tenantSendable|apply_tenant_walls/);
  });
});

describe("the observation table refuses to record a guess", () => {
  it("has no third state — an unreachable probe writes no row", () => {
    expect(mig).toMatch(/walled\s+boolean\s+NOT NULL/);
    expect(mig).toMatch(/never null — an unreachable probe writes no row/);
  });

  it("rejects a blank tenant, which would match every posting of the vendor", () => {
    expect(mig).toMatch(/vendor and token are required/);
  });

  it("advances checked_at even when the verdict is unchanged", () => {
    // The row's value is as much "when did we last look" as "what did we see".
    expect(mig).toMatch(/checked_at = now\(\)/);
  });

  it("is not readable by anon or authenticated", () => {
    expect(mig).toMatch(/REVOKE ALL ON TABLE public\.apply_tenant_walls FROM anon, authenticated/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_tenant_wall[^;]*TO service_role/);
  });
});
