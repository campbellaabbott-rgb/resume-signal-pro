/**
 * THE PASS CHECKOUT REFUSED FOR THE BOX SHOWS THE BOX (review of S11-142).
 *
 * This file pinned how the $29 pass checkout (startPassCheckout, in the
 * /agents page) handled the server's EU/UK consent refusal. The apply pivot
 * (owner decision 2026-10-11) retired the Agent Pass: the page that called
 * the checkout is the retirement notice now, and startPassCheckout is gone.
 * The property left to hold is the stronger one: nothing on the site can
 * start a pass checkout any more, so no buyer can meet a refusal (or a sale)
 * for a product that is not sold. The server half — create-pass-checkout
 * refusing every purchase — belongs to the retirement of the function itself.
 * Read off comment-stripped source, so a comment that discusses the checkout
 * cannot fail it.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) =>
  s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (rel !== "src/test") sources(rel, out); continue; }
    if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("nothing on the site starts a pass checkout", () => {
  const files = sources("src");
  it("walks a non-trivial source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("src/pages/AgentPass.tsx");
    expect(files).toContain("src/pages/AgentConnect.tsx");
  });
  it("no source invokes create-pass-checkout, and no page exports a pass checkout", () => {
    const callers = files.filter((f) => /invoke\(\s*["'`]create-pass-checkout["'`]/.test(strip(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(callers).toEqual([]);
    for (const f of ["src/pages/AgentConnect.tsx", "src/pages/AgentPass.tsx"]) {
      expect(strip(readFileSync(resolve(ROOT, f), "utf8")), `${f} still exports a pass checkout`).not.toMatch(/export (?:async )?function startPassCheckout|export const startPassCheckout/);
    }
  });
});
