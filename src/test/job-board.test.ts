// Job board normalizer contract, locked against REAL payload shapes captured
// from each ATS's official public API on 2026-07-11. If a vendor changes its
// schema, these fail loudly instead of the board going silently empty.
import { describe, it, expect } from "vitest";
import {
  filterJobs,
  htmlToText,
  normalizeAshby,
  normalizeGreenhouse,
  normalizeLever,
  sortJobs,
} from "../../supabase/functions/job-board/normalize";
import { categorize, JOB_CATEGORIES } from "../../supabase/functions/job-board/categories";
import { normalizeSmartRecruiters, normalizeWorkable } from "../../supabase/functions/job-board/normalize";
import { searchName, searchToQuery } from "../../src/lib/job-search-params";
import { computeFit } from "../../supabase/functions/_shared/fit-score";
import { normalizeBambooHR } from "../../supabase/functions/job-board/normalize";
import { leverSalary, sanePostedAt, isDatedBefore, safeIso, normalizeCloseTitle, detectCountry, normalizeRippling, extractRipplingJobPosts, normalizeWorkday, workdayPostedDays, normalizePinpoint } from "../../supabase/functions/job-board/normalize";
import { classifyDormancy, updateBoardFailures } from "../../supabase/functions/job-board/dormancy";
import { rawItemCount, aggregateVendorHealth, CANARIES, type CanaryResult } from "../../supabase/functions/job-board/vendor-canary";

// ── real captured fixtures (trimmed to the fields the APIs actually send) ──
const GH_FIXTURE = {
  jobs: [
    {
      absolute_url: "https://stripe.com/jobs/search?gh_jid=7954688",
      internal_job_id: 3453698,
      location: { name: "San Francisco, CA" },
      id: 7954688,
      updated_at: "2026-06-26T17:05:44-04:00",
      title: "Account Executive, AI Sales (Grower)",
      company_name: "Stripe",
      first_published: "2026-06-02T08:58:57-04:00",
    },
    {
      absolute_url: "https://stripe.com/jobs/search?gh_jid=100",
      id: 100,
      location: { name: "Remote, US" },
      title: "Staff Engineer",
      updated_at: "2026-07-01T00:00:00-04:00",
      // no first_published — stays undated (updated_at re-stamps on edits,
      // so treating it as a posting date would bias every age stat young)
    },
  ],
};

const LEVER_FIXTURE = [
  {
    id: "0bbfd4f4-41ff-4ec6-b73f-5200efd5d4d3",
    text: "Administrative Business Partner - Security",
    categories: {
      commitment: "Full-time",
      location: "Palo Alto, CA",
      team: "Administrative",
      allLocations: ["Palo Alto, CA"],
    },
    hostedUrl: "https://jobs.lever.co/palantir/0bbfd4f4",
    applyUrl: "https://jobs.lever.co/palantir/0bbfd4f4/apply",
    createdAt: 1778622524938,
    workplaceType: "hybrid",
    country: "US",
    descriptionPlain: "About the role...",
  },
  {
    id: "remote-1",
    text: "Deployment Strategist",
    categories: { location: "Remote - US", team: "Deployment" },
    hostedUrl: "https://jobs.lever.co/palantir/remote-1",
    createdAt: 1779000000000,
    workplaceType: "remote",
  },
];

const ASHBY_FIXTURE = {
  jobs: [
    {
      id: "d5573afa-636c-4219-832f-386f498243bf",
      title: "Customer Solution Architect (AMER)",
      location: "Remote",
      secondaryLocations: [],
      department: "Growth",
      team: "Success",
      isRemote: true,
      isListed: true,
      publishedAt: "2024-11-14T17:58:07.662+00:00",
      jobUrl: "https://jobs.ashbyhq.com/supabase/d5573afa",
      applyUrl: "https://jobs.ashbyhq.com/supabase/d5573afa/application",
      employmentType: "FullTime",
    },
    {
      id: "unlisted-1",
      title: "Hidden role",
      isListed: false, // must be filtered out
      jobUrl: "https://jobs.ashbyhq.com/supabase/unlisted-1",
    },
  ],
};

describe("normalizeWorkday + workdayPostedDays", () => {
  // Real captured list items from nvidia.wd5.myworkdayjobs.com (2026-07-16).
  const WD_ITEMS = [
    { title: "Senior Software Engineer, AI Storage", externalPath: "/job/US-CA-Santa-Clara/Senior-Software-Engineer--AI-Storage_JR2014785", locationsText: "US, CA, Santa Clara", postedOn: "Posted Today", bulletFields: ["JR2014785"] },
    { title: "Remote Solutions Architect", externalPath: "/job/Remote/Remote-Solutions-Architect_JR2010101", locationsText: "United States", postedOn: "Posted 5 Days Ago", bulletFields: ["JR2010101"] },
    { title: "Ancient Role", externalPath: "/job/US/Ancient-Role_JR9", locationsText: "US, TX, Austin", postedOn: "Posted 30+ Days Ago", bulletFields: ["JR9"] },
  ];
  it("parses the relative posting age", () => {
    expect(workdayPostedDays("Posted Today")).toBe(0);
    expect(workdayPostedDays("Posted Yesterday")).toBe(1);
    expect(workdayPostedDays("Posted 5 Days Ago")).toBe(5);
    expect(workdayPostedDays("Posted 30+ Days Ago")).toBe(31);
    expect(workdayPostedDays("nonsense")).toBeNull();
  });
  it("maps CXS list items, drops the 30+day tail, dates from the stated relative age", () => {
    const jobs = normalizeWorkday(WD_ITEMS as never, "NVIDIA", "nvidia~wd5~NVIDIAExternalCareerSite");
    expect(jobs).toHaveLength(2); // the 30+day posting is dropped by the freshness filter
    expect(jobs[0]).toMatchObject({
      id: "workday:nvidia~wd5~NVIDIAExternalCareerSite:JR2014785",
      title: "Senior Software Engineer, AI Storage",
      country: "US",
      applyUrl: "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Software-Engineer--AI-Storage_JR2014785",
    });
    // "Posted Today" → dated now (±ms); "Posted 5 Days Ago" → ~5d back. The
    // relative age IS the company's stated date, converted at day precision.
    expect(Math.abs(Date.parse(jobs[0].postedAt!) - Date.now())).toBeLessThan(60_000);
    const fiveDays = Date.now() - 5 * 86_400_000;
    expect(Math.abs(Date.parse(jobs[1].postedAt!) - fiveDays)).toBeLessThan(60_000);
    expect(jobs[1].remote).toBe(true); // "Remote Solutions Architect"
    expect(jobs.some((j) => j.title === "Ancient Role")).toBe(false);
  });
  it("rejects a malformed compound token rather than emitting broken ids", () => {
    expect(normalizeWorkday(WD_ITEMS as never, "X", "just-a-tenant")).toEqual([]);
  });
});

