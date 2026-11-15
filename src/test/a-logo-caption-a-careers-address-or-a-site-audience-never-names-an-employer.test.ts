/**
 * A LOGO CAPTION, A CAREERS SITE'S ADDRESS OR A SITE'S AUDIENCE NEVER NAMES AN
 * EMPLOYER (SEO check 2026-11-15, F04; the second recheck of S14X-060).
 *
 * Read as Googlebot on 2026-11-15, an indexable posting page was titled, headed
 * and marked up with hiringOrganization "TRAILBORN MASTER MONOGRAM ORANGE" (an
 * ADP board named by its logo file's caption), two more said "MEI Maroon", a
 * company page and posting 107235 said "HealthCareersInSask.ca", and Inova's
 * military site said "Inova Military". The gate refused two image words or a
 * lower-case trailing colour, so a capitalised caption with one colour and
 * words it did not count went through.
 *
 * THE CORPUS (the corpus-first rule; this item had failed a recheck twice, so
 * no spelling of the report's was patched in). Every (token, name) pair in the
 * catalogue and in the live company list, 45,103, was judged by
 * bakeEmployerName under main (1e81bb81) and under this gate
 * (~/.config/resumebooster/seo-check-2026-11-15/fix-names/diff-gate.mts):
 * main refused 103 and this refuses 168. The 65 that moved are every one a
 * logo caption, a careers site's address or an email address, 2 more print the
 * employer's name in front of a site's audience label, no name main refused is
 * printable now, and nothing else changed. The fixture holds all 67, and 354
 * real names nearest the new rules' shapes, which must stay as they are.
 *
 * WHAT THE GATE DOES NOT DECIDE. "LNW" is Light & Wonder's Workday tenant code,
 * printed in capitals because it has no vowel, which is how the display shows
 * a real initialism (KBR, BNSF): no pattern tells the two apart, so its name is
 * an override, routed with its evidence. "Treat any host-shaped name as a web
 * address" (the report's third fix) was measured and declined: 221 of the 223
 * domain-shaped names in the corpus are brands (Booking.com, CarParts.com,
 * Lingo.dev); only a careers site's own address is refused.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repairEmployerName, unpublishableNameReason } from "../../scripts/prerender-names.mjs";
import { postingMarkupGate, postingNameVerdict } from "@/components/jobs/posting-page";
import { CATALOG } from "./helpers/catalog";

const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/employer-names-the-widened-gate-2026-11-15.json"), "utf8")) as {
  moved: Array<{ name: string; board: string; refused?: string; printed?: string; why: string }>;
  kept: Array<{ name: string; board: string; why: string }>;
};

/** The bake's verdict on a board ("source:token") stored under `name`. */
const verdict = (board: string, name: string, key = "1") => {
  const token = board.slice(board.indexOf(":") + 1);
  return postingNameVerdict({ id: `${board}:${key}`, token, company: name });
};

