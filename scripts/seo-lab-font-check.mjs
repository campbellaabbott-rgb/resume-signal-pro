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
// Usage: node scripts/seo-lab-font-check.mjs <base-url> [path ...]
//   PLAYWRIGHT_DIR  where the playwright package lives (default: worker/node_modules/playwright)
// Exit 0 when every repeat load paints Inter, 1 otherwise. Read-only: GETs.
import { createRequire } from "node:module";
import { resolve } from "node:path";

const [base, ...paths] = process.argv.slice(2);
if (!base) { console.error("usage: node scripts/seo-lab-font-check.mjs <base-url> [path ...]"); process.exit(2); }
const pages = paths.length ? paths : ["/", "/jobs", "/jobs/company/dominos", "/pricing"];
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_DIR || resolve(process.cwd(), "worker/node_modules/playwright"));

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

const browser = await chromium.launch();
let bad = 0;
try {
  for (const p of pages) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const url = new URL(p, base).toString();
    const read = async () => {
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      await page.waitForTimeout(1500);
      return paintedFaces(page, "h1");
    };
    const first = await read();
    const repeat = await read();
    const ok = Array.isArray(repeat) && repeat.some((f) => /^Inter\b/.test(f) && f.endsWith("(web)"));
    if (!ok) bad++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${p}: first load h1 ${first ? first.join(", ") : "no h1"}; repeat load h1 ${repeat ? repeat.join(", ") : "no h1"}`);
    await context.close();
  }
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
