/**
 * CLICK A CONTROL ONLY ONCE IT CAN BE CLICKED (S12-166).
 *
 * fireEvent.click on a disabled button does nothing, silently. Two wave-3
 * render tests found their button with findByRole, which returns it the moment
 * it exists, while it was still disabled (Pro's card waits for its
 * subscription check; the homepage's scan button waits for the résumé it
 * restores), clicked, and then waited for a request that could never come:
 * main's CI went red for five pushes on a timeout that named neither the
 * button nor why.
 *
 * This waits until the control is enabled (neither `disabled` nor
 * aria-disabled), then clicks it once. A control that never enables fails as
 * itself, naming the control, within SLOW, under the per-test budget.
 */
import { fireEvent, waitFor } from "@testing-library/react";
import { SLOW } from "./mount-budget";

const isDisabled = (el: HTMLElement) =>
  (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";

const label = (el: HTMLElement) =>
  `<${el.tagName.toLowerCase()}> "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60)}"`;

/** Wait for the control (or the control `find` returns) to be enabled, then click it once. Returns it. */
export async function clickWhenEnabled(
  control: HTMLElement | (() => HTMLElement),
  { timeout = SLOW.timeout }: { timeout?: number } = {},
): Promise<HTMLElement> {
  const find = typeof control === "function" ? control : () => control;
  let el: HTMLElement | null = null;
  await waitFor(() => {
    el = find();
    if (isDisabled(el)) throw new Error(`${label(el)} is still disabled, so a click now would do nothing`);
  }, { timeout });
  fireEvent.click(el!);
  return el!;
}
