/**
 * /explore SERVES THE ROLES IT PROMISES (SEO audit 2026-11-18, CONTENT-1).
 *
 * The served /explore said it lists "the roles inside each" field and named
 * none: the role names lived only in the React page (Explore.tsx FIELD_ROLES),
 * so a crawler read 0 of the 116. The list moved to src/data/field-roles.ts,
 * which the page and the bake both import, and the bake prints each field's
 * names under the field's own label, with no counts (the counts are live
 * probes the page makes in a browser; the bake reads nothing from the board
 * for them).
 *
 * Judged on the file an offline bake writes.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FIELD_ROLES } from "@/data/field-roles";
import { FIELD_ROLES as PAGE_FIELD_ROLES } from "@/pages/Explore";
import { BOARD_CATEGORY_SLUGS } from "@/lib/job-board-categories";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
let OUT = "";
function bake(): string {
  if (OUT) return join(OUT, "dist");
  OUT = mkdtempSync(join(tmpdir(), "explore-roles-"));
  mkdirSync(join(OUT, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return join(OUT, "dist");
}
afterAll(() => {
  if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
});

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const ALL = Object.values(FIELD_ROLES).flat();

describe("the one list", () => {
  it("is the page's list too, and the page no longer defines its own", () => {
    expect(PAGE_FIELD_ROLES).toBe(FIELD_ROLES);
    const page = readFileSync(join(ROOT, "src/pages/Explore.tsx"), "utf8");
    expect(page).toMatch(/import \{ FIELD_ROLES \} from "@\/data\/field-roles";/);
    expect(page).not.toMatch(/const FIELD_ROLES\b/);
    expect(ALL).toHaveLength(116);
    expect(new Set(ALL).size).toBe(116);
  });
});

describe("the served /explore", () => {
  it("names all 116 roles, each under its own field's link and label, in the list's order", () => {
    const html = readFileSync(join(bake(), "explore", "index.html"), "utf8");
    const section = /<section[^>]*data-field-roles=""[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
    expect(section, "the baked /explore carries the field-roles section").not.toBe("");
    const cards = [...section.matchAll(/<h3[^>]*><a href="\/jobs\/field\/([a-z_]+)">([^<]+)<\/a><\/h3><ul[^>]*>([\s\S]*?)<\/ul>/g)];
    const served: Record<string, string[]> = {};
    for (const [, slug, , ul] of cards) served[slug] = [...ul.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => decode(m[1]));
    expect(Object.keys(served).sort()).toEqual(Object.keys(FIELD_ROLES).sort());
    for (const [slug, names] of Object.entries(FIELD_ROLES)) {
      expect(served[slug], slug).toEqual([...names]);
      expect(BOARD_CATEGORY_SLUGS as readonly string[], `${slug} is a field the board routes`).toContain(slug);
    }
    const text = decode(html.replace(/<[^>]+>/g, " "));
    const missing = ALL.filter((n) => !text.includes(n));
    expect(missing).toEqual([]);
  });

  it("prints no count beside a role name", () => {
    const html = readFileSync(join(bake(), "explore", "index.html"), "utf8");
    const section = /<section[^>]*data-field-roles=""[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
    const lists = [...section.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ")).join(" ");
    expect(lists).not.toMatch(/\d/);
  });
});
