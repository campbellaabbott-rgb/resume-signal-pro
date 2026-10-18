// WHICH KEYPRESSES THE BOARD'S WINDOW SHORTCUTS MAY ACT ON.
//
// The board listens on `window` for Escape (close the posting), Enter (apply
// to the posting in the desktop pane) and j/k and the arrows (move through
// the list). Pass B put Radix layers on the same page: the cards' and the
// pane's ⋯ menus, the phone's posting sheet and the company page's filter
// sheet. A key pressed inside one of them belongs to that layer, and Radix
// already handles it there (it calls preventDefault when it dismisses a layer
// on Escape and when a menu item takes Enter). The window handlers acting on
// the same keypress caused two bugs (2026-10-18 review):
//   - Enter on a ⋯ menu item also opened the pane's posting in a new tab,
//     counted an apply and wrote a tracker row marked applied, for a posting
//     that could differ from the one whose menu was used;
//   - Escape on the phone sheet closed it twice (history.back ran twice, so
//     the reader left the board), and Escape on a ⋯ menu or the filter sheet
//     also closed the open posting.
// So the window handlers skip a keypress a layer has already taken, and any
// keypress aimed inside a menu, a dialog or a listbox.

const LAYER_SELECTOR = [
  "[role='menu']", "[role='menubar']", "[role='menuitem']", "[role='menuitemcheckbox']", "[role='menuitemradio']",
  "[role='dialog']", "[role='alertdialog']", "[role='listbox']", "[role='option']",
  "[data-radix-popper-content-wrapper]", "[data-posting-sheet]",
].join(", ");

/** True when a layer on top already handled this keypress, or it was aimed inside a menu, dialog or listbox. */
export function keyBelongsToALayer(e: Pick<KeyboardEvent, "defaultPrevented" | "target">): boolean {
  if (e.defaultPrevented) return true;
  const el = e.target as Element | null;
  return !!el && typeof el.closest === "function" && !!el.closest(LAYER_SELECTOR);
}
