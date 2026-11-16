/**
 * A SHORTLIST NOTICE WAS LOGGED AS SENT WHEN IT WAS ONLY COPIED (S14X-163).
 *
 * WHAT WAS WRONG. One button, "Copy + log as sent", copied the notice text,
 * swallowed a clipboard failure, and inserted a shortlist_notices row stamped
 * now whether or not any candidate ever received it; an insert error was
 * dropped too. The log an employer would show a regulator recorded copies,
 * not sends, and an NYC role (LL144 asks for the notice ten business days
 * before the tool is used) got no warning at all.
 *
 * WHAT HOLDS NOW, mounted with the database faked: Copy copies and logs
 * nothing, and says when the clipboard refused; Log as sent needs the date the
 * notice went out, shows any error, and lists the role's notices; an insert
 * refused for a column the database does not have yet (PGRST204) is retried
 * without the recipient list; the JSON export carries the notices; an NYC
 * role warns before Evaluate until a notice was sent ten business days ago.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { argsOf, blobText, page, shortlistFake, type Answer, type Chain } from "./helpers/shortlist-page-fake";

vi.setConfig(MOUNT_TEST_BUDGET);

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./helpers/shortlist-page-fake")).fakeSupabase }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ session: { user: { id: "u-1" } }, user: { id: "u-1", email: "hr@example.com" }, loading: false }) }));
vi.mock("@/components/Header", () => ({ Header: () => null }));
vi.mock("@/components/Footer", () => ({ Footer: () => null }));

import Shortlist, { businessDaysSince } from "@/pages/Shortlist";

const ROLE = { id: "role-1", title: "Data Engineer", jd_text: "Senior data engineer: Airflow, dbt and Snowflake.", jd_version: 1, jurisdiction: "NYC", created_at: "2026-10-01T00:00:00Z" };
let notices: Array<Record<string, unknown>> = [];
let insertAnswers: Answer[] = [];

const inserts = () => shortlistFake.chains.filter((c) => c.table === "shortlist_notices" && argsOf(c, "insert"));
const isoDaysAgo = (weekdays: number) => {
  const d = new Date();
  for (let n = 0; n < weekdays;) { d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n++; }
  return d.toISOString();
};

beforeEach(() => {
  shortlistFake.reset();
  notices = [];
  insertAnswers = [];
  shortlistFake.respond = (chain: Chain) => {
    if (chain.table === "shortlist_roles") return { data: [ROLE], error: null };
    if (chain.table === "shortlist_notices") {
      if (argsOf(chain, "insert")) return insertAnswers.shift() ?? { data: null, error: null };
      return { data: page(chain, notices), error: null };
    }
    return { data: [], error: null };
  };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openNotices = async () => {
  render(<MemoryRouter><Shortlist /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Candidate notices/ }));
};
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

describe("copying is not sending", () => {
  it("a refused clipboard is said, and Copy logs nothing", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Document is not focused")) } });
    await openNotices();
    expect(screen.queryByText(/Copy \+ log as sent/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(document.querySelector("[data-notice-msg]")?.textContent ?? "").toMatch(/Could not copy.*not focused/));
    expect(inserts()).toHaveLength(0);
  });

  it("Log as sent with no date is refused and inserts nothing", async () => {
    await openNotices();
    fireEvent.click(screen.getByRole("button", { name: "Log as sent" }));
    await waitFor(() => expect(document.querySelector("[data-notice-msg]")?.textContent ?? "").toMatch(/date the notice went out/));
    expect(inserts()).toHaveLength(0);
  });

  it("a refused insert is shown as not logged", async () => {
    insertAnswers = [{ data: null, error: { message: "permission denied for table shortlist_notices", code: "42501" } }];
    await openNotices();
    fireEvent.change(screen.getByLabelText("Date the notice was sent"), { target: { value: yesterday() } });
    fireEvent.click(screen.getByRole("button", { name: "Log as sent" }));
    await waitFor(() => expect(document.querySelector("[data-notice-msg]")?.textContent ?? "").toMatch(/^Notice not logged: permission denied/));
  });

  it("an insert refused for a column the database lacks is retried once without the recipients, and says so", async () => {
    insertAnswers = [{ data: null, error: { message: "Could not find the 'recipients' column", code: "PGRST204" } }, { data: null, error: null }];
    await openNotices();
    fireEvent.change(screen.getByLabelText("Date the notice was sent"), { target: { value: yesterday() } });
    fireEvent.change(screen.getByLabelText("Sent to"), { target: { value: "Candidate 1, Candidate 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Log as sent" }));
    await waitFor(() => expect(document.querySelector("[data-notice-msg]")?.textContent ?? "").toMatch(/Notice logged as sent.*recipient list is kept only after/));
    const sent = inserts().map((c) => argsOf(c, "insert")![0] as Record<string, unknown>);
    expect(sent).toHaveLength(2);
    expect(sent[0].recipients).toBe("Candidate 1, Candidate 2");
    expect("recipients" in sent[1]).toBe(false);
    expect(String(sent[1].sent_at).slice(0, 10)).toBe(yesterday());
  });
});

describe("the log is evidence", () => {
  it("the JSON export carries the role's notices", async () => {
    notices = [{ id: "n-1", role_id: "role-1", notice_type: "nyc_advance", jurisdiction: "NYC", content: "NOTICE", sent_at: isoDaysAgo(12), logged_at: isoDaysAgo(11), recipients: "Candidate 1" }];
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    render(<MemoryRouter><Shortlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Audit JSON/ }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(JSON.parse(await blobText(blobs[0])).notices).toEqual([expect.objectContaining({ id: "n-1", recipients: "Candidate 1", notice_type: "nyc_advance" })]);
  });

  it("an NYC role whose only notice went out 3 business days ago warns before Evaluate", async () => {
    notices = [{ id: "n-1", role_id: "role-1", notice_type: "nyc_advance", jurisdiction: "NYC", content: "NOTICE", sent_at: isoDaysAgo(3) }];
    render(<MemoryRouter><Shortlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
    await waitFor(() => expect(document.querySelector("[data-nyc-notice-warning]")).not.toBeNull());
  });

  it("a notice sent 10 business days ago clears the warning", async () => {
    notices = [{ id: "n-1", role_id: "role-1", notice_type: "nyc_advance", jurisdiction: "NYC", content: "NOTICE", sent_at: isoDaysAgo(10) }];
    render(<MemoryRouter><Shortlist /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Data Engineer/ }));
    await screen.findByRole("button", { name: "Evaluate" });
    await waitFor(() => expect(shortlistFake.chains.some((c) => c.table === "shortlist_notices")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-nyc-notice-warning]")).toBeNull();
  });

  it("counts business days, not calendar days", () => {
    expect(businessDaysSince("2026-11-13T12:00:00Z", new Date("2026-11-16T09:00:00Z"))).toBe(1);
    expect(businessDaysSince("2026-11-02T12:00:00Z", new Date("2026-11-16T09:00:00Z"))).toBe(10);
  });
});
