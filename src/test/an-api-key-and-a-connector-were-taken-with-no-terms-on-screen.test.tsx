/**
 * AN API KEY AND A CONNECTOR WERE TAKEN WITH NO TERMS: THE LINES ON SCREEN
 * (commercial-readiness plan 2026-10-08, item 12; the handler and the
 * migration are in an-api-key-and-a-connector-were-taken-with-no-terms.test.ts).
 *
 * /data-api's "Email me a link" and /oauth/consent's "Allow" carried no "By
 * continuing you agree to the Terms" line. Both pages are mounted with the
 * network faked: the line sits above each button, and the key request sends
 * the version the line showed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import en from "../i18n/locales/en.json";
import { TERMS_VERSION } from "@/config/terms";

const { invoke, oauthApi } = vi.hoisted(() => ({
  invoke: vi.fn(),
  oauthApi: { getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "u1", email: "member@example.com" } }, user: { id: "u1", email: "member@example.com" }, loading: false }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    auth: { oauth: oauthApi },
    rpc: async () => ({ data: null, error: null }),
  },
}));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit", "in", "update", "insert"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import DataApi from "../pages/DataApi";
import OAuthConsent from "../pages/OAuthConsent";

const AGREE = en.purchaseTerms.agree.replace(/<\/?(terms|privacy)>/g, "");
const page = (el: React.ReactElement, at = "/") =>
  render(<HelmetProvider><MemoryRouter initialEntries={[at]}>{el}</MemoryRouter></HelmetProvider>);

beforeEach(() => {
  invoke.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("the free API key form", () => {
  it("shows the Terms line above its button and sends the version it showed", async () => {
    invoke.mockResolvedValue({ data: { requested: true }, error: null });
    page(<DataApi />);
    const button = screen.getByRole("button", { name: /email me a link/i });
    const line = screen.getAllByTestId("purchase-terms").find((el) => el.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(line?.textContent).toContain(AGREE);
    expect(line?.querySelector('a[href="/terms"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "dev@example.org" } });
    fireEvent.click(button);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("api-key-request", { body: { email: "dev@example.org", name: "", termsVersion: TERMS_VERSION } }));
  });
});

describe("the connector's consent page", () => {
  it("shows the Terms line above Allow", async () => {
    invoke.mockResolvedValue({ data: { pass: { state: "none" }, key: { live: false } }, error: null });
    oauthApi.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: "Claude", uri: "https://claude.ai" }, scope: "email" }, error: null });
    page(<OAuthConsent />, "/oauth/consent?authorization_id=auth_1");
    const allow = await screen.findByRole("button", { name: /allow/i });
    const line = screen.getByTestId("purchase-terms");
    expect(line.textContent).toContain(AGREE);
    expect(line.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
