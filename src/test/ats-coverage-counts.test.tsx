/**
 * THE VENDOR WALL MAY NOT PUBLISH A NUMBER IT DID NOT MEASURE.
 *
 * The front page now prints a live open-role count beside each ATS platform.
 * That is a stronger credibility claim than a bare list, and it fails in a
 * strictly worse way, so it gets the same treatment as every other published
 * figure in this project.
 *
 * THE BUG THIS EXISTS TO PREVENT HAS ALREADY SHIPPED ONCE. An exact per-category
 * total was published straight from `get_job_board_facets` and reverted the same
 * day: that function counts the WHOLE TABLE with no serving-rule predicate, so
 * the figure included postings the board itself refuses to show. The note left
 * in src/pages/Jobs.tsx says a correct version needs a serving-rule-filtered
 * count and that it is "a DB change, not a frontend one".
 *
 * This is that DB change, and the first draft of it got the rule HALF right —
 * it filtered `missing_since IS NULL` and forgot the 30-day window, which would
 * have over-reported every vendor and put the reverted bug back on the front
 * page with a larger audience. Hence the migration assertions below: the facet
 * must carry BOTH predicates, because that is what buildQuery serves.
 *
 * The render tests cover the other half — that absence never becomes a zero.
 * A vendor missing from the facet has either no live postings or was never
 * measured, and neither of those is "0".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import { AtsCoverage } from "../components/AtsCoverage";
import { ATS_VENDORS, ATS_VENDOR_LIST } from "../config/ats-vendors";

/** Shape the warm cache returns, trimmed to what this component reads. */
const facets = (sourcesFacet: Record<string, unknown>, openTotal: unknown = 12_345) => ({
  data: {
    total: 595_042,
    sourcesFacet,
    openTotal,
    as_of: "2026-08-08T15:07:00.124808+00:00",
    cached: true,
    stale: false,
  },
  error: null,
});

/** Route by RPC name: the component also asks whether the sender is online.
 *
 * The hook now asks the SLIM read (get_board_vendor_counts) first and falls
 * back to the wide facets RPC only on PGRST202 — both are routed to the same
 * payload here because the slim read is by construction the same cached row
 * minus companiesFacet, and these tests assert on keys both shapes carry. */
const route = (facetResult: unknown, senderOnline = false) => {
  rpc.mockImplementation((fn: string) =>
    fn === "get_board_vendor_counts" || fn === "get_job_board_facets"
      ? Promise.resolve(facetResult)
      : Promise.resolve({ data: senderOnline, error: null }),
  );
};

/** The deploy window: slim RPC not yet applied (PGRST202) → wide fallback. */
const routeSlimMissing = (facetResult: unknown) => {
  rpc.mockImplementation((fn: string) => {
    if (fn === "get_board_vendor_counts") return Promise.resolve({ data: null, error: { code: "PGRST202" } });
    if (fn === "get_job_board_facets") return Promise.resolve(facetResult);
    return Promise.resolve({ data: false, error: null });
  });
};

beforeEach(() => rpc.mockReset());

