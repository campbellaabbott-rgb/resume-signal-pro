// @vitest-environment node
/**
 * WHAT THE VENDOR STATES REACHES THE ROW (bug audit 2026-10-31, board-stream
 * group "fields": S13-030, S13-031, S13-032, S13-033, S13-034, S13-044,
 * S13-045, S13-046).
 *
 *   - Breezy states pay ("£26,228 / year") and a type id; the list kept
 *     neither (374 of 750 corpus postings state pay; main stored 0).
 *   - Recruitee's fulltime_permanent, BambooHR's employmentStatusLabel and
 *     Lever's "Full-time Employee" stored NULL. A longer label maps to a class
 *     only when it names exactly one (n1422); a fixed term beside a schedule
 *     names two and stays NULL.
 *   - Lever, Breezy and Workable state a country code; the board guessed from
 *     the place text and stored none for "Kuopio, FI" or "Riga, Latvia".
 *   - Personio's employmentType (intern, trainee, freelance) lost to its
 *     schedule.
 *   - A Lever description stored its body twice and dropped the lists (the
 *     requirements) and the closing section (the pay sentence).
 *   - A Personio posting written in another language has no description in
 *     the default feed; the board now reads ?language=en once, only then.
 *   - A Paylocity page with no structured data got no description, so the
 *     desc-sweep fetched it again on every walk.
 *
 * Corpora: board-stream-2026-11-01/corpora/fields (norm-diff.json, 8,403 real
 * postings over nine vendors; paylocity-fallback.json, 327 pages).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import {
  employmentTypeFromLabel, htmlToText, icimsCountry, leverText, mergePersonioDescriptions, normalizeBambooHR, normalizeBreezy,
  normalizeEmploymentType, normalizeLever, normalizePersonio, normalizeRecruitee, normalizeWorkable,
  paylocityPageText, PERSONIO_NO_DESCRIPTION, ldBaseSalaryText, xmlBlocks, xmlValue,
} from "../../supabase/functions/job-board/normalize";
import { jobPostingLd } from "../../supabase/functions/job-board/descriptions";
import { SLIM_SPECS } from "../../supabase/functions/job-board/slim-stream";
import { codeOf } from "./helpers/strip-comments";

const RAW = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

const constDecl = (name: string): string => {
  const m = RAW.match(new RegExp(`^const ${name}\\b[^;\\n]*;`, "m"));
  if (!m) throw new Error(`const ${name} not found at the top level of index.ts`);
  return m[0];
};
const fnDecl = (head: string): string => {
  const i = RAW.indexOf(`\n${head}`);
  if (i < 0) throw new Error(`${head} not found at the top level of index.ts`);
  return RAW.slice(i + 1, RAW.indexOf("\n}\n", i) + 2);
};
/** One shipped top-level function with `deps` in scope; an unstubbed name reports itself. */
function lift<F>(head: string, consts: string[], deps: Record<string, unknown>): F {
  const name = /function\s+(\w+)/.exec(head)![1];
  const js = transformSync([...consts.map(constDecl), fnDecl(head)].join("\n"), { loader: "ts" }).code;
  const env = new Proxy(deps, {
    has: () => true,
    get: (t, k) => {
      if (typeof k === "symbol") return undefined;
      if (k in t) return t[k as string];
      if (k in globalThis) return (globalThis as Record<string, unknown>)[k as string];
      throw new Error(`${name} reached an unstubbed dependency: ${String(k)}`);
    },
  });
  return new Function("__env", `with (__env) { ${js}\n return ${name}; }`)(env) as F;
}

