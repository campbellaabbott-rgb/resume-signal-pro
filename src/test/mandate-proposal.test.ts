import { describe, expect, it } from "vitest";
import { EMPTY_PROPOSAL, proposeMandate, toMandateField } from "@/lib/mandateProposal";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";

/**
 * A proposal that is WRONG is worse than no proposal, because a pre-filled
 * field is one a person skims rather than reads. So most of what is tested here
 * is refusal: the things this must NOT put in somebody's mandate.
 */

const PM_CV = `Jane Okafor
jane.okafor@example.com · +44 7700 900123 · London, UK
linkedin.com/in/janeokafor

PROFESSIONAL EXPERIENCE

Senior Product Manager | Monzo | 2021 – Present
• Led the payments platform team through a full re-architecture
• Owned a roadmap spanning four squads and £12m of annual revenue

Product Manager, Payments — Starling Bank — 2018 - 2021
• Shipped the merchant onboarding flow

Business Analyst, Deloitte, 2016 – 2018
• Built the reporting layer used by 200 analysts

EDUCATION
BSc Economics, University of Bristol, 2016
`;

describe("proposeMandate reads roles off the CV", () => {
  const p = proposeMandate(PM_CV);

  it("leads with the most recent role", () => {
    expect(p.titles[0]?.value).toBe("Product Manager");
  });

  it("strips the seniority prefix, because the runner matches ILIKE %term%", () => {
    // "Senior Product Manager" as a mandate term matches only titles containing
    // that exact phrase — it would miss every "Product Manager II" on the board.
    expect(p.titles.map((x) => x.value)).not.toContain("Senior Product Manager");
    expect(p.titles[0]?.value).toBe("Product Manager");
  });

  it("carries the line it came from, verbatim enough to recognise", () => {
    expect(p.titles[0]?.evidence).toContain("Senior Product Manager");
    for (const t of p.titles) {
      expect(t.evidence.length, "a proposal with no evidence cannot be shown honestly").toBeGreaterThan(0);
    }
  });

  it("never proposes the same role twice under different seniority", () => {
    // "Senior Product Manager" and "Product Manager, Payments" both reduce to
    // "Product Manager"; two identical chips would read as two searches.
    const values = p.titles.map((x) => x.value.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });

  it("proposes the city, not the city and country", () => {
    // "London, UK" carries a comma, which the mandate reads as a term separator
    // — so the value would silently become two searches, one of them "UK".
    expect(p.locations[0]?.value).toBe("London");
    for (const l of p.locations) expect(l.value).not.toContain(",");
  });

  it("maps to a category the board actually serves", () => {
    expect(p.category?.slug).toBe("product");
    expect(BOARD_CATEGORY_SLUGS as readonly string[]).toContain(p.category!.slug);
  });

  it("offers adjacent roles, and never claims they came from the CV", () => {
    expect(p.adjacent.length).toBeGreaterThan(0);
    for (const a of p.adjacent) {
      expect(PM_CV.toLowerCase().includes(a.toLowerCase()) && a === "product manager").toBe(false);
    }
  });
});

describe("what it refuses to propose", () => {
  it("returns nothing at all for text too short to be a CV", () => {
    expect(proposeMandate("Jane Okafor, London")).toEqual(EMPTY_PROPOSAL);
    expect(proposeMandate(null)).toEqual(EMPTY_PROPOSAL);
    expect(proposeMandate(undefined)).toEqual(EMPTY_PROPOSAL);
  });

  it("does not read an achievement bullet as a job title", () => {
    // "• Led the migration ..." contains "Led", which is a role word. A bullet
    // is the most common line in a CV, so getting this wrong would fill the
    // proposal with sentences.
    const cv = `Sam Rivers
sam@example.com

EXPERIENCE
Software Engineer | Acme | 2020 - Present
• Led the migration of the billing service to Kubernetes
• Managed a team of four engineers through two releases
${"x".repeat(120)}`;
    const p = proposeMandate(cv);
    expect(p.titles.map((t) => t.value)).toEqual(["Software Engineer"]);
  });

  it("does not read a section heading as a job title", () => {
    const cv = `Ann Lee
ann@example.com

PROFESSIONAL EXPERIENCE
Data Analyst | Ocado | 2019 - Present
Delivered dashboards across three teams and two regions of the business today
`;
    const p = proposeMandate(cv);
    expect(p.titles.map((t) => t.value)).toContain("Data Analyst");
    expect(p.titles.map((t) => t.value.toLowerCase())).not.toContain("professional experience");
  });

  it("does not read a place out of the body of the CV", () => {
    // The employer's location, a university town, a conference — none of them
    // is a statement about where this person wants to work.
    const cv = `Ana Silva
ana@example.com

EXPERIENCE
Marketing Manager | Globex | 2020 - Present
Ran campaigns from the office in Berlin, Germany and across the wider region
Studied at a university in Boston, MA before moving into marketing full time
${"x".repeat(80)}`;
    const p = proposeMandate(cv);
    expect(p.locations.map((l) => l.value)).not.toContain("Berlin");
    expect(p.locations.map((l) => l.value)).not.toContain("Boston");
  });

  it("does not read 'Design, UX' as a place", () => {
    // A two-token comma pattern is everywhere in a skills list. Only real state
    // codes and country names qualify, or every CV proposes a nonsense location.
    const cv = `Kit Moore
kit@example.com · Design, UX · Product, Research

EXPERIENCE
Product Designer | Figma | 2021 - Present
${"x".repeat(120)}`;
    const p = proposeMandate(cv);
    expect(p.locations.map((l) => l.value)).not.toContain("Design");
    expect(p.locations.map((l) => l.value)).not.toContain("Product");
  });

  it("proposes no category rather than a wrong one", () => {
    // "Any field" searches the whole board. A wrong category silently hides
    // most of it, and the symptom is an empty queue that looks like no jobs.
    const cv = `Pat Doe
pat@example.com

EXPERIENCE
Chief of Staff | Someco | 2020 - Present
Coordinated the executive team across several unrelated functions each quarter
${"x".repeat(80)}`;
    const p = proposeMandate(cv);
    if (p.category) expect(BOARD_CATEGORY_SLUGS as readonly string[]).toContain(p.category.slug);
  });

  it("does not gut a title whose seniority word is the whole job", () => {
    const cv = `Robin Fox
robin@example.com

EXPERIENCE
Director of Engineering | Bigco | 2019 - Present
Built the platform group from six people to forty across three product lines
${"x".repeat(80)}`;
    const p = proposeMandate(cv);
    // Stripping "Director of" would leave "Engineering", a department.
    expect(p.titles[0]?.value).toBe("Director of Engineering");
  });
});

describe("category routing on titles that share a word", () => {
  const forTitle = (title: string) =>
    proposeMandate(`N Person\nn@example.com\n\nEXPERIENCE\n${title} | Co | 2020 - Present\n${"x".repeat(120)}`)
      .category?.slug;

  it("sends a data engineer to data_ai, not engineering", () => {
    expect(forTitle("Data Engineer")).toBe("data_ai");
  });
  it("sends a sales engineer to sales, not engineering", () => {
    expect(forTitle("Sales Engineer")).toBe("sales");
  });
  it("sends a security engineer to security", () => {
    expect(forTitle("Security Engineer")).toBe("security");
  });
  it("still sends a plain software engineer to engineering", () => {
    expect(forTitle("Software Engineer")).toBe("engineering");
  });
});

describe("toMandateField writes what the runner will read", () => {
  it("joins with the separator the runner splits on", () => {
    expect(toMandateField(["Product Manager", "Programme Manager"]))
      .toBe("Product Manager, Programme Manager");
  });

  it("strips a comma inside a term rather than escaping it", () => {
    // A surviving comma is read by agent-runner as a separator, which widens
    // the search to terms nobody typed — the failure mode that is invisible.
    expect(toMandateField(["Product Manager, Payments"])).toBe("Product Manager Payments");
  });

  it("strips the PostgREST or() metacharacters too", () => {
    expect(toMandateField(["Engineer (Backend)*"])).toBe("Engineer Backend");
  });

  it("honours the same 12-term bound the runner enforces", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Role ${i}`);
    expect(toMandateField(many).split(",").length).toBe(12);
  });

  it("drops empties instead of emitting a bare separator", () => {
    expect(toMandateField(["Engineer", "  ", ""])).toBe("Engineer");
  });
});
