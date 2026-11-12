// @vitest-environment node
/**
 * A POSTING'S TITLE NAMES ITS EMPLOYER AND ENDS IN NO UNREADABLE KEY (B07;
 * SEO/GEO audit 2026-11-07, TITLE-08, F08, G4J-02).
 *
 * On 2026-11-08, 130 of the 463 live sitemap posting titles named no employer:
 * the title builder dropped the employer before the place whenever the two did
 * not fit beside a whole job title. Eight ended in a UUID or a twelve-digit id
 * the bake used to keep two titles apart, and four printed "&amp;" because
 * the employer's feed had sent its title escaped and the page escaped it again.
 * fixtures/posting-titles-2026-11-08.json is those 463 pages as they printed
 * their rows, with the title each served then.
 */
import { describe, expect, it } from "vitest";
import live from "./fixtures/posting-titles-2026-11-08.json";
import { postingEmployer, postingIdFromPath, postingPageTitle, postingPageTitleAvoiding, postingPathParts, type PostingRow } from "@/components/jobs/posting-page";

type LiveRow = { path: string; title: string; company: string | null; location: string | null; country: string | null; postedAt: string | null; servedTitle: string };
const rows = (live.rows as LiveRow[]).map((r) => {
  const id = postingIdFromPath(r.path)!;
  return {
    served: r.servedTitle,
    row: { id, token: postingPathParts(id)?.token ?? null, title: r.title, company: r.company, location: r.location, country: r.country, postedAt: r.postedAt } as unknown as PostingRow,
  };
});
const BUDGET = 68, MIN_ROOM = 24, SEP = " — ";
const UNREADABLE_END = /(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{12,})\)?$/i;
/** An employer that fits beside a job title cut to no less than MIN_ROOM characters. */
const fits = (company: string) => !!company && MIN_ROOM + SEP.length + company.length <= BUDGET;

describe("the 463 live posting pages of 2026-11-08", () => {
  it("are read: every row has a page id, and the served titles show the defects", () => {
    expect(rows.length).toBe(463);
    expect(rows.every((r) => !!r.row.id)).toBe(true);
    const unnamed = rows.filter((r) => fits(postingEmployer(r.row)) && !r.served.includes(postingEmployer(r.row)));
    expect(unnamed.length).toBeGreaterThan(90);
    expect(rows.filter((r) => UNREADABLE_END.test(r.served)).length).toBeGreaterThanOrEqual(8);
    expect(rows.filter((r) => /&amp;/.test(r.row.title ?? "")).length).toBe(4);
  });

  it("each title names the employer whenever the employer fits beside a job title cut to 24 characters", () => {
    const missing = rows.map((r) => [r, postingPageTitle(r.row)] as const).filter(([r, t]) => fits(postingEmployer(r.row)) && !t.includes(postingEmployer(r.row)));
    expect(missing.map(([r, t]) => `${r.row.id}: ${t}`)).toEqual([]);
  });

  it("titled as the bake titles them, every title is unique, inside the budget, and ends in no UUID or twelve-digit key", () => {
    const taken = new Set<string>();
    const titles = rows.map((r) => { const t = postingPageTitleAvoiding(r.row, taken); taken.add(t); return t; });
    expect(new Set(titles).size).toBe(rows.length);
    expect(titles.filter((t) => UNREADABLE_END.test(t))).toEqual([]);
    expect(titles.filter((t) => t.length > BUDGET)).toEqual([]);
    // The collisions the bake resolves may drop a long employer for the town:
    // at least 95% still name theirs (the audit's verify line).
    const named = rows.filter((r, i) => !postingEmployer(r.row) || titles[i].includes(postingEmployer(r.row))).length;
    expect(named / rows.length).toBeGreaterThanOrEqual(0.95);
  });

  it("prints an ampersand once, where the employer's feed sent it escaped", () => {
    const deag = rows.filter((r) => /&amp;/.test(r.row.title ?? ""));
    for (const r of deag) {
      const t = postingPageTitle(r.row);
      expect(t).not.toMatch(/&amp;|&#/);
      expect(t).toContain(" & ");
    }
  });
});

describe("postingPageTitleAvoiding separates a repeat by what the employer states first", () => {
  const row = (over: Partial<PostingRow>): PostingRow => ({
    id: "greenhouse:acmehealth:4012345",
    title: "Registered Nurse - Intensive Care Unit",
    company: "Acme Health",
    location: "Boston, MA",
    country: "US",
    postedAt: "2026-10-20T00:00:00Z",
    ...over,
  } as PostingRow);

  it("gives a second posting of one job in one town the day its employer says it posted it", () => {
    const a = row({}), b = row({ id: "greenhouse:acmehealth:4012399", postedAt: "2026-10-21T00:00:00Z" });
    expect(postingPageTitle(a)).toBe(postingPageTitle(b));
    const taken = new Set([postingPageTitleAvoiding(a, new Set())]);
    const tb = postingPageTitleAvoiding(b, taken);
    expect(tb).toBe("Registered Nurse - Intensive Care… — Acme Health, posted 2026-10-21");
  });

  it("ends a repeat whose key is a UUID in a short reference, never the UUID", () => {
    const uuid = "cfd7da23-3740-411c-b862-faf1ccabb418";
    const a = row({ id: "ashby:terac:3d362f56-b614-44fe-9c4f-c1f28bbb6819", company: "Terac", location: "San Francisco", country: "US", title: "Founding Engineer" });
    const b = row({ id: `ashby:terac:${uuid}`, company: "Terac", location: "San Francisco", country: "US", title: "Founding Engineer" });
    const taken = new Set<string>();
    for (const r of [a, b]) taken.add(postingPageTitleAvoiding(r, taken));
    const tb = [...taken][1];
    expect(tb).not.toContain(uuid);
    expect(tb).not.toMatch(UNREADABLE_END);
    expect(tb).toContain("Terac");
  });

  it("ends a third repeat of one day whose key is a fifteen-digit id in its last six digits", () => {
    const at = (key: string) => row({ id: `smartrecruiters:VeoliaEnvironnementSA:${key}`, company: "Veolia", location: "", country: "EG", postedAt: "2026-10-20T00:00:00Z" });
    const taken = new Set<string>();
    const titles = ["744000157670719", "744000157670720", "744000157670721"].map((k) => { const t = postingPageTitleAvoiding(at(k), taken); taken.add(t); return t; });
    expect(titles[0]).toBe("Registered Nurse - Intensive Care Unit — Veolia");
    expect(titles[1]).toBe("Registered Nurse - Intensive Care Unit — Veolia, posted 2026-10-20");
    expect(titles[2]).toContain("#670721");
    expect(titles.join(" ")).not.toMatch(/\d{12,}/);
  });
});
