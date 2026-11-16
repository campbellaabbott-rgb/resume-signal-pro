// @vitest-environment node
/**
 * A POSTING WE CANNOT READ IS NAMED BY THE SCORER THAT COULD NOT (S14X-052,
 * the server half).
 *
 * The shipped job-fit handler runs here with only the database faked
 * (helpers/edge-harness.ts). fit-batch keeps every key it answered before
 * (fits, missing, matched, scored, of) and adds `unscored`: beside each null,
 * why. A held description the scorer recognised nothing in is
 * no_recognised_terms; a row with no description is no_description; a scored
 * row, a zero included, has no entry.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadEdgeHandler, type EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const ROWS = [
  { id: "en", description: "We need a registered nurse for ICU and emergency triage, with acute care experience and patient assessment. ".repeat(3), min_years: null },
  { id: "de", description: "Wir suchen eine engagierte Kraft für unser Haus am See, mit Freude an der Arbeit im Team und Herz. ".repeat(3), min_years: null },
  { id: "none", description: null, min_years: null },
  { id: "short", description: "Nurse.", min_years: null },
];
const fakeClient = {
  rpc: async () => ({ data: true, error: null }),
  from: () => {
    const q = { select: () => q, in: async () => ({ data: ROWS, error: null }) };
    return q;
  },
};
const stub = "export function createClient() { return globalThis.__fitDb; }";

let jobFit: EdgeHandler;
beforeAll(async () => {
  const g = globalThis as Record<string, unknown>;
  const env: Record<string, string> = { SUPABASE_URL: "https://h.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key-for-tests" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: unknown) => { g.__edgeHandler = h; } };
  g.__fitDb = fakeClient;
  jobFit = await loadEdgeHandler("job-fit", { "https://esm.sh/@supabase/supabase-js@2.45.0": stub });
});

const RESUME = "Registered nurse with eight years in acute care, ICU and emergency triage, patient assessment. ".repeat(3);

describe("fit-batch names why each null is a null", () => {
  it("a held description with nothing recognised, a missing one, and a short one are told apart; a scored row is not listed", async () => {
    const res = await jobFit(new Request("https://h.supabase.co/functions/v1/job-fit", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ action: "fit-batch", resumeText: RESUME, ids: ROWS.map((r) => r.id) }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { fits: Record<string, number | null>; unscored?: Record<string, string>; scored: number; of: number };
    expect(typeof body.fits.en, "positive control: the English posting scores").toBe("number");
    expect(body.fits.de).toBeNull();
    expect(body.unscored, "fit-batch sends no reason beside its nulls").toEqual({
      de: "no_recognised_terms",
      none: "no_description",
      short: "no_description",
    });
    // The keys every older reader takes are unchanged.
    expect(body).toMatchObject({ scored: 2, of: 4 });
    expect(Object.keys(body.fits).sort()).toEqual(["de", "en", "none", "short"]);
  });
});
