/**
 * THE TEXT A READER SEES, ONE TEXT NODE AT A TIME.
 *
 * `document.body.textContent` glues neighbouring elements together: a heading
 * ending in a word and a line starting with a capitalised word read as one
 * word, so a guard that anchors a banned label on a word boundary cannot match
 * the very sentence it forbids (the review of 2026-10-27 found exactly that
 * in the score header). These
 * helpers read every text node under a root, trimmed, joined by single spaces,
 * and the exact values of the nodes, so a banned label is caught whether it
 * stands alone or sits inside a sentence.
 */

/** Every non-empty text node under `root`, trimmed, in document order. */
export function textNodes(root: Node = document.body): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (v) out.push(v);
  }
  return out;
}

/** The text nodes joined by single spaces: what a reader reads, word by word. */
export function visibleText(root: Node = document.body): string {
  return textNodes(root).join(" ");
}

/**
 * Both readings of the page, for a negative assertion: the spaced one (so a
 * word boundary is a real boundary) and the glued `textContent` (so a phrase
 * split across nodes is still seen).
 */
export function bothReadings(root: Node = document.body): string[] {
  return [visibleText(root), root.textContent ?? ""];
}
