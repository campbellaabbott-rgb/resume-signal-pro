// Rung-3 vendor normalizers, tested against REAL payloads captured from each
// vendor's official public API on 2026-07-15 (sendcloud/recruitee, personio's
// own board, oneflow's Teamtailor RSS). Breezy's fixture follows the documented
// /json shape — live verification gates that vendor before any board ships.
import { describe, it, expect } from "vitest";
import {
  normalizeRecruitee,
  normalizePersonio,
  normalizeBreezy,
  normalizeTeamtailor,
  xmlBlocks,
  xmlValue,
} from "../../supabase/functions/job-board/normalize";

const RECRUITEE_REAL = {
  offers: [{
    id: 2429738,
    slug: "senior-marketer-sample-london",
    title: "Senior Marketer (Sample)",
    department: null,
    city: "Amsterdam",
    country: "Netherlands",
    location: "Amsterdam, Noord-Holland, Netherlands",
    remote: false,
    careers_url: "https://sendcloud.recruitee.com/o/senior-marketer-sample-london",
    published_at: "2025-12-22 10:19:52 UTC",
    created_at: "2025-12-21 10:19:52 UTC",
  }],
};

const PERSONIO_REAL = `<?xml version="1.0"?><workzag-jobs>
<position>
    <id>1834171</id>
    <subcompany>Personio SE &amp; Co. KG</subcompany>
    <office>Munich</office>
    <department>Product and Tech</department>
    <name>Staff Software Engineer, Data Platform</name>
    <jobDescriptions><jobDescription><name>About</name><value><![CDATA[<p>Build the data platform.</p>]]></value></jobDescription></jobDescriptions>
    <schedule>full-time</schedule>
    <createdAt>2024-11-13T14:10:41+00:00</createdAt>
</position></workzag-jobs>`;

const TEAMTAILOR_REAL = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Senior Legal Counsel</title>
  <description>&lt;p&gt;Contracts platform legal work.&lt;/p&gt;</description>
  <link>https://career.oneflow.com/jobs/8002146-senior-legal-counsel</link>
  <pubDate>Wed, 01 Jul 2026 13:55:38 +0200</pubDate>
</item>
<item>
  <title>Remote Backend Engineer</title>
  <link>https://career.oneflow.com/jobs/8002999-remote-backend-engineer</link>
  <pubDate>Thu, 02 Jul 2026 09:00:00 +0200</pubDate>
</item>
</channel></rss>`;

const BREEZY_DOCUMENTED = [
  {
    id: "abc123",
    friendly_id: "senior-designer-remote",
    name: "Senior Designer",
    published_date: "2026-07-01T10:00:00Z",
    location: { name: "Toronto, Canada", is_remote: false },
    department: "Design",
    url: "https://acme.breezy.hr/p/senior-designer-remote",
  },
  { id: null, friendly_id: null, name: "Broken row", url: null }, // must drop, never crash
];

describe("normalizeRecruitee (real payload)", () => {
  const jobs = normalizeRecruitee(RECRUITEE_REAL, "Sendcloud", "sendcloud");
  it("normalizes id/company/url and parses the vendor's date format", () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("recruitee:sendcloud:2429738");
    expect(jobs[0].applyUrl).toBe("https://sendcloud.recruitee.com/o/senior-marketer-sample-london");
    // "2025-12-22 10:19:52 UTC" parses in V8 — must yield a real ISO date
    expect(jobs[0].postedAt).toMatch(/^2025-12-22T10:19:52/);
    expect(jobs[0].location).toContain("Amsterdam");
  });
});

describe("normalizePersonio (real feed)", () => {
  const jobs = normalizePersonio(PERSONIO_REAL, "Personio", "personio", "jobs.personio.de");
  it("parses positions from the XML feed with apply URL on the answering host", () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("personio:personio:1834171");
    expect(jobs[0].title).toBe("Staff Software Engineer, Data Platform");
    expect(jobs[0].location).toBe("Munich");
    expect(jobs[0].department).toBe("Product and Tech");
    expect(jobs[0].applyUrl).toBe("https://personio.jobs.personio.de/job/1834171");
    expect(jobs[0].postedAt).toMatch(/^2024-11-13/);
  });
  it("xml helpers unwrap CDATA", () => {
    const block = xmlBlocks(PERSONIO_REAL, "jobDescription")[0];
    expect(xmlValue(block, "value")).toBe("<p>Build the data platform.</p>");
  });
});

describe("normalizeTeamtailor (real RSS)", () => {
  const jobs = normalizeTeamtailor(TEAMTAILOR_REAL, "Oneflow", "oneflow");
  it("extracts numeric external ids from custom-domain links and parses RFC822 dates", () => {
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe("teamtailor:oneflow:8002146");
    expect(jobs[0].applyUrl).toBe("https://career.oneflow.com/jobs/8002146-senior-legal-counsel");
    expect(jobs[0].postedAt).toMatch(/^2026-07-01/);
  });
  it("flags remote from the title (the feed has no location field)", () => {
    expect(jobs[1].remote).toBe(true);
    expect(jobs[0].remote).toBe(false);
  });
});

describe("normalizeBreezy (documented shape)", () => {
  const jobs = normalizeBreezy(BREEZY_DOCUMENTED as never, "Acme", "acme");
  it("normalizes and drops rows without an id or url instead of crashing", () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("breezy:acme:senior-designer-remote");
    expect(jobs[0].location).toBe("Toronto, Canada");
    expect(jobs[0].applyUrl).toBe("https://acme.breezy.hr/p/senior-designer-remote");
  });
  it("tolerates a non-array payload", () => {
    expect(normalizeBreezy({} as never, "X", "x")).toEqual([]);
  });
});
