// @vitest-environment node
/**
 * A BUYER IN THE EU, THE EEA, THE UK OR INDIA CHECKS OUT AS ON MAIN (owner,
 * 2026-10-27, on those sales: "Keep selling as today").
 *
 * Wave 4 refused them: with the EU/UK switch (EU_UK_SALES) unset, as it ships
 * and as it is live, create-checkout and create-subscription-checkout answered
 * 451 to any buyer a euro, pound, rupee or other EEA currency, a browser time
 * zone, a country header or an ipinfo lookup of the address placed there
 * (_shared/sales-territory.ts), and the GET said territoryRefused true. main
 * 899be058 and the live create-checkout 2026-10-09.61 sell to every one of
 * them. With the switch unset, as shipped, each handler below is the shipped
 * one with only its network faked, and ipinfo has a key and would place the
 * address in Germany:
 *   - the $5 Full Analysis reaches Stripe in every territory currency main
 *     prices, from a territory time zone, behind a territory country header
 *     and from an address ipinfo places there, signed out and signed in;
 *   - Pro reaches Stripe from Berlin, London and Kolkata, in German and Hindi;
 *   - no checkout asks ipinfo anything, the session carries no billing-address
 *     demand main does not make with the switch off, and the GET answers the
 *     switch alone, as main's does;
 *   - main's own refusals stay: Russia, Nigeria and Pakistan are refused as
 *     on main, and the switch, once on, still asks for the waiver.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, W4B_ENV, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const PLAIN = { id: "00000000-0000-4000-8000-00000000f712", email: "plain@example.com" };
const FNS = ["create-checkout", "create-subscription-checkout", "create-product-checkout"];
const ADDRESS = "203.0.113.77";
const env: Record<string, string | undefined> = { ...W4B_ENV, IPINFO_API_KEY: "ipinfo_harness_token" };

let shipped: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno(env);
  shipped = await loadCheckouts(FNS);
}, 240_000);
beforeEach(() => {
  delete env.EU_UK_SALES;
  world = freshWorld({ "jwt-plain": PLAIN });
  world.ipCountry[ADDRESS] = "DE";
});

const analysis = (body: Record<string, unknown>, opts: { bearer?: string; headers?: Record<string, string> } = {}) =>
  post(shipped["create-checkout"], "create-checkout", { tempSessionId: "00000000-0000-4000-8000-0000000000ac", ...body }, opts);
const subscribe = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  post(shipped["create-subscription-checkout"], "create-subscription-checkout", { autoRenewConsent: true, ...body }, { bearer: "jwt-plain", headers });

const expectSold = async (res: Response, what: string) => {
  const body = await res.json();
  expect(res.status, `${what}: ${JSON.stringify(body).slice(0, 240)}`).toBe(200);
  expect(body.territoryRefused, what).toBeUndefined();
  expect(String(body.url ?? ""), what).toMatch(/^https:\/\/checkout\.stripe\.com\//);
};
const askedIpinfo = () => world.fetches.filter((u) => u.startsWith("https://ipinfo.io/"));

describe("the $5 Full Analysis, with the EU/UK switch unset as it ships", () => {
  it("is sold in every territory currency main prices", async () => {
    for (const currency of ["eur", "gbp", "inr", "sek", "nok", "dkk", "pln", "czk", "huf", "ron"]) {
      await expectSold(await analysis({ currency }), currency);
    }
    expect(world.stripe.created.map((s) => (s.line_items as Array<{ price_data: { currency: string } }>)[0].price_data.currency))
      .toEqual(["eur", "gbp", "inr", "sek", "nok", "dkk", "pln", "czk", "huf", "ron"]);
  });

  it("is sold from a territory time zone, behind a territory country header and from an address ipinfo places there", async () => {
    for (const timeZone of ["Europe/Berlin", "Europe/London", "Europe/Dublin", "Europe/Oslo", "Asia/Kolkata"]) {
      await expectSold(await analysis({ currency: "usd", timeZone }), timeZone);
    }
    for (const country of ["DE", "GB", "FR", "IN"]) {
      await expectSold(await analysis({ currency: "usd" }, { headers: { "cf-ipcountry": country } }), `cf-ipcountry ${country}`);
    }
    await expectSold(await analysis({ currency: "usd" }, { headers: { "cf-connecting-ip": ADDRESS } }), "ipinfo DE");
    await expectSold(await analysis({ currency: "eur", timeZone: "Europe/Paris" }, { bearer: "jwt-plain" }), "signed in, eur");
    expect(askedIpinfo()).toEqual([]);
  });

  it("its session carries no billing-address demand with the switch off, as main's sessionPolicy", async () => {
    await expectSold(await analysis({ currency: "eur" }), "eur");
    expect(world.stripe.created[0].billing_address_collection).toBeUndefined();
    expect(world.stripe.created[0].automatic_tax).toEqual({ enabled: false });
  });

  it("the public GET answers the switch alone, as main's does", async () => {
    const res = await shipped["create-checkout"](new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "GET" }));
    const body = await res.json();
    expect(body.euUkSales).toBe(false);
    expect(body).not.toHaveProperty("territoryRefused");
  });

  it("main's own refusals stay: Russia, Nigeria and Pakistan are refused, and the switch once on still asks for the waiver", async () => {
    for (const country of ["RU", "NG", "PK"]) {
      const res = await analysis({ currency: "usd" }, { headers: { "cf-ipcountry": country } });
      expect(res.status, country).toBe(403);
    }
    env.EU_UK_SALES = "on";
    const noWaiver = await analysis({ currency: "eur" });
    expect(noWaiver.status).toBe(400);
    expect((await noWaiver.json()).consentRequired).toBe("withdrawal_waiver_required");
    await expectSold(await analysis({ currency: "eur", withdrawalWaiver: true }), "switch on, with the waiver");
    expect(world.stripe.created.at(-1)?.automatic_tax).toEqual({ enabled: true });
  });
});

describe("Pro, with the EU/UK switch unset as it ships", () => {
  it("is sold from Berlin, London and Kolkata, in German, English and Hindi, and from an address ipinfo places there", async () => {
    await expectSold(await subscribe({ language: "de", timeZone: "Europe/Berlin" }), "de Berlin");
    await expectSold(await subscribe({ language: "en-GB", timeZone: "Europe/London" }, { "cf-ipcountry": "GB" }), "en-GB London");
    await expectSold(await subscribe({ language: "hi", timeZone: "Asia/Kolkata" }), "hi Kolkata");
    await expectSold(await subscribe({ language: "en" }, { "cf-connecting-ip": ADDRESS }), "ipinfo DE");
    expect(world.stripe.created.every((s) => s.mode === "subscription")).toBe(true);
    expect(world.stripe.created.every((s) => s.billing_address_collection === undefined)).toBe(true);
    expect(askedIpinfo()).toEqual([]);
  });
});

describe("the refusal is gone, not switched off", () => {
  it("no function bundles a territory module, and the three checkouts name no territory refusal", () => {
    expect(existsSync(resolve(ROOT, "supabase/functions/_shared/sales-territory.ts"))).toBe(false);
    expect(existsSync(resolve(ROOT, "supabase/functions/_shared/sales-territory-zones.ts"))).toBe(false);
    const fnDir = resolve(ROOT, "supabase/functions");
    for (const fn of readdirSync(fnDir)) {
      const index = join(fnDir, fn, "index.ts");
      if (!existsSync(index)) continue;
      expect(codeOf(readFileSync(index, "utf8")), fn).not.toMatch(/sales-territory|territoryRefusal|territoryAnswer|territoryPolicy|withBillingAddress|tax_territory/);
    }
    for (const fn of FNS) {
      expect(codeOf(readFileSync(resolve(ROOT, `supabase/functions/${fn}/index.ts`), "utf8")), fn).not.toMatch(/ipinfoLookup|\b451\b/);
    }
  });
});
