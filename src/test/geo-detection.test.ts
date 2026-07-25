// Geo detection tests for detectCountryFromResume (market-intelligence.ts).
// Locks in: the expanded dialing-code + city coverage, and — critically — the
// robust phone matcher that stops résumé growth stats ("+200%", "+300%") from
// masquerading as country codes (+20 Egypt, +30 Greece), plus the euro
// dead-end removal.
import { describe, it, expect } from "vitest";
import { detectCountryFromResume, formatGeoContextForPrompt } from "../../supabase/functions/free-keyword-scan/market-intelligence";

describe("detectCountryFromResume — phone codes", () => {
  it("detects newly-added dialing codes", () => {
    expect(detectCountryFromResume("Contact: +351 21 123 4567").country).toBe("PT");
    expect(detectCountryFromResume("Tel +54 11 4123 4567").country).toBe("AR");
    expect(detectCountryFromResume("Phone: +966 50 123 4567").country).toBe("SA");
    expect(detectCountryFromResume("+63 917 123 4567").country).toBe("PH");
    expect(detectCountryFromResume("+380 44 123 4567").country).toBe("UA");
    expect(detectCountryFromResume("+90 212 123 4567").country).toBe("TR");
    expect(detectCountryFromResume("+52 55 1234 5678").country).toBe("MX");
  });

  it("still detects the original codes", () => {
    expect(detectCountryFromResume("+44 20 7946 0958").country).toBe("GB");
    expect(detectCountryFromResume("+49 30 12345678").country).toBe("DE");
    expect(detectCountryFromResume("+61 2 9374 4000").country).toBe("AU");
  });

  it("reports a phone match as high confidence from the phone source", () => {
    const r = detectCountryFromResume("Reach me at +34 91 123 4567");
    expect(r.country).toBe("ES");
    expect(r.confidence).toBe("high");
    expect(r.source).toBe("phone");
  });
});

describe("detectCountryFromResume — growth-stat false positives", () => {
  it("does NOT read '+200%' as Egypt, '+300%' as Greece, or '+79%' as Russia", () => {
    expect(detectCountryFromResume("Grew revenue +200% YoY").country).not.toBe("EG");
    expect(detectCountryFromResume("Increased signups by +300%").country).not.toBe("GR");
    expect(detectCountryFromResume("Improved conversion +79% in Q3").country).not.toBe("RU");
  });

  it("resolves a growth-stat résumé by its US city, not a spurious country", () => {
    const r = detectCountryFromResume("Senior Manager, San Francisco. Drove +250% pipeline growth.");
    expect(r.country).toBe("US");
  });
});

describe("detectCountryFromResume — city fallback + euro fix", () => {
  it("detects added city markets when no phone is present", () => {
    expect(detectCountryFromResume("Based in Paris, France").country).toBe("FR");
    expect(detectCountryFromResume("Amsterdam, Netherlands").country).toBe("NL");
    expect(detectCountryFromResume("Located in Tokyo").country).toBe("JP");
    expect(detectCountryFromResume("São Paulo, Brazil").country).toBe("BR");
  });

  it("does NOT misfire 'New Mexico' as Mexico", () => {
    expect(detectCountryFromResume("Engineer in Albuquerque, New Mexico, USA").country).not.toBe("MX");
  });

  it("keeps unambiguous single-currency detection working (£ → GB)", () => {
    const r = detectCountryFromResume("Total compensation £45,000 per annum");
    expect(r.country).toBe("GB");
  });

  it("no longer resolves a bare euro amount to the dead 'EU' pseudo-country", () => {
    const r = detectCountryFromResume("Managed an annual budget of €2M");
    expect(r.country).not.toBe("EU");
    expect(r.country).toBeNull();
  });
});

