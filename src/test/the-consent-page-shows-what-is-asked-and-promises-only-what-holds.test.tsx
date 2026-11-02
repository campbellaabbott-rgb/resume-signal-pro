/**
 * THE CONSENT PAGE SHOWS WHAT IS ASKED AND PROMISES ONLY WHAT HOLDS (S9-001,
 * the audit-rest fixer's review; latent until the owner enables the OAuth
 * server).
 *
 * WHAT WAS WRONG. The audit-rest abuse round replaced the request's scopes
 * with a fixed sentence ending "It cannot buy anything, change your plan or
 * open your saved resume". Two things followed. A host asking for a broader
 * scope than the connector's own was approved without the person seeing it.
 * And the promise is not true: Supabase Auth's own /auth/v1/user accepts any
 * token it signed (it checks the signature, the subject and the session, not
 * the audience, the role or client_id), so whoever holds a connector token
 * can change the account's password or email there, and then sign in on the
 * site and do exactly what the sentence said it could not.
 *
 * WHAT HOLDS NOW: the page lists the scopes the request asks for, warns on
 * any beyond the connector's own, and promises no "cannot": it says the
 * access belongs to the account and to allow only an app the person trusts.
 * The connector's own scope is held equal to the MCP server's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { oauthApi } = vi.hoisted(() => ({
  oauthApi: { getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "u1", email: "me@example.com" } }, user: { id: "u1", email: "me@example.com" }, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: { pass: { state: "none" }, key: { live: false } }, error: null }) },
    auth: { oauth: oauthApi },
    rpc: async () => ({ data: null, error: null }),
  },
}));

import OAuthConsent, { CONNECTOR_SCOPES, scopesOf, unexpectedScopes } from "../pages/OAuthConsent";
import { OAUTH_SCOPE } from "../../supabase/functions/agent-mcp/oauth";

const ROOT = resolve(__dirname, "../..");
const mount = () => render(
  <HelmetProvider><MemoryRouter initialEntries={["/oauth/consent?authorization_id=auth_1"]}><OAuthConsent /></MemoryRouter></HelmetProvider>,
);
const asks = (scope: string) => oauthApi.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: "Claude", uri: "https://claude.ai" }, scope }, error: null });

beforeEach(() => oauthApi.getAuthorizationDetails.mockReset());

describe("what the request asks for", () => {
  it("lists the scopes the request names, as it names them", async () => {
    asks("email");
    mount();
    expect((await screen.findByTestId("consent-scopes")).textContent).toBe("It asks for: email.");
    expect(screen.queryByTestId("consent-scope-warning")).toBeNull();
  });

  it("warns on a scope beyond the connector's own, naming it", async () => {
    asks("email phone admin");
    mount();
    const warning = await screen.findByTestId("consent-scope-warning");
    expect(warning.textContent).toMatch(/also asks for phone, admin, which this connection does not use/);
    expect(screen.getByTestId("consent-scopes").textContent).toBe("It asks for: email, phone, admin.");
  });

  it("the connector's own scope is the MCP server's", () => {
    expect([...CONNECTOR_SCOPES]).toEqual(OAUTH_SCOPE.split(/\s+/).filter(Boolean));
    expect(unexpectedScopes(OAUTH_SCOPE)).toEqual([]);
    expect(scopesOf("  email   email ")).toEqual(["email"]);
  });
});

describe("what the page promises", () => {
  it("promises no 'cannot', and tells the person to allow only an app they trust", async () => {
    asks("email");
    const { container } = mount();
    await screen.findByText(/Claude is asking/);
    expect(container.textContent).not.toMatch(/cannot buy|cannot .*change your plan|cannot .*open your saved/i);
    expect(container.textContent).toMatch(/allow only an app you trust/);
  });

  it("the waiting translations promise no 'cannot' either, in any language", () => {
    const doc = JSON.parse(readFileSync(resolve(ROOT, "docs/audit-rest-pending-locales/abuse.json"), "utf8")) as Record<string, Record<string, string>>;
    const grant = doc["oauthConsent.grant"];
    expect(Object.keys(grant).sort()).toEqual(["de", "en", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"]);
    expect(grant.en).toBe("It can search jobs on the board, score a resume you paste against them, prepare applications for you to send yourself, and see your email address and how much of your daily allowance is used. The access it receives belongs to your account, so allow only an app you trust.");
    for (const [lang, text] of Object.entries(grant)) {
      expect(text, lang).not.toMatch(/cannot buy|kann nichts kaufen|no puede comprar|ne peut rien acheter|kan niets kopen|não pode comprar|hindi ito makakabili|खरीद नहीं सकता/i);
    }
  });
});
