/**
 * A MAIL SCANNER OPENING THE OUTCOME LINK RECORDS NOTHING (S10-153).
 *
 * The scan-report email carries three links, one per answer ("got an
 * interview", "no response", "rejected"), to the homepage with
 * ?outcome=&rid=. The page stored that answer as it loaded. Mail scanners and
 * link previews open every link in a message, so a scanner that opened all
 * three wrote three answers, the last one winning, and none of them was the
 * person's.
 *
 * Now loading the page stores nothing: the link picks the answer on a card,
 * the person can change it, and it is stored when they press the card's save
 * button. Their own answer is still recorded, and "Not now" records nothing.
 *
 * The card prints the link's report id in its title, so a link whose id the
 * mail could never have written (the mail writes only letters and digits)
 * shows no card: otherwise anyone could put their own sentence at the top of
 * the scanner, under our name, beside a Save button.
 *
 * Read on the whole homepage with the uploader and the report reduced to
 * stubs and the database faked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import en from "@/i18n/locales/en.json";
import shard from "@/i18n/shards/home-scan/en.json";

vi.setConfig(MOUNT_TEST_BUDGET);

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "neq", "in", "is", "not", "or", "order", "limit", "range", "gte", "lte", "insert", "upsert", "update", "delete"]) chain[k] = () => chain;
  Object.assign(chain, {
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: (...a: unknown[]) => rpc(...a),
      functions: { invoke: async () => ({ data: null, error: null }) },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
  safeNextPath: (s: string) => s,
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast, dismiss() {}, toasts: [] }), toast }));
vi.mock("@/lib/track-transport", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getVisitorId: () => "visitor-test-1",
}));
vi.mock("@/components/ResumeUploader", () => ({ ResumeUploader: () => <div>uploader</div> }));
vi.mock("@/components/FreeKeywordResults", () => ({ FreeKeywordResults: () => <div>report</div> }));

Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

// No request leaves the test (the checked-in .env names production).
beforeAll(() => {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 503, headers: { "content-type": "application/json" } })));
});
afterAll(() => { vi.unstubAllGlobals(); });

import Index from "@/pages/Index";

const REPORT = "RB7Q2K9X";
const card = shard.homeScan.outcome;
const outcomeCalls = () => rpc.mock.calls.filter(([fn]) => fn === "record_scan_outcome");

function openTheLink(outcome = "interview", rid = REPORT) {
  const path = `/?outcome=${outcome}&rid=${encodeURIComponent(rid)}`;
  window.history.replaceState({}, "", path);
  return render(<HelmetProvider><MemoryRouter initialEntries={[path]}><Index /></MemoryRouter></HelmetProvider>);
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
  toast.mockReset();
  try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

describe("the outcome link in the scan-report email", () => {
  it("records nothing when the page is opened, as a mail scanner opens it", async () => {
    openTheLink("interview");
    await screen.findByText("uploader", {}, SLOW);
    await settle();
    expect(outcomeCalls(), "opening the link stored an answer before anyone pressed anything").toEqual([]);
    // What the page offers instead: the answer, waiting for a press.
    expect(await screen.findByText(card.save, {}, SLOW)).toBeTruthy();
    await settle();
    expect(outcomeCalls()).toEqual([]);
  });

  it("shows the link's answer picked, and stores it when the person confirms", async () => {
    openTheLink("interview");
    const picked = await screen.findByRole("button", { name: en.scanOutcome.interview }, SLOW);
    expect(picked.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(card.title.replace("{{reportId}}", REPORT))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: card.save }));
    await waitFor(() => expect(outcomeCalls().length).toBe(1));
    expect(outcomeCalls()[0][1]).toEqual({ p_report_id: REPORT, p_outcome: "interview", p_ip: "visitor-test-1" });
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: en.scanOutcome.recorded }));
    await waitFor(() => expect(screen.queryByText(card.save)).toBeNull());
    expect(window.location.search, "the link's answer stayed in the address after it was stored").toBe("");
  });

  it("stores the answer the person changed it to, not the link's", async () => {
    openTheLink("interview");
    fireEvent.click(await screen.findByRole("button", { name: en.scanOutcome.rejected }, SLOW));
    fireEvent.click(screen.getByRole("button", { name: card.save }));
    await waitFor(() => expect(outcomeCalls().length).toBe(1));
    expect(outcomeCalls()[0][1]).toMatchObject({ p_outcome: "rejected" });
  });

  it("records nothing when the person says not now", async () => {
    openTheLink("no_response");
    fireEvent.click(await screen.findByRole("button", { name: card.dismiss }, SLOW));
    await settle();
    expect(outcomeCalls()).toEqual([]);
    expect(screen.queryByText(card.save)).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("keeps the card and says nothing was saved when the server did not keep the answer", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    openTheLink("interview");
    fireEvent.click(await screen.findByRole("button", { name: card.save }, SLOW));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: en.scanOutcome.notSaved, variant: "destructive" }));
    expect(screen.getByRole("button", { name: card.save })).toBeTruthy();
  });

  // The mail only writes letters and digits, 6 to 32 of them. Anything else
  // came from whoever wrote the link, and the card would print it as ours.
  it.each([
    ["words a stranger wrote", "Your Pro plan is suspended, email billing@example.com"],
    ["markup", "RB7Q2K9X<b>"],
    ["too few characters", "RB7"],
    ["a space", "RB7Q2K9X RB7Q2K9X"],
  ])("shows no card, and stores nothing, for a link whose report id the mail never writes (%s)", async (_why, rid) => {
    openTheLink("interview", rid);
    await screen.findByText("uploader", {}, SLOW);
    await settle();
    expect(screen.queryByText(card.save), `a card was shown for the report id ${JSON.stringify(rid)}`).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(rid);
    expect(outcomeCalls(), `an answer was stored for the report id ${JSON.stringify(rid)}`).toEqual([]);
  });

  it("shows no card for a link that names no answer the page knows", async () => {
    openTheLink("hired");
    await screen.findByText("uploader", {}, SLOW);
    await settle();
    expect(screen.queryByText(card.save)).toBeNull();
    expect(outcomeCalls()).toEqual([]);
  });
});
