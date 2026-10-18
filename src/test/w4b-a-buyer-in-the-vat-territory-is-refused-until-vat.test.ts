// @vitest-environment node
/**
 * A BUYER IN THE EU, THE EEA OR THE UK IS REFUSED UNTIL WE ARE REGISTERED FOR
 * VAT (S12-059, critical-path CP-037; owner decision 2026-10-12).
 *
 * WHAT WAS WRONG. The EU/UK switch (EU_UK_SALES) added tax and the withdrawal
 * waiver when it was on, and refused nobody while it was off: a Berlin
 * visitor bought the Full Analysis at €4.60 with no VAT charged and none of
 * the information the law there requires.
 *
 * WHAT HOLDS NOW, run on the shipped handlers: with the switch off, every
 * checkout that still sells answers 451 with a sentence saying sales there
 * wait for the VAT registration and nothing was charged, and asks Stripe for
 * nothing, when any signal places the buyer in the territory: a territory
 * currency, the page's time zone, a platform country header, or the trusted
 * address's country (looked up like the free scan's). No signal lifts a
 * refusal. Every session collects the billing address. With the switch on,
 * nobody is refused for where they are. And create-checkout's public GET
 * says the territory is refused, so a page can say so before the press.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { freshWorld, installDeno, loadCheckouts, post, W4B_ENV, type W4bWorld } from "./helpers/w4b-checkout-harness";
import { clearTerritoryCache, territoryRefusal, VAT_TERRITORY } from "../../supabase/functions/_shared/sales-territory";
import { TERRITORY_TIME_ZONES } from "../../supabase/functions/_shared/sales-territory-zones";
import { inSalesTerritory } from "@/lib/checkout-territory";

const env: Record<string, string | undefined> = { ...W4B_ENV, IPINFO_API_KEY: "ipinfo_harness" };
const MEMBER = { id: "00000000-0000-4000-8000-00000000e001", email: "member@example.com" };
let h: Record<string, EdgeHandler>;
let world: W4bWorld;

beforeAll(async () => {
  installDeno(env);
  h = await loadCheckouts(["create-checkout", "create-product-checkout", "create-subscription-checkout"]);
}, 240_000);
beforeEach(() => {
  env.EU_UK_SALES = undefined;
  clearTerritoryCache();
  world = freshWorld({ "jwt-member": MEMBER });
});

const buyAnalysis = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  post(h["create-checkout"], "create-checkout", { tempSessionId: "00000000-0000-4000-8000-0000000000aa", ...body }, { headers });

const expectRefused = async (res: Response) => {
  expect(res.status).toBe(451);
  const body = await res.json();
  expect(body).toMatchObject({ territoryRefused: true, reason: "vat_territory" });
  expect(body.error).toMatch(/EU, the EEA or the UK/);
  expect(body.error).toMatch(/VAT/);
  expect(body.error).toMatch(/Nothing was charged/);
  expect(body).not.toHaveProperty("url");
  expect(world.stripe.created, "a refused buyer reached Stripe").toEqual([]);
};

describe("the Full Analysis (create-checkout) refuses the territory while the switch is off", () => {
  it("a euro or pound price is itself the page saying so: no EUR or GBP session is minted", async () => {
    for (const currency of ["eur", "gbp", "sek", "pln"]) {
      world = freshWorld();
      await expectRefused(await buyAnalysis({ currency }));
    }
  });

  it("the page's time zone in the territory refuses", async () => {
    await expectRefused(await buyAnalysis({ currency: "usd", timeZone: "Europe/Berlin" }));
  });

  it("a platform country header in the territory refuses", async () => {
    await expectRefused(await buyAnalysis({ currency: "usd" }, { "cf-ipcountry": "DE" }));
  });

  it("the trusted address's country refuses, looked up once per block", async () => {
    world.ipCountry["198.51.100.8"] = "IE";
    await expectRefused(await buyAnalysis({ currency: "usd" }));
    expect(world.fetches.filter((f) => f.startsWith("https://ipinfo.io/"))).toHaveLength(1);
    await buyAnalysis({ currency: "usd" });
    expect(world.fetches.filter((f) => f.startsWith("https://ipinfo.io/")), "the block's answer is cached").toHaveLength(1);
  });

  it("no signal can lift a refusal: a US header does not undo a German address", async () => {
    world.ipCountry["192.0.2.44"] = "DE";
    await expectRefused(await buyAnalysis({ currency: "usd", timeZone: "America/New_York" }, { "cf-ipcountry": "US", "cf-connecting-ip": "192.0.2.44" }));
  });

  // Each test below uses its own address: the handler caches a block's
  // country in its own module, which this file cannot clear.
  it("control: a US buyer gets a session, and the session collects the billing address", async () => {
    world.ipCountry["203.0.113.10"] = "US";
    const res = await buyAnalysis({ currency: "usd", timeZone: "America/Chicago" }, { "cf-connecting-ip": "203.0.113.10" });
    expect(res.status).toBe(200);
    expect(world.stripe.created).toHaveLength(1);
    expect(world.stripe.created[0].billing_address_collection).toBe("required");
  });

  it("a lookup that cannot answer refuses nobody (the billing address and Radar are the backstop)", async () => {
    const res = await buyAnalysis({ currency: "usd" }, { "cf-connecting-ip": "203.0.114.77" });
    expect(res.status).toBe(200);
  });

  it("with the switch on, the territory buys (with tax), and nobody is refused for where they are", async () => {
    env.EU_UK_SALES = "on";
    const res = await buyAnalysis({ currency: "eur", timeZone: "Europe/Paris", withdrawalWaiver: true });
    expect(res.status).toBe(200);
    expect(world.stripe.created[0].automatic_tax).toEqual({ enabled: true });
  });

  it("the public GET says the territory is refused while the switch is off", async () => {
    const res = await h["create-checkout"](new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "GET" }));
    expect(await res.json()).toMatchObject({ euUkSales: false, territoryRefused: true });
    env.EU_UK_SALES = "on";
    const on = await h["create-checkout"](new Request("https://harness.supabase.co/functions/v1/create-checkout", { method: "GET" }));
    expect(await on.json()).toMatchObject({ euUkSales: true, territoryRefused: false });
  });
});

describe("the other checkouts that still sell refuse it too", () => {
  it("Freelance Boost (create-product-checkout)", async () => {
    await expectRefused(await post(h["create-product-checkout"], "create-product-checkout", { productId: "freelanceBoost", timeZone: "Europe/Madrid" }));
  });

  it("Pro (create-subscription-checkout), in the buyer's language", async () => {
    const res = await post(h["create-subscription-checkout"], "create-subscription-checkout", { language: "nl" }, { bearer: "jwt-member", headers: { "cf-ipcountry": "NL" } });
    expect(res.status).toBe(451);
    const body = await res.json();
    expect(body.language).toBe("nl");
    expect(body.error).toMatch(/btw/);
    expect(world.stripe.created).toEqual([]);
  });
});

describe("the rule itself", () => {
  it("EU-27, the EEA's three and the UK are the territory; Switzerland and the US are not", async () => {
    for (const c of ["DE", "FR", "IE", "PL", "NO", "IS", "LI", "GB"]) expect(VAT_TERRITORY.has(c), c).toBe(true);
    for (const c of ["CH", "US", "CA", "TR", "UA"]) expect(VAT_TERRITORY.has(c), c).toBe(false);
    expect(VAT_TERRITORY.size).toBe(27 + 3 + 1 + 2);
  });

  it("the page reads the same zones the server refuses on", () => {
    expect(inSalesTerritory("Europe/London")).toBe(true);
    expect(inSalesTerritory("Europe/Zurich")).toBe(false);
    expect(inSalesTerritory("America/New_York")).toBe(false);
    expect(TERRITORY_TIME_ZONES.has("Europe/Berlin")).toBe(true);
  });

  it("the switch on refuses nothing; a header pseudo-code is not a country", async () => {
    const headers = new Headers({ "cf-ipcountry": "XX" });
    expect(await territoryRefusal({ env: () => undefined, headers })).toBeNull();
    expect(await territoryRefusal({ env: (k) => (k === "EU_UK_SALES" ? "on" : undefined), headers: new Headers({ "cf-ipcountry": "DE" }), currency: "eur" })).toBeNull();
  });
});
