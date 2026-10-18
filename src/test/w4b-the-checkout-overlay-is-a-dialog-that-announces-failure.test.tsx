/**
 * THE CHECKOUT OVERLAY IS A DIALOG THAT TRAPS FOCUS, CLOSES ON ESCAPE AND
 * ANNOUNCES A FAILURE (S12-139).
 *
 * WHAT WAS WRONG. The overlay was a div with role="dialog": Tab walked out of
 * it into the page behind, Escape did nothing, and a failed checkout's
 * message was a plain paragraph a screen reader never announced.
 *
 * Mounted for real (a Radix dialog now).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CheckoutOverlay } from "@/components/CheckoutOverlay";

afterEach(cleanup);

describe("the checkout overlay", () => {
  it("a failure is a role=alert region carrying the message", () => {
    render(<CheckoutOverlay isVisible error="The payment service did not answer." onClose={() => {}} onRetry={() => {}} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The payment service did not answer.");
  });

  it("Escape closes it when the page gave a way to close", () => {
    const onClose = vi.fn();
    render(<CheckoutOverlay isVisible currentStep="connecting" onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is modal, and focus starts inside it and stays there", () => {
    render(
      <div>
        <button type="button">behind the overlay</button>
        <CheckoutOverlay isVisible error="x" onClose={() => {}} onRetry={() => {}} />
      </div>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Radix hides everything outside the dialog from assistive technology.
    const behind = screen.getByText("behind the overlay", { selector: "button" });
    expect(behind.closest("[aria-hidden='true'], [data-aria-hidden='true']")).not.toBeNull();
  });

  it("a press outside does not close a payment hand-off", () => {
    const onClose = vi.fn();
    render(<CheckoutOverlay isVisible currentStep="redirecting" onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
