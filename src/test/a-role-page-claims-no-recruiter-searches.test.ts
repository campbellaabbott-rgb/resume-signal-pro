/**
 * A ROLE PAGE CLAIMS NO RECRUITER SEARCHES (SEO audit 2026-11-18, CONTENT-M2).
 *
 * Every /roles page headed its titles list "Adjacent titles recruiters search
 * alongside" the role, and told the reader that using one "helps recruiter
 * searches find you". The list is the field's own titles table, the same on
 * every sibling page, and nothing on this site measures what a recruiter
 * searches. The heading now names what the list is, from one string
 * (src/lib/role-page-copy.ts relatedHeading) that the bake and the React page
 * both print.
 *
 * Judged on the served files of an offline bake (every role page is written
 * there) and on the rendered page.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ROLE_PAGES } from "@/data/roles";
import { roleListCopy } from "@/lib/role-page-copy";
import { industryLabel } from "@/lib/seo/display-case";
import RoleKeywords from "@/pages/RoleKeywords";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
// What the old copy said, in the words a reader would take as a measurement.
const CLAIM = /recruiters?\s+search/i;

let OUT = "";
function bake(): string {
  if (OUT) return join(OUT, "dist");
  OUT = mkdtempSync(join(tmpdir(), "role-claims-"));
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

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const h2s = (html: string) => [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "").trim()));

describe("the baked role pages", () => {
  it("no role page says recruiters search anything, and each heads its titles list with the field's tables", () => {
    const dist = bake();
    const saying: string[] = [];
    let headed = 0;
    for (const r of Object.values(ROLE_PAGES)) {
      const html = readFileSync(join(dist, "roles", r.slug, "index.html"), "utf8");
      if (CLAIM.test(html)) saying.push(r.slug);
      const heads = h2s(html);
      const want = heads.find((h) => /^Other titles in the /.test(h));
      if (want) {
        headed++;
        expect(want, r.slug).toBe(roleListCopy(r.title, industryLabel(r.industry)).relatedHeading);
      }
    }
    expect(saying, "role pages whose served HTML claims a recruiter search").toEqual([]);
    expect(headed, "role pages that print the titles list under its new heading").toBeGreaterThan(150);
  }, 120_000);
});

describe("the rendered role page", () => {
  it("prints the same heading as the bake and no recruiter-search claim", () => {
    for (const slug of ["registered-nurse", "plumber", "software-engineer", "hr-director"]) {
      const role = ROLE_PAGES[slug];
      expect(role, slug).toBeDefined();
      const view = render(
        h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [`/roles/${slug}`] }, h(Routes, null, h(Route, { path: "/roles/:slug", element: h(RoleKeywords) })))),
      );
      const text = view.container.textContent ?? "";
      expect(text, slug).not.toMatch(CLAIM);
      const heads = [...view.container.querySelectorAll("main h2")].map((h) => (h.textContent ?? "").trim());
      expect(heads, slug).toContain(roleListCopy(role.title, industryLabel(role.industry)).relatedHeading);
      view.unmount();
    }
  });
});
