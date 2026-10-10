/**
 * Sweep S8-081 (latent until the OAuth server is enabled). The consent page
 * named the host of client.uri as "After you allow, you return to {{host}}".
 * client_uri is the client's self-declared homepage: a client registered as
 * "Claude" with client_uri claude.ai and redirect_uri evil.example read "you
 * return to claude.ai" while Allow sent the authorization code to evil.example,
 * handing over agent-mcp actions on the account.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

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
    from: () => { const th: Record<string, unknown> = {}; const s = () => th; for (const k of ["select", "eq", "is", "not", "order", "limit"]) th[k] = s; th.maybeSingle = async () => ({ data: null }); th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok); return th; },
  },
}));

import OAuthConsent, { pendingRedirectHost } from "../pages/OAuthConsent";

const mount = () => render(
  <HelmetProvider><MemoryRouter initialEntries={["/oauth/consent?authorization_id=auth_1"]}><OAuthConsent /></MemoryRouter></HelmetProvider>,
);

describe("the consent page says where Allow sends the code", () => {
  beforeEach(() => { oauthApi.getAuthorizationDetails.mockReset(); });

  it("names the pending redirect's host, never the client's self-declared homepage", async () => {
    oauthApi.getAuthorizationDetails.mockResolvedValue({
      data: { client: { name: "Claude", uri: "https://claude.ai" }, scope: "email", redirect_uri: "https://evil.example/callback" },
      error: null,
    });
    mount();
    expect(await screen.findByText(/access to your account goes to evil\.example/)).toBeInTheDocument();
    expect(screen.queryByText(/claude\.ai/)).toBeNull();
  });

  it("names no host at all when the request does not carry one", async () => {
    oauthApi.getAuthorizationDetails.mockResolvedValue({
      data: { client: { name: "Claude", uri: "https://claude.ai" }, scope: "email" },
      error: null,
    });
    mount();
    expect(await screen.findByText(/does not say where access will go/)).toBeInTheDocument();
    expect(screen.queryByText(/claude\.ai/)).toBeNull();
  });

  it("reads only a real URL as the pending redirect", () => {
    expect(pendingRedirectHost({ redirect_uri: "https://chatgpt.com/connector/oauth/cb" })).toBe("chatgpt.com");
    expect(pendingRedirectHost({ redirect_uri: "not a url" })).toBe("");
    expect(pendingRedirectHost({ client: { uri: "https://claude.ai" } })).toBe("");
    expect(pendingRedirectHost(null)).toBe("");
  });
});
