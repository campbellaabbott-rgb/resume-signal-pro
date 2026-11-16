import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectWorkMode, normalizeAshby } from "../../supabase/functions/job-board/normalize.ts";

/**
 * A WORK MODE IS READ FROM THE PLACE, NOT THE TRADE (BR-08 + S14X-248).
 *
 * "Remote Sensing Scientist" at Wright-Patterson AFB was filed remote, and so were nine SAIC
 * "Remote Pilot Operator" postings whose own Oracle field says On-site. The word named the
 * trade. Now a hand-labelled list of trade terms is taken out of every part before the
 * work-mode words are matched; the vendor's own field still wins upstream.
 *
 * The corpus (fixtures/work-mode-corpus-2026-11-11.json) has two kinds of case, and neither
 * label comes from this rule: 121 postings with a trade term, labelled from each posting's
 * own page or detail field (its URL is stored), and 466 rows from 54,045 feed rows labelled
 * by the feed's own workplace field. `main` is fix/cost-wave's reading, stored when the
 * fixture was built. Never worse than main: no case main reads right becomes wrong, and the
 * total right is at least main's.
 */
type Mode = "remote" | "hybrid" | "onsite" | null;
type Case = { kind: "hand" | "vendor"; id: string; url: string; read?: string; title: string; location: string; label: string; basis: string; main: Mode };
const FX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/work-mode-corpus-2026-11-11.json"), "utf8")) as { cases: Case[]; vendorCorpus: { rows: number } };

// The fixture's own scoring, written down there in words.
const score = (v: Mode, label: string) =>
  label === "unstated" ? (v === null ? "right" : "wrong")
  : v === null ? "none"
  : label === "notremote" ? (v === "remote" ? "wrong" : "none")
  : v === label ? "right" : "wrong";

describe("a trade term is not a work mode", () => {
  it("Remote Sensing Scientist reads no mode, as a title alone and after an empty place", () => {
    expect(detectWorkMode(null, "Remote Sensing Scientist")).toBeNull();
    expect(detectWorkMode("Remote Sensing Scientist")).toBeNull();
  });

  it("every part is read without the trade, the place included", () => {
    expect(detectWorkMode("Philadelphia, PA, United States", "PHL Remote Pilot Operator")).toBeNull();
    expect(detectWorkMode("Hybrid Cloud", null, "Platform")).toBeNull();
    expect(detectWorkMode("Remotely Operated Vehicle Pilot")).toBeNull();
    expect(detectWorkMode("Remote-Sensing Analyst")).toBeNull();
    expect(detectWorkMode("Hybrid Vehicle Technician")).toBeNull();
    expect(detectWorkMode("Selangor, Malaysia", "Hybrid Driver - Puncak Alam (Full- Time)")).toBeNull();
  });

  it("a work mode stated beside the trade still reads", () => {
    expect(detectWorkMode("Remote Sensing Scientist - Remote")).toBe("remote");
    expect(detectWorkMode("Remote TN", "Remote Monitoring Specialist")).toBe("remote");
    expect(detectWorkMode("Belgium (remote)", "Senior Presales Systems Engineer (Belgium) - Hybrid Cloud Storage")).toBe("remote");
    expect(detectWorkMode("Hybrid Cloud Engineer (Hybrid)")).toBe("hybrid");
    // A dash between two words is a separator, not a compound: Concentrix writes the mode this way.
    expect(detectWorkMode("Sales Development Representative (Danish-speaking) - Hybrid - Cloud Solutions MV02")).toBe("hybrid");
    // "Hybrid or Remote" states the mode: it is never a trade.
    expect(detectWorkMode("Construction Project Manager - Hybrid or Remote")).toBe("hybrid");
    expect(detectWorkMode("Remote", "Sensing Engineer")).toBe("remote");
  });

  it("terms the labels did not support stay readings", () => {
    // Remote Support: 3 remote, 3 hybrid, 3 on-site, 3 unstated. Hybrid IT and Hybrid Bonding: hybrid.
    expect(detectWorkMode("Remote Support Engineer - not available for sponsorship")).toBe("remote");
    expect(detectWorkMode("Reno Remote Operations Technician")).toBe("remote");
    expect(detectWorkMode("Remote Patient Monitoring (RPM) Care Coordinator")).toBe("remote");
    expect(detectWorkMode("Anchorage, AK", "Hybrid IT Support Technician II - Anchorage, AK")).toBe("hybrid");
  });

  it("the vendor's own field still wins over the title", () => {
    const [row] = normalizeAshby(
      { jobs: [{ id: "1", title: "Remote Sensing Engineer", location: "Denver, CO", workplaceType: "Remote", isRemote: true, jobUrl: "https://jobs.ashbyhq.com/acme/1" }] } as never,
      "Acme", "acme");
    expect(row.workMode).toBe("remote");
  });
});

describe("the work-mode corpus is never worse than main", () => {
  const cases = FX.cases;

  it("has at least 300 cases, every hand label with its page", () => {
    expect(cases.length).toBeGreaterThanOrEqual(300);
    const hand = cases.filter((c) => c.kind === "hand");
    expect(hand.length).toBeGreaterThanOrEqual(100);
    for (const c of hand) {
      expect(c.url, c.id).toMatch(/^https:\/\//);
      expect(c.read, c.id).toMatch(/^https:\/\//);
      expect(c.basis.length, c.id).toBeGreaterThan(5);
    }
    expect(FX.vendorCorpus.rows).toBeGreaterThan(50_000);
  });

  it("no case main reads right becomes wrong, and the total right is at least main's", () => {
    const t = { main: { right: 0, wrong: 0, none: 0 }, head: { right: 0, wrong: 0, none: 0 } };
    const worse: string[] = [];
    for (const c of cases) {
      const head = detectWorkMode(c.location, c.title);
      const m = score(c.main, c.label), h = score(head, c.label);
      t.main[m]++; t.head[h]++;
      if (m === "right" && h === "wrong") worse.push(`${c.id}: ${c.title} @ ${c.location} -> ${head} (${c.label})`);
    }
    expect(worse).toEqual([]);
    expect(t.head.right).toBeGreaterThanOrEqual(t.main.right);
    expect(t.head.wrong).toBeLessThan(t.main.wrong);
  });

  it("PROVES THE TEETH: main filed these postings with a mode their pages do not state", () => {
    const fixed = cases.filter((c) => score(c.main, c.label) === "wrong" && score(detectWorkMode(c.location, c.title), c.label) !== "wrong");
    expect(fixed.length).toBeGreaterThanOrEqual(60);
    expect(fixed.map((c) => c.id)).toContain("workday:radiancetech~wd12~Radiance_External:HR102351");
    expect(fixed.map((c) => c.id)).toContain("oracle:eihu~us8~CX_1:2617921");
  });
});
