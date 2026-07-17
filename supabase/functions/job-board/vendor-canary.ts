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
