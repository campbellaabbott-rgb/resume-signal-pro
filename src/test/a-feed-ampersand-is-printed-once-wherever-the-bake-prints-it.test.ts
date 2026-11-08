// @vitest-environment node
/**
 * A FEED'S AMPERSAND IS PRINTED ONCE, WHEREVER THE BAKE PRINTS IT (B07;
 * SEO/GEO audit 2026-11-07, F08 and the entity half of G4J-02).
 *
 * Teamtailor and Personio send titles already escaped ("Werkstudent KI &amp;
 * Automatisierung (m/w/d)"), and the bake escaped them again: four live
 * posting pages printed "&amp;amp;" in their title, h1 and description, /jobs
 * printed it four times and /jobs/field/finance once, and the JobPosting
 * carried a literal "&amp;". Every printed title now goes through postingText,
 * which decodes the feed's entities once, before the bake's escaper and before
 * the JSON-LD write. The dist guard reads a built tree when there is one.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { postingJsonLdShape, postingPageDescription, postingPageTitle, postingText, type PostingRow } from "@/components/jobs/posting-page";
import { landerOpenings } from "../../scripts/prerender-pages.mjs";

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DESC = "Du unterstützt unser Team bei KI &amp; Automatisierung und arbeitest eng mit den Fachbereichen zusammen. ".repeat(6);
/** DEAG's live row of 2026-11-08 (personio:deag:2859520), as the board stores it. */
const deag = {
  id: "personio:deag:2859520",
  token: "deag",
  source: "personio",
  title: "Werkstudent KI &amp; Automatisierung (m/w/d)",
  company: "DEAG",
  location: "Berlin",
  country: "DE",
  postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  missingSince: null,
  applyUrl: "https://deag.jobs.personio.de/job/2859520",
  salary: null,
  agency: false,
  workMode: null,
} as unknown as PostingRow;

/** Every string value anywhere inside a parsed JSON-LD block. */
const strings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : [];

describe("a title the feed sent escaped", () => {
  it("is decoded once by postingText, and only once", () => {
    expect(postingText(deag.title)).toBe("Werkstudent KI & Automatisierung (m/w/d)");
    // Twice-escaped stays once-escaped: a second decode would rewrite what the employer wrote.
    expect(postingText("R&amp;amp;D")).toBe("R&amp;D");
  });

  it("reaches the page title, the description and the served attribute with one ampersand", () => {
    const title = postingPageTitle(deag);
    expect(title).toContain("KI & Automatisierung");
    expect(esc(title)).toContain("KI &amp; Automatisierung");
    expect(esc(title)).not.toContain("&amp;amp;");
    expect(esc(postingPageDescription(deag))).not.toContain("&amp;amp;");
  });

  it("reaches the JobPosting with no entity in any string value", () => {
    const ld = postingJsonLdShape(deag, DESC, { site: "https://resumebooster.work" });
    expect(ld).toBeTruthy();
    expect(ld!.title).toBe("Werkstudent KI & Automatisierung (m/w/d)");
    expect(strings(ld).filter((s) => /&amp;|&#\d/.test(s))).toEqual([]);
  });

  it("is printed once on a company page's list of openings, read from the board's list", () => {
    const cached = { at: "2026-11-08", rows: [{ id: deag.id, title: deag.title as string, place: "Berlin &amp; Hamburg" }] };
    const { openings } = landerOpenings({ cached, today: "2026-11-08", text: postingText });
    expect(openings[0]).toMatchObject({ title: "Werkstudent KI & Automatisierung (m/w/d)", place: "Berlin & Hamburg" });
    // The control: without the decode the escaped title would be printed and escaped again.
    expect(landerOpenings({ cached, today: "2026-11-08" }).openings[0].title).toBe(deag.title);
  });
});

const ROOT = resolve(__dirname, "../..");
const DIST = resolve(ROOT, "dist");
const built = existsSync(join(DIST, "index.html"));

function htmlFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) htmlFiles(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

describe.skipIf(!built)("the built tree (dist guard)", () => {
  const files = built ? htmlFiles(DIST) : [];

  it("prints '&amp;amp;' nowhere in any HTML file", () => {
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("&amp;amp;"));
    expect(hits.map((f) => f.slice(DIST.length))).toEqual([]);
  });

  it("carries no '&amp;' and no '&#' inside any JSON-LD string value", () => {
    const hits: string[] = [];
    for (const f of files) {
      const html = readFileSync(f, "utf8");
      for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        let parsed: unknown;
        try { parsed = JSON.parse(m[1]); } catch { hits.push(`${f.slice(DIST.length)}: unparseable JSON-LD`); continue; }
        for (const s of strings(parsed)) if (/&amp;|&#/.test(s)) hits.push(`${f.slice(DIST.length)}: ${s.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
