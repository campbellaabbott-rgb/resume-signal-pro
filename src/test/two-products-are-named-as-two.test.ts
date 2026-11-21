/**
 * TWO PRODUCTS ARE NAMED AS TWO (SEO audit 2026-11-18, CONTENT-6).
 *
 * /vs/chatgpt compares us with "ChatGPT & Claude", two products with two
 * owners, and said "ChatGPT & Claude is genuinely stronger" in its snippet,
 * "is stronger" twice in its body and "ChatGPT & Claude is a trademark of its
 * owner". The competitor now carries a plural flag and the bake and the React
 * page take their verbs from competitorWords.
 *
 * And /changelog's description ran to 183 characters with the newest entry's
 * title, so composeHtml's 160-character clamp cut it mid-clause and logged
 * it. The bake now clips the title first, where a word ends, and drops the
 * "Latest" clause when fewer than 30 characters of it would be left.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { COMPETITORS } from "@/data/competitors";
import VsCompetitor from "@/pages/VsCompetitor";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { changelogDescription, CHANGELOG_DESC_LEAD } from "../../scripts/prerender-seo.mjs";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
let OUT = "";
let LOG = "";
function bake(): string {
  if (OUT) return join(OUT, "dist");
  OUT = mkdtempSync(join(tmpdir(), "two-products-"));
  mkdirSync(join(OUT, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(OUT, "dist", "index.html"));
  const r = spawnSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PRERENDER_OUT: OUT, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(r.status, r.stderr).toBe(0);
  LOG = `${r.stdout}\n${r.stderr}`;
  return join(OUT, "dist");
}
afterAll(() => {
  if (OUT && OUT.startsWith(tmpdir())) rmSync(OUT, { recursive: true, force: true });
});

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const page = (p: string) => decode(readFileSync(join(bake(), ...p.split("/").filter(Boolean), "index.html"), "utf8"));
const descOf = (html: string) => (/<meta name="description" content="([^"]*)"/.exec(html) || [])[1] ?? "";
const SINGULAR_WRONG = /ChatGPT & Claude (?:is|uses|'s public product changes)\b|Where is ChatGPT & Claude\b|ChatGPT & Claude is a trademark of its owner/;

describe("/vs/chatgpt, as baked", () => {
  it("says 'are' wherever it says what the two products do, and names two owners", () => {
    expect(COMPETITORS.chatgpt.plural).toBe(true);
    const html = page("/vs/chatgpt");
    expect(html).not.toMatch(SINGULAR_WRONG);
    expect(descOf(html)).toMatch(/where ChatGPT & Claude are genuinely stronger\.$/);
    expect(html).toContain("ChatGPT & Claude are trademarks of their owners; we're not affiliated.");
    expect(html).toContain("including the rows where ChatGPT & Claude are stronger");
    expect(html).toContain("Where are ChatGPT & Claude better than Resume Booster?");
  }, 120_000);

  it("a single product keeps 'is'", () => {
    const html = page("/vs/jobscan");
    expect(html).toContain(`${COMPETITORS.jobscan.name} is a trademark of its owner; we're not affiliated.`);
    expect(descOf(html)).toMatch(new RegExp(`where ${COMPETITORS.jobscan.name} is genuinely stronger\\.$`));
  }, 120_000);
});

describe("/vs/chatgpt, as rendered", () => {
  it("prints the same verbs as the bake", async () => {
    const mount = (slug: string) =>
      render(h(HelmetProvider, null, h(MemoryRouter, { initialEntries: [`/vs/${slug}`] }, h(Routes, null, h(Route, { path: "/vs/:slug", element: h(VsCompetitor) })))));
    const view = mount("chatgpt");
    await new Promise((r) => setTimeout(r, 0));
    const text = (view.container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).not.toMatch(SINGULAR_WRONG);
    expect(text).toContain("ChatGPT & Claude are trademarks of their owners; we're not affiliated.");
    expect(text).toContain("Where are ChatGPT & Claude better than Resume Booster?");
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toMatch(/where ChatGPT & Claude are genuinely stronger\.$/);
    view.unmount();
  });
});

describe("/changelog's description", () => {
  it("is built to fit: the bake's clamp never cuts it, and it ends at a word of the newest title", () => {
    const html = page("/changelog");
    expect(LOG).not.toMatch(/^\s*\/changelog \(\d+ chars\)/m);
    const d = descOf(html);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.startsWith(CHANGELOG_DESC_LEAD)).toBe(true);
    const m = /Latest \((\d{4}-\d{2}-\d{2})\): (.*)$/.exec(d);
    if (m) {
      // The newest entry's title, as the page's own list prints it first.
      const bodyTitles = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((x) => x[1].trim());
      const newest = bodyTitles.find((t) => t.length > 0) ?? "";
      const said = m[2];
      if (said.endsWith("…")) {
        const prefix = said.slice(0, -1);
        expect(prefix.length).toBeGreaterThanOrEqual(30);
        expect(newest.startsWith(prefix), `${prefix} | ${newest}`).toBe(true);
        expect(newest.charAt(prefix.length), "the clip ends where a word ends").toMatch(/\s/);
      } else {
        expect(said.replace(/\.$/, "")).toBe(newest.replace(/[.!?…]+$/, ""));
      }
    }
  }, 120_000);

  it("clips a long title where a word ends, and drops the Latest clause when under 30 characters of it would be left", () => {
    const long = "The free scan no longer scores a résumé in one of eight other languages as if it were English";
    const d = changelogDescription({ date: "2026-11-17", title: long });
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).toBe(`${CHANGELOG_DESC_LEAD} Latest (2026-11-17): The free scan no longer scores a résumé in one of eight other…`);
    expect(changelogDescription({ date: "2026-11-17", title: "A short entry" })).toBe(`${CHANGELOG_DESC_LEAD} Latest (2026-11-17): A short entry.`);
    // a title with no word end inside the room leaves too little: no clause
    expect(changelogDescription({ date: "2026-11-17", title: `${"x".repeat(120)} tail` })).toBe(CHANGELOG_DESC_LEAD);
    // every clip of every length ends at a word end of its title
    const words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen".split(" ");
    for (let n = 1; n <= words.length; n++) {
      const title = words.slice(0, n).join(" ");
      const out = changelogDescription({ date: "2026-11-17", title });
      expect(out.length, title).toBeLessThanOrEqual(160);
      const said = out.startsWith(`${CHANGELOG_DESC_LEAD} Latest`) ? out.slice(`${CHANGELOG_DESC_LEAD} Latest (2026-11-17): `.length) : null;
      if (said === null) continue;
      if (said.endsWith("…")) expect(title.charAt(said.length - 1), title).toMatch(/\s/);
      else expect(said).toBe(`${title}.`);
    }
  });
});
