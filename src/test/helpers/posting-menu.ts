/**
 * THE CARD'S ⋯ MENU, DRIVEN THE WAY A KEYBOARD DRIVES IT.
 *
 * Since pass B (2026-10-12) the board's card is the listing vocabulary's
 * JobCard: Report (three reasons), Hide this posting, Compare, Open in Claude
 * or ChatGPT and Copy link live in one Radix menu behind "More actions for
 * {title}". Radix opens that menu on a pointer press or on Enter/Space, never
 * on a synthetic click, so the tests that used to press a card's own Report,
 * Hide or Compare button open the menu with Enter and pick the item from it.
 *
 * Keyboard rather than user-event on purpose: user-event's setup() replaces
 * navigator.clipboard with its own stub, which would hide the very copy that
 * the hand-off and copy-link tests read back.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

/** The card's ⋯ trigger, inside `scope` (a card, or the whole document). */
export function postingMenuTrigger(scope: HTMLElement = document.body): HTMLElement {
  return within(scope).getAllByRole("button", { name: /^More actions for / })[0];
}

/**
 * Open the ⋯ menu inside `scope` and return THAT menu: the one the trigger
 * names through aria-controls. A page with several cards can still hold the
 * previous card's menu while it leaves (Radix Presence), so the first
 * `role="menu"` in the document is not always the one just opened.
 */
export async function openPostingMenu(scope: HTMLElement = document.body): Promise<HTMLElement> {
  const trigger = postingMenuTrigger(scope);
  // Let a previous card's menu leave first: Radix keeps a closing menu in the
  // document for a moment, and a keypress while it leaves can land on it
  // (the compare tray read "1 of 3" after two cards were toggled that way).
  try {
    await waitFor(() => { if (document.querySelector('[role="menu"]')) throw new Error("a menu is still open"); }, { timeout: 1500 });
  } catch { /* a menu that never leaves is the test's to report */ }
  fireEvent.keyDown(trigger, { key: "Enter" });
  const menus = await screen.findAllByRole("menu");
  const id = trigger.getAttribute("aria-controls");
  return menus.find((m) => !!id && m.id === id) ?? menus[menus.length - 1];
}

/** Open the ⋯ menu inside `scope` and choose one item by its name. */
export async function choosePostingMenuItem(
  scope: HTMLElement,
  name: string | RegExp,
  role: "menuitem" | "menuitemcheckbox" = "menuitem",
): Promise<void> {
  const menu = await openPostingMenu(scope);
  fireEvent.click(within(menu).getByRole(role, { name }));
}
