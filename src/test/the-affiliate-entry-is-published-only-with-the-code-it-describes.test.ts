// @vitest-environment node
/**
 * S14X-021, THE AFFILIATE PROGRAM ENTRY (owner-approved 2026-11-15, the full
 * variant): a ?ref link stored a 30-day affiliate_ref cookie and a click
 * record, and the Privacy page never said so. The entry says what is kept,
 * when, for how long, and what an affiliate sees; the Cookies list names the
 * cookie under Affiliate program.
 *
 * The owner's approval makes the merge order part of the decision: three of
 * the entry's sentences are claims the code made true only in the affiliate
 * lane (the keyed address hash, the 90-day delete, the decline that clears
 * the code). So the second half of this file FAILS until that code is on the
 * branch: this entry may not reach the page ahead of it.
 *
 * Read from the text the crawler is served (scripts/prerender-legal.mjs, the
 * bake's own converter), so the words judged are the words published.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { legalBodyFromTsx, legalText } from "../../scripts/prerender-legal.mjs";
import { MCP_PRIVACY_ROWS } from "@/config/mcp-privacy";
import EN from "@/i18n/locales/en.json";

const ROOT = resolve(__dirname, "../..");
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const html = legalBodyFromTsx(readFileSync(resolve(ROOT, "src/pages/Privacy.tsx"), "utf8"), { locale: EN, vars: { AI_CACHE_MAX_HOURS: 48, SHARED_ANALYSIS_DAYS: 90, MCP_PRIVACY_ROWS }, esc });
const items = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => legalText(m[1]).replace(/&#39;|&apos;/g, "'"));

describe("the Affiliate Program entry, as the crawler reads it", () => {
  const entry = items.find((t) => t.startsWith("Affiliate Program:")) ?? "";

  it("says the referral code is kept in affiliate_ref for 30 days, and only after Allow analytics", () => {
    expect(entry, "no 'Affiliate Program:' entry").not.toBe("");
    expect(entry).toContain("affiliate_ref");
    expect(entry).toMatch(/for 30 days/);
    expect(entry, "the banner's own words: the choice is Allow analytics, not 'cookies'").toMatch(/choose Allow analytics/);
    expect(entry).toMatch(/If you choose No thanks we do not store the code, and choosing No thanks later clears it/);
  });

  it("says the click keeps a keyed hash of the address, never the address, for 90 days, and that affiliates see counts only", () => {
    expect(entry).toMatch(/a keyed hash of your IP address\. We do not store the IP address itself/);
    expect(entry).toMatch(/We keep these click records for 90 days and then delete them automatically/);
    expect(entry).toMatch(/Affiliates never see your identity: they see counts, and the value of purchases credited to them/);
  });

  it("is listed under Affiliate program in the Cookies list", () => {
    const cookie = items.find((t) => t.startsWith("Affiliate program, only if you allow analytics:")) ?? "";
    expect(cookie).toContain("affiliate_ref");
    expect(cookie).toMatch(/30 days/);
    expect(entry).toMatch(/listed under Affiliate program in the Cookies section/);
  });
});

describe("the code the entry describes is on the branch with it (the owner's merge order)", () => {
  const DIR = resolve(ROOT, "supabase/migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const code = (f: string) => readFileSync(resolve(DIR, f), "utf8").split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

  it("a migration schedules the delete of click records older than 90 days", () => {
    const pruners = files.filter((f) => { const c = code(f); return /cron\.schedule\s*\(/.test(c) && /affiliate_clicks/.test(c) && /90 days|interval\s*'90/i.test(c); });
    expect(pruners, "no migration schedules the 90-day delete of affiliate_clicks: the affiliate lane's click-privacy file must merge first").not.toEqual([]);
  });

  it("the newest track_affiliate_click stores a keyed hash of the address, never an unkeyed one", () => {
    const defs = files.filter((f) => /CREATE (OR REPLACE )?FUNCTION public\.track_affiliate_click\s*\(/i.test(code(f)));
    expect(defs.length).toBeGreaterThan(0);
    const body = code(defs[defs.length - 1]);
    expect(body, `${defs[defs.length - 1]} still hashes the address with no key`).not.toMatch(/md5\s*\(\s*'affiliate-click:'/);
    expect(body, `${defs[defs.length - 1]} names no keyed hash`).toMatch(/\bhmac\s*\(/i);
  });
});
