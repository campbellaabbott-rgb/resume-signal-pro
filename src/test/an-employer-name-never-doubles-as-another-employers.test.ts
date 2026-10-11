import { describe, expect, it } from "vitest";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";
import { employerDisplayName, employerNameOverride } from "../../supabase/functions/_shared/employer-names";

/**
 * S11-134: get_company_suggest groups by display name and the board's clusters
 * fold by it, so an override that gives one employer another employer's name
 * merges the two. Wave 3's 'Clario' for the Workday tenant clarioclinical
 * collided with recruitee:clario, a mobile-apps company. This pins every
 * override against every other catalogued board's shown name. It found two
 * more from July: 'Flex' for flextronics (greenhouse:flex is a rent-payments
 * company) and 'Spectrum Health' for the spectrumhealth tenant (bamboohr:
 * spectrumhealth is a clinical provider in Ireland).
 *
 * Boards of one Workday tenant may share a name: they are one employer. Any
 * other pair sharing a name is listed below with the evidence that it is one
 * employer.
 */
const SAME_EMPLOYER: ReadonlyArray<[string, string, string]> = [
  // [override board token, other board token, evidence]
  ["spgi~wd5~SPGI_Careers", "careers.spglobal.com", "S&P Global's own careers host and its Workday tenant spgi"],
  ["rochester~wd5~UR_Staff", "ur~wd1~URcareers", "two Workday tenants of the University of Rochester: hiringOrganization \"001 University of Rochester\" (20261009100100) and the URcareers site (20260721330000)"],
];

const fold = (s: string) => s.trim().toLowerCase();
const stem = (t: string) => t.split("~")[0].toLowerCase();

function collisions(): string[] {
  const out: string[] = [];
  // Every board's shown name, worked out once: the pairwise loop recomputed it
  // for each override and timed out under a loaded pre-push gate.
  const byShownName = new Map<string, typeof JOB_SOURCES[number][]>();
  for (const c of JOB_SOURCES) {
    const key = fold(employerDisplayName(c.token, c.name));
    const list = byShownName.get(key);
    if (list) list.push(c); else byShownName.set(key, [c]);
  }
  for (const b of JOB_SOURCES) {
    const named = employerNameOverride(b.token);
    if (named === null) continue;
    for (const c of byShownName.get(fold(named)) ?? []) {
      if (c === b || c.token === b.token) continue;
      if (c.token.includes("~") && stem(c.token) === stem(b.token)) continue;
      if (SAME_EMPLOYER.some(([x, y]) => (x === b.token && y === c.token) || (x === c.token && y === b.token))) continue;
      out.push(`${b.source}:${b.token} is named "${named}", which ${c.source}:${c.token} is called`);
    }
  }
  return [...new Set(out)].sort();
}

describe("an employer-name override never doubles as another employer's name (S11-134)", () => {
  it("no override names a board the way another employer's board is named", () => {
    expect(collisions()).toEqual([]);
  });

  it("the three it found carry names no other board uses", () => {
    expect(employerNameOverride("clarioclinical~wd1~clarioclinical_careers")).toBe("Clario (eResearch Technology)");
    expect(employerNameOverride("flextronics~wd1~Careers")).toBe("Flex Ltd.");
    expect(employerNameOverride("spectrumhealth~wd5~CorewellHealthCareers")).toBe("Corewell Health");
    // The employers whose names they had taken keep them.
    expect(employerDisplayName("clario", "Clario")).toBe("Clario");
    expect(employerDisplayName("flex", "Flex")).toBe("Flex");
    expect(employerDisplayName("spectrumhealth", "Spectrum Health")).toBe("Spectrum Health");
  });

  it("every allowed pair is still two catalogued boards, so the list cannot hide a stale exception", () => {
    const tokens = new Set(JOB_SOURCES.map((s) => s.token));
    for (const [a, b] of SAME_EMPLOYER) {
      expect(tokens.has(a), a).toBe(true);
      expect(tokens.has(b), b).toBe(true);
    }
  });
});
