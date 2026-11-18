// @vitest-environment node
/**
 * AN INTERNATIONAL PHONE NUMBER IS NOT REPORTED MISSING (bug audit NB-8).
 *
 * The primary's contact check, its rule-based report and the backup scan
 * each read a phone number with a North American pattern, so "+44 7700
 * 900123" or "06 12 34 56 78" was "not detected", and the model was told to
 * flag the missing phone. One matcher now serves every reader
 * (resume-structure.ts hasPhoneNumber), and outside the US the model is not
 * told to flag a phone the matcher did not find.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgeHandler } from "./helpers/edge-harness";
import { loadScanners, resetWorld, scanPrimary, world } from "./helpers/free-scan-world";
import { hasPhoneNumber } from "../../supabase/functions/free-keyword-scan/resume-structure";
import { hasPhoneNumber as streamHasPhoneNumber } from "../../supabase/functions/free-keyword-scan-stream/resume-structure";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const PHONES: Array<[string, boolean]> = [
  ["(555) 123-4567", true],
  ["+1 415 555 0134", true],
  ["+44 7700 900123", true],
  ["+49 (0)30 1234567", true],
  ["+33 6 12 34 56 78", true],
  ["+63 917 123 4567", true],
  ["+91 98765 43210", true],
  ["0044 20 7946 0958", true],
  ["07700 900123", true],
  ["06 12 34 56 78", true],
  ["030 1234567", true],
  ["Tel: 0612345678", true],
  // Dates and short numbers are not phone numbers.
  ["01.2019 - 2021", false],
  ["05/2019 - 08/2022", false],
  ["2019 - 2022", false],
  ["+1 2", false],
  ["Grew revenue 40% in 2023", false],
];

describe("one phone matcher for every reader", () => {
  it.each(PHONES)("%s -> %s, in both copies", (text, want) => {
    expect(hasPhoneNumber(text)).toBe(want);
    expect(streamHasPhoneNumber(text)).toBe(want);
  });
});

describe("the primary tells the model about a missing phone only where it can read every format", () => {
  let primary: EdgeHandler;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary } = await loadScanners(["primary"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  const cv = (contact: string) => [
    contact,
    "SUMMARY",
    "Retail store manager with nine years in grocery and convenience retail, running teams of up to forty.",
    "EXPERIENCE",
    "Store Manager, Northside Grocers, Jan 2020 - Present",
    "- Grew weekly sales by 12% through range changes and better staffing",
    "- Cut stock loss by a third with daily counts on high-risk lines",
    "EDUCATION",
    "BA Business, University of Leeds, 2015",
    "SKILLS",
    "Team leadership, rota planning, stock control, merchandising",
  ].join("\n");
  const prompts = () => world.fetched.filter((f) => f.url.includes("ai.gateway.lovable.dev")).map((f) => f.body).join("\n");

  it("a UK number is a phone number: the model is not told it is missing", async () => {
    await scanPrimary(primary, { resumeText: cv("Sam Hart | sam.hart@example.co.uk | +44 7700 900123 | Leeds"), targetCountry: "GB" });
    expect(prompts()).not.toContain("phone number — not detected");
  });

  it("outside the US, a phone the matcher did not find is not flagged either", async () => {
    await scanPrimary(primary, { resumeText: cv("Sam Hart | sam.hart@example.co.uk | Leeds"), targetCountry: "GB" });
    expect(prompts()).not.toContain("phone number — not detected");
  });

  it("control: a US CV with no phone is still flagged", async () => {
    await scanPrimary(primary, { resumeText: cv("Sam Hart | sam.hart@example.com | Columbus, OH"), targetCountry: "US" });
    expect(prompts()).toContain("phone number — not detected");
  });
});
