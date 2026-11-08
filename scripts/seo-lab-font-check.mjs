#!/usr/bin/env node
// THE LAB CHECK THAT THE WEB FONT IS ACTUALLY USED (SEO-020, the round's
// review of 2026-10-24). The round's first font head (Google's CSS applied by
// a media swap, font-display optional) rendered Inter on no load at all: an
// optional face declared after the first layout is never used, and the lab
// read "Arial" (the Inter Fallback face) from every h1 while the woff2 still
// downloaded. This loads each page twice in one browser context, the HTTP
// cache on, and reads the face the browser actually painted the h1 with
// (CSS.getPlatformFontsForNode, Chrome DevTools Protocol). The repeat load
// must paint Inter; the first may paint the fallback on a slow line, which is
// what font-display optional means, and is reported, not failed.
//
// THE REPEAT LOAD MUST ALSO TAKE EVERY FONT FROM THE CACHE (B12, SEO/GEO
// audit 2026-11-07, PERF-02). The /fonts/ copies were served with no
// Cache-Control and never a 304, so every full page load downloaded them
// again (47-152 KB a view) and, on the phone profile, Inter painted on no
// load at all, first or repeat; this check passed anyway, because it ran
// unthrottled. Each woff2 response of the repeat load is now read from the
// DevTools network log: one that came from the network fails the page.
// --phone runs both loads on the profile the audit measured with (412x823,
// 4x CPU, 150 ms, 1.6 Mbps down, 750 Kbps up).
//
// Usage: node scripts/seo-lab-font-check.mjs [--phone] <base-url> [path ...]
//   PLAYWRIGHT_DIR  where the playwright package lives (default: worker/node_modules/playwright)
// Exit 0 when every repeat load paints Inter from cached fonts, 1 otherwise.
// Read-only: GETs.
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The profile --phone loads with: the SEO/GEO audit's lab (devtools throttling at Lighthouse's values). */
export const PHONE = { viewport: { width: 412, height: 823 }, cpuRate: 4, latencyMs: 150, downKbps: 1600, upKbps: 750 };

/**
 * The verdict on one page from what the two loads read. `repeatFonts` is
 * every woff2 response of the repeat load as { url, fromCache }.
 */
export function repeatLoadVerdict({ path, first, repeat, repeatFonts = [] }) {
  const painted = Array.isArray(repeat) && repeat.some((f) => /^Inter\b/.test(f) && f.endsWith("(web)"));
  const network = repeatFonts.filter((r) => !r.fromCache).map((r) => r.url);
  const ok = painted && network.length === 0;
  const fonts = repeatFonts.length ? `; repeat load fonts: ${repeatFonts.length - network.length} from cache, ${network.length} from the network${network.length ? ` (${network.slice(0, 3).join(", ")})` : ""}` : "";
  return { ok, line: `${ok ? "PASS" : "FAIL"}  ${path}: first load h1 ${first ? first.join(", ") : "no h1"}; repeat load h1 ${repeat ? repeat.join(", ") : "no h1"}${fonts}` };
}

/** The faces the browser painted a node's text with, by name. */
async function paintedFaces(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) return null;
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  await cdp.detach();
  return fonts.map((f) => `${f.familyName}${f.isCustomFont ? "(web)" : ""}`);
}

async function main(argv) {
  const phone = argv.includes("--phone");
  const [base, ...paths] = argv.filter((a) => a !== "--phone");
  if (!base) { console.error("usage: node scripts/seo-lab-font-check.mjs [--phone] <base-url> [path ...]"); return 2; }
  const pages = paths.length ? paths : ["/", "/jobs", "/jobs/company/dominos", "/pricing"];
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PLAYWRIGHT_DIR || resolve(process.cwd(), "worker/node_modules/playwright"));
  const browser = await chromium.launch();
  let bad = 0;
  try {
    for (const p of pages) {
      const context = await browser.newContext({ viewport: phone ? PHONE.viewport : { width: 1280, height: 900 } });
      const page = await context.newPage();
      // One DevTools session for the page's life: throttling and the network log.
      const net = await context.newCDPSession(page);
      await net.send("Network.enable");
      if (phone) {
        await net.send("Emulation.setCPUThrottlingRate", { rate: PHONE.cpuRate });
        await net.send("Network.emulateNetworkConditions", { offline: false, latency: PHONE.latencyMs, downloadThroughput: (PHONE.downKbps * 1024) / 8, uploadThroughput: (PHONE.upKbps * 1024) / 8 });
      }
      let fonts = [];
      const fromMemory = new Set();
      net.on("Network.requestServedFromCache", (e) => fromMemory.add(e.requestId));
      net.on("Network.responseReceived", (e) => {
        if (!/\.woff2(?:$|\?)/.test(e.response.url)) return;
        fonts.push({ url: new URL(e.response.url).pathname, fromCache: Boolean(e.response.fromDiskCache || e.response.fromPrefetchCache || fromMemory.has(e.requestId)) });
      });
      const url = new URL(p, base).toString();
      const read = async () => {
        fonts = [];
        await page.goto(url, { waitUntil: "load", timeout: 120_000 });
        await page.waitForTimeout(1500);
        return paintedFaces(page, "h1");
      };
      const first = await read();
      const repeat = await read();
      const v = repeatLoadVerdict({ path: p, first, repeat, repeatFonts: fonts });
      if (!v.ok) bad++;
      console.log(v.line);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return bad ? 1 : 0;
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) process.exit(await main(process.argv.slice(2)));
