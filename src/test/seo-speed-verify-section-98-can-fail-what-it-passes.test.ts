// @vitest-environment node
/**
 * VERIFY SECTION 98 CAN FAIL ON EVERYTHING IT PASSES.
 *
 * scripts/verify-deploy.d/98-seo-speed.sh judges the deployed site for the
 * speed half of the SEO round of 2026-10-18: the app stylesheet and the font
 * link (SEO-020), the entry's mount code (SEO-021), the entry budget and its
 * strings (SEO-040), the share image, the touch icon and the tab icon, read
 * as bytes and content types (the image follow-ups), and the descriptions
 * (OBS-3), and since the SEO/GEO audit of 2026-11-07 the fonts' hashed,
 * cached files (B12) and the route-chunk hints' priority (PERF-01). This file
 * runs the section, in bash, against a local site built from this checkout's
 * own files (the positive control) and against the site as it shipped before
 * the round (the negative one): every line that passes on the first must fail
 * on the second. A third site is the one served on 2026-11-07, before B12 and
 * PERF-01: the lines those two add fail there, and every older line passes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { fallbackPreloadHtml, modulepreloadTag } from "../../scripts/prerender-preload.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = resolve(ROOT, "scripts/verify-deploy.d/98-seo-speed.sh");
const EN = JSON.parse(readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8")) as Record<string, unknown>;
const INDEX = readFileSync(resolve(ROOT, "index.html"), "utf8");
const pub = (f: string) => readFileSync(resolve(ROOT, "public", f));

type Site = Record<string, { type: string; body: Buffer | string; status?: number; headers?: Record<string, string> }>;

/** The face files index.html names, by name. */
const FACES = [...INDEX.matchAll(/url\(\/src\/assets\/fonts\/([a-z0-9-]+)\.woff2\)/g)].map((m) => m[1]);
const IMMUTABLE = { "cache-control": "public, max-age=31536000, immutable" };
/** The homepage the build would serve: this checkout's index.html with each face at the hashed address vite writes, and the entry and stylesheet vite adds. */
const homepage = (head: string) => INDEX.replace(/\/src\/assets\/fonts\/([a-z0-9-]+)\.woff2/g, "/assets/$1-Ab12Cd34.woff2").replace("</head>", `${head}</head>`);
const fontFiles = (path: (name: string) => string, headers: Record<string, string>): Site =>
  Object.fromEntries(FACES.map((n) => [path(n), { type: "font/woff2", body: readFileSync(resolve(ROOT, "src/assets/fonts", `${n}.woff2`)), headers }]));
/** The bake's hints on "/" (the SPA fallback) and /pricing, as fallbackPreloadHtml and modulepreloadTag write them. */
const HOME_HINTS = fallbackPreloadHtml(["HomePage-after.js"], { always: ["Footer-after.js"] });
const PRICING_PAGE = (hints: string) => `<!doctype html><html><head><title>Pricing</title>${hints}</head><body><div id="root"></div></body></html>`;
const AFTER: Site = {
  "/": { type: "text/html; charset=utf-8", body: homepage(`<script type="module" crossorigin src="/assets/index-after.js"></script><link rel="stylesheet" crossorigin href="/assets/index-after.css">${HOME_HINTS}`) },
  "/pricing": { type: "text/html; charset=utf-8", body: PRICING_PAGE(["PricingPage-after.js", "Footer-after.js"].map(modulepreloadTag).join("")) },
  ...fontFiles((n) => `/assets/${n}-Ab12Cd34.woff2`, IMMUTABLE),
  "/assets/index-after.css": { type: "text/css", body: "body{margin:0}" },
  "/assets/index-after.js": { type: "text/javascript", body: `import"./dep-after.js";const N=new Set(${JSON.stringify(Object.keys(EN))});const m="data-app-mount";` },
  "/assets/dep-after.js": { type: "text/javascript", body: "export const x=1;" },
  "/og-image.png": { type: "image/png", body: pub("og-image.png") },
  "/apple-touch-icon.png": { type: "image/png", body: pub("apple-touch-icon.png") },
  "/favicon.png": { type: "image/png", body: pub("favicon.png") },
  "/favicon.ico": { type: "image/x-icon", body: pub("favicon.ico") },
};

