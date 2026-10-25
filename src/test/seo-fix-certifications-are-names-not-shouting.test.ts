/**
 * CERTIFICATION NAMES ARE NAMES, NOT SHOUTING (the round's review, 2026-10-24,
 * next to S13-089). The industry FAQ answers, visible and in the FAQPage
 * markup, upper-cased every certification whole: "CERTIFIED ADMINISTRATIVE
 * PROFESSIONAL, CAP CERTIFICATION, NOTARY PUBLIC", "COMMERCIAL PILOT
 * LICENSE", "DATABRICKS CERTIFIED, SNOWFLAKE CORE". And one template read
 * "on a administrative resume". Both renderers print through
 * buildIndustryFaqs, so one rule fixes both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildIndustryFaqs } from "@/data/industry-faqs";
import { displayCertification, withArticle } from "@/lib/seo/display-case";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";

const ROOT = resolve(__dirname, "../..");

describe("a certification is printed as its name", () => {
  it("keeps acronyms as acronyms and names as names", () => {
    expect(displayCertification("certified administrative professional")).toBe("Certified Administrative Professional");
    expect(displayCertification("cap certification")).toBe("CAP Certification");
    expect(displayCertification("commercial pilot license")).toBe("Commercial Pilot License");
    expect(displayCertification("databricks certified")).toBe("Databricks Certified");
    expect(displayCertification("aws certified")).toBe("AWS Certified");
    expect(displayCertification("osha 30")).toBe("OSHA 30");
    expect(displayCertification("pmp")).toBe("PMP");
    expect(displayCertification("shrm-cp")).toBe("SHRM-CP");
    expect(displayCertification("comptia security+")).toBe("CompTIA Security+");
    expect(displayCertification("pharmd")).toBe("PharmD");
    expect(displayCertification("leed ap")).toBe("LEED AP");
    expect(displayCertification("series 7")).toBe("Series 7");
  });
  it("never shouts a plain word anywhere in the tables' first six certifications", () => {
    for (const [slug, d] of Object.entries(INDUSTRY_KEYWORDS)) {
      for (const c of [...new Set(d.certifications)].slice(0, 6)) {
        const shown = displayCertification(c);
        for (const w of shown.split(/[\s/]+/)) {
          // A word of five letters or more in capitals is an acronym on the reviewed list or a mistake.
          if (/^[A-Z]{5,}$/.test(w)) expect(["MEDDPICC", "MEDDIC", "CISSP", "TESOL", "APICS", "NABCEP", "SOCRA", "BICSI", "NCARB", "NCIDQ", "NBCMI", "GMDSS", "PRINCE2", "OSHA", "HIPAA", "HACCP", "ACSM", "NBCT", "CFII", "CPCU", "CCRN", "TNCC", "SPHR", "GPHR", "CHMM", "CSCS", "LCSW", "LMSW", "LMHC", "LMFT", "DMCP", "CWEP", "CSEP", "CCHI", "MLIS", "USCG", "STCW", "SHRM", "LEED", "NCAA", "CHHA", "CRDE", "CGFM", "CCRP", "CCRA", "ACRP", "CFRE", "BCPS", "BCOP", "EFDA", "RCDD", "DBIA", "OSCP", "GSEC", "CSCP", "CPIM", "CLTD", "CCIM", "AINS", "CPHT", "PTCB", "NASM", "ISSA", "NSCA", "CIMS", "MSHA", "CKAD"], `${slug}: ${c} -> ${shown}`).toContain(w);
        }
      }
    }
  });
});

describe("the article fits the word", () => {
  it("says an administrative, a healthcare, an HR, a UX", () => {
    expect(withArticle("administrative")).toBe("an administrative");
    expect(withArticle("aviation")).toBe("an aviation");
    expect(withArticle("healthcare")).toBe("a healthcare");
    expect(withArticle("HR")).toBe("an HR");
    expect(withArticle("UX design")).toBe("a UX design");
    expect(withArticle("university")).toBe("a university");
  });
});

describe("the industry FAQ prints through both rules", () => {
  it("in the answer and the question", () => {
    const faqs = buildIndustryFaqs({ name: "Administrative", keywords: ["a", "b", "c", "d", "e"], certifications: ["certified administrative professional", "cap certification", "notary public"] });
    const certQ = faqs.find((f) => /certifications/.test(f.q))!;
    expect(certQ.q).toBe("Which certifications matter most on an administrative resume?");
    expect(certQ.a).toContain("certifications like Certified Administrative Professional, CAP Certification, Notary Public.");
    expect(JSON.stringify(faqs)).not.toMatch(/CERTIFIED ADMINISTRATIVE|NOTARY PUBLIC|on a administrative/);
  });
  it("and the certification headings on both renderers take the article rule", () => {
    expect(readFileSync(resolve(ROOT, "src/pages/IndustryKeywords.tsx"), "utf8")).toMatch(/Certifications that anchor \{withArticle\(lower\)\} resume/);
    expect(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8")).toMatch(/Certifications that anchor \$\{esc\(D\.withArticle\(lower\)\)\} resume/);
  });
});
