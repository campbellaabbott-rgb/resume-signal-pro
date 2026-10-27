/**
 * A SCANNER ADDRESS IS ONLY THE SCANNER'S, AND IT NEVER SHOWS OR CARRIES THE
 * HOMEPAGE (review round of 2026-10-26).
 *
 *   - "/?ref=<anything>" went to the scanner, because "ref" counted whenever
 *     it was present. Affiliate codes are 12 hex characters
 *     (affiliates.referral_code DEFAULT encode(gen_random_bytes(6),'hex')),
 *     while directories tag their own links ?ref=producthunt, ?ref=github:
 *     those referred visitors, the scarce segment, landed on the scanner
 *     instead of the homepage. Only a code's shape counts now.
 *   - The baked "/" file's inline scripts tested only the path, so a scanner
 *     address preloaded the homepage's chunks, kept the baked board on screen
 *     under /resume-checker until the scanner's chunk committed, and kept the
 *     homepage's SoftwareApplication block in the head of the rendered
 *     scanner. The fallback's scripts read the same rule as the route
 *     (written from SCANNER_QUERY_PARAMS, so the two cannot drift): on a
 *     scanner address they clear the baked page and its home-only blocks and
 *     preload the scanner's chunks instead; the redirect also takes the
 *     home-only blocks off before it moves.
 *   - /resume-checker and the other scanner landings now preload the
 *     scanner's own route chunk (Index), which the old "/" did.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AFFILIATE_CODE, scannerAddressFor, scannerAddressScript } from "@/lib/scanner-address";
import { ScannerAddressRedirect } from "@/components/ScannerAddressRedirect";
import { fallbackPreloadHtml, routeChunkPrefix } from "../../scripts/prerender-preload.mjs";

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("script[data-home-only]").forEach((s) => s.remove());
});

const CODE = "0a1b2c3d4e5f";

describe("which ?ref= is an affiliate's", () => {
  it("a 12-hex code reaches the scanner; a directory's own tag stays on the homepage", () => {
    expect(AFFILIATE_CODE.test(CODE)).toBe(true);
    expect(scannerAddressFor(`?ref=${CODE}`, "")).toBe(`/resume-checker?ref=${CODE}`);
    expect(scannerAddressFor(`?ref=${CODE.toUpperCase()}&utm_source=x`, "")).toBe(`/resume-checker?ref=${CODE.toUpperCase()}&utm_source=x`);
    for (const tag of ["producthunt", "github", "taaft", "AFF123", ""]) {
      expect(scannerAddressFor(`?ref=${tag}`, ""), tag).toBeNull();
    }
    expect(scannerAddressFor("?utm_source=x&ref=taaft", "")).toBeNull();
    // Every other scanner address is unchanged.
    expect(scannerAddressFor("?ref=producthunt", "#upload")).toBe("/resume-checker?ref=producthunt#upload");
    expect(scannerAddressFor("?outcome=interview&rid=r-1", "")).toBe("/resume-checker?outcome=interview&rid=r-1");
  });

  it("the route keeps a directory's ?ref= visitor on the homepage", () => {
    const Where = () => { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; };
    render(
      <MemoryRouter initialEntries={["/?ref=producthunt"]}>
        <Routes>
          <Route path="/" element={<ScannerAddressRedirect><p data-testid="home">home</p></ScannerAddressRedirect>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("home")).not.toBeNull();
  });
});

describe("the redirect leaves no homepage structured data behind", () => {
  it("takes the home-only blocks off before it moves to the scanner", () => {
    const ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.setAttribute("data-home-only", "1");
    document.head.appendChild(ld);
    const Where = () => { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; };
    render(
      <MemoryRouter initialEntries={[`/?ref=${CODE}`]}>
        <Routes>
          <Route path="/" element={<ScannerAddressRedirect><p>home</p></ScannerAddressRedirect>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where").textContent).toBe(`/resume-checker?ref=${CODE}`);
    expect(document.head.querySelector("script[data-home-only]")).toBeNull();
  });
});

/** The inline predicate, run against an address as the browser would. */
const runPredicate = (search: string, hash: string): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  (new Function("location", "URLSearchParams", `return (${scannerAddressScript()});`) as (l: unknown, u: typeof URLSearchParams) => boolean)(
    { pathname: "/", search, hash },
    URLSearchParams,
  );

describe("the fallback's inline rule is the route's rule", () => {
  const ADDRESSES: Array<[string, string]> = [
    ["", ""], ["", "#upload"], ["?x=1", "#upload"], ["", "#faq"],
    [`?ref=${CODE}`, ""], ["?ref=producthunt", ""], ["?ref=", ""],
    ["?outcome=interview&rid=r-1", ""], ["?coupon=SPRING", ""], ["?canceled=1", ""], ["?session_id=cs_1", ""],
    ["?scan_pack_success=1", ""], ["?scan_pack_canceled=1", ""], ["?rid=r-2", ""],
    ["?utm_source=email&utm_medium=scan_report&utm_campaign=free_scan", ""],
    ["?utm_source=email&utm_medium=market_pulse&utm_campaign=rescan", ""],
    ["?utm_source=newsletter&utm_medium=email", ""],
  ];
  for (const [search, hash] of ADDRESSES) {
    it(`"/${search}${hash}"`, () => {
      expect(runPredicate(search, hash)).toBe(scannerAddressFor(search, hash) !== null);
    });
  }
});

describe("the fallback's preload script", () => {
  const HOME = ["HomePage-a.js", "HomeSearchHero-b.js"];
  const INDEX = ["Index-c.js", "ResumeUploader-d.js"];
  const preloadsFor = (pathname: string, search: string, hash: string): string[] => {
    const html = fallbackPreloadHtml(HOME, { always: ["Footer-z.js"], scanner: { files: INDEX, predicate: scannerAddressScript() } });
    const code = /<script data-home-preload="1">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const added: string[] = [];
    const doc = { createElement: () => ({}) as { rel?: string; href?: string }, head: { appendChild: (l: { href: string }) => { added.push(l.href); } } };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("location", "document", "URLSearchParams", code)({ pathname, search, hash }, doc, URLSearchParams);
    return added;
  };

  it("a bare \"/\" preloads the homepage's chunks", () => {
    expect(preloadsFor("/", "", "")).toEqual(HOME.map((f) => `/assets/${f}`));
  });
  it("a scanner address of \"/\" preloads the scanner's instead", () => {
    expect(preloadsFor("/", "", "#upload")).toEqual(INDEX.map((f) => `/assets/${f}`));
    expect(preloadsFor("/", `?ref=${CODE}`, "")).toEqual(INDEX.map((f) => `/assets/${f}`));
  });
  it("any other address the fallback serves preloads neither", () => {
    expect(preloadsFor("/auth", "", "")).toEqual([]);
  });
});

describe("the scanner's landings preload the scanner's chunk", () => {
  it("routeChunkPrefix names Index for every landing Index renders", () => {
    for (const p of ["/resume-checker", "/ats-resume-test", "/resume-score", "/es/revisar-curriculum"]) expect(routeChunkPrefix(p), p).toBe("Index");
    expect(routeChunkPrefix("/")).toBe("HomePage");
  });
});
