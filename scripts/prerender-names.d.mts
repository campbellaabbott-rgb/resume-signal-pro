// Types for scripts/prerender-names.mjs, which plain node runs for the bake and
// src/components/jobs/posting-page.ts imports so the app judges a name as the
// bake does. The module itself stays JavaScript: the bake imports it unbundled.

export interface BakeEmployerName {
  /** The name every part of a page prints: repaired, or as stored when refused whole. */
  name: string;
  /** The app's own name for the board, before the repair. */
  shown: string;
  /** True when a trailing career-site label came off. */
  repaired: boolean;
  /** Why the name cannot be printed as an employer's, or null when it can. */
  reason: string | null;
}

export function repairEmployerName(name: unknown): { name: string; repaired: boolean };

export function unpublishableNameReason(name: unknown, opts?: { codeShaped?: boolean }): string | null;

export function bakeEmployerName(
  token: string | null | undefined,
  stored: string | null | undefined,
  parts: {
    boardName: (token: string | null | undefined, stored: string | null | undefined) => string;
    isCodeShapedName: (token: string | null | undefined, name: string | null | undefined) => boolean;
  },
): BakeEmployerName;
