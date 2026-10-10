// Whether the homepage's sticky bottom bar is on screen, for the one other
// fixed control in that corner (sweep S8-118). The bar's 44px dismiss button
// sat 32-76px from the right edge; the help button sits 24-72px from it, at
// the same z-index and later in the DOM, so below ~1,500px of width a tap on
// "dismiss" opened Help instead. The help button lifts itself while the bar
// is visible.
import { useSyncExternalStore } from "react";

let visible = false;
const listeners = new Set<() => void>();

export function setStickyBarVisible(next: boolean): void {
  if (visible === next) return;
  visible = next;
  for (const l of listeners) l();
}

export function useStickyBarVisible(): boolean {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => visible,
    () => false,
  );
}