describe("detectCountryFromResume — scoring: city mention ≠ candidate location", () => {
  it("does NOT tag a US candidate as GB/AU for naming foreign markets in a bullet", () => {
    const r = detectCountryFromResume(
      "Senior Product Manager, San Francisco, CA. Led expansion into the London and Sydney markets. Authorized to work in the US.",
    );
    expect(r.country).toBe("US");
  });

  it("lets a US city + US spelling outweigh a lone foreign city mention", () => {
    const r = detectCountryFromResume(
      "Alex Kim — New York, NY. Product Manager. Led the London team; optimized the color scheme and organized the launch program.",
    );
    expect(r.country).toBe("US");
  });

  it("flags a genuine two-country tie with lowered confidence", () => {
    const r = detectCountryFromResume("Operations Lead across our Toronto and New York offices.");
    expect(r.confidence).not.toBe("high"); // a real tie should never read as high-confidence
  });
});

describe("detectCountryFromResume — relocation intent (declared target market wins outright)", () => {
  it("destination beats a fully-documented current US location", () => {
    const r = detectCountryFromResume(
      "Senior Engineer — Austin, TX 78701. Authorized to work in the US. Relocating to London in September; seeking UK-based roles.",
    );
    expect(r.country).toBe("GB");
    expect(r.source).toBe("relocation");
    expect(r.confidence).toBe("high");
  });

  it("'seeking roles in Germany' targets DE", () => {
    const r = detectCountryFromResume("Product Manager, Toronto, ON M5V 2T6. Seeking roles in Germany.");
    expect(r.country).toBe("DE");
    expect(r.source).toBe("relocation");
  });

  it("historical 'relocated to' does NOT trigger the override", () => {
    const r = detectCountryFromResume(
      "Marketing Manager, Austin, TX 78701. Relocated to London in 2015, returned to the US in 2018.",
    );
    expect(r.source).not.toBe("relocation");
    expect(r.country).toBe("US");
  });
});

describe("detectCountryFromResume — postal addresses (strong) vs city mentions (weak)", () => {
  it("US state + ZIP resolves without a famous city name", () => {
    const r = detectCountryFromResume("Jane Roe — 44 Elm Street, Boise, ID 83702. Operations manager, 10 years experience.");
    expect(r.country).toBe("US");
    expect(r.confidence).toBe("high");
  });

  it("Canadian postal code resolves CA", () => {
    const r = detectCountryFromResume("John Doe — 12 King St W, Hamilton L8P 1A1. Financial analyst.");
    expect(r.country).toBe("CA");
    expect(r.confidence).toBe("high");
  });

  it("a German postal address beats a stray foreign-city mention", () => {
    const r = detectCountryFromResume(
      "Anna Schmidt — Musterstraße 5, 10115 Berlin. Managed the Paris client portfolio.",
    );
    expect(r.country).toBe("DE");
    expect(r.confidence).toBe("high");
  });
});

describe("detectCountryFromResume — widened work-auth, education, cities", () => {
  it("native-language work authorization resolves the country", () => {
    expect(detectCountryFromResume("Chef de projet. Titre de séjour en cours de validité.").country).toBe("FR");
    expect(detectCountryFromResume("Software engineer, Singapore PR, available immediately.").country).toBe("SG");
  });

  it("new education systems resolve", () => {
    expect(detectCountryFromResume("Laurea in Ingegneria, liceo scientifico, esperienza in sviluppo software.").country).toBe("IT");
    expect(detectCountryFromResume("Data analyst. Vestibular 2015, ensino médio completo.").country).toBe("BR");
  });

  it("newly covered cities resolve their countries", () => {
    expect(detectCountryFromResume("Based in Warsaw, 8 years in fintech.").country).toBe("PL");
    expect(detectCountryFromResume("Operations lead, Nairobi.").country).toBe("KE");
    expect(detectCountryFromResume("Software developer in Zurich.").country).toBe("CH");
  });
});

describe("detectCountryFromResume — work authorization (strongest signal)", () => {
  it("reads an explicit work-authorization statement as the target country", () => {
    const uk = detectCountryFromResume("Product Manager. British citizen with the right to work in the UK.");
    expect(uk.country).toBe("GB");
    expect(uk.source).toBe("work_authorization");

    expect(detectCountryFromResume("Engineer. Authorized to work in the US. Green card holder.").country).toBe("US");
  });
});

