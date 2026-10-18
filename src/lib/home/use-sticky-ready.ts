import { useState } from "react";

/**
 * TRUE FROM THE FIRST RENDER WHERE `ready` IS TRUE, AND FROM THEN ON.
 *
 * Both new pages wait for the reader's strings before their first render,
 * so a German reader never sees an English frame swap into German (a layout
 * shift: CLS 0.18 measured at 375 px). A later language change must not
 * wait the same way: unmounting the page while the new strings load drops
 * the reader's focus and scroll position (WCAG 2.4.3). So the gate opens
 * once and stays open; the content re-renders in the new language when its
 * strings land.
 */
export function useStickyReady(ready: boolean): boolean {
  const [ever, setEver] = useState(ready);
  if (ready && !ever) setEver(true);
  return ever || ready;
}
