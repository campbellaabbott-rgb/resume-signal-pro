/**
 * A POSTING'S LIST LINE AND ITS MARKUP FOLLOW ITS PAGE AND ITS EMPLOYER.
 *
 *   SEO-F11  /jobs' list of posting pages printed the raw row's employer
 *            name, so seven lines carried names the name gate refuses
 *            ("Group withMVSB wtag", an email-signature file name) while the
 *            pages they linked said "The employer" (Googlebot, 2026-11-15).
 *   SEO-F08  a Buenos Aires posting ("AR - BUENOS AIRES (ARBUO)") was marked
 *            up as Arkansas, US, while its employer's own page said
 *            Argentina. A country the employer's own page states, and the row
 *            contradicts, withholds the markup as a location naming another
 *            country does: a carried page keeps its page with none (D7), a new
 *            one gets no page.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import type { PostingRow } from "@/components/jobs/posting-page";
import { bakePostingPage, employerStatedCountry, postingIndexLine, withEmployerCountry } from "../../scripts/prerender-seo.mjs";

const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const DESC = "We are hiring a medical assistant for our Bridgewater practice, working beside a team of physicians and nurses every day. ".repeat(5);
/** The bake's D: the app's own modules, as its esbuild entry bundles them. */
const D = { ...companyDisplay, ...postingPage };
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const good = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:acme~wd3~Careers:JR1",
  title: "Medical Assistant",
  company: "Acme Health",
  token: "acme~wd3~Careers",
  source: "workday",
  location: "Bridgewater, NJ",
  country: "US",
  workMode: null,
  postedAt: ago(3),
  missingSince: null,
  applyUrl: "https://acme.example/jobs/JR1",
  salary: null,
  agency: false,
  ...over,
});
/** The logo-text shape the gate refuses (synthetic token, as the parity guard's). */
const REFUSED = good({ id: "ukg:recruiting~EXA1000EXMP~11111111-2222-3333-4444-555555555555:238cdd44", token: "recruiting~EXA1000EXMP~11111111-2222-3333-4444-555555555555", source: "ukg", company: "Example Logo Horizontal" });

describe("the /jobs list line (SEO-F11)", () => {
  it("says 'the employer' where the page it links does, never the refused name", () => {
    const page = bakePostingPage(REFUSED, DESC, { D, SITE, carried: true });
    expect(page.nameRefused).toBe(true);
    const line = postingIndexLine(page, page.rawJob, { D, esc });
    expect(line).toContain("— the employer, Bridgewater, NJ");
    expect(line).not.toContain("Example Logo Horizontal");
  });
  it("prints a name the gate passes (the control)", () => {
    const page = bakePostingPage(good(), DESC, { D, SITE, carried: false });
    expect(postingIndexLine(page, page.rawJob, { D, esc })).toBe(
      `<li><a href="${D.postingPagePath(good().id)}">Medical Assistant</a> — Acme Health, Bridgewater, NJ</li>`,
    );
  });
});

describe("the employer's own country (SEO-F08)", () => {
  const ARGENTINA = { address: { addressLocality: "Tortuguitas", addressRegion: "Buenos Aires", addressCountry: "Argentina" } };
  const row = good({ location: "AR - BUENOS AIRES (ARBUO)", country: "US" });

  it("is read as a code from a code or a name, and as nothing from nothing", () => {
    expect(employerStatedCountry(ARGENTINA, D)).toBe("AR");
    expect(employerStatedCountry({ address: { addressLocality: "X", addressCountry: "us" } }, D)).toBe("US");
    expect(employerStatedCountry({ address: { addressLocality: "X", addressCountry: "Atlantis" } }, D)).toBeNull();
    expect(employerStatedCountry(null, D)).toBeNull();
    expect(employerStatedCountry({ employmentType: "Full time" }, D)).toBeNull();
  });

  it("withholds the markup when it contradicts the row: a carried page keeps its page, a new one gets none", () => {
    // The premise: without the statement the row is marked up as US.
    expect(bakePostingPage(row, DESC, { D, SITE, carried: false }).ld?.jobLocation).toBeTruthy();
    const bake = (carried: boolean, stated: unknown) => withEmployerCountry(bakePostingPage(row, DESC, { D, SITE, carried }), stated, { D, carried });
    expect(bake(true, ARGENTINA)).toMatchObject({ live: true, ld: null, mismatchOnly: true, statedCountry: "AR" });
    expect(bake(false, ARGENTINA)).toMatchObject({ live: false, ld: null });
  });

  it("is read in the posting loop, after the page is decided", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/d\.page = bakePostingPage\([^\n]*\);\n\s*d\.page = withEmployerCountry\(d\.page, d\.stated, \{ D, carried: d\.carried \}\);/);
    expect(src).toMatch(/export \{ countryCodeOfName \} from "\.\.\/src\/components\/jobs\/posting-page";/);
  });

  it("changes nothing when it agrees with the row or states no country (the control)", () => {
    for (const stated of [{ address: { addressLocality: "Bridgewater", addressCountry: "US" } }, { employmentType: "Full time" }, null]) {
      const page = withEmployerCountry(bakePostingPage(good(), DESC, { D, SITE, carried: false }), stated, { D, carried: false });
      expect(page.live).toBe(true);
      expect(page.ld).toBeTruthy();
      expect(page.statedCountry ?? null).toBeNull();
    }
  });
});
