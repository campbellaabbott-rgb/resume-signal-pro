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
 *   - every other query parameter Index reads, and every one a hook Index
 *     mounts reads: "?ref=CODE", the affiliate links (use-affiliate-auth's
 *     link builder and /r/:code both send "/?ref=CODE"), which only Index's
 *     useAffiliateTracking records, so an affiliate click on the homepage
 *     would have stored no code and credited no one;
 *   - the scanner's own mail campaigns, which carry only utm_ tags: the
 *     scan report's and the market pulse's "Rescan free" links
 *     (utm_campaign=rescan) and every scan-report link to "/" (utm_medium=
 *     scan_report, such as "Get the full analysis", "/?…#pricing"), in mail
 *     already sent and still going out.
 * They land on /resume-checker with the query and the hash kept, before any
 * page chunk loads. A plain visit to "/" (or one carrying only other utm_
 * tags) is the homepage's.
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
import { SCANNER_QUERY_PARAMS, scannerAddressFor, scannerReturnPath } from "@/lib/scanner-address";
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
    ["/?ref=0a1b2c3d4e5f", "/resume-checker?ref=0a1b2c3d4e5f"],
    ["/?ref=0a1b2c3d4e5f&utm_source=x", "/resume-checker?ref=0a1b2c3d4e5f&utm_source=x"],
    ["/?utm_source=email&utm_medium=scan_report&utm_campaign=rescan", "/resume-checker?utm_source=email&utm_medium=scan_report&utm_campaign=rescan"],
    ["/?utm_source=email&utm_medium=market_pulse&utm_campaign=rescan", "/resume-checker?utm_source=email&utm_medium=market_pulse&utm_campaign=rescan"],
    ["/?utm_source=email&utm_medium=scan_report&utm_campaign=free_scan#pricing", "/resume-checker?utm_source=email&utm_medium=scan_report&utm_campaign=free_scan#pricing"],
  ];
  for (const [from, to] of cases) {
    it(`${from} -> ${to}`, () => {
      expect(landAt(from)).toBe(to);
    });
  }

  it("a directory's own ?ref= tag is not an affiliate code: it stays on the homepage", () => {
    expect(landAt("/?ref=producthunt")).toBe("home");
  });

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

/**
 * Parameters a hook Index mounts reads that are NOT the scanner's, each with
 * the address that carries it. Anything else Index or its hooks read must be
 * in SCANNER_QUERY_PARAMS.
 */
const NOT_THE_SCANNERS: Record<string, string> = {
  utm_source: "a campaign tag: a visit to \"/\" carrying only campaign tags is the homepage's, except the scanner's own mail campaigns (matched below)",
  utm_medium: "a campaign tag (as utm_source)",
  utm_campaign: "a campaign tag (as utm_source)",
  portal: "Stripe's billing portal returns to /account?portal=return",
  pro: "Pro's checkout returns to /account?pro=success",
};

