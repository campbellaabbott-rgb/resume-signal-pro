// @vitest-environment jsdom
/**
 * THE MISSING DESCRIPTION IS OUR FAILURE, NOT THEIRS (job-listings audit JL4).
 *
 * The pane said "This company's feed doesn't publish the full description" —
 * a statement about a named employer — on postings whose feed does publish one
 * and whose text we had not fetched or could not store. Now a missing
 * description says WE could not load it and hands the reader the employer's
 * own page; a fetch that failed also offers a retry, and a description that
 * simply is not held offers none (there is nothing a retry could change).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import enListing from "@/i18n/shards/listing/en.json";
import { PostingDescription } from "@/components/jobs/listing/PostingDescription";

beforeAll(() => { i18n.addResourceBundle("en", "translation", enListing, true, true); });
afterEach(cleanup);

const mount = (props: Partial<React.ComponentProps<typeof PostingDescription>> = {}) => render(
  <MemoryRouter>
    <PostingDescription
      description={{ text: null, state: "unavailable" }}
      employer="Domino's"
      applyUrl="https://jobs.dominos.com/us/jobs/123/apply"
      {...props}
    />
  </MemoryRouter>,
);

describe("a description we do not hold", () => {
  it("says the failure is ours and links the employer's own page", () => {
    mount();
    const text = document.body.textContent ?? "";
    expect(text).toContain("We couldn't load the full description here.");
    expect(text, "never a claim about the employer's feed").not.toMatch(/doesn't publish|does not publish|feed doesn't|no description/i);
    const link = screen.getByRole("link", { name: /Read it on Domino's site/ });
    expect(link.getAttribute("href")).toBe("https://jobs.dominos.com/us/jobs/123/apply");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toMatch(/opens in a new tab/);
  });

  it("offers a retry only when a fetch failed", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    cleanup();
    const onRetry = vi.fn();
    mount({ description: { text: null, state: "unavailable", onRetry } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an empty string is no description either", () => {
    mount({ description: { text: "", state: "loaded" } });
    expect(document.querySelector("[data-description='unavailable']")).not.toBeNull();
  });

  it("with no employer name and no usable link it still blames us, in plain words", () => {
    mount({ employer: "", applyUrl: "javascript:void(0)" });
    expect(document.body.textContent).toContain("We couldn't load the full description here.");
    expect(document.body.textContent).toContain("Read it on the employer's site");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("while it loads", () => {
  it("says it is loading and claims nothing else", () => {
    mount({ description: { text: null, state: "loading" } });
    expect(screen.getByRole("status").textContent).toContain("Loading the description");
    expect(document.body.textContent).not.toMatch(/couldn't/);
  });
});
