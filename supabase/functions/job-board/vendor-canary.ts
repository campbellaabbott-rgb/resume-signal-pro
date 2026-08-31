// Vendor schema-drift canary.
//
// The normalizer contract tests lock OUR parsing against payloads captured on a
// fixed date — they catch regressions in our code at commit time. They cannot
// catch the other failure mode: a vendor changing its LIVE API shape, after which
// that vendor's feeds still fetch fine but normalize to zero postings, and the
// whole vendor silently drains off the board (failedSources only tracks fetch
// failures, not "fetched OK, parsed nothing").
//
// This canary fetches a couple of large, stable reference boards per vendor
// through the SAME fetch+normalize path the refresh uses and compares RAW feed
// items to NORMALIZED postings. Raw items present but zero normalized ⇒ drift.
// Pure helpers here; the fetch + caching live in index.ts so this is unit-testable.

import type { JobSource } from "./sources.ts";
import { extractRipplingJobPosts } from "./normalize.ts";

export type VendorKind = JobSource["source"];

export interface Canary {
  vendor: VendorKind;
  token: string;
  name: string;
}

// Large, stable reference boards, live-verified 2026-07-14 to carry many postings
// (Stripe 523, GitLab 163, Palantir 276, Spotify 110, OpenAI 720, Notion 140,
// Avery Dennison 422, Public Storage 633, Blueground 30, Rokt 26, Bitrise 7,
// Flo 7). Two per vendor so a single board going temporarily empty can't fake a
// drift signal. If one goes permanently dark, swap its token.
export const CANARIES: readonly Canary[] = [
  { vendor: "greenhouse", token: "stripe", name: "Stripe" },
  { vendor: "greenhouse", token: "gitlab", name: "GitLab" },
  { vendor: "lever", token: "palantir", name: "Palantir" },
  { vendor: "lever", token: "spotify", name: "Spotify" },
  { vendor: "ashby", token: "openai", name: "OpenAI" },
  { vendor: "ashby", token: "Notion", name: "Notion" },
  { vendor: "smartrecruiters", token: "AveryDennison", name: "Avery Dennison" },
  { vendor: "smartrecruiters", token: "PublicStorage", name: "Public Storage" },
  { vendor: "workable", token: "blueground", name: "Blueground" },
  { vendor: "workable", token: "rokt", name: "Rokt" },
  { vendor: "bamboohr", token: "bitrise", name: "Bitrise" },
  { vendor: "bamboohr", token: "flo", name: "Flo" },
  // Rippling reference boards (57 + 26 postings, live-verified 2026-07-16).
  // Rippling's board data is an embedded page payload, not a documented API —
  // exactly the vendor where the drift canary earns its keep.
  { vendor: "rippling", token: "aalo-atomics", name: "Aalo Atomics" },
  { vendor: "rippling", token: "aalyria-careers", name: "Aalyria" },
  // Workday CXS reference tenants (compound token tenant~dc~site).
  { vendor: "workday", token: "nvidia~wd5~NVIDIAExternalCareerSite", name: "NVIDIA" },
  { vendor: "workday", token: "salesforce~wd12~External_Career_Site", name: "Salesforce" },
  // Pinpoint reference boards (live-verified 2026-07-17; small vendor — these
  // are its steadier tenants).
  { vendor: "pinpoint", token: "agencyanalytics", name: "AgencyAnalytics" },
  { vendor: "pinpoint", token: "airtanker", name: "AirTanker" },
  // iCIMS reference boards (live-verified 2026-07-26). The token IS the
  // employer's career-site host; these two are its steadiest large tenants.
  { vendor: "icims", token: "careers.accentcare.com", name: "AccentCare" },
  { vendor: "icims", token: "careers.84lumber.com", name: "84 Lumber" },
  // Paylocity reference boards (24 + 21 postings, live-verified 2026-08-30,
  // the day the adapter landed). Another embedded-page-payload vendor: a
  // renamed key inside Jobs[] parses fine and normalizes to zero rows, which
  // is exactly the "fetched OK, parsed nothing" drift this list exists for.
  { vendor: "paylocity", token: "1c38e30f-9af2-4b93-a08f-3ea42d2f6872", name: "Wendy's" },
  { vendor: "paylocity", token: "c47e27a2-5dd2-408a-9ef0-c799cbdd5796", name: "Forsman Farms" },
  // ADP Workforce Now reference boards (82 + 13 postings, live-verified
  // 2026-08-31, the day the adapter landed). The tokens are opaque career-
  // center GUIDs and the payload never names the employer, so these names came
  // from the boards' own welcome text and their Google-indexed posting titles.
  // The list endpoint is the SPA's data channel rather than a documented API —
  // the exact vendor class this list exists for.
  { vendor: "adp", token: "89da4960-4d45-4b46-b7aa-5959c5f71827", name: "Vince" },
  { vendor: "adp", token: "3bb79720-acce-4bc6-88ba-203255f76c74", name: "League School" },
];