describe("the report's names, on the boards that carry them", () => {
  it.each([
    ["adp:b873581b-1203-4072-8b55-0d6dd9d414f5", "TRAILBORN MASTER MONOGRAM ORANGE", "colour caption"],
    ["adp:70410376-3018-4e61-a9e7-d6794946516c", "MEI Maroon", "colour caption"],
    ["adp:70410376-3018-4e61-a9e7-d6794946516c~295453191_2068", "MEI Maroon", "colour caption"],
    ["oracle:emqk~ca3~CX_1", "HealthCareersInSask.ca", "careers site address"],
  ])("%s named %s is refused as %s", (board, name, why) => {
    expect(verdict(board, name).reason).toBe(why);
  });

  it("Inova's military site prints Inova, the name the same tenant's main site carries", () => {
    // The evidence: the catalogue's own entry for the tenant's main site.
    expect(CATALOG.find((b) => b.source === "oracle" && b.token === "elar~us2~CX_1")?.name).toBe("Inova");
    expect(CATALOG.find((b) => b.source === "oracle" && b.token === "elar~us2~CX_14001")?.name).toBe("Inova Military");
    const v = verdict("oracle:elar~us2~CX_14001", "Inova Military");
    expect(v).toMatchObject({ name: "Inova", repaired: true, reason: null });
  });

  it("the markup names Inova and writes none for the logo caption", () => {
    const row = {
      title: "Registered Nurse", location: "Fairfax, VA", country: "US",
      postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), missingSince: null,
      recheckedAt: new Date(Date.now() - 600_000).toISOString(), salary: null, agency: false,
    };
    const desc = "Inova is hiring a registered nurse for the cardiac unit, working twelve-hour shifts with a team of experienced clinicians. ".repeat(4);
    const inova = postingMarkupGate({ ...row, id: "oracle:elar~us2~CX_14001:300000123", token: "elar~us2~CX_14001", source: "oracle", company: "Inova Military", applyUrl: "https://elar.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_14001/job/300000123" }, desc);
    expect(inova?.company).toBe("Inova");
    const trailborn = postingMarkupGate({ ...row, id: "adp:b873581b-1203-4072-8b55-0d6dd9d414f5:9202017586566_8", token: "b873581b-1203-4072-8b55-0d6dd9d414f5", source: "adp", company: "TRAILBORN MASTER MONOGRAM ORANGE", applyUrl: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=b873581b-1203-4072-8b55-0d6dd9d414f5&jobId=9202017586566_8" }, desc);
    expect(trailborn).toBeNull();
  });
});

describe("every name that moved, judged as the bake judges it (45,103 pairs, read 2026-11-15)", () => {
  it("holds the 67 that moved, the report's four among them", () => {
    expect(FIXTURE.moved).toHaveLength(67);
    expect(FIXTURE.moved.filter((m) => m.why.includes("F04")).map((m) => m.name).sort()).toEqual(
      ["HealthCareersInSask.ca", "Inova Military", "MEI Maroon", "MEI Maroon", "TRAILBORN MASTER MONOGRAM ORANGE"],
    );
  });

  it("refuses each refused one by its reason and prints each repaired one by its employer's name", () => {
    const wrong = FIXTURE.moved
      .map((m) => ({ m, v: verdict(m.board, m.name) }))
      .filter(({ m, v }) => (m.refused ? v.reason !== m.refused : v.reason !== null || v.name !== m.printed))
      .map(({ m, v }) => `${m.board} "${m.name}": want ${m.refused ?? `"${m.printed}"`}, got ${v.reason ?? `"${v.name}"`}`);
    expect(wrong).toEqual([]);
  });
});

describe("the real names nearest the widened rules stay as they are", () => {
  it("holds at least 300 real names", () => {
    expect(FIXTURE.kept.length).toBeGreaterThanOrEqual(300);
  });

  it("refuses none and repairs none", () => {
    const moved = FIXTURE.kept
      .map((k) => ({ k, reason: unpublishableNameReason(k.name), repaired: repairEmployerName(k.name).name, bake: verdict(k.board, k.name).reason }))
      .filter((x) => x.reason !== null || x.repaired !== x.k.name || x.bake !== null)
      .map((x) => `${x.k.board} "${x.k.name}": ${x.reason ?? x.bake ?? `repaired to "${x.repaired}"`}`);
    expect(moved).toEqual([]);
  });

  it.each([
    // Brands written as their domain: a host-shaped name is not refused.
    "Booking.com", "CarParts.com", "Lingo.dev", "Copper.co", "Pay.UK",
    // A colour that is the name, twice or after a capitalised word.
    "Copper | Copper", "Alaskan Copper", "ArcherGrey", "Blades of Green",
    // The new image words inside a name.
    "Monogram Health", "Master Boat Builders, Inc.", "FirstLight Fiber", "Path Light Pro",
    // A hiring label is not a resolution.
    "Ducera Partners - Experienced Hires",
    // An audience word the name is built on.
    "Clear Path For Veterans", "IntelliDyne Jobs for Veterans",
    // An @ inside a name, not an email address.
    "Bistro @ Bluewater", "Connect@home GmbH",
  ])("%s is printed as it is", (name) => {
    expect(unpublishableNameReason(name)).toBeNull();
    expect(repairEmployerName(name).name).toBe(name);
  });
});