describe("Breezy: pay, type and country as the vendor states them (S13-030, S13-034, S13-032)", () => {
  const position = {
    id: "cbaa7dc9ec6001", friendly_id: "cbaa7dc9ec6001-customer-service-advisor-part-time", name: "Customer Service Advisor - Part Time",
    url: "https://activate-group-limited.breezy.hr/p/cbaa7dc9ec6001-customer-service-advisor-part-time", published_date: "2026-10-26T16:00:35.813Z",
    type: { id: "partTime", name: "Part-Time" }, salary: "£26,228 / year", department: "Contact Centre",
    location: { country: { id: "GB", name: "United Kingdom" }, city: "Halifax", is_remote: false, name: "Halifax, England" },
  };
  it("reads them", () => {
    const [p] = normalizeBreezy([position], "Activate", "activate-group-limited");
    expect(p).toMatchObject({ salary: "£26,228 / year", employmentType: "part_time", employmentTypeText: "Part-Time", country: "GB" });
  });
  it("fills a country the place text leaves unsaid, and declines an unknown type", () => {
    const [p] = normalizeBreezy([{ ...position, name: "Myyjä", location: { country: { id: "FI" }, name: "Kuopio, FI" }, type: { id: "other", name: "Other" }, salary: "" }], "Co", "t");
    expect(p).toMatchObject({ country: "FI", employmentType: null, salary: null });
  });
});

describe("one class in a longer label, and only one (S13-031, S13-034)", () => {
  it("the corpus labels that name one class", () => {
    for (const [label, want] of [
      ["fulltime_permanent", "full_time"], ["parttime_permanent", "part_time"], ["parttime_minijob", "part_time"],
      ["Full-time Employee", "full_time"], ["Regular, Salaried, Full-Time", "full_time"], ["Perm - Full-time", "full_time"], ["Freelance Contract", "contract"],
      ["Subcontractor", "contract"], ["Hourly Part-Time Guard", "part_time"], ["Temps plein (37,5h)", "full_time"], ["Vollzeit", "full_time"],
      ["Seasonal", "temporary"], ["Intern", "internship"], ["Full-Time", "full_time"],
    ] as const) expect(employmentTypeFromLabel(label), label).toBe(want);
  });
  it("labels that name none, or two, stay NULL", () => {
    for (const label of [
      "fulltime_fixed_term", "parttime_fixed_term", "Seasonal (Fixed-Term)", "Temporary, Hourly, Full-Time",
      "Temporary - part time with potential for permanent employment", "Volunteer", "PRN", "Open-Ended", "GEN - 0.8 FTE",
      "Consultant", "Stage", "Homeoffice", "Internal Transfer", "", null,
    ]) expect(employmentTypeFromLabel(label), String(label)).toBeNull();
  });
  it("a permanent engagement is not a contract: gojob's \"Permanent Contract\" (a CDI) stays NULL, as on main (n1422)", () => {
    // corpora/review-fix/fields/et-labels.*.json: 131 labels over 4,730 rows; this is the one label the contract word misread.
    expect(employmentTypeFromLabel("Permanent Contract")).toBeNull();
    const [l] = normalizeLever([{ id: "g", text: "Agent", hostedUrl: "https://jobs.lever.co/gojob/g", categories: { commitment: "Permanent Contract", location: "Paris" } }], "Gojob", "gojob");
    expect(l.employmentType).toBeNull();
    for (const [label, want] of [["Freelance Contract", "contract"], ["Fixed-Term Contract", "contract"], ["Contract - Remote", "contract"], ["Perm - Full-time", "full_time"], ["Permanent / Part Time", "part_time"]] as const) {
      expect(employmentTypeFromLabel(label), label).toBe(want);
    }
  });
  it("the exact ladder every other vendor uses is unchanged", () => {
    expect(normalizeEmploymentType("Full-time Employee")).toBeNull();
    expect(normalizeEmploymentType("fulltime_permanent")).toBeNull();
    expect(normalizeEmploymentType("Full-time")).toBe("full_time");
  });
  it("Recruitee, BambooHR and Lever read through it", () => {
    const [r] = normalizeRecruitee({ offers: [{ id: 1, slug: "x", title: "Developer", city: "Berlin", country: "Germany", employment_type_code: "fulltime_permanent" }] }, "Co", "t");
    expect(r.employmentType).toBe("full_time");
    const [b] = normalizeBambooHR({ result: [{ id: 7, jobOpeningName: "Guard", employmentStatusLabel: "Hourly Part-Time Guard", atsLocation: { city: "Austin", state: "Texas", country: "United States" } }] }, "Co", "t");
    expect(b.employmentType).toBe("part_time");
    const [l] = normalizeLever([{ id: "a", text: "Engineer", hostedUrl: "https://jobs.lever.co/t/a", categories: { commitment: "Full-time Employee", location: "Toronto" } }], "Co", "t");
    expect(l.employmentType).toBe("full_time");
  });
});

