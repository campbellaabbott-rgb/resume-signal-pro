import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  greenhouseApi,
  leverApi,
  normalizeGreenhouse,
  normalizeLever,
} from "../../supabase/functions/job-board/normalize";

/**
 * A TENANT LIVES ON EXACTLY ONE SIDE OF THE ATLANTIC.
 *
 * Greenhouse and Lever both run separate EU infrastructure, and census
 * discovery (2026-34) surfaced 370 + 73 tenants that exist ONLY there —
 * measured live 2026-08-31: Asobo Studio answers 404 on Lever's US API host
 * and 200 with seven postings on the EU one. Point the plain adapters at
 * these boards and every one of them reads as "employer has no openings",
 * which is the quietest possible way to lose four hundred employers.
 *
 * The design decision, and why it is a token prefix rather than anything
 * grander: greenhouse-EU is still Greenhouse. A new source value would ripple
 * through every copy surface that enumerates platforms (published-claims,
 * ats-vendors) for no user-facing truth, and a new catalog field would need
 * the catalog guard parser widened in three places. So the region rides
 * INSIDE the token as an `eu~` prefix — the same compound-token pattern
 * workday already uses for `tenant~dc~site` — and everything downstream
 * (posting ids, the catalog, the closure log, the resume sidecars) keeps the
 * full prefixed token as the board's identity. Exactly one seam ever strips
 * it: the pair of helpers in normalize.ts, at the moment a hostname is
 * derived. These tests pin every point that must honor that seam.
 *
 * (Greenhouse's US API host happens to answer for EU tenants today —
 * byte-identical payloads, measured 2026-08-31 — but Lever's does not, and
 * neither vendor documents the symmetry as a contract. The routing goes
 * through the helpers for both, so the board survives the day Greenhouse
 * starts answering the way Lever already does.)
 */
const ROOT = resolve(__dirname, "../..");
// Comments are stripped before any structural pin — a guard whose spelling
// can be satisfied by prose in a comment has failed four separate times in
// this repo, and reading the file raw is how that starts.
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FN = strip(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));
const VERIFY = strip(readFileSync(resolve(ROOT, "scripts/verify-all.mjs"), "utf8"));
const MILL = strip(readFileSync(resolve(ROOT, "scripts/mill-screen-all.mjs"), "utf8"));

// The four hostnames, taken FROM the helpers rather than spelled here — the
// helpers are the single place the spellings live, and a test that re-typed
// them would drift the day they ever legitimately change.
const GH_US = greenhouseApi("acme").host;
const GH_EU = greenhouseApi("eu~acme").host;
const LV_US = leverApi("acme").host;
const LV_EU = leverApi("eu~acme").host;

describe("a board that lives in Europe is fetched in Europe", () => {
  it("the helpers route the prefix to the EU hosts and strip it at the doorway", () => {
    expect(greenhouseApi("eu~abbyy")).toEqual({ host: GH_EU, token: "abbyy" });
    expect(leverApi("eu~asobostudio")).toEqual({ host: LV_EU, token: "asobostudio" });
    // A bare token is untouched — 1,000+ existing US boards must not notice
    // this feature exists.
    expect(greenhouseApi("stripe")).toEqual({ host: GH_US, token: "stripe" });
    expect(leverApi("palantir")).toEqual({ host: LV_US, token: "palantir" });
    // The two sides really are different hosts, or the routing routes nowhere.
    expect(GH_EU).not.toBe(GH_US);
    expect(LV_EU).not.toBe(LV_US);
  });

  it("the posting id keeps the FULL prefixed token — the prefix is routing, the id is identity", () => {
    // Ids seed the closure log, dedupe, bookmarks, and the detail endpoint's
    // JOB_SOURCES lookup. A stripped id would orphan the board from its own
    // catalog entry and re-open every EU posting as brand new.
    const gh = normalizeGreenhouse(
      { jobs: [{ id: 7, title: "Baker", absolute_url: "https://x.example/j/7" }] as never },
      "Acme", "eu~acme",
    );
    expect(gh[0].id).toBe("greenhouse:eu~acme:7");
    expect(gh[0].token).toBe("eu~acme");
    const lv = normalizeLever(
      [{ id: "u-1", text: "Baker", hostedUrl: "https://jobs.eu.lever.co/acme/u-1" }] as never,
      "Acme", "eu~acme",
    );
    expect(lv[0].id).toBe("lever:eu~acme:u-1");
    expect(lv[0].applyUrl).toBe("https://jobs.eu.lever.co/acme/u-1");
  });

  it("a rebuilt board-index link crosses the Atlantic with its board", () => {
    // The shared-URL rebuild (five titles behind one link) reconstructs the
    // per-job page. An EU tenant's pages are served only by the EU
    // hosted-pages host, and the path wants the bare slug — a US-host rebuild
    // would 404 every rescued link on exactly the boards being rescued.
    const jobs = [1, 2, 3, 4, 5, 6].map((i) => ({
      id: i, title: `Role ${i}`, absolute_url: "https://jobs.acme.example/all",
    }));
    const out = normalizeGreenhouse({ jobs: jobs as never }, "Acme", "eu~acme");
    for (const j of out) {
      expect(j.applyUrl).toBe(`https://job-boards.eu.greenhouse.io/acme/jobs/${j.id.split(":")[2]}`);
    }
  });

  it("index.ts spells neither vendor's hostname — every fetch path derives it", () => {
    // The honor points in index.ts: listUrl, both checkLive branches, the
    // description detail fetch, the posted-date backfill, the salary/desc
    // backfill, and the application-questions endpoint. Rather than pin each
    // line, pin the property that makes a missed one impossible: the file
    // contains no greenhouse or lever hostname AT ALL, US or EU spelling, so
    // a fetch path can only get one by calling the helpers.
    for (const host of [GH_US, GH_EU, LV_US, LV_EU]) {
      expect(FN.includes(host), `index.ts hardcodes ${host}`).toBe(false);
    }
    expect((FN.match(/greenhouseApi\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect((FN.match(/leverApi\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("the census tooling derives the same hosts the fetcher does", () => {
    // verify-all probes candidates and mill-screen samples board text; both
    // are .mjs and cannot import the TS helpers, so they carry the hostnames
    // as strings. This pin is the drift alarm: the day a helper's host
    // changes, the scripts fail here instead of silently probing the wrong
    // continent.
    for (const [file, text] of [["verify-all.mjs", VERIFY], ["mill-screen-all.mjs", MILL]] as const) {
      expect(text.includes(GH_EU), `${file} lost the greenhouse EU host`).toBe(true);
      expect(text.includes(LV_EU), `${file} lost the lever EU host`).toBe(true);
    }
  });

  it("verify-all folds the census's EU keys into their vendors, prefixed, before the catalog dedupe", () => {
    // Discovery reads hostnames, so EU candidates arrive under their own keys
    // carrying bare slugs. Folding them in prefixed — and BEFORE the dedupe —
    // is what lets a merged EU board match its own catalog entry on the next
    // round instead of being probed and merged twice.
    expect(VERIFY).toMatch(/\[\s*"greenhouse-eu",\s*"greenhouse"\s*\]/);
    expect(VERIFY).toMatch(/\[\s*"lever-eu",\s*"lever"\s*\]/);
    expect(VERIFY).toMatch(/`eu~\$\{t\}`/);
  });
});
