/**
 * A CLICK ON A DISABLED BUTTON IS NO CLICK (S12-166).
 *
 * The helper two render tests now use: it waits for the control to enable and
 * clicks it once, and a control that never enables fails naming itself, not
 * as "Test timed out".
 */
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { clickWhenEnabled } from "./helpers/click-when-enabled";

afterEach(cleanup);

function Late({ after, onClick }: { after: number | null; onClick: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (after === null) return;
    const t = setTimeout(() => setReady(true), after);
    return () => clearTimeout(t);
  }, [after]);
  return <button type="button" disabled={!ready} onClick={onClick}>Go Pro</button>;
}

describe("clickWhenEnabled", () => {
  it("positive control: the bare click the two tests used lands on nothing while the button is disabled", () => {
    const onClick = vi.fn();
    render(<Late after={100} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Go Pro" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("waits for the button to enable, then clicks it exactly once", async () => {
    const onClick = vi.fn();
    render(<Late after={120} onClick={onClick} />);
    await clickWhenEnabled(() => screen.getByRole("button", { name: "Go Pro" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("a button that never enables fails naming it", async () => {
    render(<Late after={null} onClick={() => {}} />);
    await expect(clickWhenEnabled(screen.getByRole("button", { name: "Go Pro" }), { timeout: 200 }))
      .rejects.toThrow(/<button> "Go Pro" is still disabled, so a click now would do nothing/);
  });
});