describe("the vendor's country (S13-032)", () => {
  it("Lever, with the place's own state or province overruling a code that disagrees", () => {
    const lever = (country: string, location: string) =>
      normalizeLever([{ id: "a", text: "Engineer", hostedUrl: "https://jobs.lever.co/t/a", country, categories: { location } }], "Co", "t")[0].country;
    expect(lever("CA", "Toronto")).toBe("CA");
    expect(lever("US", "Remote")).toBe("US");
    expect(lever("US", "Hamilton, ON")).toBe("CA");
  });
  it("a place that names the code's own country keeps the code: Mexicali, Baja California, Mexico stays MX (n1425)", () => {
    const lever = (country: string, location: string) =>
      normalizeLever([{ id: "a", text: "Engineer", hostedUrl: "https://jobs.lever.co/t/a", country, categories: { location } }], "Co", "t")[0].country;
    expect(lever("MX", "Mexicali, Baja California, Mexico")).toBe("MX");
    expect(icimsCountry("MX", "Mexicali, Baja California, Mexico")).toBe("MX");
    // The overrule still stands where the place names no country of the code's: Smoothie King's FR at "KCMO, MO".
    expect(icimsCountry("FR", "KCMO, MO")).toBe("US");
    expect(lever("CA", "3388 Sweden Way, Richmond, BC")).toBe("CA");
  });
  it("Workable, per location entry", () => {
    const [w] = normalizeWorkable({ jobs: [{ title: "Analyst", shortcode: "AB12", city: "Riga", state: "Riga", country: "Latvia", locations: [{ countryCode: "LV" }] }] }, "Co", "t");
    expect(w.country).toBe("LV");
  });
});

describe("Personio: the employment type the employer picked (S13-033)", () => {
  const one = (et: string, schedule: string) => normalizePersonio(
    `<workzag-jobs><position><id>1</id><name>Role</name><employmentType>${et}</employmentType><schedule>${schedule}</schedule><createdAt>2026-10-20T10:00:00+00:00</createdAt></position></workzag-jobs>`,
    "Co", "tok", "jobs.personio.de",
  )[0].employmentType;
  it("an internship, trainee, freelance or temporary post is not filed by its schedule", () => {
    expect(one("intern", "full-time")).toBe("internship");
    expect(one("trainee", "full-time")).toBe("internship");
    expect(one("working_student", "full-or-part-time")).toBe("internship");
    expect(one("freelance", "full-time")).toBe("contract");
    expect(one("temporary", "full-time")).toBe("temporary");
  });
  it("a part-time schedule keeps part_time, the one part-time signal the stored row hands the pay re-sweep", () => {
    // The text re-sweep reads only the stored row: "temporary" for a part-time
    // minijob at EUR 14.50 an hour would let it publish 30,160 a year, which
    // the ingest parse (it reads the schedule) refuses.
    expect(one("working_student", "part-time")).toBe("part_time");
    expect(one("freelance", "part-time")).toBe("part_time");
    expect(one("temporary", "part-time")).toBe("part_time");
  });
  it("a permanent post is still filed by its schedule", () => {
    expect(one("permanent", "part-time")).toBe("part_time");
    expect(one("permanent", "full-or-part-time")).toBe("full_time");
  });
});