describe("normalizePinpoint", () => {
  // Live-captured shape from agencyanalytics.pinpointhq.com/postings.json (2026-07-17).
  const PP_ITEMS = [
    {
      id: "509212", title: "Head of Engineering",
      url: "https://agencyanalytics.pinpointhq.com/en/postings/910be08b-c49d-4052-925a-29373b1e3820",
      workplace_type: "hybrid", compensation_visible: false, compensation_minimum: null,
      location: { city: "Toronto", name: "Hybrid - Toronto ", province: "Ontario" },
      job: { department: { name: "Engineering" } },
    },
    {
      id: "600001", title: "Remote Data Analyst",
      url: "https://agencyanalytics.pinpointhq.com/en/postings/abc",
      workplace_type: "remote", compensation_visible: true,
      compensation_minimum: 90000, compensation_maximum: 110000,
      compensation_currency: "CAD", compensation_frequency: "annually",
      location: { name: "Remote - Canada" }, job: { department: { name: "Data" } },
    },
    { id: "", title: "No Url Role", url: "", workplace_type: "onsite" },
  ];
  it("maps postings: undated-honest, salary only when visible, remote from workplace_type", () => {
    const jobs = normalizePinpoint(PP_ITEMS as never, "AgencyAnalytics", "agencyanalytics");
    expect(jobs).toHaveLength(2); // empty url/id row dropped
    expect(jobs[0]).toMatchObject({
      id: "pinpoint:agencyanalytics:509212",
      title: "Head of Engineering",
      postedAt: null,
      salary: null, // compensation_visible false — never invented
      department: "Engineering",
      country: "CA",
    });
    expect(jobs[0].location).toBe("Hybrid - Toronto");
    expect(jobs[1].remote).toBe(true);
    expect(jobs[1].salary).toBe("CAD 90,000\u2013110,000 per year");
  });
});

