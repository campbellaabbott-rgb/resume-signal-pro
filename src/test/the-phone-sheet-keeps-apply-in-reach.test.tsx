// @vitest-environment jsdom
/**
 * THE PHONE SHEET KEEPS APPLY IN REACH (design spec 4.2, audit DX2).
 *
 * The hand-rolled drawer had role="dialog" and nothing else a dialog needs:
 * no focus trap, no inert background, no focus return, and a header at
 * z-[60] painting over its title at z-50. The sheet is a real dialog:
 *   - focus moves in; Escape and Close both close it; focus returns to the
 *     card that opened it;
 *   - the page behind is hidden from assistive tech while it is open, and the
 *     body carries data-scroll-locked (which the floating help hides under);
 *   - the footer's primary is "Apply on employer site" — its accessible name
 *     contains that text — opening the employer's link in a new tab, with
 *     Check fit and Save beside it;
 *   - it sits at z-50, and nothing in it is wider than its container.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { PostingSheet } from "@/components/jobs/listing/PostingSheet";
import { PostingDetail } from "@/components/jobs/listing/PostingDetail";
import type { ListingJob } from "@/lib/listing/types";

const JOB: ListingJob = {
  id: "workday:acme~wd5~External:R1", title: "Registered Nurse — Intensive Care Unit (Nights, 36 hrs)", company: "Acme Health",
  token: "acme~wd5~External", source: "workday", location: "Leeds", postedAt: "2026-10-10",
  recheckedAt: "2026-10-12T11:00:00Z", applyUrl: "https://acme.wd5.myworkdayjobs.com/External/job/Leeds/RN_R1/apply",
};

function Harness({ onApply }: { onApply?: () => void }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<HTMLElement | null>(null);
  return (
    <MemoryRouter>
      <main data-testid="page">
        <a href="/x" ref={setCard} onClick={(e) => { e.preventDefault(); setOpen(true); }}>Open the card</a>
      </main>
      <PostingSheet
        job={JOB}
        open={open}
        onClose={() => setOpen(false)}
        onApply={onApply}
        onCheckFit={() => {}}
        onToggleSave={() => {}}
        returnFocusTo={card}
      >
        <PostingDetail job={JOB} surface="sheet" description={{ text: "We are hiring night-shift ICU nurses.", state: "loaded" }} />
      </PostingSheet>
    </MemoryRouter>
  );
}

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
afterEach(cleanup);

const openSheet = async () => {
  const card = screen.getByRole("link", { name: "Open the card" });
  card.focus();
  fireEvent.click(card);
  return { card, dialog: await screen.findByRole("dialog") };
};

describe("the sheet is a dialog", () => {
  it("is named by the posting title, takes focus, and sits at z-50", async () => {
    render(<Harness />);
    const { dialog } = await openSheet();
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(JOB.title);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(dialog.className).toMatch(/\bz-50\b/);
    expect(dialog.className).toMatch(/\bmin-w-0\b/);
  });

  it("hides the page behind it and locks the scroll", async () => {
    render(<Harness />);
    await openSheet();
    await waitFor(() => expect(screen.getByTestId("page").closest("[aria-hidden='true']")).not.toBeNull());
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(true);
  });

  it("Escape closes it and focus goes back to the card", async () => {
    render(<Harness />);
    const { card, dialog } = await openSheet();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it("Close and Back are named controls, and each closes it", async () => {
    render(<Harness />);
    await openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Apply is always in reach", () => {
  it("the footer's primary says 'Apply on employer site', opens the cleaned employer link in a new tab, and reports the click", async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    const { dialog } = await openSheet();
    const footer = dialog.querySelector("[data-posting-actions='short']")!;
    expect(footer).not.toBeNull();
    const apply = [...footer.querySelectorAll("a")].find((a) => /Apply on employer site/.test(a.textContent ?? ""))!;
    expect(apply, "the footer has no Apply link").toBeTruthy();
    expect(screen.getByRole("link", { name: /Apply on employer site/ })).toBe(apply);
    expect(apply.getAttribute("href"), "the Workday /apply strip applies here too").toBe("https://acme.wd5.myworkdayjobs.com/External/job/Leeds/RN_R1");
    expect(apply.getAttribute("target")).toBe("_blank");
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(footer.textContent).toContain("Check my fit, free");
    expect(footer.querySelector("[aria-pressed]")?.getAttribute("aria-label")).toMatch(/^Save /);
  });

  it("the body does not repeat the decision row (one Apply in the sheet), and carries no second close", async () => {
    render(<Harness />);
    const { dialog } = await openSheet();
    expect(dialog.querySelectorAll("[data-apply-link]").length).toBe(1);
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBe(1);
  });

  it("nothing in the footer refuses to wrap (no overflow at 320px)", async () => {
    render(<Harness />);
    const { dialog } = await openSheet();
    const footer = dialog.querySelector("[data-posting-actions='short']")!;
    // Every control that carries a label may wrap it; an icon-only control has no label to wrap.
    const labelled = [...footer.querySelectorAll("a, button")].filter((el) => (el.textContent ?? "").trim().length > 0);
    expect(labelled.length, "Apply and Check fit both carry labels").toBeGreaterThanOrEqual(2);
    for (const el of [footer, ...labelled]) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls, el.outerHTML.slice(0, 80)).not.toMatch(/(^|\s)whitespace-nowrap(\s|$)|(^|\s)min-w-\[/);
    }
    expect(footer.getAttribute("class")).toMatch(/flex-wrap/);
  });
});
