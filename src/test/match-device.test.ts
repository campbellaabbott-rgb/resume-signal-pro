// @vitest-environment node
/**
 * THE DEVICE HALF OF RÉSUMÉ MATCHING (src/lib/match/**), behind no UI yet.
 *
 * What leaves the device is the confirmed profile and nothing more: never the
 * résumé text, never a basis line (they quote the résumé), never work
 * authorisation unless asked. Keyword overlap is the scorer's own matched and
 * missing for the same posting. Re-tiering on the device uses the server's
 * gates and tiers and counts what it sets aside. A visible row never moves.
 * The session profile survives storage that throws, and the synced shape
 * leaves work authorisation out by construction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeFit, scanResume } from "../../supabase/functions/_shared/fit-score";
import { postingTerms } from "../../supabase/functions/_shared/posting-requirements";
import { readProfile } from "../../supabase/functions/_shared/resume-profile";
import type { RowFacets, TierReader } from "../../supabase/functions/_shared/match-tiers";
import { keywordOverlap } from "@/lib/match/keyword-overlap";
import { applyNotForMe, NO_ADJUSTMENTS, notForMeEvent, partitionBySession } from "@/lib/match/not-for-me";
import { changesRetrieval, matchRequestBody } from "@/lib/match/request";
import { retier, type ServerRow } from "@/lib/match/retier";
import { clearSessionProfile, loadSessionProfile, saveSessionProfile, SESSION_KEY, syncableProfile } from "@/lib/match/session";
import { appendGroup, fillInPlace } from "@/lib/match/stable-insert";
import { stripChips } from "@/lib/match/strip";
import { readProfileOnDevice } from "@/lib/match/profile-reader";
import { RESUMES } from "./fixtures/match-bench/manifest";

const DIR = resolve(__dirname, "fixtures/match-bench/resumes");
const text = (id: string) => readFileSync(resolve(DIR, `${id}.txt`), "utf8");
const NOW_YEAR = 2026;

describe("what leaves the device", () => {
  it("never the résumé text: no 30-character run of any dev résumé appears in the request body outside a confirmed title or place, and no basis line", () => {
    for (const r of RESUMES) {
      const t = text(r.id);
      const p = readProfile(t, { nowYear: NOW_YEAR });
      const body = JSON.stringify(matchRequestBody(p));
      // The titles and places ARE the profile the reader confirms; a long title may run past 30 characters.
      const allowed = [...p.roles, p.former ?? "", p.home?.city ?? "", ...p.extraPlaces.map((x) => x.city)].filter(Boolean);
      const flat = t.replace(/\s+/g, " ");
      for (let i = 0; i + 30 <= flat.length; i += 7) {
        const run = flat.slice(i, i + 30);
        if (/^[\s\W\d]*$/.test(run)) continue;
        if (!body.includes(run)) continue;
        expect(allowed.some((a) => a.includes(run)), `${r.id}: "${run}"`).toBe(true);
      }
      for (const line of Object.values(p.basis)) {
        if (line.length >= 30) expect(body.includes(line), `${r.id} basis`).toBe(false);
      }
      expect(body).not.toMatch(/"basis"|"headline"/);
    }
  });

  it("work authorisation stays on the device unless the reader chooses to send it", () => {
    const p = readProfile(text("da-ng-opt-sanjose"), { nowYear: NOW_YEAR });
    expect(p.workAuth.needsSponsorship).toBe(true);
    expect(matchRequestBody(p).profile).not.toHaveProperty("workAuth");
    expect(matchRequestBody(p, { includeWorkAuth: true }).profile.workAuth).toMatchObject({ needsSponsorship: true });
  });

  it("titles at most three, the site surface, and a follow-up token only with a widening step", () => {
    const p = { ...readProfile(text("sw-ng-austin"), { nowYear: NOW_YEAR }), roles: ["a", "b", "c", "d"] };
    const b = matchRequestBody(p, { followUp: "v1.1.x" });
    expect(b).toMatchObject({ action: "match", surface: "site" });
    expect((b.profile.roles as string[]).length).toBe(3);
    expect(b).not.toHaveProperty("followUp");
    expect(matchRequestBody(p, { widen: 2, followUp: "v1.1.x" })).toMatchObject({ widen: 2, followUp: "v1.1.x" });
  });

  it("only the fields that change what is searched send a match call; every other edit re-tiers here", () => {
    expect(changesRetrieval("home")).toBe(true);
    expect(changesRetrieval("radiusKm")).toBe(true);
    expect(changesRetrieval("years")).toBe(false);
    expect(changesRetrieval("licences")).toBe(false);
    expect(changesRetrieval("workAuth")).toBe(false);
  });

  it("the reader loads on demand and reads the same profile the server would", async () => {
    const t = text("rn-ng-phoenix");
    expect(await readProfileOnDevice(t, NOW_YEAR)).toEqual(readProfile(t, { nowYear: NOW_YEAR }));
  });
});

describe("keyword overlap is the scorer's own matched and missing", () => {
  it("for the same posting and résumé, matched and missing equal computeFit's", () => {
    const resume = text("sw-sr-seattle");
    const posting = "Senior Software Engineer. Python, Kubernetes, AWS, PostgreSQL, React and TypeScript. CI/CD with GitHub Actions; on-call rotation; agile scrum team; REST APIs and microservices.";
    const f = computeFit(posting, scanResume(resume), 40);
    const o = keywordOverlap(postingTerms(posting), resume)!;
    expect(new Set(o.matched)).toEqual(new Set(f.matched));
    expect(new Set(o.missing)).toEqual(new Set(f.missing));
    expect(o.line).toBe(`Keyword overlap: ${o.n} of ${o.m} recognised terms in this posting appear in your résumé.`);
  });
  it("pending terms give no overlap rather than a zero", () => {
    expect(keywordOverlap("pending", "anything")).toBeNull();
  });
});

const LEVEL0 = { intern: false, aboveEntry: false, numeral: false, overreach: false, junior: false, assistant: false };
const facets = (over: Partial<RowFacets> = {}): RowFacets => ({
  place: { kind: "ring", label: "in your Columbus commute area (40 km)" }, titleRank: 0, previousField: false, level: { ...LEVEL0 },
  levelInQuery: false, assistantIsJunior: false, widenStep: 0, minYears: null, band: null,
  requirements: { minYears: null, licence: null, noSponsorship: null, citizenshipRequired: null, activeClearance: null, degree: null, must: [] },
  rowStates: ["OH"], licenceStateNotStated: false, country: "US", ...over,
});
const reader = (over: Partial<TierReader> = {}): TierReader => ({
  level: "mid", years: { low: 5, high: 5 }, targetYears: null, careerChanger: false, student: false,
  workAuth: { status: "unknown", needsSponsorship: false, citizenOf: [], clearance: null }, licences: [], degree: "bachelor", ...over,
});
const row = (id: string, over: Partial<RowFacets> = {}, extra: Partial<ServerRow> = {}): ServerRow => ({
  id, lane: "ring", tier: "strong", gaps: [], openings: 1, postedAt: new Date(Date.UTC(2026, 9, 10)).toISOString(), facets: facets(over), ...extra,
});

describe("re-tiering on the device", () => {
  const NOW = Date.UTC(2026, 9, 12);
  it("declaring a sponsorship need sets aside the rows that say they won't sponsor, counted over the rows read; nothing is dropped", () => {
    const rows = [
      row("a"),
      row("b", { requirements: { ...facets().requirements as Exclude<RowFacets["requirements"], "not read">, noSponsorship: "We are unable to sponsor visas." } }),
      row("c", { requirements: "not read" }),
    ];
    const before = retier(rows, reader(), { nowMs: NOW, found: 3, read: 2 });
    expect(before.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    const after = retier(rows, reader({ workAuth: { status: "work_visa", needsSponsorship: true, citizenOf: [], clearance: null } }), { nowMs: NOW, found: 3, read: 2 });
    expect(after.rows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(after.setAside.map((s) => [s.row.id, s.gate.reason])).toEqual([["b", "no_sponsorship"]]);
    expect(after.counts.no_sponsorship).toEqual({ count: 1, basis: "of the 2 postings we read" });
    expect(after.rows.length + after.setAside.length).toBe(rows.length);
  });
  it("a row whose requirements were not read stays at Good on the device too", () => {
    const out = retier([row("x", { requirements: "not read" })], reader(), { nowMs: NOW, found: 1, read: 0 });
    expect(out.rows[0].tier).toBe("good");
  });
  it("keyword overlap is the last tie-break and never lifts a row over a better tier", () => {
    const rows = [row("good", { titleRank: 1 }), row("s1"), row("s2")];
    const out = retier(rows, reader(), { nowMs: NOW, found: 3, read: 3, overlap: new Map([["s2", 9], ["s1", 1], ["good", 99]]) });
    expect(out.rows.map((r) => r.id)).toEqual(["s2", "s1", "good"]);
  });
});

describe("'Not for me' chips", () => {
  const r = { id: "1", title: "Cashier", company: "Kroger", location: "Delaware, OH", employerToken: "kroger", lane: "ring" };
  it("too far first narrows the radius (a match call), then leaves the place out on the device", () => {
    const a = applyNotForMe(NO_ADJUSTMENTS, "too_far", r);
    expect(a).toEqual({ next: { ...NO_ADJUSTMENTS, radiusKm: 15 }, retrieval: true });
    const b = applyNotForMe(a.next, "too_far", r);
    expect(b.retrieval).toBe(false);
    expect(b.next.excludedPlaces).toEqual(["delaware oh"]);
  });
  it("rows a chip leaves out are counted apart, never dropped; the analytics event carries the reason alone", () => {
    const s = applyNotForMe(NO_ADJUSTMENTS, "not_this_employer", r).next;
    const other = { ...r, id: "2", company: "Target", employerToken: "target" };
    expect(partitionBySession([r, other], s)).toEqual({ shown: [other], notForMe: [r] });
    expect(notForMeEvent("wrong_role")).toEqual({ event: "match_not_for_me", reason: "wrong_role" });
    expect(JSON.stringify(notForMeEvent("wrong_role"))).not.toMatch(/Cashier|Kroger|Delaware/);
  });
});

describe("results arrive in pieces and a visible row never moves", () => {
  it("a widening group is appended below; a row found again stays where it first appeared; a fill changes no position", () => {
    const page = [{ group: "page", rows: [{ id: "a" }, { id: "b" }] }];
    const next = appendGroup(page, "widen:1", [{ id: "b" }, { id: "c" }]);
    expect(next).toEqual([{ group: "page", rows: [{ id: "a" }, { id: "b" }] }, { group: "widen:1", rows: [{ id: "c" }] }]);
    expect(appendGroup(next, "widen:2", [{ id: "a" }])).toEqual(next);
    const filled = fillInPlace(next as Array<{ group: string; rows: Array<{ id: string; line?: string }> }>, new Map([["c", { line: "x" }]]));
    expect(filled.flatMap((g) => g.rows.map((x) => x.id))).toEqual(["a", "b", "c"]);
    expect(filled[1].rows[0]).toEqual({ id: "c", line: "x" });
  });
});

describe("the session profile", () => {
  const p = readProfile(text("da-ng-opt-sanjose"), { nowYear: NOW_YEAR });
  it("round-trips through sessionStorage under its own key", () => {
    const m = new Map<string, string>();
    const store = { setItem: (k: string, v: string) => void m.set(k, v), getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) };
    expect(saveSessionProfile(p, store)).toBe(true);
    expect([...m.keys()]).toEqual([SESSION_KEY]);
    expect(loadSessionProfile(store)).toEqual(p);
    clearSessionProfile(store);
    expect(loadSessionProfile(store)).toBeNull();
  });
  it("storage that throws or is absent means nothing is remembered, never an error", () => {
    const boom = { setItem: () => { throw new Error("quota"); }, getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(saveSessionProfile(p, boom)).toBe(false);
    expect(loadSessionProfile(boom)).toBeNull();
    expect(() => clearSessionProfile(boom)).not.toThrow();
    expect(saveSessionProfile(p, null)).toBe(false);
    expect(loadSessionProfile({ getItem: () => "{not json" })).toBeNull();
  });
  it("the shape a signed-in reader may sync leaves work authorisation and the quoted lines out", () => {
    const s = syncableProfile(p) as Record<string, unknown>;
    expect(s).not.toHaveProperty("workAuth");
    expect(s).not.toHaveProperty("basis");
    expect(s.roles).toEqual(p.roles);
  });
});

describe("the strip", () => {
  it("one chip per fact, each with the line it was read from; work authorisation defaults to Skip; years say where they came from", () => {
    const chips = stripChips(readProfile(text("rt-ng-columbus"), { nowYear: NOW_YEAR }));
    const by = Object.fromEntries(chips.map((c) => [c.key, c]));
    expect(by.workAuth.value).toBe("Skip");
    expect(by.workAuth.basis).toBeNull();
    expect(by.home.value).toMatch(/Columbus/);
    if (by.years) expect(by.years.value).toMatch(/^about \d+(-\d+)? \(from your employment dates\)$/);
    expect(chips.every((c) => c.editable)).toBe(true);
  });
  it("an RN's licence chip names its state and the compact", () => {
    const chips = stripChips(readProfile(text("rn-ng-phoenix"), { nowYear: NOW_YEAR }));
    expect(chips.find((c) => c.key === "licences")?.value).toMatch(/RN \(AZ, multistate compact\)/);
  });
});
