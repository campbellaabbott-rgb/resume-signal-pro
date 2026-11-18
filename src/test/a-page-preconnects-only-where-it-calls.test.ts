// @vitest-environment node
/**
 * A PAGE PRECONNECTS ONLY WHERE IT CALLS (SEO audit 2026-11-18,
 * PERFORMANCE-M2).
 *
 * index.html preconnects to the Supabase host, and every baked page copies
 * that head. lab/supa-count.mjs counted 0 Supabase requests in the 10 s after
 * load on a guide, a translated CV page, a /roles page, a CV-standards page
 * and an industry page, so a phone visit to one of them paid a DNS, TCP and
 * TLS setup it never used. Those pages now lose the preconnect and keep the
 * dns-prefetch (a lookup costs next to nothing and still helps if the page
 * calls later); every page that calls the board keeps both, and a page not
 * measured keeps today's head.
 *
 * Judged on the files an offline bake writes.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dropsSupabasePreconnect, withoutSupabasePreconnect } from "../../scripts/prerender-preload.mjs";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SUPA = /<link rel="preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co"[^>]*>/;
const PREFETCH = /<link rel="dns-prefetch" href="https:\/\/[a-z0-9]+\.supabase\.co"[^>]*>/;

let OUT = "";
function bake(): string {
  if (OUT) return join(OUT, "dist");
  OUT = mkdtempSync(join(tmpdir(), "preconnect-"));
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

const page = (p: string) => readFileSync(join(bake(), ...p.split("/").filter(Boolean), "index.html"), "utf8");
/** The first page written under a directory of the bake, as a path. */
const firstUnder = (dir: string) => {
  const base = join(bake(), ...dir.split("/").filter(Boolean));
  const d = readdirSync(base, { withFileTypes: true }).find((e) => e.isDirectory() && existsSync(join(base, e.name, "index.html")));
  return d ? `${dir}/${d.name}` : null;
};

describe("the template", () => {
  it("preconnects to the Supabase host, so every page copied it", () => {
    const head = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(head).toMatch(SUPA);
    expect(head).toMatch(PREFETCH);
  });

  it("loses only the preconnect, never the dns-prefetch", () => {
    const head = readFileSync(join(ROOT, "index.html"), "utf8");
    const out = withoutSupabasePreconnect(head);
    expect(out).not.toMatch(SUPA);
    expect(out).toMatch(PREFETCH);
    expect(head.length - out.length).toBeLessThan(200);
  });
});

describe("the baked pages that never call Supabase", () => {
  it("a /roles, guide, industry, CV-standards and translated page carry no preconnect and keep the dns-prefetch", () => {
    const pages = [
      "/roles/hr-director",
      "/guides",
      firstUnder("/guides"),
      "/industries",
      firstUnder("/industries"),
      "/cv-standards",
      "/cv-standards/germany",
      firstUnder("/es/normas-cv"),
      firstUnder("/es/industrias"),
      firstUnder("/fr/normes-cv"),
    ].filter((p): p is string => !!p);
    expect(pages.length).toBeGreaterThanOrEqual(9);
    for (const p of pages) {
      expect(dropsSupabasePreconnect(p), p).toBe(true);
      const html = page(p);
      expect(html, p).not.toMatch(SUPA);
      expect(html, p).toMatch(PREFETCH);
    }
  });
});

describe("the baked pages that call the board", () => {
  it("/jobs, a field, /pricing, the homepage, the Spanish scanner and a data page keep it", () => {
    for (const p of ["/jobs", "/jobs/field/engineering", "/pricing", "/", "/es/revisar-curriculum", "/ghost-job-index", "/agents"]) {
      expect(dropsSupabasePreconnect(p), p).toBe(false);
      const html = p === "/" ? readFileSync(join(bake(), "index.html"), "utf8") : page(p);
      expect(html, p).toMatch(SUPA);
    }
  });
});
