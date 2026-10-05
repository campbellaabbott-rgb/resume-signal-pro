/**
 * THE JOB DESCRIPTION BOX REACHES THE FREE SCAN (register L13-31, sweep 1.48).
 *
 * The homepage's "Target Job Description" box kept its text in the uploader's
 * own state; the scan button sent only the résumé, so a JD typed or pasted
 * there never reached free-keyword-scan and the advertised match score never
 * appeared. A JD handed off from the job board and then edited or cleared in
 * the box was still sent unchanged.
 *
 * Rendered, typed into, clicked: what the parent receives is what the box says.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";
const JD = "We are hiring a senior financial analyst to own forecasting, vendor management and the monthly close.";

function mount(props: Partial<Parameters<typeof ResumeUploader>[0]> = {}) {
  const onFreeScan = vi.fn();
  const onJobDescriptionTextChange = vi.fn();
  render(
    <MemoryRouter>
      <ResumeUploader
        onFileSelect={vi.fn()}
        onTextSubmit={vi.fn()}
        onCheckout={vi.fn()}
        onFreeScan={onFreeScan}
        onJobDescriptionTextChange={onJobDescriptionTextChange}
        isLoading={false}
        hasContent
        {...props}
      />
    </MemoryRouter>,
  );
  return { onFreeScan, onJobDescriptionTextChange };
}

/** The paste-mode résumé box and the JD paste box, by their placeholders. */
function boxes() {
  const all = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
  const jd = all.find((t) => /job description you're applying to/i.test(t.placeholder ?? ""));
  const resume = all.find((t) => /resume content here/i.test(t.placeholder ?? ""));
  return { jd, resume };
}
const openResumePaste = () => fireEvent.click(document.getElementById("resume-paste-tab")!);

describe("the free scan button", () => {
  it("sends the JD typed into the box, and tells the parent", async () => {
    const { onFreeScan, onJobDescriptionTextChange } = mount();
    openResumePaste();
    const { jd, resume } = boxes();
    expect(jd, "the JD paste box did not render").toBeTruthy();
    fireEvent.change(resume!, { target: { value: RESUME } });
    fireEvent.change(jd!, { target: { value: JD } });
    fireEvent.click(screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))!);
    expect(onFreeScan).toHaveBeenCalledTimes(1);
    expect(onFreeScan.mock.calls[0][1]).toBe(JD);
    expect(onJobDescriptionTextChange).toHaveBeenCalledWith(JD);
  });

  it("a handed-off JD the visitor cleared is not sent", async () => {
    const { onFreeScan } = mount({ jobDescriptionText: JD });
    openResumePaste();
    const { jd, resume } = boxes();
    expect(jd!.value).toBe(JD);
    fireEvent.change(resume!, { target: { value: RESUME } });
    fireEvent.change(jd!, { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))!);
    expect(onFreeScan.mock.calls[0][1]).toBe("");
  });
});
