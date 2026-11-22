/**
 * /DATA-API PROMISES A FORM ONLY WHERE /v1 READS ONE (GEO-1b, the React half;
 * SEO audit 2026-11-18b).
 *
 * The /data-api page described GET /v1/jobs/{id}/application as "the
 * employer's own application form for a live posting, when its hiring system
 * publishes one". /v1 does not read every such system's form: since the
 * owner's decision of 2026-11-16 an Ashby posting answers form.source
 * "not-read-on-this-surface", and Ashby publishes a form all the same. The line
 * now promises the form "where we read that hiring system's form", and names
 * each answer a posting with no form read gets, read from the API's own type
 * (supabase/functions/public-api/application.ts), so a value the API adds or
 * drops fails here rather than on a reader's code. It types no list of
 * hiring systems (that list lives in the API and drifts when copied).
 *
 * On f1ea5e353 the line says "when its hiring system publishes one" and names
 * only "not-published".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

import DataApi from "../pages/DataApi";

vi.setConfig({ ...MOUNT_TEST_BUDGET, testTimeout: 30_000 });
const ROOT = resolve(__dirname, "../..");
const ROUTE = "GET /v1/jobs/{id}/application";

/** The form.source values /v1 can answer, from the API's own V1Form type. */
function apiFormSources(): string[] {
  const src = readFileSync(resolve(ROOT, "supabase/functions/public-api/application.ts"), "utf8");
  const union = /export type V1Form = \{[\s\S]*?\bsource:\s*([^;]+);/.exec(src)?.[1] ?? "";
  return [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

/** The rendered sentence under the application route. */
async function applicationLine(): Promise<string> {
  render(<HelmetProvider><MemoryRouter initialEntries={["/data-api"]}><DataApi /></MemoryRouter></HelmetProvider>);
  let line = "";
  await waitFor(() => {
    const code = [...document.querySelectorAll("code")].find((c) => c.textContent === ROUTE);
    expect(code, "the application route is listed").toBeTruthy();
    line = code!.nextElementSibling?.textContent ?? "";
    expect(line).not.toBe("");
  });
  return line;
}

afterEach(() => { cleanup(); document.head.innerHTML = ""; });

describe("the application route on /data-api", () => {
  it("promises the employer's form where we read that hiring system's form, not wherever a system publishes one", async () => {
    const line = await applicationLine();
    expect(line).toContain("where we read that hiring system's form");
    expect(line).not.toMatch(/when its hiring system publishes one/i);
    expect(document.body.textContent ?? "").not.toMatch(/hiring system publishes one/i);
  });

  it("names every answer a posting with no form read gets, as the API types them", async () => {
    const sources = apiFormSources();
    expect(sources, "the API's V1Form type was read").toContain("employer-published");
    const notRead = sources.filter((s) => s !== "employer-published");
    expect(notRead.length).toBeGreaterThanOrEqual(2);
    const line = await applicationLine();
    for (const s of notRead) expect(line, s).toContain(`"${s}"`);
  });

  it("types no list of hiring systems into the line", async () => {
    const line = await applicationLine();
    expect(line).not.toMatch(/\b(?:Ashby|Greenhouse|Lever|Workable|Teamtailor|Breezy|BambooHR|Paylocity|Pinpoint|Recruitee|Workday)\b/);
  });
});
