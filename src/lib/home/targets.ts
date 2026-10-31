/**
 * TARGET SIZE ON A LINK DRAWN AS A BUTTON (spec section 8: 44 px under a
 * coarse pointer for buttons, chips and disclosure triggers).
 *
 * index.css gives every `a[href]` a 24 px floor in its base layer. Tailwind
 * 3's @layer is not a native cascade layer, so specificity decides: a[href]
 * (0,1,1) beats any single-class utility (0,1,0), and `min-h-11` on a link
 * never applies (the stylesheet's own comment says the opposite; the
 * switch-over plan asks design to correct it). A link's floor is therefore
 * important. A <button> needs no such thing (`button` is 0,0,1).
 *
 * The literal class names sit in this file so Tailwind's content scan
 * generates them.
 */

/** A link drawn as a large button: 44 px under every pointer. */
export const LINK_TARGET_44 = "!min-h-11";
