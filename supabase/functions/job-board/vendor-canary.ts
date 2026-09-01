import type { JobSource } from "./sources.ts";
import { extractRipplingJobPosts } from "./normalize.ts";
export type VendorKind = JobSource["source"];
export interface Canary {
  vendor: VendorKind;
  token: string;
  name: string;
}
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
  { vendor: "rippling", token: "aalo-atomics", name: "Aalo Atomics" },
  { vendor: "rippling", token: "aalyria-careers", name: "Aalyria" },
  { vendor: "workday", token: "nvidia~wd5~NVIDIAExternalCareerSite", name: "NVIDIA" },
  { vendor: "workday", token: "salesforce~wd12~External_Career_Site", name: "Salesforce" },
  { vendor: "pinpoint", token: "agencyanalytics", name: "AgencyAnalytics" },
  { vendor: "pinpoint", token: "airtanker", name: "AirTanker" },
  { vendor: "icims", token: "careers.accentcare.com", name: "AccentCare" },
  { vendor: "icims", token: "careers.84lumber.com", name: "84 Lumber" },
  { vendor: "ukg", token: "recruiting2~SUB1000SUBZ~ffaa667e-61b4-4b38-b427-2cb6982a41a3", name: "Sub-Zero Group" },
  { vendor: "ukg", token: "recruiting~AAM1000AAM~c5a88c41-a6d1-4e5d-bf94-4d0432a0df30", name: "Associated Asset Management" },
  { vendor: "paylocity", token: "1c38e30f-9af2-4b93-a08f-3ea42d2f6872", name: "Wendy's" },
  { vendor: "paylocity", token: "c47e27a2-5dd2-408a-9ef0-c799cbdd5796", name: "Forsman Farms" },
  { vendor: "adp", token: "89da4960-4d45-4b46-b7aa-5959c5f71827", name: "Vince" },
  { vendor: "adp", token: "3bb79720-acce-4bc6-88ba-203255f76c74", name: "League School" },
];
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
      return Array.isArray(r.items) ? r.items.length : Array.isArray(r.jobs) ? r.jobs.length : 0;
    case "adp":
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