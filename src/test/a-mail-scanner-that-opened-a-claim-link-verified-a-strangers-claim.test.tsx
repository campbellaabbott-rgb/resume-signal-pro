/**
 * A MAIL SCANNER THAT OPENED A CLAIM LINK VERIFIED A STRANGER'S CLAIM (S8-097).
 *
 * WHAT WAS WRONG. CompanyClaim POSTed {action:"verify"} from a mount effect
 * the moment a page opened with ?claim_verify=. Mail scanners that run a
 * page's script open every link in a message, so the scanner, not the
 * inbox's owner, completed the claim -- and a domain-matched claim went
 * straight to the "Verified employer" badge.
 *
 * WHAT HOLDS NOW, with the component mounted for real and only the backend
 * faked: opening the link sends nothing and takes the token out of the
 * address bar; the visitor's press of the confirm button sends the verify,
 * once, with the link's token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: { verified: false, website: null }, error: null }),
  },
}));

import { CompanyClaim } from "@/components/jobs/CompanyClaim";

vi.setConfig(MOUNT_TEST_BUDGET);

const TOKEN = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { status: "verified" }, error: null });
  window.history.replaceState(null, "", `/jobs/company/acme?claim_verify=${TOKEN}`);
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("a claim link is confirmed by a press, not by opening it", () => {
  it("opening the link sends nothing; the confirm button sends the verify with the link's token", async () => {
    render(<MemoryRouter><CompanyClaim companyToken="acme" companyName="Acme" /></MemoryRouter>);
    const button = await screen.findByRole("button", { name: /confirm my claim/i }, SLOW);
    expect(window.location.search, "the token stayed in the address bar").toBe("");
    expect(invoke, "opening the page verified the claim: a mail scanner can do that").not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1), SLOW);
    expect(invoke).toHaveBeenCalledWith("company-claim", { body: { action: "verify", token: TOKEN } });
    expect(await screen.findByText(/verified employer/i, {}, SLOW)).toBeInTheDocument();
  });
});
