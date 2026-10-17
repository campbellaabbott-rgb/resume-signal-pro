/**
 * THE JOB-DESCRIPTION SWITCH IS A TAB LIST, AND AN UNREADABLE LINK IS SEEN.
 *
 * S12-140: the Paste / Job URL / Excel / Google Sheets switch exposed no
 * selected state to a screen reader. It is a tab list now, the selection
 * announced, and the section toggle says whether it is open.
 * S12-141: on a phone the job-description section starts collapsed; a link
 * that could not be read put its message inside the closed section, so the
 * scan button seemed to do nothing. The section opens and the message takes
 * focus, and while the link is read the scan button says so.
 *
 * The uploader rendered for real, with only the network faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";
const LINK = "https://careers.example.org/jobs/123";

function mount() {
  const onFreeScan = vi.fn();
  render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={vi.fn()} onFreeScan={onFreeScan} isLoading={false} hasContent resumeText={RESUME} />
    </MemoryRouter>,
  );
  return { onFreeScan };
}
const scanButton = () => screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))!;
const sectionToggle = () => screen.getAllByRole("button").find((b) => b.hasAttribute("aria-expanded"))!;

beforeEach(() => { invoke.mockReset(); });
afterEach(cleanup);

describe("the mode switch (S12-140)", () => {
  it("is a tab list whose selected tab is announced, and moves with a press", () => {
    mount();
    if (sectionToggle().getAttribute("aria-expanded") === "false") fireEvent.click(sectionToggle());
    const list = screen.getByRole("tab", { name: /^Job URL$/ }).closest('[role="tablist"]') as HTMLElement;
    expect(list, "the Job URL tab sits in a tab list").toBeTruthy();
    expect(list.getAttribute("aria-label")).toBeTruthy();
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
    fireEvent.click(screen.getByRole("tab", { name: /^Job URL$/ }));
    expect(screen.getByRole("tab", { name: /^Job URL$/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /^Paste Text$/ }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("an unreadable link (S12-141)", () => {
  it("opens the collapsed section and focuses the reason, instead of a scan button that does nothing", async () => {
    let release: (v: unknown) => void = () => {};
    invoke.mockImplementation((fn: string) => (fn === "fetch-job-posting"
      ? new Promise((r) => { release = r; })
      : Promise.resolve({ data: null, error: null })));
    const { onFreeScan } = mount();
    if (sectionToggle().getAttribute("aria-expanded") === "false") fireEvent.click(sectionToggle());
    fireEvent.click(screen.getByRole("tab", { name: /^Job URL$/ }));
    fireEvent.change(screen.getByRole("textbox", { name: /^Job URL$/ }), { target: { value: LINK } });
    // The person closes the section (as a phone starts it), then presses scan.
    fireEvent.click(sectionToggle());
    expect(sectionToggle().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(scanButton());
    // While the link is read, the button says so and cannot be pressed again.
    await waitFor(() => expect(scanButton().getAttribute("aria-busy")).toBe("true"));
    expect((scanButton() as HTMLButtonElement).disabled).toBe(true);
    release({ data: { ok: false, reason: "unsupported_host" }, error: null });
    const message = await screen.findByTestId("job-url-message");
    expect(sectionToggle().getAttribute("aria-expanded")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(onFreeScan).not.toHaveBeenCalled();
  });
});