/** Every name a file reads off an address with .get("name"). */
const reads = (code: string) => [...code.matchAll(/\b(?:params|searchParams|urlParams|q|URLSearchParams\([^)]*\))\.get\(\s*["']([a-z_]+)["']\s*\)/g)].map((m) => m[1]);
/** Index, every hook it imports from @/hooks, and the hooks those import (by either path). */
function indexAndItsHooks(): Record<string, string> {
  const files: Record<string, string> = { "src/pages/Index.tsx": strip(read("src/pages/Index.tsx")) };
  const hooksOf = (code: string) => [...code.matchAll(/from ["'](?:@\/hooks\/|\.\/)(use-[a-z0-9-]+)["']/g)].map((m) => m[1]);
  const load = (name: string) => {
    for (const ext of [".ts", ".tsx"]) {
      const p = `src/hooks/${name}${ext}`;
      try { return [p, strip(read(p))] as const; } catch { /* the other extension */ }
    }
    return null;
  };
  const queue = hooksOf(files["src/pages/Index.tsx"]);
  for (let i = 0; i < queue.length && i < 200; i++) {
    const hit = load(queue[i]);
    if (!hit || files[hit[0]]) continue;
    files[hit[0]] = hit[1];
    for (const h of hooksOf(hit[1])) if (!queue.includes(h)) queue.push(h);
  }
  return files;
}

describe("the redirect knows every query parameter the scanner reads", () => {
  it("each parameter Index reads from the address is in SCANNER_QUERY_PARAMS", () => {
    const read_ = reads(strip(read("src/pages/Index.tsx")));
    expect(read_.length, "Index's reads were found").toBeGreaterThanOrEqual(5);
    for (const k of new Set(read_)) expect(SCANNER_QUERY_PARAMS, `Index reads ?${k}=`).toContain(k);
  });

  it("each parameter a hook Index mounts reads is the scanner's, or named here with the address that carries it", () => {
    const files = indexAndItsHooks();
    expect(Object.keys(files), "the affiliate hook is among them").toContain("src/hooks/use-affiliate-auth.ts");
    const found: string[] = [];
    for (const [file, code] of Object.entries(files)) {
      for (const k of new Set(reads(code))) {
        found.push(k);
        if (!NOT_THE_SCANNERS[k]) expect(SCANNER_QUERY_PARAMS, `${file} reads ?${k}=`).toContain(k);
      }
    }
    expect(found, "the affiliate code").toContain("ref");
    expect(found, "the campaign tags").toContain("utm_source");
  });

  it("an affiliate's link, from the link builder and from /r/:code, reaches the scanner that records it", () => {
    expect(read("src/hooks/use-affiliate-auth.ts")).toMatch(/\?ref=\$\{/);
    expect(read("src/pages/AffiliateRedirect.tsx")).toMatch(/\/\?ref=/);
    expect(scannerAddressFor("?ref=0a1b2c3d4e5f", "")).toBe("/resume-checker?ref=0a1b2c3d4e5f");
  });

  it("every link to \"/\" left in the scan report's, the market pulse's and the digest's mail reaches the scanner", () => {
    const links: string[] = [];
    for (const fn of ["send-scan-report", "send-market-pulse", "send-search-digest"]) {
      const code = read(`supabase/functions/${fn}/index.ts`);
      // A link: an href, or a ...Url the template puts in one.
      for (const m of code.matchAll(/(?:href="|Url = `)(?:\$\{SITE_URL\}|https:\/\/resumebooster\.work)\/?(\?[^"`'\s#]*)?(#[a-z-]+)?[`"]/g)) {
        links.push(`${fn}: /${m[1] ?? ""}${m[2] ?? ""}`);
        const search = (m[1] ?? "").replace(/\$\{[^}]*\}/g, "x");
        expect(scannerAddressFor(search, m[2] ?? ""), `${fn}: /${m[1] ?? ""}${m[2] ?? ""} (a bare "/" is the homepage)`).not.toBeNull();
      }
    }
    expect(links.some((l) => l.includes("outcome=interview")), "the outcome links were found").toBe(true);
  });

  it("from now on the mail names the scanner's own address for every link that means it", () => {
    const report = read("supabase/functions/send-scan-report/index.ts");
    expect(report).toContain("${SITE_URL}/resume-checker?utm_source=email&utm_medium=scan_report&utm_campaign=rescan");
    expect(report).toContain("${SITE_URL}/resume-checker?utm_source=email&utm_medium=scan_report&utm_campaign=free_scan#pricing");
    expect(read("supabase/functions/send-market-pulse/index.ts")).toContain("${SITE_URL}/resume-checker?utm_source=email&utm_medium=market_pulse&utm_campaign=rescan");
    expect(read("supabase/functions/send-search-digest/index.ts")).toMatch(/href="\$\{SITE_URL\}\/resume-checker"[^>]*>scan your resume</);
  });

  it("the report emails' outcome links are among them", () => {
    const mail = read("supabase/functions/send-scan-report/index.ts");
    expect(mail).toMatch(/\/\?outcome=interview&rid=/);
    expect(SCANNER_QUERY_PARAMS).toEqual(expect.arrayContaining(["outcome", "rid"]));
  });
});

describe("links that mean the scanner name it, not \"/\"", () => {
  it("the free report's sign-in links bring the reader back to the scanner page they were on, never \"/\"", () => {
    const report = strip(read("src/components/FreeKeywordResults.tsx"));
    expect(report).not.toMatch(/next=\$\{encodeURIComponent\('\/'\)\}/);
    expect((report.match(/\/auth\?next=\$\{encodeURIComponent\(scannerReturnPath\(\)\)\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(scannerReturnPath("/es/revisar-curriculum")).toBe("/es/revisar-curriculum");
    expect(scannerReturnPath("/resume-checker")).toBe("/resume-checker");
    expect(scannerReturnPath("/")).toBe("/resume-checker");
  });

  it("Freelance Boost's \"Scan the result free\" opens the scanner", () => {
    const page = strip(read("src/pages/FreelanceBoost.tsx"));
    expect(page).not.toMatch(/to="\/\?utm_source=freelance_boost"/);
    expect(page).toMatch(/to="\/resume-checker\?utm_source=freelance_boost"/);
  });

  it("llms.txt points answer engines' free resume scan at the scanner", () => {
    const llms = read("public/llms.txt");
    expect(llms).toMatch(/^- \[Free resume scan\]\(https:\/\/resumebooster\.work\/resume-checker\)/m);
    expect(llms).not.toMatch(/\[Free resume scan\]\(https:\/\/resumebooster\.work\/\)/);
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
