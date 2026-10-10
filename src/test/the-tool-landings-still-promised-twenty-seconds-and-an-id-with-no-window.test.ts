/**
 * THE TOOL LANDINGS STILL PROMISED TWENTY SECONDS, AND A REPORT ID WITH NO
 * WINDOW.
 *
 * /resume-checker, /resume-score and /es/revisar-curriculum render the
 * homepage scanner with their own SEO copy, which feeds the page's meta
 * description, the prerendered page and the llms listing. After the homepage
 * moved to one bound (SCAN_RESULTS_WITHIN_SECONDS) and to "a rescan within 7
 * days returns the same report", these still said "in about 20 seconds"
 * beside a prerendered CTA saying "within 90 seconds", and promised a
 * "reproducible report ID" with no window, though a rescan after the cache
 * expires can score, and so be named, differently.
 */
import { describe, expect, it } from "vitest";
import { TOOL_LANDINGS } from "@/data/tool-landings";
import { SCAN_RESULTS_WITHIN_SECONDS } from "@/config/scan-timing";
import { REPORT_CACHE_DAYS } from "@/lib/resume-retention";

const texts = (cfg: (typeof TOOL_LANDINGS)[string]) => [cfg.title, cfg.description, cfg.heading, cfg.intro, ...cfg.bullets, ...cfg.faqs.flatMap((f) => [f.q, f.a])];

describe("every tool landing", () => {
  for (const cfg of Object.values(TOOL_LANDINGS)) {
    it(`${cfg.path} states only the scan's own bound as its time to results`, () => {
      const stated = texts(cfg).flatMap((t) => [...t.matchAll(/(\d+)\s*(?:seconds?|secs?\b|segundos?)/gi)].map((m) => Number(m[1])));
      for (const n of stated) expect(n).toBe(SCAN_RESULTS_WITHIN_SECONDS);
    });

    it(`${cfg.path} names the cache window wherever it promises the same report ID`, () => {
      for (const t of texts(cfg)) {
        if (!/report ID|reproducible|identificador/i.test(t)) continue;
        expect(t, t).toMatch(new RegExp(`${REPORT_CACHE_DAYS} (?:days|días)`));
      }
    });
  }
});
