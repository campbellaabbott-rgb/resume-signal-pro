/**
 * THE UPLOADER SHOWS AND SCANS THE RÉSUMÉ THE PAGE HOLDS, AND A REPEATED DRAFT
 * KEEPS THE REPORT.
 *
 *  S11-030  "Resume uploaded ✓" and the scan and $5 buttons followed the
 *           uploader's own pick, not the text the page scans. A click mid-
 *           read, a failed read, Clear, or two reads landing out of order
 *           scanned nothing ("No resume provided" under "uploaded") or the
 *           previous résumé, and sent it to the $5 checkout. Now the buttons
 *           follow the page's résumé text and its reading state, "uploaded"
 *           shows only over a file the page finished reading, and the page
 *           drops the uploader's pick on a failed read or Clear.
 *  S11-031  In paste mode the uploader re-sent its unchanged draft whenever
 *           the page's handler changed identity (it depends on the job
 *           description, which "Check against a posting" sets), and the page
 *           nulled the report each time; switching to an empty Paste tab sent
 *           "" and erased an uploaded résumé. Only a changed draft is sent.
 *
 * Rendered, with the page's props driven as Index drives them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const RESUME = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions";
type Props = Parameters<typeof ResumeUploader>[0];

function harness(initial: Partial<Props> = {}) {
  const onFreeScan = vi.fn();
  const onCheckout = vi.fn();
  const onFileSelect = vi.fn();
  const onResumeDraftChange = vi.fn();
  let props: Props = {
    onFileSelect, onTextSubmit: vi.fn(), onCheckout, onFreeScan, onResumeDraftChange,
    isLoading: false, resumeText: "", ...initial,
  } as Props;
  const view = render(<MemoryRouter><ResumeUploader {...props} /></MemoryRouter>);
  const set = (next: Partial<Props>) => {
    props = { ...props, ...next } as Props;
    view.rerender(<MemoryRouter><ResumeUploader {...props} /></MemoryRouter>);
  };
  return { onFreeScan, onCheckout, onFileSelect, onResumeDraftChange, set, view };
}

const scanButton = () => screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]')) as HTMLButtonElement;
const pickFile = (name = "resume.pdf") => {
  const input = document.querySelector('input[type="file"][accept*=".pdf"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["%PDF-1.4"], name, { type: "application/pdf" })] } });
};
const uploadedShown = () => !!screen.queryByText(/uploaded/i);

afterEach(() => { vi.useRealTimers(); });

describe("S11-030: the uploader follows the page's résumé", () => {
  it("while the page reads the picked file, nothing says uploaded and nothing can be scanned or bought", () => {
    const h = harness();
    pickFile();
    expect(h.onFileSelect).toHaveBeenCalledTimes(1);
    h.set({ isLoading: true, resumeText: "" });
    expect(scanButton().disabled).toBe(true);
    expect(uploadedShown()).toBe(false);
    // The read finishes: the page holds the text, and only now is it uploaded.
    h.set({ isLoading: false, resumeText: RESUME });
    expect(scanButton().disabled).toBe(false);
    expect(uploadedShown()).toBe(true);
  });

  it("a failed read drops the pick: no 'uploaded', no scan of nothing", () => {
    const h = harness();
    pickFile();
    h.set({ isLoading: true });
    h.set({ isLoading: false, resumeText: "", uploadResetSignal: 1 });
    expect(uploadedShown()).toBe(false);
    expect(scanButton().disabled).toBe(true);
  });

  it("a new pick while the old résumé is still in the page cannot scan the old one", () => {
    const h = harness({ resumeText: RESUME });
    expect(scanButton().disabled).toBe(false);
    pickFile("second.pdf");
    // The page clears its résumé the moment the new file is picked, and reads it.
    h.set({ resumeText: "", isLoading: true });
    expect(scanButton().disabled).toBe(true);
  });

  it("a résumé the page restored (no file picked here) can be scanned", () => {
    harness({ resumeText: RESUME, hasContent: true });
    expect(scanButton().disabled).toBe(false);
  });

  it("removing the file clears the page's résumé, not just the box", () => {
    const onClearResume = vi.fn();
    const h = harness({ onClearResume });
    pickFile();
    h.set({ resumeText: RESUME });
    fireEvent.click(screen.getByLabelText(/remove/i));
    expect(onClearResume).toHaveBeenCalled();
  });
});

describe("S11-031: only a changed draft reaches the page", () => {
  const openPaste = () => fireEvent.click(document.getElementById("resume-paste-tab")!);
  const pasteBox = () => (screen.getAllByRole("textbox") as HTMLTextAreaElement[]).find((t) => /resume content here/i.test(t.placeholder ?? ""))!;

  it("a new handler identity (the job description changed) does not re-send the same draft", () => {
    vi.useFakeTimers();
    const h = harness();
    openPaste();
    fireEvent.change(pasteBox(), { target: { value: RESUME } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(h.onResumeDraftChange).toHaveBeenCalledTimes(1);
    expect(h.onResumeDraftChange).toHaveBeenLastCalledWith(RESUME.trim());
    const second = vi.fn();
    h.set({ onResumeDraftChange: second, jobDescriptionText: "A posting the visitor checked against" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(second).not.toHaveBeenCalled();
    // A real edit still goes through.
    fireEvent.change(pasteBox(), { target: { value: `${RESUME}\n- Built the forecast` } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("switching to an empty Paste tab does not erase an uploaded résumé", () => {
    vi.useFakeTimers();
    const h = harness({ resumeText: RESUME });
    openPaste();
    act(() => { vi.advanceTimersByTime(300); });
    expect(h.onResumeDraftChange).not.toHaveBeenCalled();
  });

  it("Clear empties the paste box", () => {
    vi.useFakeTimers();
    const h = harness();
    openPaste();
    fireEvent.change(pasteBox(), { target: { value: RESUME } });
    act(() => { vi.advanceTimersByTime(300); });
    h.set({ pasteResetSignal: 1, uploadResetSignal: 1, resumeText: "" });
    expect(pasteBox().value).toBe("");
  });
});
