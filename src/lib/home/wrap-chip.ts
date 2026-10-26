/**
 * A CHIP WHOSE TRANSLATED LABEL WRAPS (spec section 7: no nowrap on a value
 * that carries translated text).
 *
 * The Ledger Chip (src/components/ui/chip.tsx, the design train's) is 24 px
 * tall and truncates its label: right for a short board fact, wrong for a
 * translated sentence. Under WCAG 1.4.12 text spacing the German sample
 * chip was cut off and pushed the page 7 px sideways at 320 px. Passed as
 * the Chip's className, this lets the chip grow and its label wrap, without
 * editing the primitive: the child selector (0,1,1) outranks `truncate`
 * (0,1,0).
 */
export const WRAP_CHIP = "h-auto min-h-6 py-0.5 [&>span:last-child]:overflow-visible [&>span:last-child]:whitespace-normal";