// Count raw feed items in a vendor's payload (pre-normalization), matching each
// ATS's envelope shape. Lets us tell "vendor sent data we failed to parse"
// (drift) from "board is legitimately empty" (no items either way).
export function rawItemCount(vendor: VendorKind, raw: unknown): number {
  if (raw == null) return 0;
  if (vendor === "lever") return Array.isArray(raw) ? raw.length : 0;
  const r = raw as Record<string, unknown>;
  switch (vendor) {
    case "greenhouse":
    case "ashby":
    case "workable":
      return Array.isArray(r.jobs) ? r.jobs.length : 0;
    case "smartrecruiters":
      return Array.isArray(r.content) ? r.content.length : 0;
    case "bamboohr":
      return Array.isArray(r.result) ? r.result.length : 0;
    case "rippling": {
      const page = extractRipplingJobPosts(String(raw));
      return page ? page.items.length : 0;
    }
    case "workday":
      return Array.isArray(r.jobPostings) ? r.jobPostings.length : 0;
    case "pinpoint":
      return Array.isArray(r.data) ? r.data.length : 0;
    case "icims":
      // fetchBoard hands the canary { items: [...] } (its own envelope), and
      // the vendor's own shape is { jobs: [...] } — accept either so a raw
      // count is never mistaken for drift.
      return Array.isArray(r.items) ? r.items.length : Array.isArray(r.jobs) ? r.jobs.length : 0;
    case "adp":
      // fetchAdp re-wraps the accumulated pages under the vendor's own
      // envelope key, so raw counting reads the same shape the API serves.
      return Array.isArray(r.jobRequisitions) ? r.jobRequisitions.length : 0;
    default:
      return 0;
  }
}

export interface CanaryResult {
  vendor: VendorKind;
  token: string;
  fetchOk: boolean;
  raw: number;
  normalized: number;
}

export interface VendorHealth {
  vendor: string;
  fetchOk: boolean;
  rawItems: number;
  normalized: number;
  drift: boolean;
  boards: string[];
}

// Fold per-board probes into per-vendor health. Drift = the vendor's feeds carried
// raw items but the normalizer produced zero postings — a shape change on their
// side. Requires at least one board to have fetched OK (a vendor fully unreachable
// is an outage/transient, reported separately, not drift).
export function aggregateVendorHealth(results: readonly CanaryResult[]): {
  vendors: VendorHealth[];
  drifted: string[];
  unreachable: string[];
} {
  const by = new Map<string, VendorHealth>();
  for (const r of results) {
    const v = by.get(r.vendor) ?? { vendor: r.vendor, fetchOk: false, rawItems: 0, normalized: 0, drift: false, boards: [] };
    v.fetchOk = v.fetchOk || r.fetchOk;
    v.rawItems += r.raw;
    v.normalized += r.normalized;
    v.boards.push(r.token);
    by.set(r.vendor, v);
  }
  const vendors = [...by.values()].map((v) => ({ ...v, drift: v.fetchOk && v.rawItems > 0 && v.normalized === 0 }));
  return {
    vendors,
    drifted: vendors.filter((v) => v.drift).map((v) => v.vendor),
    unreachable: vendors.filter((v) => !v.fetchOk).map((v) => v.vendor),
  };
}
