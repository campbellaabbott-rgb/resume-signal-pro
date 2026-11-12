/**
 * THE /agents AND /agent BLOCKS OF THE PRERENDER, EXECUTED.
 *
 * Each block is cut out of scripts/prerender-seo.mjs and run with the real
 * mirrors (src/config/mcp-tools.ts, the main locale bundle, the homepage's
 * reach arithmetic) and a board read the caller states, so a test reads the
 * page a crawler gets rather than grepping the template. A block that reads a
 * name this harness does not hand it throws, which is the point: the guard
 * that executes the block is where a new dependency has to be declared.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

export interface BakedPage { path: string; content: string; title: string; description: string; robots?: string }

/** A board read as get_board_vendor_counts answers it, parsed (counts, openTotal, asOf). */
export interface VendorRead { counts: Record<string, number>; openTotal: number; asOf: Date }

/** A plausible live read: the withheld systems present, as the 2026-11-08 read had them. */
export const SAMPLE_VENDOR_READ: VendorRead = {
  counts: { workday: 400_000, greenhouse: 300_000, lever: 208_491, usajobs: 17_794, smartrecruiters: 71_933 },
  openTotal: 998_218,
  asOf: new Date("2026-11-08T09:52:00Z"),
};

async function bakeD(mutate: (D: Record<string, unknown>) => Record<string, unknown>) {
  const [mcp, figures, format, stamps, apply, en] = await Promise.all([
    import("../../config/mcp-tools"),
    import("../../lib/home/board-figures"),
    import("../../lib/format"),
    import("../../lib/home/stamps"),
    import("../../components/agents/apply-yourself-copy"),
    import("../../i18n/locales/en.json"),
  ]);
  return mutate({
    ...mcp,
    aiReach: figures.aiReach,
    fmtCount: format.count,
    utcStamp: stamps.utcStamp,
    homeAndList: stamps.andList,
    applyYourselfBakeHtml: apply.applyYourselfBakeHtml,
    EN_LOCALE: (en as { default?: unknown }).default ?? en,
  });
}

const slice = (from: string, to: string) => {
  const BAKE = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
  const start = BAKE.indexOf(from);
  const end = BAKE.indexOf(to, start);
  if (start < 0 || end <= start) throw new Error(`agents-bake: the block from ${JSON.stringify(from)} was not found`);
  return BAKE.slice(start, end);
};

/** The /agents block, run. `read` is the board read (null: the board was not read, so no figure). */
export async function bakeAgents(opts: {
  mutate?: (D: Record<string, unknown>) => Record<string, unknown>;
  read?: VendorRead | null;
} = {}): Promise<BakedPage> {
  const block = slice("      const envText3 = ", '      write({\n        path: "/mcp",');
  const { APPLY_YOURSELF_LINE } = await import("../../../scripts/prerender-retired.mjs");
  const D = await bakeD(opts.mutate ?? ((d) => d));
  const read = opts.read === undefined ? SAMPLE_VENDOR_READ : opts.read;
  const VENDOR_TOTAL = read ? read.openTotal : null;
  const VENDOR_STAMP = read ? (D.utcStamp as (a: Date, l: string) => unknown)(read.asOf, "en") : null;
  const written: BakedPage[] = [];
  const fn = new Function(
    "D", "write", "readFileSync", "join", "root", "process", "BOARD_TOTAL", "plusClaim", "breadcrumbLd", "breadcrumbNav", "FREE_KEY_RATE_SENTENCE", "APPLY_YOURSELF_LINE",
    "SITE", "MCP_URL", "BOARD_AS_OF", "BOARD_VENDOR", "VENDOR_TOTAL", "VENDOR_STAMP",
    `${block}; return true;`,
  );
  fn(
    D, (p: BakedPage) => written.push(p),
    () => "", (...xs: string[]) => xs.join("/"), ROOT, { env: { VITE_SUPABASE_URL: "https://example.invalid" } },
    1_024_524, (n: number) => `${n}+`, () => ({}), () => "", "the rate sentence", APPLY_YOURSELF_LINE,
    "https://resumebooster.work", "https://example.invalid/functions/v1/agent-mcp", "as of 2026-11-08",
    read, VENDOR_TOTAL, VENDOR_STAMP,
  );
  if (written.length !== 1 || written[0].path !== "/agents") throw new Error(`agents-bake: /agents wrote ${written.map((w) => w.path).join(", ")}`);
  return written[0];
}

/** The /agent block (the old apply page's address), run. */
export async function bakeAgent(): Promise<BakedPage> {
  const block = slice("    // ---- /agent ----", "    // ---- /agents: the MCP server's human page ----");
  const { APPLY_YOURSELF_LINE } = await import("../../../scripts/prerender-retired.mjs");
  const D = await bakeD((d) => d);
  const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const written: BakedPage[] = [];
  const fn = new Function("D", "write", "breadcrumbLd", "breadcrumbNav", "esc", "cta", "APPLY_YOURSELF_LINE", "FOOTER_AGENTS_LABEL", `${block}; return true;`);
  fn(D, (p: BakedPage) => written.push(p), () => ({}), () => "", esc, () => "", APPLY_YOURSELF_LINE, "Connect your agent");
  if (written.length !== 1 || written[0].path !== "/agent") throw new Error(`agents-bake: /agent wrote ${written.map((w) => w.path).join(", ")}`);
  return written[0];
}

/** The words a crawler reads: tags off, the bake's entities back to characters. */
export const bakedText = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ");
