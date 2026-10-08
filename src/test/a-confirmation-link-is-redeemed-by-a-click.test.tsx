/**
 * A CONFIRMATION LINK IS REDEEMED BY A CLICK, NOT BY A PAGE LOAD.
 *
 * Both confirmation mails (the data-API key, defect sweep 1.43; the market
 * pulse, 1.59), and the fix-plan button in a report mail (review of
 * 2026-10-04), carry a token in the URL fragment. Mail scanners
 * open links by themselves, so the page that a link opens must not spend the
 * token on load: a key minted by a scanner's prefetch would be shown to the
 * scanner, and a pulse "confirmed" by one would not be the person's choice.
 *
 * These render the real pages with the network faked and hold that:
 *   - nothing is invoked until the button is pressed;
 *   - the key is shown once, with the limits the server returned, and the
 *     token leaves the address bar;
 *   - a refusal prints the server's own message (supabase-js returns data=null
 *     for a non-2xx and puts the Response on error.context);
 *   - the request form says a link is on its way (if the address can receive
 *     our mail: the server's answer is the same either way) and never shows a
 *     key;
 *   - the fix-plan sequence is started only by its page's button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { apiKeyTokenFromHash, dripTokenFromHash, errorBodyOf, pulseTokenFromHash } from "@/lib/confirm-link";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: null }),
    from: () => stubTable(),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import DataApi from "../pages/DataApi";
import MarketPulseConfirm from "../pages/MarketPulseConfirm";
import FixPlanConfirm from "../pages/FixPlanConfirm";

const TOKEN = "ab".repeat(32);
const KEY = "rb_live_" + "c".repeat(64);
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error(`HTTP ${status}`), { context: new Response(JSON.stringify(body), { status }) });

beforeEach(() => {
  invoke.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const page = (el: React.ReactElement) => render(<HelmetProvider><MemoryRouter>{el}</MemoryRouter></HelmetProvider>);

describe("the fragment parsers", () => {
  it("read only a 64-hex token, from the fragment's own parameter", () => {
    expect(apiKeyTokenFromHash(`#confirm=${TOKEN}`)).toBe(TOKEN);
    expect(apiKeyTokenFromHash(`#x=1&confirm=${TOKEN}`)).toBe(TOKEN);
    expect(apiKeyTokenFromHash(`#confirm=${TOKEN}0`)).toBeNull();
    expect(apiKeyTokenFromHash(`#confirm=<script>`)).toBeNull();
    expect(apiKeyTokenFromHash(`#t=${TOKEN}`)).toBeNull();
    expect(pulseTokenFromHash(`#t=${TOKEN}`)).toBe(TOKEN);
    expect(pulseTokenFromHash("")).toBeNull();
  });

  it("read the fix-plan link's signed plan, and nothing that is not one", () => {
    const signed = `eyJ2IjoxfQ_-abc.${"0f".repeat(32)}`;
    expect(dripTokenFromHash(`#d=${signed}`)).toBe(signed);
    expect(dripTokenFromHash(`#d=${signed}&x=1`)).toBe(signed);
    expect(dripTokenFromHash(`#d=<script>.${"0f".repeat(32)}`)).toBeNull();
    expect(dripTokenFromHash(`#d=${TOKEN}`)).toBeNull();
    expect(dripTokenFromHash(`#t=${signed}`)).toBeNull();
  });

  it("errorBodyOf reads a non-2xx body, and answers null for anything else", async () => {
    expect(await errorBodyOf(httpError(429, { error: { code: "x", message: "slow down" } }))).toEqual({ error: { code: "x", message: "slow down" } });
    expect(await errorBodyOf(new Error("network"))).toBeNull();
    expect(await errorBodyOf(null)).toBeNull();
  });
});

describe("/data-api: a key needs the mailbox, and the link needs a click", () => {
  it("the request form promises a link, sends the address, and shows no key", async () => {
    invoke.mockResolvedValue({ data: { requested: true, emailed: true }, error: null });
    page(<DataApi />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "dev@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: /email me a link/i }));
    await waitFor(() => expect(screen.getByText(/Check your inbox/i)).toBeInTheDocument());
    // True whether or not the server mailed: its answer does not say.
    expect(screen.getByText(/can receive mail from us, a link is on its way/)).toBeInTheDocument();
    expect(screen.queryByText(/We sent a link to/)).toBeNull();
    expect(invoke).toHaveBeenCalledWith("api-key-request", { body: { email: "dev@example.org", name: "" } });
    expect(screen.queryByText(/rb_live_/)).toBeNull();
    expect(screen.queryByText(/revokes the old one/i)).toBeNull();
  });

  it("a refused request prints the server's reason, not a guess", async () => {
    invoke.mockResolvedValue({ data: null, error: httpError(429, { error: { code: "network_busy", message: "Too many key requests from your network. Try again in an hour." } }) });
    page(<DataApi />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "dev@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: /email me a link/i }));
    await waitFor(() => expect(screen.getByText("Too many key requests from your network. Try again in an hour.")).toBeInTheDocument());
  });

  it("the link's page waits for the button, then shows the key once and forgets the token", async () => {
    window.history.replaceState(null, "", `/data-api#confirm=${TOKEN}`);
    invoke.mockResolvedValue({ data: { key: KEY, shownOnce: true, limits: { perMinute: 60, perDay: 1000 }, retiredPrefixes: ["rb_live_0123abcd"] }, error: null });
    page(<DataApi />);
    const button = await screen.findByRole("button", { name: /create my key/i });
    expect(invoke, "the page spent the token on load").not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(KEY)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("api-key-request", { body: { action: "confirm", token: TOKEN } });
    expect(screen.getByText(/60 requests\/minute, 1,000\/day/)).toBeInTheDocument();
    expect(screen.getByText(/rb_live_0123abcd…/)).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("a spent link says so in the server's words and offers the form again", async () => {
    window.history.replaceState(null, "", `/data-api#confirm=${TOKEN}`);
    invoke.mockResolvedValue({ data: null, error: httpError(410, { error: { code: "already_used", message: "This link was already used, and its key was shown then." } }) });
    page(<DataApi />);
    fireEvent.click(await screen.findByRole("button", { name: /create my key/i }));
    await waitFor(() => expect(screen.getByText("This link was already used, and its key was shown then.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /email me a link/i })).toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });
});

describe("/market-pulse/confirm: subscribed only by the person's click", () => {
  it("waits for the button, then confirms with the token from the fragment", async () => {
    window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
    invoke.mockResolvedValue({ data: { success: true, confirmed: true }, error: null });
    page(<MarketPulseConfirm />);
    const button = await screen.findByRole("button", { name: /yes, send me the pulse/i });
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/You're subscribed/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("send-market-pulse", { body: { action: "confirm", token: TOKEN } });
    expect(window.location.hash).toBe("");
  });

  it("an expired or spent link is named as such, and no button can resend it", async () => {
    window.history.replaceState(null, "", `/market-pulse/confirm#t=${TOKEN}`);
    invoke.mockResolvedValue({ data: null, error: httpError(410, { success: false, error: "This link has expired or was already used." }) });
    page(<MarketPulseConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: /yes, send me the pulse/i }));
    await waitFor(() => expect(screen.getByText(/expired or was already used/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /yes, send me the pulse/i })).toBeNull();
  });

  it("without a token there is nothing to press", () => {
    page(<MarketPulseConfirm />);
    expect(screen.getByText(/needs the link from your confirmation email/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("/fix-plan/confirm: the sequence starts only on the person's click", () => {
  const SIGNED = `eyJ2IjoxfQ_-abc.${"0f".repeat(32)}`;

  it("waits for the button, then starts it with the plan from the fragment", async () => {
    window.history.replaceState(null, "", `/fix-plan/confirm#d=${SIGNED}`);
    invoke.mockResolvedValue({ data: { success: true, queued: true }, error: null });
    page(<FixPlanConfirm />);
    const button = await screen.findByRole("button", { name: /yes, start the emails/i });
    expect(invoke, "the page started the sequence on load").not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/The first email arrives in two days/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("send-scan-report", { body: { action: "confirm-drip", token: SIGNED } });
    expect(window.location.hash).toBe("");
  });

  it("a sequence already running this month, or an address that opted out, is said plainly", async () => {
    for (const [reason, text] of [["already_started", /already started for this address this month/], ["opted_out", /unsubscribed from our emails earlier/]] as const) {
      window.history.replaceState(null, "", `/fix-plan/confirm#d=${SIGNED}`);
      invoke.mockResolvedValue({ data: { success: true, queued: false, reason }, error: null });
      page(<FixPlanConfirm />);
      fireEvent.click(await screen.findByRole("button", { name: /yes, start the emails/i }));
      await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
      cleanup();
    }
  });

  it("an expired or forged link is named as such, and no button can resend it", async () => {
    window.history.replaceState(null, "", `/fix-plan/confirm#d=${SIGNED}`);
    invoke.mockResolvedValue({ data: null, error: httpError(410, { success: false, error: "This link has expired or is not valid." }) });
    page(<FixPlanConfirm />);
    fireEvent.click(await screen.findByRole("button", { name: /yes, start the emails/i }));
    await waitFor(() => expect(screen.getByText(/expired or is not valid/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /yes, start the emails/i })).toBeNull();
  });

  it("a failed start asks for another press only when another press can work", async () => {
    for (const [body, text, retryWorks] of [
      [{ success: false, error: "Could not start it right now. Try the button again shortly." }, /Try the button again shortly/, true],
      [{ success: false, error: "Could not start the whole sequence.", retry: false }, /will not restart it this month/, false],
    ] as const) {
      window.history.replaceState(null, "", `/fix-plan/confirm#d=${SIGNED}`);
      invoke.mockResolvedValue({ data: null, error: httpError(503, body) });
      page(<FixPlanConfirm />);
      fireEvent.click(await screen.findByRole("button", { name: /yes, start the emails/i }));
      await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
      if (!retryWorks) expect(screen.queryByText(/Try the button again/), "the page asked for a press that can only answer already started").toBeNull();
      cleanup();
    }
  });

  it("without a plan there is nothing to press", () => {
    page(<FixPlanConfirm />);
    expect(screen.getByText(/needs the button from your report email/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
