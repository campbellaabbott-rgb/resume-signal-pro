// iCIMS normalizer — pinned against a REAL payload captured from
// careers.accentcare.com/api/jobs on 2026-07-26 (the vendor nests every field
// under `data`). iCIMS is the only feed that hands us stated salary AND a real
// posted date in the list response, so those two paths get the most coverage.
import { describe, it, expect } from "vitest";
import { normalizeIcims, type IcimsJobItem } from "../../supabase/functions/job-board/normalize";

const real: IcimsJobItem = {
  data: {
    req_id: "85865",
    slug: "85865",
    title: "Admissions Director RN, Hospice",
    description: "<p>Overview</p><p>Find Your Passion and Purpose as an Admissions Director.</p>",
    posted_date: "2026-07-25T09:01:00+0000",
    create_date: "2026-07-25T09:02:19+0000",
    city: "Tampa",
    state: "Florida",
    country: "United States",
    country_code: "US",
    full_location: "Tampa, Florida",
    category: [" Corporate & Leadership"],
    employment_type: "FULL_TIME",
    salary_min_value: 0,
    salary_max_value: 0,
    hiring_organization: "AccentCare, Inc.",
    apply_url: "https://careers-accentcare.icims.com/jobs/85865/login",
  },
};

describe("normalizeIcims", () => {
  it("maps a real payload to the board's posting shape", () => {
    const [j] = normalizeIcims([real], "AccentCare", "careers.accentcare.com");
    expect(j.id).toBe("icims:careers.accentcare.com:85865");
    expect(j.source).toBe("icims");
    expect(j.company).toBe("AccentCare");
    expect(j.title).toBe("Admissions Director RN, Hospice");
    expect(j.location).toBe("Tampa, Florida");
    // /login is the vendor's email-collection wall (verified live: no job
    // content); ingest rewrites to the sibling /job page, which IS the posting.
    expect(j.applyUrl).toBe("https://careers-accentcare.icims.com/jobs/85865/job");
  });

  it("keeps the feed's real posted date", () => {
    const [j] = normalizeIcims([real], "AccentCare", "careers.accentcare.com");
    expect(j.postedAt).not.toBeNull();
    expect(j.postedAt!.slice(0, 10)).toBe("2026-07-25");
  });

  it("uses the feed's own ISO country code rather than location text", () => {
    const [j] = normalizeIcims([real], "AccentCare", "careers.accentcare.com");
    expect(j.country).toBe("US");
  });

  it("never renders a zero salary as $0 — that states pay the posting doesn't", () => {
    const [j] = normalizeIcims([real], "AccentCare", "careers.accentcare.com");
    expect(j.salary).toBeNull();
  });

  it("formats a real stated range, and a single value", () => {
    const range = normalizeIcims(
      [{ data: { ...real.data, salary_min_value: 85000, salary_max_value: 110000 } }],
      "AccentCare", "careers.accentcare.com",
    )[0];
    expect(range.salary).toBe("$85,000 - $110,000");
    const one = normalizeIcims(
      [{ data: { ...real.data, salary_min_value: 0, salary_max_value: 0, salary_value: 95000 } }],
      "AccentCare", "careers.accentcare.com",
    )[0];
    expect(one.salary).toBe("$95,000");
  });

  it("prefers the vendor's structured location_type over text guessing", () => {
    const [remote] = normalizeIcims(
      [{ data: { ...real.data, location_type: "Remote" } }],
      "AccentCare", "careers.accentcare.com",
    );
    expect(remote.workMode).toBe("remote");
    expect(remote.remote).toBe(true);
    const [hybrid] = normalizeIcims(
      [{ data: { ...real.data, location_type: "Hybrid" } }],
      "AccentCare", "careers.accentcare.com",
    );
    expect(hybrid.workMode).toBe("hybrid");
    expect(hybrid.remote).toBe(false);
  });

  it("says nothing about work mode when the feed and text both stay silent", () => {
    const [j] = normalizeIcims([real], "AccentCare", "careers.accentcare.com");
    expect(j.workMode).toBeNull();
  });

  it("drops rows with no title, no id, or an unusable apply URL", () => {
    const rows = normalizeIcims(
      [
        { data: { ...real.data, title: "" } },
        { data: { ...real.data, req_id: null, slug: null } },
        { data: { ...real.data, apply_url: "javascript:alert(1)" } },
        real,
      ],
      "AccentCare", "careers.accentcare.com",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Admissions Director RN, Hospice");
  });

  it("survives a malformed payload without throwing", () => {
    expect(normalizeIcims([], "X", "careers.x.com")).toEqual([]);
    expect(normalizeIcims(null as never, "X", "careers.x.com")).toEqual([]);
    expect(normalizeIcims([{}, { data: null }] as never, "X", "careers.x.com")).toEqual([]);
  });
});
