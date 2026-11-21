// @vitest-environment node
/**
 * A JOB ADDRESS NAMES A REAL PLACE (SEO audit 2026-11-18, STRUCTURED-7).
 *
 * The served JobPostings put things that are not towns in addressLocality and
 * things that are not streets in streetAddress: Syneos Health "CHN-Client"
 * was the town "Client", Levi's "LS FIRENZE SPEZIALI, Firenze, Italy" the
 * store, Stanley Black & Decker "Rheingau-Taunus-Kreis, Idstein, Deutschland"
 * the district, Highmark "Pittsburgh PA, 15222, FAP, 5th Avenue Place" the
 * town with its state glued on, Hy-Vee "Fort Madison, Ave L, Fort Madison,
 * IA" the street "Fort Madison, Ave L", Adventureland the street
 * "Adventureland, 3200 Adventureland drive", and Cinemark the street "01147 -
 * Cinemark Renaissance Marketplace and XD", a theatre.
 *
 * The corpus is the 491 served JobPostings with a jobLocation
 * (fixtures/served-postings-2026-11-18.json.gz), read against the address
 * each served: the 7 above change, as labelled, and every other address is
 * byte-identical to what was served (never worse). The reviewed corpus of 947
 * strings (fixtures/posting-locations.json, a-posting-names-the-town-its-
 * employer-stated.test.ts) holds the same rule to main on every case it has.
 * KBR's "Corniche, Al Khobar" is not changed here: that corpus records it as
 * an open case held to main's reading until its flag is lifted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { postingJsonLdShape, postingPostalAddress, type PostingRow } from "@/components/jobs/posting-page";

type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string; jp: { address: Record<string, unknown> | null } | null };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));
const rowOf = (r: Served): PostingRow => ({
  id: r.id, source: r.source, token: r.token, title: r.title, company: r.company,
  location: r.location, country: r.country, postedAt: new Date(Date.now() - 86_400_000).toISOString(),
  applyUrl: null, salary: null, agency: false, workMode: null, missingSince: null,
} as unknown as PostingRow);
const byPath = (p: string) => {
  const r = SERVED.find((x) => x.path === `/jobs/posting/${p}`);
  if (!r) throw new Error(`no served page ${p}`);
  return r;
};
const addressOf = (p: string) => postingPostalAddress(rowOf(byPath(p)));

const SYNEOS = "workday/syneoshealth~wd12~Syneos_Health_External_Site/25114651-1";
const LEVIS = "workday/levistraussandco~wd5~External/R-0159776";
const SBD = "workday/sbdinc~wd1~Stanley_Black_Decker_Career_Site/REQ-1000050575";
const HIGHMARK = "workday/highmarkhealth~wd1~highmark/J280717";
const HYVEE = "workday/hyvee~wd1~HyVeeCareers/R251130";
const ADVENTURELAND = "workday/hfecorp~wd503~palace_jobs/JR107927";
const CINEMARK = "workday/cinemark~wd1~cinemark/R39293";
// STRUCTURED-B7: "Jessup,Maryland: United States of America" named no region.
const SUDDATH_2 = "workday/suddath~wd5~Suddath/R12265-1";
const SUDDATH_3 = "workday/suddath~wd5~Suddath/R12268-1";
/** What each address is now, in full. */
const NOW: Record<string, Record<string, unknown>> = {
  [SYNEOS]: { "@type": "PostalAddress", addressCountry: "CN" },
  [LEVIS]: { "@type": "PostalAddress", addressCountry: "IT", addressLocality: "Firenze" },
  [SBD]: { "@type": "PostalAddress", addressCountry: "DE", addressLocality: "Idstein" },
  [HIGHMARK]: { "@type": "PostalAddress", addressCountry: "US", addressRegion: "PA", addressLocality: "Pittsburgh" },
  [HYVEE]: { "@type": "PostalAddress", addressCountry: "US", addressRegion: "IA", addressLocality: "Fort Madison", streetAddress: "Ave L" },
  [ADVENTURELAND]: { "@type": "PostalAddress", addressCountry: "US", addressRegion: "IA", addressLocality: "Altoona", streetAddress: "3200 Adventureland drive", postalCode: "50009" },
  [CINEMARK]: { "@type": "PostalAddress", addressCountry: "US", addressRegion: "CA", addressLocality: "Rialto" },
  [SUDDATH_2]: { "@type": "PostalAddress", addressCountry: "US", addressRegion: "MD", addressLocality: "Jessup" },
  [SUDDATH_3]: { "@type": "PostalAddress", addressCountry: "US", addressRegion: "MD", addressLocality: "Jessup" },
};

describe("the addresses the audit names", () => {
  it("Syneos 'CHN-Client' names no town, in the address and in the markup", () => {
    expect(addressOf(SYNEOS)?.addressLocality).toBeUndefined();
    const r = byPath(SYNEOS);
    const ld = postingJsonLdShape(rowOf(r), r.description, { site: "https://resumebooster.work" });
    expect(ld).not.toBeNull();
    expect(JSON.stringify(ld!.jobLocation)).not.toMatch(/Client/);
  });

  it("a store or a district before the town is not the town: Firenze, Idstein", () => {
    expect(addressOf(LEVIS)?.addressLocality).toBe("Firenze");
    expect(addressOf(SBD)?.addressLocality).toBe("Idstein");
  });

  it("'Pittsburgh PA' with more after it is Pittsburgh in PA", () => {
    expect(addressOf(HIGHMARK)).toMatchObject({ addressLocality: "Pittsburgh", addressRegion: "PA" });
  });

  it("a street line is the street: no repeated town, no venue before the number, and a theatre is not a street", () => {
    expect(addressOf(HYVEE)?.streetAddress).toBe("Ave L");
    expect(addressOf(ADVENTURELAND)?.streetAddress).toBe("3200 Adventureland drive");
    expect(addressOf(CINEMARK)?.streetAddress).toBeUndefined();
    // A street the employer wrote stays one.
    expect(postingPostalAddress({ id: "x:t:1", location: "777 E Colorado Blvd, Pasadena,CA 91101-2104", country: "US" } as unknown as PostingRow)?.streetAddress).toBe("777 E Colorado Blvd");
    expect(postingPostalAddress({ id: "x:t:1", location: "1 Presidents Choice Circle, Brampton, ON", country: "CA" } as unknown as PostingRow)?.streetAddress).toBe("1 Presidents Choice Circle");
  });

  it("Suddath's 'Jessup,Maryland: United States of America' is Jessup in MD (STRUCTURED-B7)", () => {
    expect(addressOf(SUDDATH_3)).toMatchObject({ addressLocality: "Jessup", addressRegion: "MD" });
  });

  it("a town named after its county keeps its whole name", () => {
    expect(postingPostalAddress({ id: "x:t:1", location: "Târgu Mures, Mures, Romania", country: "RO" } as unknown as PostingRow)?.addressLocality).toBe("Târgu Mures");
  });
});

describe("the 491 served JobPosting addresses", () => {
  const located = SERVED.filter((r) => r.jp?.address);
  it("is the corpus the audit read", () => {
    expect(located.length).toBe(491);
  });

  it("changes exactly the 9 labelled, as labelled, and serves every other address byte for byte (never worse)", () => {
    const changed: Record<string, unknown> = {};
    for (const r of located) {
      const now = postingPostalAddress(rowOf(r));
      if (JSON.stringify(now) !== JSON.stringify(r.jp!.address)) changed[r.path.replace("/jobs/posting/", "")] = now;
    }
    expect(changed).toEqual(NOW);
  });
});
