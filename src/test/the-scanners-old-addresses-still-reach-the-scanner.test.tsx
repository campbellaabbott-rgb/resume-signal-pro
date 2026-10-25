/**
 * THE SCANNER'S OLD ADDRESSES STILL REACH THE SCANNER (homepage switch-over,
 * docs/homepage-pricing/README.md: owner decision 5, the scanner lives at
 * /resume-checker; steps 1 and 11).
 *
 * "/" was the scanner. When the switch-over routes "/" to the board-first
 * homepage, every address that meant the scanner must still open it:
 *   - "/#upload", with or without a query (the board's "Check my fit", the
 *     header's Start, the account checklist, the builder's "/?rescan=1#upload",
 *     the rate-limit sign-in's next=/#upload);
 *   - "/?outcome=…&rid=…", the outcome links in every scan report email sent
 *     so far, which only Index records (the README's redirect covered the
 *     hash alone, so these would have landed on the homepage and recorded
 *     nothing);
 *   - every other query parameter Index reads.
 * They land on /resume-checker with the query and the hash kept, before any
 * page chunk loads. A plain visit to "/" (or one carrying only utm_ tags) is
 * the homepage's.
 *
 * And the scanner's own address stays crawlable: the route, the bake's tool
 * landing pages and the sitemap keep /resume-checker.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ScannerAddressRedirect } from "@/components/ScannerAddressRedirect";
import { SCANNER_QUERY_PARAMS, scannerAddressFor } from "@/lib/scanner-address";
import { TOOL_LANDINGS } from "@/data/tool-landings";

afterEach(cleanup);

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

function Where() {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}${l.hash}`}</p>;
}

/** The "/" route as App.tsx mounts it, with the page swapped for a marker. */
function landAt(entry: string): string {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<ScannerAddressRedirect><p data-testid="home">home</p></ScannerAddressRedirect>} />
        <Route path="/resume-checker" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.queryByTestId("home") ? "home" : screen.getByTestId("where").textContent ?? "";
}

describe("every address that meant the scanner lands on /resume-checker, query and hash kept", () => {
  const cases: Array<[string, string]> = [
    ["/#upload", "/resume-checker#upload"],
    ["/?x=1#upload", "/resume-checker?x=1#upload"],
    ["/?rescan=1#upload", "/resume-checker?rescan=1#upload"],
    ["/?outcome=interview&rid=r-123", "/resume-checker?outcome=interview&rid=r-123"],
    ["/?outcome=no_response&rid=r-9&utm_source=email", "/resume-checker?outcome=no_response&rid=r-9&utm_source=email"],
    ["/?coupon=SPRING", "/resume-checker?coupon=SPRING"],
  ];
  for (const [from, to] of cases) {
    it(`${from} -> ${to}`, () => {
      expect(landAt(from)).toBe(to);
    });
  }

  it("a plain visit, and one with only campaign tags, stays on the homepage", () => {
    expect(landAt("/")).toBe("home");
    cleanup();
    expect(landAt("/?utm_source=newsletter&utm_medium=email")).toBe("home");
    cleanup();
    expect(landAt("/#faq")).toBe("home");
  });

  it("the rule is one pure function the route and the tests share", () => {
    expect(scannerAddressFor("", "#upload")).toBe("/resume-checker#upload");
    expect(scannerAddressFor("?rid=a&outcome=rejected", "")).toBe("/resume-checker?rid=a&outcome=rejected");
    expect(scannerAddressFor("?utm_campaign=x", "")).toBeNull();
    expect(scannerAddressFor("", "")).toBeNull();
  });
});

describe("the redirect knows every query parameter the scanner reads", () => {
  it("each parameter Index reads from the address is in SCANNER_QUERY_PARAMS", () => {
    const code = strip(read("src/pages/Index.tsx"));
    const read_ = [...code.matchAll(/\b(?:params|searchParams)\.get\(\s*["']([a-z_]+)["']\s*\)/g)].map((m) => m[1]);
    expect(read_.length, "Index's reads were found").toBeGreaterThanOrEqual(5);
    for (const k of new Set(read_)) expect(SCANNER_QUERY_PARAMS, `Index reads ?${k}=`).toContain(k);
  });

  it("the report emails' outcome links are among them", () => {
    const mail = read("supabase/functions/send-scan-report/index.ts");
    expect(mail).toMatch(/\/\?outcome=interview&rid=/);
    expect(SCANNER_QUERY_PARAMS).toEqual(expect.arrayContaining(["outcome", "rid"]));
  });
});

describe("the routes", () => {
  const app = strip(read("src/App.tsx"));

  it('"/" hands the scanner\'s addresses on before its page loads', () => {
    const root = app.split("\n").find((l) => l.includes('<Route path="/" ')) ?? "";
    expect(root, 'the "/" route').toMatch(/element=\{<ScannerAddressRedirect>.*<\/ScannerAddressRedirect>\} \/>/);
    // Imported eagerly: a lazy wrapper would load a chunk before it moved.
    expect(app).toMatch(/^import \{ ScannerAddressRedirect \} from "@\/components\/ScannerAddressRedirect";$/m);
  });

  it("/resume-checker is the scanner: Index with its own landing", () => {
    expect(app).toMatch(/<Route path="\/resume-checker" element=\{<Index landing=\{TOOL_LANDINGS\["resume-checker"\]\} \/>\} \/>/);
    expect(TOOL_LANDINGS["resume-checker"].path).toBe("/resume-checker");
  });
});

describe("the scanner's address stays crawlable", () => {
  it("the bake writes a page for every tool landing, and its sitemap names every page it wrote", () => {
    const bake = read("scripts/prerender-seo.mjs");
    expect(bake).toMatch(/export \{ TOOL_LANDINGS \} from "\.\.\/src\/data\/tool-landings";/);
    expect(bake).toMatch(/for \(const cfg of Object\.values\(D\.TOOL_LANDINGS\)\) \{\s*write\(\{\s*path: cfg\.path,/);
    expect(bake).toMatch(/for \(const wp of writtenPaths\) \{/);
  });

  it("the committed sitemap lists /resume-checker", () => {
    expect(read("public/sitemap.xml")).toContain("<loc>https://resumebooster.work/resume-checker</loc>");
  });
});
