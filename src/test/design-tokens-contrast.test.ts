/**
 * EVERY COLOUR PAIR THE LEDGER PALETTE PROMISES, MEASURED FROM THE CSS.
 *
 * The tokens live in src/index.css as HSL triplets, once for the dark theme
 * (served to everyone, under :root and [data-theme="dark"]) and once for the
 * light theme ([data-theme="light"], reachable for QA). This test parses that
 * file, not a copy of the numbers, so a token edited by hand is measured the
 * moment it changes.
 *
 * The bars are WCAG 2.2 AA:
 *   - text on any surface it can sit on: 4.5:1;
 *   - primary as link text on every surface: 4.5:1;
 *   - subtle-foreground (the quietest text) on every surface and every tint: 4.5:1;
 *   - non-text the eye must find (the input border, the focus ring, the
 *     selected ring): 3:1.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");

function block(selectorPattern: RegExp): Record<string, [number, number, number]> {
  const m = CSS.match(selectorPattern);
  if (!m || m.index === undefined) throw new Error(`no block for ${selectorPattern}`);
  const open = CSS.indexOf("{", m.index);
  const close = CSS.indexOf("}", open);
  const body = CSS.slice(open + 1, close);
  const out: Record<string, [number, number, number]> = {};
  for (const v of body.matchAll(/--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)) {
    out[v[1]] = [Number(v[2]), Number(v[3]), Number(v[4])];
  }
  return out;
}

const DARK = block(/:root,\s*\[data-theme="dark"\]\s*\{/);
const LIGHT = block(/\[data-theme="light"\]\s*\{/);

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const S = s / 100;
  const L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
function luminance(rgb: [number, number, number]): number {
  const c = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(rgb[0]) + 0.7152 * c(rgb[1]) + 0.0722 * c(rgb[2]);
}
function ratio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(hslToRgb(a));
  const lb = luminance(hslToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["background", "card", "popover", "muted", "secondary"];
const TINTS = ["primary-tint", "success-tint", "warning-tint", "destructive-tint", "signal-tint"];
const STATUS = ["success", "warning", "destructive", "signal"];
const REQUIRED = [
  ...SURFACES, ...TINTS, ...STATUS, "accent", "foreground", "muted-foreground", "subtle-foreground",
  "primary", "primary-foreground", "primary-hover", "border", "border-strong", "input", "ring",
  "success-foreground", "warning-foreground", "destructive-foreground", "signal-foreground",
  "card-foreground", "popover-foreground", "secondary-foreground", "accent-foreground",
];

type Pair = [fg: string, bg: string, min: number];

function pairs(): Pair[] {
  const out: Pair[] = [];
  for (const s of [...SURFACES, "accent", "primary-tint"]) out.push(["foreground", s, 4.5]);
  for (const s of [...SURFACES, "accent"]) out.push(["muted-foreground", s, 4.5]);
  for (const s of [...SURFACES, "accent", ...TINTS]) out.push(["subtle-foreground", s, 4.5]);
  for (const s of SURFACES) out.push(["primary", s, 4.5]);
  out.push(["primary", "primary-tint", 4.5]); // selected chip text
  out.push(["primary-foreground", "primary", 4.5]);
  out.push(["primary-foreground", "primary-hover", 4.5]);
  for (const st of STATUS) {
    for (const s of ["background", "card", "popover", "muted"]) out.push([st, s, 4.5]);
    out.push([st, `${st}-tint`, 4.5]);
    out.push([`${st}-foreground`, st, 4.5]);
  }
  out.push(["card-foreground", "card", 4.5]);
  out.push(["popover-foreground", "popover", 4.5]);
  out.push(["secondary-foreground", "secondary", 4.5]);
  out.push(["accent-foreground", "accent", 4.5]);
  // Non-text.
  out.push(["input", "background", 3]);
  out.push(["input", "card", 3]);
  out.push(["ring", "background", 3]);
  out.push(["ring", "card", 3]);
  out.push(["ring", "popover", 3]);
  out.push(["primary", "card", 3]); // the selected ring around a card
  return out;
}

describe.each([
  ["dark", DARK],
  ["light", LIGHT],
] as const)("the %s palette", (_name, T) => {
  it("defines every token the components read", () => {
    const missing = REQUIRED.filter((k) => !T[k]);
    expect(missing).toEqual([]);
  });

  it.each(pairs())("%s on %s reaches %s:1", (fg, bg, min) => {
    const r = ratio(T[fg], T[bg]);
    expect(r, `${fg} on ${bg} measures ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe("the served default is dark", () => {
  it(":root carries the dark palette, and light lives only under its attribute", () => {
    expect(CSS).toMatch(/:root,\s*\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;/);
    expect(CSS).toMatch(/\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;/);
    expect(CSS, "a media query must not flip the served palette in this release").not.toMatch(/@media \(prefers-color-scheme: light\)/);
  });

  it("positive control: the parser reads a real value", () => {
    expect(DARK.background).toEqual([217, 37, 7]);
    expect(LIGHT.background).toEqual([220, 23, 97.5]);
    // A failing pair is caught: white text on the dark warning token is ~1.9:1.
    expect(ratio([0, 0, 100], DARK.warning)).toBeLessThan(3);
  });
});
