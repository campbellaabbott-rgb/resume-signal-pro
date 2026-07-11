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
      // no first_published — must fall back to updated_at
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
    // fallback to updated_at + remote inferred from location text
    expect(jobs[1].postedAt).toBe("2026-07-01T00:00:00-04:00");
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

  it("companies filter uses board tokens", () => {
    expect(filterJobs(all, { companies: ["supabase"] })).toHaveLength(1);
    expect(filterJobs(all, { companies: ["stripe", "palantir"] })).toHaveLength(4);
  });

  it("sorts newest first with undated postings last", () => {
    const sorted = sortJobs(all);
    expect(sorted[0].id).toBe("greenhouse:stripe:100"); // 2026-07-01 is the newest fixture
    const dates = sorted.map((j) => j.postedAt);
    const dated = dates.filter(Boolean) as string[];
    expect([...dated].sort().reverse()).toEqual(dated);
  });
});