describe("detectCountryFromResume — education-system signals", () => {
  it("uses the education system to pin the country", () => {
    expect(detectCountryFromResume("Klaus Weber — Berlin. Software Engineer. Abitur 2010.").country).toBe("DE");
    expect(detectCountryFromResume("Priya Sharma — Bengaluru. Data Engineer. B.Tech from IIT.").country).toBe("IN");
    expect(detectCountryFromResume("James Carter. Marketing Manager. A-Levels, University of Manchester.").country).toBe("GB");
  });
});

// ─── 2026-07-25 live-audit regression: a US cloud engineer's resume received
// a full UK market report at stated high confidence. Root causes, each pinned
// below: bare "EC2" matched the UK postcode-district signal, "Seattle, WA"
// matched the case-sensitive AU state list, the US phone patterns demanded a
// literal "+1" that domestic resumes never write, the US address pattern
// demanded a ZIP, and the resulting 2-2-2 tie broke toward GB purely by map
// insertion order.
describe("detectCountryFromResume — 2026-07-25 US-resume-got-UK-report regression", () => {
  const AUDIT_RESUME = [
    "Jordan Lee — Seattle, WA",
    "(206) 555-0148 · jordan.lee@example.com",
    "Cloud Engineer. Built and operated AWS EC2, S3, and Lambda infrastructure.",
    "AWS Certified Solutions Architect - Associate.",
    "B.S. Computer Science, University of Washington.",
  ].join("\n");

  it("the exact audit resume resolves US at high confidence", () => {
    const r = detectCountryFromResume(AUDIT_RESUME);
    expect(r.country).toBe("US");
    expect(r.confidence).toBe("high");
  });

  it("bare AWS service names carry no UK signal", () => {
    const r = detectCountryFromResume("Migrated workloads to EC2 and set up SW1 and N1 node pools.");
    expect(r.country).not.toBe("GB");
  });

  it("a REAL full UK postcode still resolves GB", () => {
    const r = detectCountryFromResume("Amara Okafor — 14 Finsbury Square, EC2A 1AH. Data analyst.");
    expect(r.country).toBe("GB");
  });

  it("'B2B 2nd-largest' does not parse as a UK postcode", () => {
    expect(detectCountryFromResume("Scaled the B2B 2nd-largest vertical.").country).not.toBe("GB");
  });

  it("domestic US phone formats count as US without +1", () => {
    expect(detectCountryFromResume("Contact: (206) 555-0148").country).toBe("US");
    expect(detectCountryFromResume("Cell 206-555-0148, references available").country).toBe("US");
  });

  it("'City, ST' with no ZIP is a US signal", () => {
    const r = detectCountryFromResume("Priya Patel — Columbus, GA. Supply chain analyst.");
    expect(r.country).toBe("US");
  });

  it("a degree line 'English, MA 2015' is NOT Massachusetts", () => {
    expect(detectCountryFromResume("B.A. English, MA 2015, cum laude").country).not.toBe("US");
  });
});

describe("detectCountryFromResume — Australian signals after the WA/SA fix", () => {
  it("capitalized Australian cities now match (old regex was case-sensitive)", () => {
    expect(detectCountryFromResume("Liam O'Brien — Sydney, NSW. Operations manager.").country).toBe("AU");
    expect(detectCountryFromResume("Based in Melbourne, available immediately.").country).toBe("AU");
  });

  it("state + real postcode is address-grade AU evidence", () => {
    const r = detectCountryFromResume("42 George St, Perth WA 6000. Mining engineer.");
    expect(r.country).toBe("AU");
    expect(r.confidence).toBe("high");
  });

  it("'Seattle, WA' carries no AU signal", () => {
    const r = detectCountryFromResume("Software engineer in Seattle, WA since 2019.");
    expect(r.country).toBe("US");
  });

  it("'Windows NT' and an ACT test score carry no AU signal", () => {
    expect(detectCountryFromResume("Administered Windows NT and Solaris estates.").country).not.toBe("AU");
    expect(detectCountryFromResume("SAT 1490, ACT 34. Recent graduate.").country).not.toBe("AU");
  });

  it("'Acme SA 2019' (company suffix + year) is not an Australian address", () => {
    expect(detectCountryFromResume("Consultant, Acme SA 2019-2023, led EMEA rollouts.").country).not.toBe("AU");
  });
});

