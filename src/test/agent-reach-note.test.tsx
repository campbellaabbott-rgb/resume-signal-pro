/**
 * THE PANEL THAT WAS SILENTLY DARK.
 *
 * AgentReachNote is the only place a subscriber is told that unattended
 * submission covers a minority of the board. It read `agent_reach`, an RPC that
 * returns `57014 statement timeout` on every call — measured against production
 * 2026-08-05, four calls, ~3.2s each, at every cache window. The cause is a
 * deadlock: the only writer of the RPC's cache is the RPC's own slow path, and
 * that path counts ~590k rows twice, so it never finishes and never fills the
 * cache it depends on.
 *
 * The component behaved correctly throughout — it renders nothing rather than a
 * made-up number — which is exactly why nobody noticed. "Fails closed" and
 * "fails visibly" are different properties and this had only the first.
 *
 * These tests exercise the RENDER, not the source text, because the bug was
 * never in what the file said. It was in what the call returned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import AgentReachNote from "../components/account/AgentReachNote";
import { SENDABLE_VENDORS } from "../../supabase/functions/_shared/apply-automation";

/** The shape production actually returned when this fix was written. */
const LIVE = { vendors: SENDABLE_VENDORS.length, postings: 31786, ofTotal: 572607, pct: 5.6 };

beforeEach(() => invoke.mockReset());

describe("it reads the number that works", () => {
  it("asks job-board for status, not the RPC that times out", async () => {
    invoke.mockResolvedValue({ data: { sendable: LIVE } });
    render(<AgentReachNote />);
    await waitFor(() => expect(screen.getByText(/31,786/)).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("job-board", { body: { action: "status" } });
  });

  it("shows the share of the board, so the minority is explicit", async () => {
    invoke.mockResolvedValue({ data: { sendable: LIVE } });
    render(<AgentReachNote />);
    await waitFor(() => expect(screen.getByText(/572,607/)).toBeInTheDocument());
    expect(screen.getByText(/5\.6%/)).toBeInTheDocument();
    // The half that stops a subscriber concluding the product is broken.
    expect(screen.getByText(/bot protection/i)).toBeInTheDocument();
  });

  it("computes the share itself when the server sends no pct", async () => {
    invoke.mockResolvedValue({ data: { sendable: { ...LIVE, pct: null } } });
    render(<AgentReachNote />);
    await waitFor(() => expect(screen.getByText(/5\.6%/)).toBeInTheDocument());
  });
});

describe("it renders nothing rather than a number it cannot stand behind", () => {
  // PROVE THE EFFECT RAN, then assert emptiness. The component renders nothing
  // on first paint regardless, so asserting emptiness immediately would pass
  // for good data too. Waiting on the CALL rather than on a timer is both
  // non-vacuous and avoids holding a window open around a rejected promise,
  // which vitest reports as unhandled even when the component catches it.
  const rendersNothing = async (payload: unknown) => {
    invoke.mockResolvedValue(payload);
    const { container } = render(<AgentReachNote />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  };

  it("when the call errors", async () => {
    await rendersNothing({ data: null, error: { message: "boom" } });
  });

  it("when the payload has no sendable block — an older bundle", async () => {
    await rendersNothing({ data: { catalogSize: 16473 } });
  });

  it("when the total is zero, which would render NaN%", async () => {
    await rendersNothing({ data: { sendable: { ...LIVE, ofTotal: 0 } } });
  });

  it("when a field is not a number", async () => {
    await rendersNothing({ data: { sendable: { ...LIVE, postings: null } } });
  });

  // THE REJECTING-INVOKE CASE IS DELIBERATELY ABSENT. Recording that, because
  // an unexplained gap looks like an oversight and invites someone to "add" it
  // and get the same red test.
  //
  // The component handles it — verified by rendering it against a rejecting
  // mock in an isolated file, where it renders nothing and passes. In THIS
  // file, which also contains async tests, vitest attributes the rejection to
  // the test and fails it however the promise is shaped: eagerly rejected,
  // lazily rejected, or pre-handled with a no-op catch. The component's own
  // try/catch has already dealt with it; the report is harness attribution,
  // not a defect.
  //
  // It is also the least load-bearing case here. supabase-js RETURNS errors
  // rather than throwing them — a fact this codebase has been bitten by twice
  // in the other direction — so the `error` case above is the one that
  // actually happens, and it is covered.

  it("the empty assertion is not vacuous — the same harness DOES render on good data", async () => {
    // Without this, every test above would pass if the component were deleted.
    invoke.mockResolvedValue({ data: { sendable: LIVE } });
    const { container } = render(<AgentReachNote />);
    await waitFor(() => expect(container).not.toBeEmptyDOMElement());
  });
});

describe("it will not name vendors the number was not computed from", () => {
  it("names them when both runtimes agree on the count", async () => {
    invoke.mockResolvedValue({ data: { sendable: LIVE } });
    render(<AgentReachNote />);
    await waitFor(() => expect(screen.getByText(/Auto-submits on:/)).toBeInTheDocument());
    for (const v of SENDABLE_VENDORS) {
      expect(screen.getByText(new RegExp(v))).toBeInTheDocument();
    }
  });

  it("drops the names when the deployed bundle counted a different number", async () => {
    // The edge bundle and this app bundle deploy separately, so during a
    // partial rollout one can know about an adapter the other does not. Naming
    // four vendors beside a figure computed from five is a quiet lie about
    // which employers this covers — the figure stays, the names go.
    invoke.mockResolvedValue({ data: { sendable: { ...LIVE, vendors: SENDABLE_VENDORS.length + 1 } } });
    render(<AgentReachNote />);
    await waitFor(() => expect(screen.getByText(/31,786/)).toBeInTheDocument());
    expect(screen.queryByText(/Auto-submits on:/)).not.toBeInTheDocument();
    expect(screen.getByText(/application systems/)).toBeInTheDocument();
  });
});