describe("counts render only when they were actually measured", () => {
  it("shows a vendor's live count beside its name", async () => {
    route(facets({ greenhouse: 48_102, workday: 305_380 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("48,102")).toBeInTheDocument());
    expect(screen.getByText("305,380")).toBeInTheDocument();
  });

  it("prefers the slim read and never fetches the wide facets when it answers", async () => {
    // The wide RPC returns 1.6MB of companiesFacet this component discards;
    // fetching it anyway — twice per landing — was ~3.2MB per visitor.
    route(facets({ greenhouse: 48_102 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("48,102")).toBeInTheDocument());
    const called = rpc.mock.calls.map((c) => c[0]);
    expect(called).toContain("get_board_vendor_counts");
    expect(called).not.toContain("get_job_board_facets");
  });

  it("falls back to the wide facets during the deploy window (PGRST202)", async () => {
    // Frontend can ship before the migration applies; the cost degrades to
    // yesterday's, the wall never goes blank.
    routeSlimMissing(facets({ greenhouse: 48_102 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("48,102")).toBeInTheDocument());
  });

  it("says when the counts were true", async () => {
    // A count of a churning table without a timestamp is a decoration.
    route(facets({ greenhouse: 48_102 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText(/measured/i)).toBeInTheDocument());
  });

  it("renders NO number for a vendor absent from the facet", async () => {
    // The load-bearing case. `lever` is not in the payload, so it has either no
    // live postings or was never measured. Both must render as name-only.
    route(facets({ greenhouse: 48_102 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("48,102")).toBeInTheDocument());
    expect(screen.getByText("Lever")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("never turns a zero, null or junk value into a printed count", async () => {
    route(facets({ greenhouse: 0, lever: null, ashby: "many", bamboohr: -5, workday: 12 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    for (const bad of ["0", "-5", "many", "NaN", "null"]) {
      expect(screen.queryByText(bad), bad).not.toBeInTheDocument();
    }
  });

  it("falls back to names alone when the RPC errors", async () => {
    route({ data: null, error: { message: "statement timeout" } });
    render(<AtsCoverage />);
    // Every platform still named — the page degrades to the older, weaker claim
    // rather than to an empty section.
    await waitFor(() => expect(screen.getByText("Greenhouse")).toBeInTheDocument());
    expect(screen.getByText("Workday")).toBeInTheDocument();
    expect(screen.queryByText(/measured/i)).not.toBeInTheDocument();
  });

  it("falls back to names alone on a COLD cache", async () => {
    // sourcesFacet {} + openTotal null is "nothing computed yet", not "no jobs".
    route(facets({}, null));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("Greenhouse")).toBeInTheDocument());
    expect(screen.queryByText(/measured/i)).not.toBeInTheDocument();
  });

  it("quotes a total only when it has one", async () => {
    route(facets({ greenhouse: 48_102 }, 561_004));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText(/561,004 open roles/)).toBeInTheDocument());
  });

  it("names every platform the config carries", async () => {
    route(facets({ greenhouse: 48_102 }));
    render(<AtsCoverage />);
    await waitFor(() => expect(screen.getByText("48,102")).toBeInTheDocument());
    for (const v of ATS_VENDORS) {
      expect(screen.getByText(v.label), v.label).toBeInTheDocument();
    }
  });
});

describe("the strip at the top of the page is a narrower layout, not a weaker claim", () => {
  it("names every platform, immediately", async () => {
    // The whole point of the placement: all fifteen, before anything asks the
    // visitor for a file.
    route(facets({ greenhouse: 48_102 }));
    render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText("48,102")).toBeInTheDocument());
    for (const v of ATS_VENDORS) {
      expect(screen.getByText(v.label), v.label).toBeInTheDocument();
    }
  });

  it("carries the counts and the as-of line", async () => {
    route(facets({ greenhouse: 48_102, workday: 305_380 }, 561_004));
    render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText("305,380")).toBeInTheDocument());
    expect(screen.getByText(/measured/i)).toBeInTheDocument();
  });

  it("does NOT restate a board-wide total — the hero above it owns that", async () => {
    // Measured in production once the facet went live: the hero showed 595,687
    // and this facet's openTotal was 596,759. Both honest, computed by
    // different paths at different moments, ~1,000 apart — and rendered four
    // lines apart on the same screen, where a reader has no way to know they
    // are two measurements rather than one contradiction.
    route(facets({ greenhouse: 48_102, workday: 305_380 }, 561_004));
    render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText("305,380")).toBeInTheDocument());
    expect(screen.queryByText(/561,004/)).not.toBeInTheDocument();
    // A restated FIGURE is the problem, not the phrase: the as-of line says
    // "currently open roles" and states no total, which is exactly right.
    expect(screen.queryByText(/[\d,]+\s+open roles/i)).not.toBeInTheDocument();
    // The claim that sentence actually carries survives.
    expect(screen.getByText(/never scraped from a search engine/i)).toBeInTheDocument();
  });

  it("obeys absence-is-not-zero exactly like the full block", async () => {
    route(facets({ greenhouse: 0, workday: 12 }));
    render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("falls back to names alone when nothing was measured", async () => {
    route({ data: null, error: { message: "statement timeout" } });
    render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText("Workday")).toBeInTheDocument());
    expect(screen.queryByText(/measured/i)).not.toBeInTheDocument();
  });

  it("still states the auto/click split when the sender is live", async () => {
    // Compacting the layout must not quietly drop the one claim that says we
    // do not bypass a human check.
    route(facets({ workday: 12 }), true);
    render(<AtsCoverage variant="strip" />);
    await waitFor(() => expect(screen.getByText(/press send/i)).toBeInTheDocument());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("the board's Sources note is generated, never typed out", () => {
  const LOCALES = resolve(__dirname, "../i18n/locales");

  it("ATS_VENDOR_LIST names every platform", () => {
    for (const v of ATS_VENDORS) expect(ATS_VENDOR_LIST, v.label).toContain(v.label);
  });

  it("every locale interpolates the list instead of spelling it out", () => {
    // Ten copies of one fact — nine locales plus the inline default — is how
    // the default came to omit Workday, the largest source on the board,
    // without anyone noticing.
    for (const f of readdirSync(LOCALES).filter((n) => n.endsWith(".json"))) {
      const note = (JSON.parse(readFileSync(resolve(LOCALES, f), "utf8"))
        .jobsPage ?? {}).sourceNote as string | undefined;
      if (!note) continue;
      expect(note, `${f} does not interpolate {{vendors}}`).toContain("{{vendors}}");
      // No hardcoded platform run left behind next to the placeholder.
      const named = ATS_VENDORS.filter((v) => note.includes(v.label));
      expect(named.map((v) => v.label), `${f} still hardcodes platform names`).toEqual([]);
    }
  });

  it("Jobs.tsx passes the generated list into the string", () => {
    const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    expect(jobs).toMatch(/jobsPage\.sourceNote[\s\S]{0,600}?\{ vendors: ATS_VENDOR_LIST \}/);
    expect(jobs).toMatch(/import \{ ATS_VENDOR_LIST \} from "@\/config\/ats-vendors"/);
  });

  it("the inline default no longer spells any platform out", () => {
    // It used to name ten and miss five. The en.json key overrode it, so the
    // drift was invisible until a translation went missing.
    const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    const call = /t\("jobsPage\.sourceNote",\s*"([^"]+)"/.exec(jobs);
    expect(call, "could not find the sourceNote default").toBeTruthy();
    expect(call![1]).toContain("{{vendors}}");
    for (const v of ATS_VENDORS) {
      expect(call![1], `default still hardcodes ${v.label}`).not.toContain(v.label);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const DIR = resolve(__dirname, "../../supabase/migrations");
// Match on the DDL that ADDS the key, never on the identifier — selecting "the
// latest file mentioning sourcesFacet" would pick up any later migration that
// merely reads it. This slip cost three green runs in one day.
const mig = readdirSync(DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(resolve(DIR, f), "utf8"))
  .filter((t) => t.includes("'sourcesFacet', COALESCE((")).pop() ?? "";

/**
 * JUST THE sourcesFacet SUBQUERY — sliced, not regex-windowed.
 *
 * The first version of these assertions used /sourcesFacet[\s\S]{0,400}?…/ and
 * PASSED with the 30-day window deleted from the facet, because the lazy window
 * ran on past the block and matched the copy of the predicate inside
 * `openTotal`. A test that reads a neighbouring block's code and reports it as
 * the block under test is worse than no test: it is a green light wired to the
 * wrong sensor. Caught by mutating the migration, which is the only reason it
 * is not still in here.
 *
 * Slicing to the block's own text makes the assertion structurally unable to
 * see the other one.
 */
const facetBlock = (() => {
  const start = mig.indexOf("'sourcesFacet', COALESCE((");
  if (start < 0) return "";
  const end = mig.indexOf("), '{}'::jsonb)", start);
  return end < 0 ? "" : mig.slice(start, end);
})();

describe("the facet is filtered by the board's real serving rule", () => {
  it("exists at all", () => {
    expect(mig, "no migration builds sourcesFacet").not.toBe("");
    expect(facetBlock, "could not isolate the sourcesFacet subquery").not.toBe("");
  });

  it("the slice really is only the facet block", () => {
    // Guards the guard. If this ever spans into openTotal again, the two
    // assertions below silently stop testing anything.
    expect(facetBlock).not.toMatch(/openTotal/);
    expect(facetBlock).toMatch(/GROUP BY source/);
  });

  it("filters missing_since — postings the board refuses to serve", () => {
    expect(facetBlock).toMatch(/missing_since IS NULL/);
  });

  it("ALSO filters the 30-day window, which the first draft forgot", () => {
    // Half the rule over-reports every vendor. This is the assertion that would
    // have caught the draft, and the reason the file exists.
    expect(facetBlock).toMatch(/effective_posted >= now\(\) - interval '30 days'/);
  });

  it("counts the denominator under the SAME two predicates", () => {
    // Parts and whole must be one measurement, or the vendor counts will not
    // sum to the total printed beside them.
    expect(mig).toMatch(
      /'openTotal'[\s\S]{0,300}?missing_since IS NULL AND effective_posted >= now\(\) - interval '30 days'/,
    );
  });

  it("omits vendors with no postings rather than recording a zero", () => {
    // ASSERTED ON THE CONSTRUCTION, NOT ON A COMMENT SAYING SO.
    //
    // This first checked for the sentence "absence is never rendered as a
    // measured zero" in the migration text. Lovable re-stamps applied
    // migrations with the comments stripped, so the identical SQL arrived as a
    // new file and the assertion failed — correctly telling me the test was
    // wrong, not the code. A comment enforces nothing; it was never the thing
    // keeping zeros out.
    //
    // What actually does: jsonb_object_agg over a GROUP BY. A source with no
    // matching rows forms no group, so it cannot appear as a key at all. The
    // way to break this is to zero-fill against a vendor list — a LEFT JOIN
    // with COALESCE(n, 0) — which is precisely what the last assertion forbids.
    expect(facetBlock).toMatch(/jsonb_object_agg\(source, n\)/);
    expect(facetBlock).toMatch(/GROUP BY source/);
    expect(facetBlock).not.toMatch(/LEFT JOIN|COALESCE\([^)]*,\s*0\s*\)/i);
  });

  it("stays off the request path", () => {
    // The whole reason this is a cached facet. A per-vendor count still times
    // out live today, even capped at 10k.
    expect(mig).toMatch(/CREATE OR REPLACE FUNCTION public\.refresh_job_board_facets/);
    expect(mig).toMatch(/statement_timeout = '10min'/);
  });

  it("declares the new keys in the COLD-cache shape too", () => {
    // Otherwise a consumer written against the warm shape sees undefined on a
    // cold cache and renders whatever its author assumed.
    expect(mig).toMatch(/'sourcesFacet', '\{\}'::jsonb, 'openTotal', NULL/);
  });
});

describe("the page names no platform the catalog does not carry", () => {
  it("every ATS_VENDORS key appears as a vendor in sources.ts", () => {
    // A platform listed on a credibility surface but absent from the catalog is
    // the cheapest possible false claim to make and the hardest to notice.
    const sources = readFileSync(
      resolve(__dirname, "../../supabase/functions/job-board/sources.ts"),
      "utf8",
    );
    for (const v of ATS_VENDORS) {
      expect(sources.includes(`"${v.key}"`), `${v.key} named on the front page but absent from sources.ts`).toBe(true);
    }
  });
});