describe("a Lever posting read once and whole (S13-044)", () => {
  const body = "About Us\nAir-tek is a Canadian-based software company redefining how airlines operate.";
  const job = {
    id: "1cee6a91", text: "Senior Software Engineer", descriptionPlain: `${body}\n`, descriptionBodyPlain: `${body}\n`,
    lists: [{ text: "What You'll Bring", content: "\n<li>5+ years of experience building backend services</li>\n<li>Strong <strong>Python</strong></li>\n" }],
    additionalPlain: "The base salary range for this role is CA$120,000 - CA$150,000.",
  };
  it("the body once, then the lists, then the closing section", () => {
    const t = leverText(job);
    expect(t.split("Air-tek is").length - 1, "the body is stored once").toBe(1);
    expect(t).toContain("What You'll Bring\n5+ years of experience building backend services");
    expect(t.endsWith("CA$120,000 - CA$150,000.")).toBe(true);
  });
  it("the ingest, the detail read and the streamed read all store that text", () => {
    expect(RAW).toContain("const text = leverText(j);");
    expect(RAW).toContain("if (job) text = leverText(job).slice(0, DESC_CAP) || null;");
    expect(SLIM_SPECS.lever.text(job as never)).toBe(leverText(job));
    expect(codeOf(RAW)).not.toMatch(/descriptionBodyPlain/);
  });
});

describe("a Personio posting in another language (S13-045)", () => {
  const pos = (id: string, desc: string) => `<position><id>${id}</id><name>Role ${id}</name>${desc}<createdAt>2026-10-20T10:00:00+00:00</createdAt></position>`;
  const d = (text: string) => `<jobDescriptions><jobDescription><name>Tasks</name><value><![CDATA[<p>${text}</p>]]></value></jobDescription></jobDescriptions>`;
  const DEFAULT = `<workzag-jobs>${pos("1", d("Deine Aufgaben"))}${pos("2", "<jobDescriptions></jobDescriptions>")}${pos("3", "<jobDescriptions/>")}</workzag-jobs>`;
  const EN = `<workzag-jobs>${pos("1", d("Your tasks"))}${pos("2", d("Build the data platform"))}${pos("3", "<jobDescriptions></jobDescriptions>")}</workzag-jobs>`;

  it("only an empty description is filled, from the same posting", () => {
    const merged = mergePersonioDescriptions(DEFAULT, EN);
    expect(normalizePersonio(merged, "Co", "tok", "jobs.personio.de")).toHaveLength(3);
    expect(merged).toContain("Deine Aufgaben");
    expect(merged).not.toContain("Your tasks");
    expect(merged).toContain("Build the data platform");
    expect(PERSONIO_NO_DESCRIPTION.test(merged), "posting 3 has no text in either language").toBe(true);
  });

  const run = async (def: string, en: string | null) => {
    const asked: string[] = [];
    const fetchPersonio = lift<(s: { token: string }) => Promise<{ xml: string; host: string }>>("async function fetchPersonio(", [], {
      fetchWithTimeout: async (u: string) => {
        asked.push(u);
        const body = /language=en$/.test(u) ? en : def;
        return body === null ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => body };
      },
      discardBody: () => {}, OVERSIZE_MARKER: "OVERSIZE_BODY", PERSONIO_NO_DESCRIPTION, mergePersonioDescriptions,
    });
    return { r: await fetchPersonio({ token: "acme" }), asked };
  };
  it("the feed is read in English once, and only when a posting has no text", async () => {
    const a = await run(DEFAULT, EN);
    expect(a.asked).toEqual(["https://acme.jobs.personio.de/xml", "https://acme.jobs.personio.de/xml?language=en"]);
    expect(a.r.xml).toContain("Build the data platform");
    const full = `<workzag-jobs>${pos("1", d("Deine Aufgaben"))}</workzag-jobs>`;
    const b = await run(full, EN);
    expect(b.asked, "a feed with every description costs no second request").toEqual(["https://acme.jobs.personio.de/xml"]);
    const c = await run(DEFAULT, null);
    expect(c.r.xml, "a failed English read leaves the default feed standing").toBe(DEFAULT);
  });

  it("a seeker's click fills a stored row's empty description from the same feed", async () => {
    const detail = (feed: Promise<{ xml: string }>) => lift<(s: { source: string; token: string }, id: string, ext: string) => Promise<{ text: string | null }>>(
      "async function fetchVendorDetail(", ["DESC_CAP", "RAW_HTML_CAP"],
      { fetchPersonio: () => feed, xmlBlocks, xmlValue, htmlToText },
    )({ source: "personio", token: "acme" }, "personio:acme:2", "2");
    expect((await detail(Promise.resolve({ xml: mergePersonioDescriptions(DEFAULT, EN) }))).text).toBe("Build the data platform");
    expect((await detail(Promise.reject(new Error("personio feed unavailable on .de/.com")))).text, "an unreachable feed is no description, not a thrown read").toBeNull();
  });
});

