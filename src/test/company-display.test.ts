// The acronym fix must be conservative: it exists to stop "Verified direct from
// Nshs", not to restyle every employer on the board. These tests pin both
// halves — the shapes it fixes AND the much larger set it must leave alone.
import { describe, it, expect } from "vitest";
import { companyDisplayName, cleanJobTitle, decodeNameEntities } from "@/lib/company-display";

describe("companyDisplayName", () => {
  it("uppercases a title-cased initialism that lost its capitals", () => {
    expect(companyDisplayName("Nshs")).toBe("NSHS");
    expect(companyDisplayName("Hcsc")).toBe("HCSC");
    expect(companyDisplayName("Nshs Health")).toBe("NSHS Health");
  });

  it("leaves ordinary employer names untouched", () => {
    for (const name of [
      "AccentCare", "84 Lumber", "Chevron Stations", "Blue Cross & Blue Shield of Rhode Island",
      "Alto Pharmacy", "JCPenney", "Johns Hopkins Applied Physics Laboratory", "REI",
      "Garmin", "Easterseals Northern California", "M.C. Dean", "AXA",
    ]) {
      expect(companyDisplayName(name)).toBe(name);
    }
  });

  it("never touches names the feed already styled deliberately", () => {
    expect(companyDisplayName("IBM")).toBe("IBM");
    expect(companyDisplayName("eBay")).toBe("eBay");
    expect(companyDisplayName("PwC")).toBe("PwC");
    expect(companyDisplayName("3M")).toBe("3M");
  });

  it("does not shout real vowel-less words", () => {
    expect(companyDisplayName("Nth Degree")).toBe("Nth Degree");
  });

  it("is idempotent — running it twice changes nothing further", () => {
    for (const name of ["Nshs", "AccentCare", "Nth Degree", "84 Lumber"]) {
      const once = companyDisplayName(name);
      expect(companyDisplayName(once)).toBe(once);
    }
  });

  it("handles empty and missing input without throwing", () => {
    expect(companyDisplayName("")).toBe("");
    expect(companyDisplayName(null)).toBe("");
    expect(companyDisplayName(undefined)).toBe("");
  });

  it("applies confirmed slug-mangle fixes, idempotently", () => {
    expect(companyDisplayName("Modernatx")).toBe("Moderna");
    expect(companyDisplayName("Moderna")).toBe("Moderna");
    expect(companyDisplayName("Drivenbrands")).toBe("Driven Brands");
    expect(companyDisplayName("Driven Brands")).toBe("Driven Brands");
  });
});

// cleanJobTitle feeds the cards, the apply kits AND the JobPosting JSON-LD that
// Google for Jobs indexes — a false positive here publishes a wrong job title.
// These pin the exact boundary between the vendor artifact we collapse and the
// real titles we must never touch (bug sweep 2026-07-26).
describe("cleanJobTitle", () => {
  it("collapses the multi-word ATS duplication artifact", () => {
    expect(cleanJobTitle("Registered Nurse Registered Nurse RN")).toBe("Registered Nurse RN");
    expect(cleanJobTitle("Medical Assistant Medical Assistant (GI Scheduler)")).toBe("Medical Assistant (GI Scheduler)");
    expect(cleanJobTitle("Data Analyst Data Analyst II")).toBe("Data Analyst II");
  });

  it("leaves short repeated phrases alone (below the length floor)", () => {
    // "Copy of Copy of ..." is a junk vendor title either way; showing the
    // feed's text verbatim is honest, inventing a shortened one is not.
    expect(cleanJobTitle("Copy of Copy of Registered Nurse")).toBe("Copy of Copy of Registered Nurse");
  });

  it("NEVER collapses reduplicated proper nouns (a single repeated word)", () => {
    // Real places and brands are spelled this way; collapsing them would ship a
    // wrong title to cards and to structured data.
    for (const title of [
      "Walla Walla School District Nurse",
      "Sing Sing Correctional Officer",
      "New York New York Hotel Front Desk",
      "Duran Duran Tour Manager",
      "Wagga Wagga Dental Assistant",
      "Bora Bora Resort Chef",
      "Pago Pago Port Operator",
      "RN RN RN",
    ]) {
      expect(cleanJobTitle(title)).toBe(title);
    }
  });

  it("leaves ordinary titles untouched", () => {
    for (const title of ["Senior Software Engineer", "Nurse Practitioner", "Sales Salesforce Admin"]) {
      expect(cleanJobTitle(title)).toBe(title);
    }
  });

  it("normalizes whitespace and is idempotent", () => {
    const once = cleanJobTitle("Registered   Nurse Registered Nurse  RN");
    expect(once).toBe("Registered Nurse RN");
    expect(cleanJobTitle(once)).toBe(once);
  });

  it("survives regex metacharacters in the repeated phrase", () => {
    // The backreference matches literally, so metacharacters are data, not
    // pattern — and short repeats stay below the floor either way.
    expect(() => cleanJobTitle("C++ Dev C++ Dev")).not.toThrow();
    expect(cleanJobTitle("C++ Dev C++ Dev")).toBe("C++ Dev C++ Dev");
    expect(cleanJobTitle("C++ Developer C++ Developer II")).toBe("C++ Developer II");
  });

  it("stays fast on a pathological title (no catastrophic backtracking)", () => {
    const long = `${"Registered Nurse ".repeat(600)}RN`;
    const started = Date.now();
    cleanJobTitle(long);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("decodeNameEntities", () => {
  it("decodes the entities the feeds actually emit", () => {
    expect(decodeNameEntities("Bob&#039;s Auto &amp; Towing")).toBe("Bob's Auto & Towing");
    expect(decodeNameEntities("Platform &amp; Operational Data")).toBe("Platform & Operational Data");
    expect(decodeNameEntities("Don&apos;t See Your Role?")).toBe("Don't See Your Role?");
  });

  it("maps each dash entity to its own character", () => {
    expect(decodeNameEntities("A &ndash; B")).toBe("A – B");
    expect(decodeNameEntities("A &mdash; B")).toBe("A — B");
  });

  it("leaves entity-free strings identical", () => {
    const s = "Northwestern Memorial Healthcare";
    expect(decodeNameEntities(s)).toBe(s);
  });

  it("decodes exactly one escaping layer", () => {
    // Double-encoded input stays visibly encoded rather than being silently
    // re-interpreted — one layer per pass is the honest contract.
    expect(decodeNameEntities("A &amp;amp; B")).toBe("A &amp; B");
  });
});
