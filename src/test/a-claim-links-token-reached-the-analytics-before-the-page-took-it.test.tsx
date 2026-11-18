/**
 * A CLAIM LINK'S TOKEN REACHED THE ANALYTICS BEFORE THE PAGE TOOK IT
 * (S14X-103, S12-090).
 *
 * WHAT WAS WRONG. The company-claim mail links to
 * /jobs/company/<token>/?claim_verify=<uuid>, and that uuid confirms the
 * claim. CompanyClaim read it and stripped it from the address in a mount
 * effect of the lazy board route, long after the host's deferred analytics
 * script (which records full URLs) had recorded the address with the token in
 * it. index.html's first script, which moves every other credential a URL can
 * carry into this tab's stash before any other script runs, did not know the
 * key.
 *
 * WHAT HOLDS NOW, with index.html's first script run as the page ships it and
 * the component mounted for real (only the backend faked): the script moves
 * the token into this tab's stash before any other script runs; the confirm
 * button still sends the verify with it, once, on a press, and never on load;
 * the spent token leaves the stash, so a reload offers nothing; a token
 * stashed on one company's page is never offered on another's; and the
 * "menu" variant the company header uses confirms the same way.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: { verified: false, website: null }, error: null }),
  },
}));

import { CompanyClaim } from "@/components/jobs/CompanyClaim";
import { STASH_KEY } from "@/lib/auth-fragment";

vi.setConfig(MOUNT_TEST_BUDGET);

const HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const HEAD = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(HTML)?.[1] ?? "";
const SCRIPT = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(HEAD)?.[1] ?? "";

const TOKEN = "7c1d2e3f-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const stashed = () => JSON.parse(sessionStorage.getItem(STASH_KEY) ?? "{}") as Record<string, unknown>;

/** A page load: the first script, exactly as index.html ships it, then the address it left. */
function land(url: string) {
  window.history.replaceState(null, "", url);
  new Function(SCRIPT)();
  return `${window.location.pathname}${window.location.search}`;
}
const mount = (token = "acme", variant?: "inline" | "menu") =>
  render(<MemoryRouter><CompanyClaim companyToken={token} companyName="Acme" variant={variant} /></MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { status: "verified" }, error: null });
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

describe("the claim link's token is moved before the page loads, and the press still confirms", () => {
  it("the confirm button verifies with the token the first script stashed, and spends it", async () => {
    expect(SCRIPT, "index.html has no first <head> script").toContain("rb_url_stash");
    expect(land(`/jobs/company/acme?claim_verify=${TOKEN}`), "the token was still in the address the analytics records").toBe("/jobs/company/acme");
    expect(stashed()).toMatchObject({ claim_verify: TOKEN, claim_verify_path: "/jobs/company/acme" });

    mount();
    const button = await screen.findByRole("button", { name: /confirm my claim/i }, SLOW);
    expect(invoke, "opening the page verified the claim: a mail scanner can do that").not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1), SLOW);
    expect(invoke).toHaveBeenCalledWith("company-claim", { body: { action: "verify", token: TOKEN } });
    expect(await screen.findByText(/verified employer/i, {}, SLOW)).toBeInTheDocument();
    expect(stashed().claim_verify, "the spent token stayed in the stash").toBeUndefined();
    expect(stashed().claim_verify_path).toBeUndefined();

    cleanup();
    mount();
    expect(await screen.findByRole("button", { name: /claim this profile/i }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm my claim/i }), "a reload offered the spent token again").toBeNull();
  });

  it("the address the claim mail builds, with its trailing slash, is cleaned the same way, and a reload before the press still finds the token", async () => {
    expect(land(`/jobs/company/careers.ulta.com/?claim_verify=${TOKEN}`)).toBe("/jobs/company/careers.ulta.com/");
    land("/jobs/company/careers.ulta.com/");
    mount("careers.ulta.com");
    fireEvent.click(await screen.findByRole("button", { name: /confirm my claim/i }, SLOW));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("company-claim", { body: { action: "verify", token: TOKEN } }), SLOW);
  });

  it("a token stashed on another company's page is not offered here", async () => {
    land(`/jobs/company/globex?claim_verify=${TOKEN}`);
    land("/jobs/company/acme");
    mount();
    expect(await screen.findByRole("button", { name: /claim this profile/i }, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm my claim/i })).toBeNull();
    expect(stashed().claim_verify, "another page's token was spent here").toBe(TOKEN);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("the company header's menu variant offers the same confirm press", async () => {
    land(`/jobs/company/acme?claim_verify=${TOKEN}`);
    mount("acme", "menu");
    fireEvent.click(await screen.findByRole("button", { name: /confirm my claim/i }, SLOW));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1), SLOW);
    expect(stashed().claim_verify).toBeUndefined();
  });

  it("a token an in-app link left in the address is still read from it, and taken out of it", async () => {
    window.history.replaceState(null, "", `/jobs/company/acme?from=explore&claim_verify=${TOKEN}`);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /confirm my claim/i }, SLOW));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("company-claim", { body: { action: "verify", token: TOKEN } }), SLOW);
    expect(window.location.search).toBe("?from=explore");
  });
});
