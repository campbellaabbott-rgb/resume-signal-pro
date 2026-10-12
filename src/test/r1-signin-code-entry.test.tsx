/**
 * R1: THE CODE FIELD TAKES A CODE HOWEVER IT ARRIVES, AND RESEND WAITS A MINUTE.
 *
 * One field, not six boxes: numeric keyboard, the phone's one-time-code
 * autofill, a pasted code with spaces or dashes, any length from 6 to 10.
 * "Ask for a new code" appears only after the countdown, with the support
 * address beside it; until then the field says when.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeEntry, normalizeCode } from "@/components/auth/CodeEntry";
import { AUTH_SUPPORT_EMAIL, RESEND_AFTER_SECONDS } from "@/config/auth-providers";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("normalizeCode", () => {
  it.each([
    ["123 456", "123456"], ["123-456", "123456"], [" 12 34 56 ", "123456"], ["12345678", "12345678"], ["1234567890123", "1234567890"], ["abc", ""],
  ])("%s -> %s", (raw, want) => expect(normalizeCode(raw)).toBe(want));
});

describe("the field", () => {
  it("is labelled, numeric, filled by the phone, and takes a pasted code with spaces", async () => {
    const onSubmit = vi.fn();
    render(<CodeEntry purpose="signin" onSubmit={onSubmit} onResend={vi.fn()} onBack={vi.fn()} />);
    const field = screen.getByLabelText("Code from the email");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(field, { target: { value: "98 76 54" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    expect(onSubmit).toHaveBeenCalledWith("987654");
  });

  it("refuses a partial code with an error tied to the field", async () => {
    const onSubmit = vi.fn();
    render(<CodeEntry purpose="signin" onSubmit={onSubmit} onResend={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Code from the email"), { target: { value: "123" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    expect(onSubmit).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(screen.getByLabelText("Code from the email").getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("offers a new code only after the countdown, then the support address", async () => {
    vi.useFakeTimers();
    const onResend = vi.fn();
    render(<CodeEntry purpose="recovery" onSubmit={vi.fn()} onResend={onResend} onBack={vi.fn()} />);
    expect(screen.getByText("If an account exists for this address, a reset code is on its way. It usually arrives within a minute.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask for a new code" })).toBeNull();
    expect(screen.getByText(`You can ask for a new code in ${RESEND_AFTER_SECONDS} s.`)).toBeInTheDocument();
    for (let i = 0; i < RESEND_AFTER_SECONDS; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("link", { name: AUTH_SUPPORT_EMAIL })).toHaveAttribute("href", `mailto:${AUTH_SUPPORT_EMAIL}`);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask for a new code" })); });
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Ask for a new code" }), "the countdown did not restart").toBeNull();
  });
});