describe("a Paylocity page with no structured data (S13-046)", () => {
  const page = (ld: string) => `<html><head>${ld}</head><body>
    <div class="job-preview-details">
      <div class="mobile-apply-btn"><a class="apply-link-marker button" href="/Recruiting/jobs/Apply/2884973">Apply</a></div>
        <div class="vertical-padding">
          <div class="job-listing-header">Job Type</div>
          <div>Full-time</div>
        </div>
      <div class="job-listing-header">Description</div>
      <div><p>The Implementation Consultant is responsible for executing several critical activities throughout our ERP software implementations.&nbsp;</p></div>
        <div class="job-listing-header">Requirements</div>
        <div data-bind="html: Job.Requirements"><p>Lead clients through successful implementation of EGT ERP &amp; Finance Software Products</p></div>
              <div class="job-listing-header">Salary Description</div>
        <div>$70,000 - $85,000 per year</div>
                </div>
    <div class="preview-bottom-apply-btn"><a class="apply-link-marker button" href="/Recruiting/jobs/Apply/2884973">Apply</a></div></body></html>`;
  it("reads the description, requirements and pay sections, without the job type or the buttons", () => {
    const t = paylocityPageText(page(""));
    expect(t.startsWith("The Implementation Consultant is responsible")).toBe(true);
    expect(t).toContain("Lead clients through successful implementation of EGT ERP & Finance Software Products");
    expect(t).toContain("$70,000 - $85,000 per year");
    expect(t).not.toMatch(/Full-time|Apply|Description|Requirements|<div/);
  });
  it("a page without the posting's section reads nothing", () => {
    expect(paylocityPageText("<html><body><h1>Job not found</h1></body></html>")).toBe("");
  });

  const detail = async (html: string) => {
    const fetchVendorDetail = lift<(s: { source: string; token: string }, id: string, ext: string, a?: string | null) => Promise<{ text: string | null; pay?: string | null }>>(
      "async function fetchVendorDetail(", ["DESC_CAP"],
      { fetchWithTimeout: async () => ({ ok: true, status: 200, text: async () => html }), jobPostingLd, htmlToText, paylocityPageText, ldBaseSalaryText },
    );
    return fetchVendorDetail({ source: "paylocity", token: "b89c2baf" }, "paylocity:b89c2baf:2884973", "2884973", null);
  };
  it("the detail read falls back to the page only when the structured data has no description", async () => {
    expect((await detail(page("")))?.text).toContain("The Implementation Consultant");
    const ld = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Consultant", description: `<p>${"From the structured data. ".repeat(6).trim()}</p>` })}</script>`;
    expect((await detail(page(ld)))?.text).toBe("From the structured data. ".repeat(6).trim());
  });
});

describe("our reading changed: the first fill is unlogged for a dated window (n1426)", () => {
  const REMOVE_AFTER = "2026-11-30";
  const ENTRIES = ["lever:employment_type", "bamboohr:employment_type", "recruitee:employment_type", "breezy:employment_type", "personio:employment_type", "breezy:salary", "lever:salary"];
  const line = /const OUR_READING_CHANGED = new Set\(\[[\s\S]*?\]\);/.exec(RAW)?.[0] ?? "";
  it("the set names every field these readers now fill", () => {
    for (const e of ENTRIES) expect(line, e).toContain(`"${e}"`);
    expect(line).toContain(`Remove after ${REMOVE_AFTER} (n1426)`);
  });
  it(`the entries are removed by ${REMOVE_AFTER}`, () => {
    const today = new Date().toISOString().slice(0, 10);
    const present = ENTRIES.some((e) => codeOf(line).includes(`"${e}"`));
    expect(today <= REMOVE_AFTER || !present, `remove the n1426 entries from OUR_READING_CHANGED in job-board/index.ts: the window closed ${REMOVE_AFTER}`).toBe(true);
  });
});
