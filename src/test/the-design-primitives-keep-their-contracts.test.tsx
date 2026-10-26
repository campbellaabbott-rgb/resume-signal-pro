/**
 * THE DESIGN PRIMITIVES KEEP THEIR CONTRACTS.
 *
 * The listing and company groups build on these, so each promise is held
 * here rather than re-checked in every caller:
 *   - Disclosure opens on click, Enter or Space, and NEVER on focus (the
 *     perks list opened as a keyboard user tabbed past and pushed the page);
 *   - ErrorState offers "Try again" only when a retry can help;
 *   - AsOf names its date basis inside a machine-readable <time>;
 *   - FactList renders nothing for an absent value (no "—" for missing data);
 *   - Chip status variants carry an icon beside the colour;
 *   - OverflowMenu's trigger is named for whose actions it holds;
 *   - IconButton cannot be written without a name (a type error, below);
 *   - toast() lands in the one sonner stack.
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Check } from "lucide-react";
import { Disclosure } from "@/components/ui/disclosure";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { AsOf } from "@/components/data/AsOf";
import { FactList } from "@/components/data/Fact";
import { Stat } from "@/components/data/Stat";
import { Chip } from "@/components/ui/chip";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Monogram, monogramLetter } from "@/components/ui/monogram";
import { HeaderSkeleton } from "@/components/ui/skeletons";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";

describe("Disclosure", () => {
  it("is a button with aria-expanded that focus does not open", () => {
    render(<Disclosure summary="Why?"><p>Because the board is read in laps.</p></Disclosure>);
    const trigger = screen.getByRole("button", { name: "Why?" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger.focus());
    fireEvent.focus(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/read in laps/)).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/read in laps/)).toBeTruthy();
  });

  it("can sit inside a heading for an accordion section", () => {
    render(<Disclosure summary="About this employer" headingLevel={2}><p>x</p></Disclosure>);
    expect(screen.getByRole("heading", { level: 2, name: "About this employer" })).toBeTruthy();
  });
});

describe("ErrorState", () => {
  it("offers Try again only when a retry can help, in a live region", () => {
    const retry = vi.fn();
    const { unmount } = render(<ErrorState title="We couldn't load these jobs" onRetry={retry} />);
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    unmount();
    render(<ErrorState title="This connection has used today's allowance" body="It resets at 20:00 your time." />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("data components", () => {
  it("AsOf names its basis in a <time dateTime>", () => {
    const { container } = render(<AsOf iso="2026-07-23" basis="loaded" />);
    const time = container.querySelector("time")!;
    expect(time.getAttribute("datetime")).toBe("2026-07-23");
    expect(time.textContent).toBe("loaded 23 Jul 2026");
  });

  it("AsOf can read relative, and prints nothing without a date", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    const { container, rerender } = render(<AsOf iso={new Date(now - 46 * 60_000).toISOString()} basis="read" relative now={now} />);
    expect(container.textContent).toBe("read 46 min ago");
    rerender(<AsOf iso={null} basis="read" />);
    expect(container.textContent).toBe("");
  });

  it("FactList is a description list that skips an absent value", () => {
    const { container } = render(
      <FactList items={[{ key: "sys", term: "Hiring system", value: "Workday" }, { key: "pay", term: "Pay", value: null }, false]} />,
    );
    expect(container.querySelector("dl")).toBeTruthy();
    expect(container.querySelectorAll("dt").length).toBe(1);
    expect(container.textContent).not.toMatch(/Pay|—/);
  });

  it("FactList with nothing to show renders nothing", () => {
    const { container } = render(<FactList items={[{ key: "a", term: "A", value: "" }]} />);
    expect(container.innerHTML).toBe("");
  });

  it("Stat carries its value, label and basis", () => {
    render(<Stat value="10,000+" label="open roles" basis={<AsOf iso="2026-10-12" basis="asOf" />} />);
    expect(screen.getByText("10,000+")).toBeTruthy();
    expect(screen.getByText("as of 12 Oct 2026")).toBeTruthy();
  });
});

describe("chips, menus, buttons", () => {
  it("a status chip carries an icon, hidden from assistive technology", () => {
    const { container } = render(<Chip variant="live" icon={<Check />}>Live at source</Chip>);
    expect(container.querySelector('[aria-hidden="true"] svg')).toBeTruthy();
    expect(container.textContent).toBe("Live at source");
  });

  it("the overflow trigger is named for whose actions it holds", () => {
    render(<OverflowMenu label="More actions for Staff Nurse" items={[{ key: "r", label: "Report", onSelect: vi.fn() }]} />);
    expect(screen.getByRole("button", { name: "More actions for Staff Nurse" })).toBeTruthy();
  });

  it("an IconButton's name is its label; its icon is decorative", () => {
    render(<IconButton aria-label="Save Staff Nurse"><Check /></IconButton>);
    const b = screen.getByRole("button", { name: "Save Staff Nurse" });
    expect(b.getAttribute("type")).toBe("button");
    expect(b.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it("IconButton without a name does not compile", () => {
    // @ts-expect-error aria-label is required by the type
    const el = <IconButton><Check /></IconButton>;
    expect(el).toBeTruthy();
  });

  it("a long Watch label can wrap instead of widening the page", () => {
    render(<Button wrap variant="secondary">Watch Academy Of Motion Picture Arts and Sciences</Button>);
    const b = screen.getByRole("button");
    expect(b.className).toMatch(/\bwhitespace-normal\b/);
    expect(b.className).toMatch(/\bmax-w-full\b/);
    expect(b.className).not.toMatch(/\bwhitespace-nowrap\b/);
  });

  it("buttons are flat: no gradient, glow or press-scale", () => {
    render(<Button>Apply</Button>);
    expect(screen.getByRole("button").className).not.toMatch(/gradient|shadow-primary|active:scale/);
  });

  it("Monogram is neutral and decorative", () => {
    const { container } = render(<Monogram name="Domino's" />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(monogramLetter("  élan")).toBe("É");
  });

  it("the header skeleton reserves the loaded header's height and holds no name", () => {
    const { container } = render(<HeaderSkeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toMatch(/min-h-\[168px\]/);
    expect(el.className).toMatch(/sm:min-h-\[136px\]/);
    expect(el.textContent).toBe("");
  });

  it("EmptyState says what is empty and offers the next step", () => {
    render(<EmptyState title="No open roles at Blackstone right now" actions={<Button>Watch</Button>} />);
    expect(screen.getByRole("heading", { name: "No open roles at Blackstone right now" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watch" })).toBeTruthy();
  });
});

describe("one toast system", () => {
  it("toast() from the old hook lands in the sonner stack", async () => {
    render(<Toaster />);
    act(() => {
      toast({ title: "Copied", description: "The link is on your clipboard." });
    });
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(screen.getByText("The link is on your clipboard.")).toBeTruthy();
  });
});