describe("normalizeRippling + extractRipplingJobPosts", () => {
  // Real captured item shapes from ats.rippling.com/aalo-atomics/jobs (2026-07-16),
  // one mutated to REMOTE to lock the workplaceType mapping.
  const RIPPLING_ITEMS = [
    {
      id: "8d4783fb-b22c-4cfd-ae34-81d4b2ad628f",
      name: "AI Platform Architect",
      url: "https://ats.rippling.com/aalo-atomics/jobs/8d4783fb-b22c-4cfd-ae34-81d4b2ad628f",
      department: { name: "Engineering" },
      locations: [{ name: "Austin, TX", country: "United States", countryCode: "US", city: "Austin", workplaceType: "ON_SITE" }],
    },
    {
      id: "7f01827b-9bb6-4bb1-9e2e-8769c118211e",
      name: "Staff Software Engineer",
      url: "https://ats.rippling.com/aalo-atomics/jobs/7f01827b-9bb6-4bb1-9e2e-8769c118211e",
      department: { name: "Engineering" },
      locations: [
        { name: "Remote (US)", country: "United States", countryCode: "US", workplaceType: "REMOTE" },
        { name: "Austin, TX", country: "United States", countryCode: "US", workplaceType: "ON_SITE" },
      ],
    },
  ];
  it("maps the embedded board items — undated, feed-stated country, remote from workplaceType", () => {
    const jobs = normalizeRippling(RIPPLING_ITEMS as never, "Aalo Atomics", "aalo-atomics");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "rippling:aalo-atomics:8d4783fb-b22c-4cfd-ae34-81d4b2ad628f",
      title: "AI Platform Architect",
      location: "Austin, TX",
      remote: false,
      postedAt: null, // the board payload carries no dates — never invented
      country: "US",  // feed-stated ISO code, no location-text guessing needed
      applyUrl: "https://ats.rippling.com/aalo-atomics/jobs/8d4783fb-b22c-4cfd-ae34-81d4b2ad628f",
    });
    expect(jobs[1].remote).toBe(true);
    expect(jobs[1].location).toBe("Remote (US) +1 more");
  });
  it("extracts items + totalPages from __NEXT_DATA__, null on unrecognizable shape", () => {
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { dehydratedState: { queries: [
        { queryKey: ["board", "aalo-atomics", "job-posts", false, {}], state: { data: { items: RIPPLING_ITEMS, totalPages: 3 } } },
      ] } } },
    })}</script></html>`;
    const page = extractRipplingJobPosts(html);
    expect(page?.items).toHaveLength(2);
    expect(page?.totalPages).toBe(3);
    expect(extractRipplingJobPosts("<html>no payload</html>")).toBeNull(); // drift signal, not empty board
  });
});

describe("detectCountry (deterministic, never guesses)", () => {
  it("resolves explicit country names and US/CA state patterns", () => {
    expect(detectCountry("Dallas, Texas, United States")).toBe("US");
    expect(detectCountry("Austin, TX")).toBe("US");
    expect(detectCountry("Remote - US")).toBe("US");
    expect(detectCountry("Toronto, ON")).toBe("CA");
    expect(detectCountry("Vancouver, British Columbia")).toBe("CA");
    expect(detectCountry("Berlin, Germany")).toBe("DE");
    expect(detectCountry("München, Deutschland")).toBe("DE");
    expect(detectCountry("London, United Kingdom")).toBe("GB");
    expect(detectCountry("Warszawa, Polska")).toBe("PL");
    expect(detectCountry("Manila, Philippines")).toBe("PH");
  });
  it("resolves bare major cities — state/province checks run FIRST, which is what makes this safe", () => {
    // North American feeds essentially always qualify their cities ("London,
    // ON", "Melbourne, FL", "Dublin, OH"), and those resolve via the state and
    // province checks BEFORE the city table is consulted. A bare segment is
    // therefore the non-NA reading. Contract changed 2026-07-25 (was: null).
    expect(detectCountry("London")).toBe("GB");
    expect(detectCountry("London, ON")).toBe("CA");        // province wins first
    expect(detectCountry("Melbourne")).toBe("AU");
    expect(detectCountry("Melbourne, FL")).toBe("US");     // state wins first
    expect(detectCountry("Kuala Lumpur")).toBe("MY");
    expect(detectCountry("Pune, Maharashtra")).toBe("IN");
    // Exact SEGMENT matching, never substring:
    expect(detectCountry("Santiago de Compostela, Spain")).toBe("ES");
  });
  it("returns null for ambiguous or unplaceable locations", () => {
    expect(detectCountry("Tbilisi, Georgia")).toBeNull(); // country vs US state
    expect(detectCountry("Remote")).toBeNull();
    expect(detectCountry("EMEA")).toBeNull();
    expect(detectCountry("Perugia, Italy")).toBe("IT");   // not PE(ru)
    expect(detectCountry(null)).toBeNull();
    expect(detectCountry("")).toBeNull();
  });
});

describe("normalizeCloseTitle (superseded detection)", () => {
  it("strips req-id noise so decorated reposts still match", () => {
    expect(normalizeCloseTitle("Behavior Technician (R-48213)")).toBe("behavior technician");
    expect(normalizeCloseTitle("Registered Nurse - #10422")).toBe("registered nurse");
    expect(normalizeCloseTitle("Software Engineer [Req 20931]")).toBe("software engineer");
    expect(normalizeCloseTitle("Care Coordinator – 88231")).toBe("care coordinator");
  });
  it("never strips words — seniority differences stay distinct", () => {
    expect(normalizeCloseTitle("Senior Software Engineer")).toBe("senior software engineer");
    expect(normalizeCloseTitle("Engineer (Remote)")).toBe("engineer (remote)"); // no digits — kept
    expect(normalizeCloseTitle("24/7 Support Agent")).toBe("24/7 support agent"); // leading digits kept
  });
});

describe("normalizers", () => {
  it("maps the real Greenhouse shape (id, location.name, first_published, absolute_url)", () => {
    const jobs = normalizeGreenhouse(GH_FIXTURE, "Stripe", "stripe");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "greenhouse:stripe:7954688",
      company: "Stripe",
      title: "Account Executive, AI Sales (Grower)",
      location: "San Francisco, CA",
      remote: false,
      postedAt: "2026-06-02T08:58:57-04:00",
      applyUrl: "https://stripe.com/jobs/search?gh_jid=7954688",
    });
    // no first_published -> undated (never updated_at) + remote inferred from location text
    expect(jobs[1].postedAt).toBeNull();
    expect(jobs[1].remote).toBe(true);
  });

  it("maps the real Lever shape (text, categories, epoch createdAt, workplaceType)", () => {
    const jobs = normalizeLever(LEVER_FIXTURE as never, "Palantir", "palantir");
    expect(jobs[0]).toMatchObject({
      id: "lever:palantir:0bbfd4f4-41ff-4ec6-b73f-5200efd5d4d3",
      title: "Administrative Business Partner - Security",
      location: "Palo Alto, CA",
      department: "Administrative",
      remote: false,
      applyUrl: "https://jobs.lever.co/palantir/0bbfd4f4",
    });
    expect(jobs[0].postedAt).toBe(new Date(1778622524938).toISOString());
    expect(jobs[1].remote).toBe(true); // workplaceType === "remote"
  });

  it("maps the real Ashby shape and drops unlisted postings", () => {
    const jobs = normalizeAshby(ASHBY_FIXTURE as never, "Supabase", "supabase");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: "ashby:supabase:d5573afa-636c-4219-832f-386f498243bf",
      title: "Customer Solution Architect (AMER)",
      remote: true,
      department: "Growth",
      applyUrl: "https://jobs.ashbyhq.com/supabase/d5573afa",
    });
  });
});

describe("new vendor normalizers (real captured shapes)", () => {
  it("maps SmartRecruiters (Visa sample): location object, function label, constructed apply URL", () => {
    const jobs = normalizeSmartRecruiters(
      { content: [{
        id: "744000133907678",
        name: "Sr. Manager",
        releasedDate: "2026-06-24T10:00:11.853Z",
        location: { city: "Austin", region: "TX", country: "us", remote: false, fullLocation: "Austin, TX, United States" },
        department: { label: "Software Development/Engineering" },
        function: { label: "Engineering" },
      }] },
      "Visa", "visa",
    );
    expect(jobs[0]).toMatchObject({
      id: "smartrecruiters:visa:744000133907678",
      company: "Visa",
      location: "Austin, TX, United States",
      department: "Engineering",
      category: "engineering",
      postedAt: "2026-06-24T10:00:11.853Z",
      applyUrl: "https://jobs.smartrecruiters.com/visa/744000133907678",
    });
  });

  it("maps Workable (Blueground sample): shortcode id, telecommuting remote, date-only postedAt", () => {
    const jobs = normalizeWorkable(
      { jobs: [{
        title: "Business Development Account Executive - Partner Network",
        shortcode: "38ABFA8E0D",
        telecommuting: true,
        department: "Shared Services",
        url: "https://apply.workable.com/j/38ABFA8E0D",
        published_on: "2026-03-02",
        created_at: "2026-02-24",
        country: "Greece",
        city: "",
        state: "",
      }] },
      "Blueground", "blueground",
    );
    expect(jobs[0]).toMatchObject({
      id: "workable:blueground:38ABFA8E0D",
      remote: true,
      location: "Greece",
      category: "sales",
      applyUrl: "https://apply.workable.com/j/38ABFA8E0D",
    });
    expect(jobs[0].postedAt).toBe(new Date("2026-03-02").toISOString());
  });
});

describe("fit scoring + salary mapping", () => {
  it("computeFit is deterministic and directionally sane", () => {
    const posting = "We need Python, Kubernetes, SQL and project management experience.";
    const strong = computeFit(posting, "Led project management for Python services on Kubernetes with SQL analytics.");
    const weak = computeFit(posting, "Barista experience with latte art and customer service.");
    expect(strong.pct).not.toBeNull();
    expect(weak.pct ?? 0).toBeLessThan(strong.pct ?? 0);
    expect(computeFit(posting, "Python Kubernetes SQL project management").pct)
      .toBe(computeFit(posting, "Python Kubernetes SQL project management").pct);
  });

  it("computeFit returns null when the posting has no recognized terms", () => {
    expect(computeFit("", "any resume").pct).toBeNull();
  });

  it("computeFit surfaces missing keywords the board card nudges on", () => {
    // Board fit-first (#1): a term the posting needs but the resume lacks must
    // land in `missing` (rendered as "Add to compete: …"), and a term the
    // resume covers must land in `matched`, never `missing`.
    const posting = "We need Python, Kubernetes, SQL and project management experience.";
    const fit = computeFit(posting, "Senior engineer with Python and SQL experience.");
    expect(fit.matched).toEqual(expect.arrayContaining(["python", "sql"]));
    expect(fit.missing).toEqual(expect.arrayContaining(["kubernetes"]));
    // A term can't be both matched and missing.
    expect(fit.matched.filter((m) => fit.missing.includes(m))).toEqual([]);
    // Missing is bounded enough to slice the top few for the card without going empty.
    expect(fit.missing.length).toBeGreaterThan(0);
  });

  it("sanePostedAt rejects garbage feed dates, keeps real ones", () => {
    const now = Date.parse("2026-07-12T00:00:00Z");
    // Real recent date passes through unchanged.
    expect(sanePostedAt("2026-07-01T00:00:00Z", now)).toBe("2026-07-01T00:00:00Z");
    // The live 2009 Palantir-style garbage date is rejected.
    expect(sanePostedAt("2009-12-05T00:00:00Z", now)).toBeNull();
    // Future beyond clock-skew grace is rejected; within grace is kept.
    expect(sanePostedAt("2027-01-01T00:00:00Z", now)).toBeNull();
    expect(sanePostedAt("2026-07-13T06:00:00Z", now)).toBe("2026-07-13T06:00:00Z");
    // Real-but-old dates PASS: the freshness cap drops those postings at
    // ingest. Nulling them here is what used to keep 3-year-old evergreens
    // alive undated past the 30-day promise.
    expect(sanePostedAt("2023-08-01T00:00:00Z", now)).toBe("2023-08-01T00:00:00Z");
    expect(sanePostedAt("2022-01-01T00:00:00Z", now)).toBe("2022-01-01T00:00:00Z");
    // Null / empty / unparseable all collapse to null.
    expect(sanePostedAt(null, now)).toBeNull();
    expect(sanePostedAt("", now)).toBeNull();
    expect(sanePostedAt("not a date", now)).toBeNull();
  });

  it("safeIso converts feed dates without ever throwing on garbage", () => {
    // Valid epoch number (Lever's createdAt shape) → ISO.
    expect(safeIso(Date.parse("2026-07-01T00:00:00Z"))).toBe("2026-07-01T00:00:00.000Z");
    // Valid date string (Workable's published_on shape) → ISO.
    expect(safeIso("2026-07-01")).toBe("2026-07-01T00:00:00.000Z");
    // Absent values collapse to null.
    expect(safeIso(null)).toBeNull();
    expect(safeIso(undefined)).toBeNull();
    expect(safeIso("")).toBeNull();
    // The crash regression: a non-empty garbage date must return null, NOT throw.
    // `new Date("garbage").toISOString()` raises a RangeError — inside a normalizer
    // that would silently fail the board's entire ingest. safeIso absorbs it.
    expect(() => safeIso("garbage")).not.toThrow();
    expect(safeIso("garbage")).toBeNull();
    expect(safeIso("2026-13-45")).toBeNull();
  });

  it("normalizeWorkable survives a malformed published_on (no throw, null date)", () => {
    // A board whose feed carries a broken date must still ingest — the posting
    // just shows dateless — rather than throwing and taking the whole board down.
    const jobs = normalizeWorkable(
      { jobs: [{ title: "Engineer", shortcode: "abc", published_on: "not-a-date", url: "https://apply.workable.com/j/abc" } as never] },
      "Acme",
      "acme",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].postedAt).toBeNull();
  });

  it("isDatedBefore drops known-old postings but never undated ones", () => {
    const cutoff = Date.parse("2026-06-12T00:00:00Z"); // 30 days before 2026-07-12
    // A real date past the window is dropped.
    expect(isDatedBefore("2026-05-01T00:00:00Z", cutoff)).toBe(true);
    // A real date inside the window is kept.
    expect(isDatedBefore("2026-07-01T00:00:00Z", cutoff)).toBe(false);
    // Undated / garbage-dated (sanePostedAt already collapsed to null) is NEVER
    // dropped on age — we can't prove it's old. This is the subtle safety point.
    expect(isDatedBefore(null, cutoff)).toBe(false);
    // Composed with sanePostedAt: a garbage 2009 date sanitizes to null, so the
    // freshness cap keeps the posting (shown dateless) rather than dropping it.
    expect(isDatedBefore(sanePostedAt("2009-01-01T00:00:00Z", cutoff), cutoff)).toBe(false);
  });

  it("leverSalary formats ranges and rejects empties", () => {
    expect(leverSalary({ min: 120000, max: 160000, currency: "USD", interval: "yearly" })).toContain("120k");
    expect(leverSalary({ min: 120000, max: 160000, currency: "USD", interval: "yearly" })).toContain("$");
    expect(leverSalary(undefined)).toBeNull();
    expect(leverSalary({ currency: "USD" })).toBeNull();
  });
});

describe("BambooHR normalizer (real captured shape)", () => {
  it("maps the careers/list payload with atsLocation fallbacks", () => {
    const jobs = normalizeBambooHR(
      { result: [{
        id: "109",
        jobOpeningName: "Solutions Architect",
        departmentLabel: "CSM",
        isRemote: null,
        location: { city: null, state: null },
        atsLocation: { country: "United Kingdom", state: null, province: null, city: "London" },
      }] },
      "Bitrise", "bitrise",
    );
    expect(jobs[0]).toMatchObject({
      id: "bamboohr:bitrise:109",
      company: "Bitrise",
      title: "Solutions Architect",
      location: "London, United Kingdom",
      remote: false,
      department: "CSM",
      postedAt: null,
      applyUrl: "https://bitrise.bamboohr.com/careers/109",
    });
  });
});

describe("saved-search helpers", () => {
  it("builds readable names and round-trippable URLs", () => {
    const p = { q: "nurse", category: "healthcare", remote: true };
    expect(searchName(p, "Healthcare & Clinical")).toBe("nurse · Healthcare & Clinical · remote");
    expect(searchName({})).toBe("All jobs");
    expect(searchToQuery(p)).toBe("/jobs?q=nurse&remote=1&category=healthcare");
    expect(searchToQuery({})).toBe("/jobs");
  });
});

describe("htmlToText", () => {
  it("unescapes Greenhouse's entity-escaped HTML before stripping tags", () => {
    // Greenhouse returns content like this — escaped, not raw HTML.
    const escaped = "&lt;p&gt;About the &lt;strong&gt;role&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Ship things&lt;/li&gt;&lt;/ul&gt;";
    const text = htmlToText(escaped);
    expect(text).toContain("About the role");
    expect(text).toContain("Ship things");
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).not.toContain("&lt;");
  });

  it("keeps &amp; content and drops script/style blocks", () => {
    expect(htmlToText("R&amp;D <style>p{}</style><script>x()</script> team")).toBe("R&D team");
  });

  it("handles Greenhouse's double-escaped entities (&amp;nbsp; inside escaped HTML)", () => {
    // Real production artifact: "Req ID: FEQ227R81&nbsp;" survived one pass.
    const doubleEscaped = "&lt;p&gt;Req ID: FEQ227R81&amp;nbsp;Location: Osaka&amp;amp;Kyoto&lt;/p&gt;";
    const text = htmlToText(doubleEscaped);
    expect(text).toContain("Req ID: FEQ227R81 Location: Osaka&Kyoto");
    expect(text).not.toContain("&nbsp;");
    expect(text).not.toContain("&amp;");
  });
});

describe("client/server category contract", () => {
  it("Jobs.tsx CATEGORY_IDS mirrors the edge function's JOB_CATEGORIES exactly", async () => {
    const fs = await import("node:fs");
    const client = fs.readFileSync("src/pages/Jobs.tsx", "utf8");
    const m = client.match(/CATEGORY_IDS = \[([\s\S]*?)\]/);
    const clientIds = [...(m?.[1] ?? "").matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
    expect(clientIds).toEqual([...JOB_CATEGORIES].sort());
  });
});

describe("categorize", () => {
  it("maps departments first (curated signal wins)", () => {
    expect(categorize("Team Member", "Sales")).toBe("sales");
    expect(categorize("Software Engineer", "Clinical Operations")).toBe("healthcare");
    expect(categorize("Coordinator", "People")).toBe("people_hr");
  });

  it("maps titles across non-tech fields", () => {
    expect(categorize("Registered Nurse - ICU")).toBe("healthcare");
    expect(categorize("Senior Accountant")).toBe("finance");
    expect(categorize("Warehouse Associate, Night Shift")).toBe("operations");
    expect(categorize("Line Cook")).toBe("hospitality_retail");
    expect(categorize("Corporate Counsel")).toBe("legal");
    expect(categorize("Curriculum Designer")).toBe("education");
    expect(categorize("Research Associate, Protein Sciences")).toBe("science");
    expect(categorize("Executive Assistant to the CEO")).toBe("admin");
  });

  it("recovers roles that previously fell into Other (v3 rules)", () => {
    // Medical professions the healthcare regex now names explicitly.
    expect(categorize("Optometrist")).toBe("healthcare");
    expect(categorize("Optometrist - Full-time")).toBe("healthcare");
    expect(categorize("Neuropsychologist - Tinley Park, IL")).toBe("healthcare");
    // Creative-director titles → design (alongside the existing "creative director").
    expect(categorize("Associate Art Director - Rainbow Six Siege")).toBe("design");
    // The \bteacher\b-only bug: plural "Teachers" and "Preschool" now match education.
    expect(categorize("Child Care and Preschool Teachers")).toBe("education");
    expect(categorize("Teachers Assistant")).toBe("education");
  });

  it("does not regress existing categorizations after the v3 additions", () => {
    expect(categorize("Senior Software Engineer")).toBe("engineering");
    expect(categorize("Product Manager")).toBe("product");
    expect(categorize("Account Executive")).toBe("sales");
    expect(categorize("UX Designer")).toBe("design");
    expect(categorize("Registered Nurse")).toBe("healthcare");
  });

  it("resolves the security/engineering boundary deliberately", () => {
    expect(categorize("Security Engineer")).toBe("engineering");
    expect(categorize("SOC Analyst")).toBe("security");
    expect(categorize("Fraud Investigator")).toBe("security");
  });

  it("handles compounds, cyber, and comp — real misses from the live smoke", () => {
    expect(categorize("Cybersecurity Analyst")).toBe("security");
    expect(categorize("Allround Onderhoudsmonteur (v/m/x)")).toBe("operations");
    expect(categorize("Compensation Specialist")).toBe("people_hr");
    expect(categorize("Analyst, Continuous Improvement Operational Excellence")).toBe("operations");
  });

  it("falls back to other, and every category id is unique", () => {
    expect(categorize("Chief Vibes Officer")).toBe("other");
    expect(new Set(JOB_CATEGORIES).size).toBe(JOB_CATEGORIES.length);
  });
});

describe("applyUrl hardening", () => {
  it("upgrades http apply URLs and drops non-http(s) schemes", () => {
    const jobs = normalizeGreenhouse(
      { jobs: [
        { id: 1, title: "A", absolute_url: "javascript:alert(1)", location: { name: "X" } },
        { id: 2, title: "B", absolute_url: "http://www.onemedical.com/careers/x", location: { name: "X" } },
        { id: 3, title: "C", absolute_url: "https://ok.example/x", location: { name: "X" } },
      ] } as never,
      "T", "t",
    );
    // One Medical ships http:// URLs for 340 real postings — upgrade, don't drop.
    expect(jobs.map((j) => j.title)).toEqual(["B", "C"]);
    expect(jobs[0].applyUrl).toBe("https://www.onemedical.com/careers/x");
  });
});

describe("filter + sort", () => {
  const all = [
    ...normalizeGreenhouse(GH_FIXTURE, "Stripe", "stripe"),
    ...normalizeLever(LEVER_FIXTURE as never, "Palantir", "palantir"),
    ...normalizeAshby(ASHBY_FIXTURE as never, "Supabase", "supabase"),
  ];

  it("ANDs multi-term q across title/company/department", () => {
    expect(filterJobs(all, { q: "deployment strategist" })).toHaveLength(1);
    expect(filterJobs(all, { q: "deployment stripe" })).toHaveLength(0);
  });

  it("location and remote filters compose", () => {
    expect(filterJobs(all, { location: "palo alto" })).toHaveLength(1);
    expect(filterJobs(all, { remote: true }).every((j) => j.remote)).toBe(true);
    expect(filterJobs(all, { remote: true })).toHaveLength(3);
  });

  it("category filter composes with the rest", () => {
    expect(filterJobs(all, { category: "engineering" }).every((j) => j.category === "engineering")).toBe(true);
    expect(filterJobs(all, { category: "healthcare" })).toHaveLength(0);
  });

  it("companies filter uses board tokens", () => {
    expect(filterJobs(all, { companies: ["supabase"] })).toHaveLength(1);
    expect(filterJobs(all, { companies: ["stripe", "palantir"] })).toHaveLength(4);
  });

  it("sorts newest first with undated postings last", () => {
    const sorted = sortJobs(all);
    // stripe:100 has only updated_at, so it's undated now — it must sort LAST,
    // and the newest genuinely dated posting leads.
    expect(sorted[sorted.length - 1].id).toBe("greenhouse:stripe:100");
    const dates = sorted.map((j) => j.postedAt);
    const dated = dates.filter(Boolean) as string[];
    expect(dated.length).toBeGreaterThan(0);
    expect([...dated].sort().reverse()).toEqual(dated);
  });
});

describe("tiered refresh invariants", () => {
  // 30s timeout: this test dynamically imports the multi-MB sources.ts
  // catalog; under parallel-suite load the parse alone can blow the 5s
  // default, reporting a "failure" with no assertion diff (recurring
  // pre-push flake, root-caused 2026-07-18).
  it("every HOT token matches a real source token (silent-shrink guard)", { timeout: 30_000 }, async () => {
    const { HOT_TOKENS, JOB_SOURCES } = await import("../../supabase/functions/job-board/sources");
    const tokens = new Set(JOB_SOURCES.map((s) => s.token));
    const missing = [...HOT_TOKENS].filter((t) => !tokens.has(t));
    expect(missing).toEqual([]);
    // Hot tier must stay small enough that the hot phase fits a few slices —
    // it re-runs every pass, so its size bounds per-pass cost.
    expect(HOT_TOKENS.size).toBeGreaterThan(20);
    expect(HOT_TOKENS.size).toBeLessThan(300);
  });

  it("CATEGORIZE_VERSION is stamped and bumps with rules changes", async () => {
    const { CATEGORIZE_VERSION } = await import("../../supabase/functions/job-board/categories");
    // v1 = launch rules; v2 = the 2026-07-12 Other-bucket audit. If you
    // changed RULES without bumping this, the stored corpus never refiles.
    expect(CATEGORIZE_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("every LIGHT_DESC token is a real Greenhouse source (light fetch only means anything there)", async () => {
    const { LIGHT_DESC_TOKENS, JOB_SOURCES } = await import("../../supabase/functions/job-board/sources");
    const gh = new Set(JOB_SOURCES.filter((s) => s.source === "greenhouse").map((s) => s.token));
    expect([...LIGHT_DESC_TOKENS].filter((t) => !gh.has(t))).toEqual([]);
  });
});

describe("category gap fixes (2026-07-12 Other-bucket audit)", () => {
  const cases: Array<[string, string | null, string]> = [
    ["IT Administrator", "Information Technology", "engineering"],
    ["Analyst, Enterprise Service Desk", "Enterprise Service Desk", "engineering"],
    ["Forward Deployed Researcher", "Data & AI", "data_ai"],
    ["Master Thesis AI-based Sensorless Edrive Control", "Research", "science"],
    ["Investor Relations - Associate", "Investor Relations", "finance"],
    ["District Manager In Training Bilingual Spanish", "District Management", "operations"],
    ["Vendeur Polyvalent (H/F)", "Management", "hospitality_retail"],
    ["Manager, Premium Support (Italian/English)", "Community Support", "customer"],
    ["ESTÁGIO SUPERIOR - COMUNICAÇÃO INTERNA (35119)", null, "marketing"],
    // regressions that must NOT move — "Research Scientist" hits science's
    // bare "scientist" stem (science precedes data_ai); long-standing behavior
    ["Research Scientist", null, "science"],
    ["Clinical Research Nurse", "Clinical", "healthcare"],
    ["Security Engineer", null, "engineering"],
  ];
  for (const [title, dept, want] of cases) {
    it(`${title} → ${want}`, () => {
      expect(categorize(title, dept)).toBe(want);
    });
  }
});

describe("cold-rotation wrap detection (freshness SLA)", () => {
  // The refresh stamps cold_rotation when the modular cursor wraps past the
  // end — this is the signal the heartbeat's freshness SLA reads.
  it("detects a wrap when the new cursor is less than the old", () => {
    const wrapped = (before: number, len: number, total: number) => ((before + len) % total) < before;
    expect(wrapped(580, 60, 600)).toBe(true);   // 580 -> 40, wrapped
    expect(wrapped(0, 60, 600)).toBe(false);     // 0 -> 60, no wrap
    expect(wrapped(300, 60, 600)).toBe(false);   // 300 -> 360, no wrap
    expect(wrapped(599, 1, 600)).toBe(true);     // 599 -> 0, wrapped exactly
  });
});

describe("never-stale arc invariants (2026-07-12)", () => {
  it("verify treats unknown/null liveness as still-live (never a false close)", async () => {
    // Mirrors the verify action's rule: only an explicit false prunes.
    const decide = (live: boolean | null) => live === false ? "prune" : "keep";
    expect(decide(true)).toBe("keep");
    expect(decide(null)).toBe("keep");   // transient/unverifiable — must NOT close
    expect(decide(false)).toBe("prune"); // confirmed gone
  });

  it("consecutive-failure prune fires only at the 6th straight miss", () => {
    let streak = 0;
    const step = (ok: boolean) => { if (ok) { streak = 0; return false; } streak += 1; return streak >= 6; };
    expect([1,2,3,4,5].map(() => step(false))).toEqual([false,false,false,false,false]);
    expect(step(false)).toBe(true);   // 6th → prune
    expect(step(true)).toBe(false);   // a success resets
    expect(streak).toBe(0);
  });
});

describe("dormancy skip-list (cold-tail throughput)", () => {
  const RECHECK = 12 * 60 * 60_000;
  const NOW = 1_000_000_000_000;

  it("classifyDormancy: active boards fetch, not-due dormant skip, due dormant recheck", () => {
    const dormant = {
      dead_recent: NOW - 1 * 60 * 60_000, // 1h dormant → still skip
      dead_old: NOW - 13 * 60 * 60_000, // 13h dormant → due for recheck
    };
    const { skip, recheck } = classifyDormancy(
      ["active_a", "dead_recent", "dead_old", "active_b"],
      dormant,
      NOW,
      RECHECK,
    );
    expect([...skip]).toEqual(["dead_recent"]);
    expect([...recheck]).toEqual(["dead_old"]);
    // active boards appear in neither set
    expect(skip.has("active_a")).toBe(false);
    expect(recheck.has("active_b")).toBe(false);
  });

  it("a responding board clears both its streak and dormancy", () => {
    const r = updateBoardFailures({
      okTokens: ["revived"],
      failedTokens: [],
      recheckTokens: new Set(["revived"]),
      streaks: { revived: 3 },
      dormant: { revived: NOW - RECHECK - 1 },
      deadThreshold: 6, dormantCap: 3000, now: NOW,
    });
    expect(r.streaks.revived).toBeUndefined();
    expect(r.dormant.revived).toBeUndefined();
    expect(r.toPrune).toEqual([]);
  });

  it("crossing the dead threshold prunes once and marks dormant", () => {
    // 5 prior failures, one more → hits 6 → prune + dormant + streak cleared
    const r = updateBoardFailures({
      okTokens: [],
      failedTokens: ["dying"],
      recheckTokens: new Set(),
      streaks: { dying: 5 },
      dormant: {},
      deadThreshold: 6, dormantCap: 3000, now: NOW,
    });
    expect(r.toPrune).toEqual(["dying"]);
    expect(r.dormant.dying).toBe(NOW);
    expect(r.streaks.dying).toBeUndefined();
  });

  it("a failed recheck probe stays dormant with a refreshed timer and is NOT re-pruned", () => {
    const r = updateBoardFailures({
      okTokens: [],
      failedTokens: ["still_dead"],
      recheckTokens: new Set(["still_dead"]),
      streaks: {},
      dormant: { still_dead: NOW - RECHECK - 5 },
      deadThreshold: 6, dormantCap: 3000, now: NOW,
    });
    expect(r.toPrune).toEqual([]); // no double-delete of already-pruned postings
    expect(r.dormant.still_dead).toBe(NOW); // timer reset → skipped again until next window
    expect(r.streaks.still_dead).toBeUndefined(); // recheck failures don't touch the streak
  });

  it("an ordinary (non-recheck, sub-threshold) failure just increments the streak", () => {
    const r = updateBoardFailures({
      okTokens: [],
      failedTokens: ["flaky"],
      recheckTokens: new Set(),
      streaks: { flaky: 2 },
      dormant: {},
      deadThreshold: 6, dormantCap: 3000, now: NOW,
    });
    expect(r.streaks.flaky).toBe(3);
    expect(r.dormant.flaky).toBeUndefined();
    expect(r.toPrune).toEqual([]);
  });

  it("the dormant map is capped, keeping the most recently detected", () => {
    const dormant: Record<string, number> = {};
    for (let i = 0; i < 10; i++) dormant[`d${i}`] = NOW - i * 1000; // d0 newest, d9 oldest
    const r = updateBoardFailures({
      okTokens: [], failedTokens: [], recheckTokens: new Set(),
      streaks: {}, dormant, deadThreshold: 6, dormantCap: 3, now: NOW,
    });
    const kept = Object.keys(r.dormant).sort();
    expect(kept).toEqual(["d0", "d1", "d2"]); // three most recent survive
  });

  it("does not mutate the input streaks/dormant objects", () => {
    const streaks = { a: 1 };
    const dormant = { b: NOW };
    updateBoardFailures({
      okTokens: ["b"], failedTokens: ["a"], recheckTokens: new Set(),
      streaks, dormant, deadThreshold: 6, dormantCap: 3000, now: NOW,
    });
    expect(streaks).toEqual({ a: 1 }); // unchanged
    expect(dormant).toEqual({ b: NOW }); // unchanged
  });
});

describe("vendor schema-drift canary", () => {
  it("rawItemCount reads each vendor's envelope shape", () => {
    expect(rawItemCount("lever", [{ id: 1 }, { id: 2 }])).toBe(2);
    expect(rawItemCount("greenhouse", { jobs: [1, 2, 3] })).toBe(3);
    expect(rawItemCount("ashby", { jobs: [1] })).toBe(1);
    expect(rawItemCount("workable", { jobs: [1, 2] })).toBe(2);
    expect(rawItemCount("smartrecruiters", { content: [1, 2, 3, 4] })).toBe(4);
    expect(rawItemCount("bamboohr", { result: [1] })).toBe(1);
    // malformed / empty payloads → 0, never throws
    expect(rawItemCount("greenhouse", null)).toBe(0);
    expect(rawItemCount("greenhouse", { jobs: "nope" })).toBe(0);
    expect(rawItemCount("lever", { not: "array" })).toBe(0);
  });

  it("flags drift when a vendor returns raw items that normalize to zero", () => {
    const results: CanaryResult[] = [
      // greenhouse healthy
      { vendor: "greenhouse", token: "stripe", fetchOk: true, raw: 500, normalized: 500 },
      { vendor: "greenhouse", token: "gitlab", fetchOk: true, raw: 160, normalized: 160 },
      // lever DRIFTED: fetched raw items, parsed none (schema changed)
      { vendor: "lever", token: "palantir", fetchOk: true, raw: 270, normalized: 0 },
      { vendor: "lever", token: "spotify", fetchOk: true, raw: 110, normalized: 0 },
    ];
    const { vendors, drifted, unreachable } = aggregateVendorHealth(results);
    expect(drifted).toEqual(["lever"]);
    expect(unreachable).toEqual([]);
    expect(vendors.find((v) => v.vendor === "greenhouse")!.drift).toBe(false);
    expect(vendors.find((v) => v.vendor === "lever")!.drift).toBe(true);
  });

  it("a legitimately empty board (no raw items) is NOT drift", () => {
    const { drifted } = aggregateVendorHealth([
      { vendor: "bamboohr", token: "bitrise", fetchOk: true, raw: 0, normalized: 0 },
      { vendor: "bamboohr", token: "flo", fetchOk: true, raw: 0, normalized: 0 },
    ]);
    expect(drifted).toEqual([]); // raw 0 → nothing to parse → not drift
  });

  it("one empty board can't fake drift when its sibling parses fine", () => {
    const { drifted } = aggregateVendorHealth([
      { vendor: "workable", token: "blueground", fetchOk: true, raw: 0, normalized: 0 }, // temporarily empty
      { vendor: "workable", token: "rokt", fetchOk: true, raw: 26, normalized: 26 }, // parses fine
    ]);
    expect(drifted).toEqual([]); // vendor total normalized > 0 → healthy
  });

  it("a fully unreachable vendor is reported separately, not as drift", () => {
    const { drifted, unreachable, vendors } = aggregateVendorHealth([
      { vendor: "ashby", token: "openai", fetchOk: false, raw: 0, normalized: 0 },
      { vendor: "ashby", token: "Notion", fetchOk: false, raw: 0, normalized: 0 },
    ]);
    expect(drifted).toEqual([]);
    expect(unreachable).toEqual(["ashby"]);
    expect(vendors[0].drift).toBe(false); // no fetchOk → can't be drift
  });

  it("ships two stable canaries for every canaried vendor", () => {
    // Every vendor whose payload we parse gets exactly two reference boards —
    // one flake can't fake drift, and a real API change trips both. iCIMS
    // joined 2026-07-26 (vendor #15).
    const vendors = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr", "rippling", "workday", "pinpoint", "icims"];
    for (const v of vendors) {
      expect(CANARIES.filter((c) => c.vendor === v).length).toBe(2);
    }
    expect(CANARIES.length).toBe(20);
  });
});

// Role-alias expansion: curated shorthand → disclosed OR-branches. The
// original spelling must ALWAYS survive as its own branch, advanced syntax
// must never be touched, and branch count stays bounded.
import { expandQuery, ROLE_ALIASES } from "../../supabase/functions/job-board/search-alias";

describe("expandQuery (role aliases)", () => {
  it("expands a bare alias and keeps the original spelling", () => {
    const r = expandQuery("swe");
    expect(r.q).toBe("swe OR software engineer");
    expect(r.expansions).toEqual(["software engineer"]);
  });

  it("keeps surrounding tokens in every OR-branch", () => {
    const r = expandQuery("senior swe");
    expect(r.q).toBe("senior swe OR senior software engineer");
  });

  it("caps multi-reading aliases at 3 total branches", () => {
    const r = expandQuery("pm");
    expect(r.q).toBe("pm OR product manager OR project manager");
    expect(r.expansions).toHaveLength(2);
  });

  it("expands only the first aliased token", () => {
    const r = expandQuery("rn np");
    expect(r.expansions).toEqual(["registered nurse"]);
    expect(r.q).toBe("rn np OR registered nurse np");
  });

  it("never touches advanced syntax or long queries", () => {
    for (const raw of ['"swe"', "swe OR sde", "-swe intern", "front-end swe", "a b c d e f swe"]) {
      const r = expandQuery(raw);
      expect(r.q).toBe(raw);
      expect(r.expansions).toEqual([]);
    }
  });

  it("passes non-alias queries through unchanged", () => {
    const r = expandQuery("product manager");
    expect(r.q).toBe("product manager");
    expect(r.expansions).toEqual([]);
  });

  it("is case-insensitive on input", () => {
    expect(expandQuery("RN").q).toBe("rn OR registered nurse");
  });

  it("keeps the curated map free of ambiguous collisions", () => {
    // Guard: these context-dependent shorthands must never be added.
    for (const banned of ["pt", "ot", "cs", "ds", "em", "ts"]) {
      expect(ROLE_ALIASES[banned]).toBeUndefined();
    }
  });
});

// Adjacent-role discovery: curated lateral-move suggestions. Longest seed
// wins, query's own role is never re-suggested, short/unknown → empty.
import { adjacentRoles } from "../../src/lib/role-adjacency";

describe("adjacentRoles", () => {
  it("suggests real adjacent roles for a known seed", () => {
    const r = adjacentRoles("product manager");
    expect(r.length).toBeGreaterThan(0);
    expect(r).toContain("product owner");
    expect(r).not.toContain("product manager");
  });
  it("matches a seed inside a longer query", () => {
    expect(adjacentRoles("senior product manager")).toContain("product owner");
  });
  it("prefers the most specific (longest) seed", () => {
    // 'registered nurse' is more specific than 'nurse' — its list must win.
    expect(adjacentRoles("registered nurse")).toContain("charge nurse");
  });
  it("returns [] for unknown or too-short queries", () => {
    expect(adjacentRoles("xyzzy")).toEqual([]);
    expect(adjacentRoles("ab")).toEqual([]);
  });
  it("respects the max cap", () => {
    expect(adjacentRoles("software engineer", 2).length).toBeLessThanOrEqual(2);
  });
});
