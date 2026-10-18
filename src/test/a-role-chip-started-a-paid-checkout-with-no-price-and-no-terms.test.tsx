/**
 * A ROLE CHIP STARTED A PAID CHECKOUT WITH NO PRICE AND NO TERMS (review of
 * the wave-3 integration, 2026-10-10, money-consent lens).
 *
 * WHAT WAS WRONG. Once a spreadsheet or Google Sheet of jobs is imported, the
 * uploader shows a chip per role under "See how you compare to your target
 * roles". Each chip ran the Full Analysis checkout (Index.handleCheckout,
 * create-checkout). The chip named no price and sat under no Terms line, so
 * the call recorded no Terms version, and with the EU/UK switch on it sent the
 * waiver as false even after the buyer ticked the box elsewhere on the page:
 * the server refused, and the buyer was told to tick a box that was not beside
 * the button they pressed.
 *
 * WHAT HOLDS NOW, rendered: after a two-job sheet is imported, a press on a
 * role chip picks that role and starts no checkout. Every press in the
 * uploader that does start one (the priced Full Analysis link) records the
 * Terms version, and with the switch on the box ticked beside it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TERMS_VERSION } from "@/config/terms";

const eu = vi.hoisted(() => ({ on: false }));
vi.mock("@/config/eu-consumer", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  get EU_UK_SALES_ON() { return eu.on; },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const JOBS = [
  { id: "j1", title: "Data Engineer", company: "Acme", location: "Leeds", description: "Own the pipelines: Airflow, dbt and Snowflake, with on-call for the warehouse." },
  { id: "j2", title: "Analytics Engineer", company: "Beta", location: "York", description: "Model the warehouse in dbt and keep the reporting layer honest." },
];
vi.mock("@/lib/resilient-edge-function", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resilient-edge-function")>();
  return {
    ...actual,
    resilientCallers: { ...actual.resilientCallers, parseSpreadsheet: vi.fn(async () => ({ data: { success: true, jobs: JOBS }, error: null })) },
  };
});

import { ResumeUploader } from "@/components/ResumeUploader";
import { purchaseTerms, resetPurchaseTermsForTests } from "@/lib/purchase-terms";

afterEach(() => { cleanup(); eu.on = false; resetPurchaseTermsForTests(); });

const RESUME = "Jane Doe\nSenior Data Engineer, Acme Corp, Jan 2020 - Present\n- Built 40 Airflow pipelines moving 2TB a day\n- Cut warehouse spend by $250,000 a year\n";

/** Mounted as Index mounts it: a restored résumé, the free scan, and a checkout that records what Index's would send. */
async function mountWithSheet() {
  const checkouts: Array<Record<string, unknown>> = [];
  const record = () => { checkouts.push({ ...purchaseTerms() }); };
  const onJobsChange = vi.fn();
  render(
    <MemoryRouter>
      <ResumeUploader
        onFileSelect={vi.fn()}
        onTextSubmit={record}
        onCheckout={record}
        onFreeScan={vi.fn()}
        onJobsChange={onJobsChange}
        isLoading={false}
        hasContent
        resumeText={RESUME}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("tab", { name: /excel\/csv/i }));
  const input = screen.getByLabelText(/upload job listing spreadsheet/i) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["title,company\nData Engineer,Acme\n"], "jobs.csv", { type: "text/csv" })] } });
    await new Promise((r) => setTimeout(r, 0));
  });
  const chips = JOBS.map((j) => screen.getAllByRole("button").find((b) => b.textContent?.trim() === j.title));
  expect(chips.every(Boolean), "the role chips did not render after the sheet was imported").toBe(true);
  return { checkouts, onJobsChange, chips: chips as HTMLButtonElement[] };
}

describe("the role chips under an imported sheet", () => {
  it("a chip picks its role and starts no checkout", async () => {
    const { checkouts, onJobsChange, chips } = await mountWithSheet();
    fireEvent.click(chips[1]);
    expect(checkouts, "a role chip started a checkout").toEqual([]);
    expect(onJobsChange).toHaveBeenLastCalledWith([JOBS[1]]);
  });

  it("every press in the uploader that starts a checkout records the Terms version", async () => {
    const { checkouts, chips } = await mountWithSheet();
    for (const chip of chips) fireEvent.click(chip);
    const full = screen.getAllByRole("button").find((b) => /or get the complete analysis/i.test(b.textContent ?? ""));
    expect(full, "the priced Full Analysis link did not render").toBeTruthy();
    fireEvent.click(full!);
    expect(checkouts.length).toBeGreaterThan(0);
    for (const c of checkouts) expect(c, "a checkout started from a press no Terms line covered").toMatchObject({ termsVersion: TERMS_VERSION });
  });

  it("with the EU/UK switch on, a ticked box reaches every checkout the uploader starts", async () => {
    eu.on = true;
    const { checkouts, chips } = await mountWithSheet();
    for (const chip of chips) fireEvent.click(chip);
    const full = screen.getAllByRole("button").find((b) => /or get the complete analysis/i.test(b.textContent ?? ""))!;
    // The box of the line that covers this button (S11-141: each line holds its own).
    let block: HTMLElement | null = full.parentElement;
    while (block && !block.querySelector("input[type=checkbox]")) block = block.parentElement;
    fireEvent.click(block!.querySelector("input[type=checkbox]")!);
    fireEvent.click(full);
    expect(checkouts.length).toBeGreaterThan(0);
    for (const c of checkouts) expect(c, "a checkout sent the waiver as unticked after the buyer ticked it").toMatchObject({ withdrawalWaiver: true });
  });
});
