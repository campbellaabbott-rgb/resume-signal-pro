/**
 * A RESTORED RÉSUMÉ LEFT THE SCAN BUTTONS GREYED OUT (sweep S8-013).
 *
 * After a reload, the board's "Check my fit — free scan" (navigate('/#upload'))
 * or Account's rescan link, Index restores the résumé and the uploader shows
 * "Resume loaded (N chars)". canProceed read only the uploader's own picked
 * file or pasted text, so the free scan, the $5 link and the fallback button
 * stayed disabled and the visitor had to upload again.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { ResumeUploader } from "@/components/ResumeUploader";

const RESTORED = "Jane Doe\nSenior Analyst, Acme Corp, Jan 2020 - Present\n- Cut vendor spend by $250,000 annually\n- Led a team of five analysts across three regions\n- Built the monthly close model";

function mount(props: Partial<Parameters<typeof ResumeUploader>[0]>) {
  const onFreeScan = vi.fn();
  const onCheckout = vi.fn();
  render(
    <MemoryRouter>
      <ResumeUploader onFileSelect={vi.fn()} onTextSubmit={vi.fn()} onCheckout={onCheckout} onFreeScan={onFreeScan} isLoading={false} {...props} />
    </MemoryRouter>,
  );
  const scan = screen.getAllByRole("button").find((b) => b.closest('[data-scan-button="true"]'))! as HTMLButtonElement;
  return { onFreeScan, onCheckout, scan };
}

describe("a résumé restored by the page", () => {
  it("enables the free scan, which scans the restored text", () => {
    const { onFreeScan, scan } = mount({ hasContent: true, resumeText: RESTORED });
    expect(screen.getByText(/resume loaded/i)).toBeTruthy();
    expect(scan.disabled).toBe(false);
    fireEvent.click(scan);
    expect(onFreeScan).toHaveBeenCalledTimes(1);
    expect(onFreeScan.mock.calls[0][0]).toBeUndefined();
  });

  it("enables the $5 Full Analysis link too", () => {
    const { onCheckout } = mount({ hasContent: true, resumeText: RESTORED });
    const link = screen.getAllByRole("button").find((b) => /\$5/.test(b.textContent ?? "") && !b.closest('[data-scan-button="true"]')) as HTMLButtonElement;
    expect(link.disabled).toBe(false);
    fireEvent.click(link);
    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it("still keeps the buttons disabled with nothing loaded", () => {
    const { scan } = mount({ hasContent: false, resumeText: "" });
    expect(scan.disabled).toBe(true);
  });
});
