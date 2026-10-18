/**
 * THE HOMEPAGE'S MIRRORS AGREE WITH WHAT THEY MIRROR, AND "/" LOADS ONLY WHAT
 * IT NEEDS.
 *
 *   - The AI line's withheld systems equal the connector's own list
 *     (MCP_WITHHELD_SOURCES), read here because the page may not import
 *     mcp-tools.ts (review P13).
 *   - The scan allowance equals what free-keyword-scan enforces.
 *   - No file of the homepage imports mcp-tools, the scanner page, the
 *     uploader, the checkout hook, or reads get_board_flow (owner decision
 *     D11: no 24-hour flow figure).
 *   - The homepage mounts the board's JobCard without a save handler, a fit
 *     button or a menu (review P12).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MCP_WITHHELD_SOURCES } from "@/config/mcp-tools";
import { HOME_WITHHELD_SOURCES } from "@/lib/home/board-figures";
import { HOME_FREE_SCANS_PER_DAY, HOME_SIGNED_IN_SCANS_PER_DAY } from "@/lib/home/facts";

const ROOT = resolve(__dirname, "../..");
const HOME_DIRS = ["src/pages/home", "src/components/home", "src/lib/home"];

function files(dir: string): string[] {
  const abs = join(ROOT, dir);
  return readdirSync(abs).flatMap((name) => {
    const p = join(abs, name);
    return statSync(p).isDirectory() ? files(relative(ROOT, p)) : /\.(ts|tsx)$/.test(name) ? [relative(ROOT, p)] : [];
  });
}
const SOURCES = HOME_DIRS.flatMap(files);
const text = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Import specifiers only: comments may name a module without loading it. */
const imports = (src: string) => [...src.matchAll(/(?:^|\n)\s*import[^"'`]*["'`]([^"'`]+)["'`]/g), ...src.matchAll(/import\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);

describe("the homepage's mirrors", () => {
  it("withholds the systems the AI connector withholds", () => {
    expect([...HOME_WITHHELD_SOURCES].sort()).toEqual([...MCP_WITHHELD_SOURCES].sort());
  });

  it("states the scan allowance free-keyword-scan enforces", () => {
    const fn = text("supabase/functions/free-keyword-scan/index.ts");
    const num = (name: string) => Number(fn.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`))?.[1]);
    expect(num("FREE_SCANS_PER_DAY")).toBe(HOME_FREE_SCANS_PER_DAY);
    expect(num("SIGNED_IN_SCANS_PER_DAY")).toBe(HOME_SIGNED_IN_SCANS_PER_DAY);
  });
});

describe("what \"/\" loads", () => {
  it("finds the homepage's files (the sweep below is not vacuous)", () => {
    expect(SOURCES).toEqual(expect.arrayContaining(["src/pages/home/HomePage.tsx", "src/components/home/HomeBoardRows.tsx", "src/lib/home/use-home-rows.ts"]));
  });

  it("imports no mcp-tools, scanner page, uploader or checkout hook", () => {
    const FORBIDDEN = [/config\/mcp-tools/, /pages\/Index/, /components\/ResumeUploader/, /use-product-checkout/, /pages\/Pricing/, /pages\/Jobs/];
    for (const f of SOURCES) {
      for (const spec of imports(text(f))) {
        for (const re of FORBIDDEN) expect(re.test(spec), `${f} imports ${spec}`).toBe(false);
      }
    }
  });

  it("never reads the 24-hour flow figure", () => {
    for (const f of SOURCES) expect(/get_board_flow|serving_delta|intake/.test(text(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), f).toBe(false);
  });

  it("calls job-board only through the one door (invokeJobBoard)", () => {
    for (const f of SOURCES) expect(/functions\.invoke\(/.test(text(f)), f).toBe(false);
  });

  it("mounts JobCard with no save handler, no fit button and no menu", () => {
    const rows = text("src/components/home/HomeBoardRows.tsx");
    const cards = rows.match(/<JobCard\b[^>]*\/>/g) ?? [];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).not.toMatch(/onToggleSave|onCheckFit|menu=|onOpen/);
  });
});