/** A PNG header of the given size, padded to `bytes`: enough for a reader of the IHDR. */
function fakePng(w: number, h: number, bytes: number): Buffer {
  const b = Buffer.alloc(Math.max(bytes, 33));
  Buffer.from("89504e470d0a1a0a", "hex").copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
const jobsLeaf = (() => {
  const leaves: string[] = [];
  (function w(v: unknown) { if (typeof v === "string") leaves.push(v); else if (v && typeof v === "object") Object.values(v).forEach(w); })(EN.jobsPage);
  return leaves.sort((a, b) => b.length - a.length)[0];
})();
/** The site as it shipped before the round (2026-10-18): chained font import, Stripe preconnect, 1200x675, no touch icon file, a 180 px tab icon, English whole in the entry. */
const BEFORE: Site = {
  "/": {
    type: "text/html; charset=utf-8",
    body: `<!doctype html><html><head><meta name="description" content="Live jobs, re-verified all day."><link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/favicon.png"><link rel="preconnect" href="https://js.stripe.com" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="675" /><script type="module" crossorigin src="/assets/index-before.js"></script><link rel="stylesheet" crossorigin href="/assets/index-before.css"></head><body><div id="root"></div></body></html>`,
  },
  "/assets/index-before.css": { type: "text/css", body: `@import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');body{margin:0}` },
  "/assets/index-before.js": { type: "text/javascript", body: `const en=${JSON.stringify({ jobsPage: { x: jobsLeaf } })};const pad="${randomBytes(240 * 1024).toString("base64")}";` },
  "/og-image.png": { type: "image/png", body: fakePng(1200, 675, 133_325) },
  "/apple-touch-icon.png": { type: "text/plain", body: "Not Found", status: 404 },
  "/favicon.png": { type: "image/png", body: fakePng(180, 180, 5_606) },
  // The host served the homepage for it before #35 put a real icon in public/.
  "/favicon.ico": { type: "text/html; charset=utf-8", body: "<!doctype html><html></html>" },
};

/**
 * The site as served on 2026-11-07, before B12 and PERF-01: the faces on the
 * public/fonts copies (an ETag, no Cache-Control), the latin file preloaded,
 * and every route-chunk hint at the default priority. Everything else is as
 * this checkout builds it.
 */
const NOV7_HEAD = INDEX.replace(/\/src\/assets\/fonts\//g, "/fonts/").replace("<style>", `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/inter-latin.woff2" /><style>`);
const NOV7: Site = {
  ...AFTER,
  "/": {
    type: "text/html; charset=utf-8",
    body: NOV7_HEAD.replace("</head>", `<script type="module" crossorigin src="/assets/index-after.js"></script><link rel="stylesheet" crossorigin href="/assets/index-after.css"><link rel="modulepreload" href="/assets/Footer-after.js"><script data-home-preload="1">if(location.pathname==="/"){["HomePage-after.js"].forEach(function(f){var l=document.createElement("link");l.rel="modulepreload";l.href="/assets/"+f;document.head.appendChild(l);});}</script></head>`),
  },
  "/pricing": { type: "text/html; charset=utf-8", body: PRICING_PAGE('<link rel="modulepreload" href="/assets/PricingPage-after.js"><link rel="modulepreload" href="/assets/Footer-after.js">') },
  ...fontFiles((n) => `/fonts/${n}.woff2`, { etag: '"65850a373e258f1c897a2b3d75eb74de"' }),
};

let server: Server;
let site: Site = AFTER;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    const r = site[(req.url || "/").split("?")[0]];
    if (!r) { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not Found"); return; }
    res.writeHead(r.status ?? 200, { "content-type": r.type, ...(r.headers ?? {}) });
    res.end(r.body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

async function runSection(which: Site): Promise<string[]> {
  site = which;
  const output = await new Promise<string>((done, fail) => {
    try {
      // execFileSync would block the event loop the local site answers on: run it in a child and wait.
      execFile("bash", ["-c", `. ${JSON.stringify(SECTION)}`], { env: { ...process.env, SITE: base, UA: "vitest" }, encoding: "utf8", timeout: 50_000 }, (err, stdout) => (err ? fail(err) : done(stdout)));
    } catch (e) { fail(e); }
  });
  return output.split("\n").filter((l) => /^(PASS|FAIL|INFO)\s/.test(l));
}

describe("section 98", () => {
  let after: string[] = [];
  let before: string[] = [];
  let nov7: string[] = [];
  beforeAll(async () => {
    after = await runSection(AFTER);
    before = await runSection(BEFORE);
    nov7 = await runSection(NOV7);
  });

  it("passes every line on a site built from this checkout", () => {
    expect(FACES.length).toBe(13);
    expect(after.length, after.join("\n")).toBeGreaterThanOrEqual(14);
    expect(after.filter((l) => !l.startsWith("PASS")), after.join("\n")).toEqual([]);
  });

  it("fails every one of those lines on the site as it shipped before the round", () => {
    expect(before.length, before.join("\n")).toBe(after.length);
    expect(before.filter((l) => l.startsWith("PASS")), before.join("\n")).toEqual([]);
    for (const tag of ["SEO-020", "SEO-021", "SEO-040", "B12", "PERF-01", "og-image.png", "apple-touch-icon", "favicon.png", "favicon.ico", "verified"]) {
      expect(before.some((l) => l.startsWith("FAIL") && l.includes(tag)), `a FAIL line names ${tag}`).toBe(true);
    }
  });

  it("on the site as served 2026-11-07 fails exactly the font head, the font file's cache and the hints' priority", () => {
    expect(nov7.length, nov7.join("\n")).toBe(after.length);
    const failed = nov7.filter((l) => !l.startsWith("PASS"));
    expect(failed, nov7.join("\n")).toHaveLength(3);
    expect(failed.some((l) => /^FAIL\s+the font head: .*not all hashed \/assets\/ files \(first: \/fonts\/inter-latin\.woff2\), 1 font preload\(s\) \(\/fonts\/inter-latin\.woff2\)/.test(l)), failed.join("\n")).toBe(true);
    expect(failed.some((l) => /^FAIL\s+\/fonts\/inter-latin\.woff2 answered 200, a woff2, Cache-Control: none .*\(B12\)$/.test(l)), failed.join("\n")).toBe(true);
    expect(failed.some((l) => /^FAIL\s+route-chunk hints that compete with the stylesheet: 3 without fetchpriority low .*the homepage script adds hints at the default priority \(PERF-01\)$/.test(l)), failed.join("\n")).toBe(true);
  });

  it("is listed where verify-deploy.sh sources it and prints only PASS, FAIL or INFO lines", () => {
    const text = readFileSync(SECTION, "utf8");
    expect(text).toMatch(/^echo "== 98\. /m);
    expect(execFileSync("bash", ["-n", SECTION]).toString()).toBe("");
  });
});