describe("detectCountryFromResume — deterministic ties", () => {
  it("an exact one-city-each tie reports LOW confidence (caller defers to IP)", () => {
    const r = detectCountryFromResume("Coordinated the London and Seattle launch events.");
    expect(r.confidence).toBe("low");
    expect(r.country).toBe("US"); // traffic-priority order, not map insertion order
  });
});

// ─── Adversarial-review round (2026-07-25): each block pins a confirmed
// finding from the pre-ship review of the country-detection fix.
describe("detectCountryFromResume — NANP shape rejects foreign domestic formats", () => {
  it("Israeli 05X-XXX-XXXX is not a US phone", () => {
    const r = detectCountryFromResume("Noa Cohen — Tel Aviv\n054-123-4567\nBackend engineer.");
    expect(r.country).toBe("IL");
  });

  it("Irish (0XX) XXX XXXX is not a US phone", () => {
    const r = detectCountryFromResume("Aoife Murphy — Cork, Ireland\n(021) 496 1234\nAccountant.");
    expect(r.country).toBe("IE");
  });

  it("Colombian 300-1XX-XXXX is not a US phone (exchange starts with 1)", () => {
    const r = detectCountryFromResume("Camila Rojas — Bogotá\n300-123-4567\nProduct designer.");
    expect(r.country).toBe("CO");
  });

  it("real US formats still match after the [2-9] tightening", () => {
    expect(detectCountryFromResume("Contact: (206) 555-0148").country).toBe("US");
    expect(detectCountryFromResume("Cell 206-555-0148").country).toBe("US");
  });
});

describe("detectCountryFromResume — UK postcode vs hardware/spec bigrams", () => {
  it("'EC2 8GB' and 'S3 4TB' spec lines carry no UK signal", () => {
    const r = detectCountryFromResume(
      "Alex Rivera — Cloud Engineer\nProvisioned EC2 8GB instances behind ALB.\nMigrated S3 4TB data lake.",
    );
    expect(r.country).not.toBe("GB");
  });
});

describe("detectCountryFromResume — Brazilian state codes vs US 'City, ST'", () => {
  it("'Florianópolis, SC' ties BR vs US at LOW confidence instead of scoring US outright", () => {
    const r = detectCountryFromResume("Lucas Ferreira — Florianópolis, SC\nSenior Software Engineer.");
    expect(r.confidence).toBe("low"); // the caller's IP fallback decides
  });
});

describe("detectCountryFromResume — full AU postcode ranges", () => {
  it("Tuggeranong-district Canberra (ACT 29xx) is address-grade AU", () => {
    const r = detectCountryFromResume("12 Smith St, Kambah ACT 2902. APS6 policy officer.");
    expect(r.country).toBe("AU");
    expect(r.confidence).toBe("high");
  });
});

describe("formatGeoContextForPrompt — honors the caller's resolved country", () => {
  const tieGeo = {
    country: "GB" as const,
    confidence: "low" as const,
    signals: [],
    source: "address" as const,
  };

  it("prompt names the caller's country, not the raw tie winner", () => {
    const hint = formatGeoContextForPrompt("US", "technology", tieGeo, "ip");
    expect(hint).toContain("United States");
    expect(hint).not.toContain("Candidate Location: United Kingdom");
    expect(hint).toContain("inferred from IP");
  });

  it("a selected target market reaches the prompt with target provenance", () => {
    const usGeo = { country: "US" as const, confidence: "high" as const, signals: [], source: "phone" as const };
    const hint = formatGeoContextForPrompt("GB", "finance", usGeo, "target");
    expect(hint).toContain("United Kingdom");
    expect(hint).toContain("the market the candidate selected");
  });
});
