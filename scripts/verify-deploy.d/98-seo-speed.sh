# SEO round of 2026-10-18, speed (branch seo/speed): what the first paint
# waits for and what the share cards and home-screen icons are. A FRONTEND
# deploy (no edge function, no migration), judged on the served files with
# the browser UA. Read-only: GETs of the homepage, a prerendered posting
# page, the app's entry script and stylesheet, and three images. Pre-deploy
# the new claims FAIL by design; nothing here may crash.
#   SEO-020  the app stylesheet imports nothing; the font CSS loads from the
#            head without blocking (media swap); no Stripe preconnect
#   SEO-021  the entry carries the code that keeps the prerendered page on
#            screen (its mount attribute); that #root never empties is a
#            browser measurement, recorded in the round's report
#   SEO-040  the entry and its static imports are within 220 KB gzip, carry
#            the namespace registry and none of the job board's strings
#   IMG      /og-image.png is a PNG of 1200x630 within 200 KB, served as
#            image/png, and the head says 630; /apple-touch-icon.png is a
#            180 px PNG the head links; /favicon.png is 48-96 px within 3 KB
#   OBS-3    no head description on / says verified
echo "== 98. SEO speed: fonts, the prerendered page, the entry budget, share image and icons =="

REPO_ROOT98="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="$SITE" UA="$UA" REPO_ROOT="$REPO_ROOT98" node -e '
const { SITE, UA, REPO_ROOT } = process.env;
const fs = require("fs");
const zlib = require("zlib");
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const get = async (path, ms = 30000) => {
  try {
    const r = await fetch(path.startsWith("http") ? path : SITE + path, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get("content-type") || "", body: buf.toString("utf8"), bytes: buf };
  } catch (e) { return { status: 0, type: "", body: "", bytes: Buffer.alloc(0), err: String(e).slice(0, 80) }; }
};
const headOf = (h) => ((h.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [])[1] || "").replace(/<!--[\s\S]*?-->/g, "");
const tags = (head, name) => [...head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "").matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
const attr = (tag, a) => ((tag.match(new RegExp(`\\s${a}="([^"]*)"`, "i")) || [])[1]);
const meta = (head, key) => { const t = tags(head, "meta").find((x) => attr(x, "property") === key || attr(x, "name") === key); return t ? attr(t, "content") : undefined; };
const png = (b) => (b.length >= 24 && b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && b.subarray(12, 16).toString("latin1") === "IHDR") ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
(async () => {
  const home = await get("/");
  if (home.status !== 200) { out("FAIL", `/ answered ${home.status} ${home.err || ""}: nothing below can be judged`); return; }
  const head = headOf(home.body);
  const links = tags(head, "link");

  // ---- SEO-020: fonts never block the first paint ----
  const cssHref = links.map((l) => attr(l, "href")).find((h) => /^\/assets\/[^"]+\.css$/.test(h || ""));
  if (!cssHref) out("FAIL", "the homepage names no app stylesheet under /assets/");
  else {
    const css = await get(cssHref);
    if (css.status !== 200) out("FAIL", `${cssHref} answered ${css.status}`);
    else if (/@import\b/.test(css.body.replace(/\/\*[\s\S]*?\*\//g, ""))) out("FAIL", `${cssHref} still imports another stylesheet: a chained request the first paint waits for (SEO-020)`);
    else out("PASS", `${cssHref} imports nothing (${css.bytes.length} B): the first paint waits for one stylesheet (SEO-020)`);
  }
  const fontSheets = links.filter((l) => attr(l, "rel") === "stylesheet" && /^https:\/\/fonts\.googleapis\.com\//.test(attr(l, "href") || ""));
  if (fontSheets.length === 1 && attr(fontSheets[0], "media") === "print" && /this\.media\s*=\s*.all./.test(attr(fontSheets[0], "onload") || "") && /display=optional(&|$)/.test(attr(fontSheets[0], "href") || "")) out("PASS", "the font stylesheet loads from the head without blocking the paint (media swap, font-display optional: no late re-wrap) (SEO-020, SEO-022)");
  else out("FAIL", `the homepage head has ${fontSheets.length} font stylesheet link(s), not one applied by a media swap with display=optional (SEO-020, SEO-022)`);
  const stripe = links.filter((l) => /^(preconnect|dns-prefetch)$/.test(attr(l, "rel") || "") && /stripe\.com/.test(attr(l, "href") || ""));
  if (stripe.length) out("FAIL", `the head still opens a connection to ${attr(stripe[0], "href")}, which no page loads (SEO-020)`);
  else out("PASS", "the head opens no connection to Stripe (SEO-020)");

  // ---- SEO-040 and SEO-021: the entry ----
  const entry = (home.body.match(/<script type="module"[^>]*src="(\/assets\/index-[^"]+\.js)"/) || [])[1];
  if (!entry) { out("FAIL", "the homepage names no entry script /assets/index-*.js"); }
  else {
    const seen = new Map();
    const walk = async (p) => {
      if (seen.has(p)) return;
      const r = await get(p);
      seen.set(p, r);
      if (r.status !== 200) return;
      for (const m of r.body.matchAll(/(?:^|[;\n}])\s*import\s*(?:[^"\x27;]*?from\s*)?["\x27]\.\/([^"\x27]+\.js)["\x27]/g)) await walk(`/assets/${m[1]}`);
    };
    await walk(entry);
    const bad = [...seen].filter(([, r]) => r.status !== 200);
    if (bad.length) out("FAIL", `the entry or a chunk it imports answered ${bad[0][1].status}: ${bad[0][0]}`);
    else {
      const total = [...seen.values()].reduce((n, r) => n + gz(r.bytes), 0);
      const files = [...seen.keys()].map((p) => p.replace("/assets/", "")).join(" + ");
      if (total <= 220 * 1024) out("PASS", `the entry and its static imports are ${(total / 1024).toFixed(1)} KB gzip, within 220 KB (${files}) (SEO-040)`);
      else out("FAIL", `the entry and its static imports are ${(total / 1024).toFixed(1)} KB gzip, over 220 KB (${files}) (SEO-040)`);
      const code = [...seen.values()].map((r) => r.body).join("\n");
      let en = null;
      try { en = JSON.parse(fs.readFileSync(`${REPO_ROOT}/src/i18n/locales/en.json`, "utf8")); } catch { /* judged below */ }
      if (!en) out("INFO", "en.json could not be read from the checkout: the entry\x27s strings were not judged");
      else {
        const names = JSON.stringify(Object.keys(en)).slice(1, -1);
        const leaves = [];
        (function w(v) { if (typeof v === "string") leaves.push(v); else if (v && typeof v === "object") Object.values(v).forEach(w); })(en.jobsPage);
        const others = JSON.stringify(Object.fromEntries(Object.entries(en).filter(([k]) => k !== "jobsPage")));
        const sig = leaves.filter((s) => s.length >= 40 && !/[{}"\\<]/.test(s) && !others.includes(s)).sort((a, b) => b.length - a.length)[0];
        if (!code.includes(names)) out("FAIL", "the entry carries no namespace registry: English still rides the entry whole, or this deploy predates the split (SEO-040)");
        else if (sig && code.includes(sig)) out("FAIL", `the entry still carries the job board\x27s strings ("${sig.slice(0, 50)}…") (SEO-040)`);
        else out("PASS", "the entry carries the namespace registry and none of the job board\x27s strings, which load with the board (SEO-040)");
      }
      if (/data-app-mount/.test(code)) out("PASS", "the entry mounts React beside the prerendered markup (data-app-mount): the baked page stays until the route renders (SEO-021)");
      else out("FAIL", "the entry carries no data-app-mount: React still mounts into #root and blanks the prerendered page (SEO-021)");
    }
  }

  // ---- the share image and the icons ----
  const og = await get("/og-image.png");
  const ogSize = png(og.bytes);
  if (og.status === 200 && ogSize && ogSize.w === 1200 && ogSize.h === 630 && /^image\/png/.test(og.type) && og.bytes.length <= 200 * 1024) out("PASS", `/og-image.png is a ${ogSize.w}x${ogSize.h} PNG of ${og.bytes.length} B served as ${og.type}`);
  else out("FAIL", `/og-image.png answered ${og.status} as "${og.type}", ${ogSize ? `${ogSize.w}x${ogSize.h}` : "not a PNG"}, ${og.bytes.length} B (want a 1200x630 PNG within 200 KB served as image/png)`);
  const ogH = meta(head, "og:image:height"), ogW = meta(head, "og:image:width");
  if (ogW === "1200" && ogH === "630") out("PASS", "the homepage head declares og:image 1200x630");
  else out("FAIL", `the homepage head declares og:image ${ogW}x${ogH} (want 1200x630, the file\x27s size)`);
  const touchLink = links.find((l) => (attr(l, "rel") || "").split(/\s+/).includes("apple-touch-icon"));
  const touch = await get("/apple-touch-icon.png");
  const tSize = png(touch.bytes);
  if (touch.status === 200 && tSize && tSize.w === 180 && tSize.h === 180 && /^image\/png/.test(touch.type)) out("PASS", `/apple-touch-icon.png is a 180x180 PNG of ${touch.bytes.length} B served as ${touch.type}`);
  else out("FAIL", `/apple-touch-icon.png answered ${touch.status} as "${touch.type}", ${tSize ? `${tSize.w}x${tSize.h}` : "not a PNG"} (want a 180x180 PNG)`);
  if (touchLink && attr(touchLink, "href") === "/apple-touch-icon.png") out("PASS", "the homepage head links /apple-touch-icon.png as its touch icon");
  else out("FAIL", `the homepage head\x27s touch icon is ${touchLink ? attr(touchLink, "href") : "absent"} (want /apple-touch-icon.png)`);
  const fav = await get("/favicon.png");
  const fSize = png(fav.bytes);
  if (fav.status === 200 && fSize && fSize.w >= 48 && fSize.w <= 96 && fSize.w === fSize.h && fav.bytes.length <= 3 * 1024 && /^image\/png/.test(fav.type)) out("PASS", `/favicon.png is a ${fSize.w} px PNG of ${fav.bytes.length} B served as ${fav.type}`);
  else out("FAIL", `/favicon.png answered ${fav.status} as "${fav.type}", ${fSize ? `${fSize.w}x${fSize.h}` : "not a PNG"}, ${fav.bytes.length} B (want 48-96 px, within 3 KB)`);

  // ---- OBS-3: no description says verified ----
  const said = ["description", "og:description", "twitter:description"].map((k) => [k, meta(head, k) || ""]).filter(([, v]) => /verif/i.test(v));
  if (said.length) out("FAIL", `the homepage ${said[0][0]} says "${said[0][1].slice(0, 80)}" (owner: never "verified")`);
  else out("PASS", "no description in the homepage head says verified");
})().catch((e) => out("FAIL", `section 98 could not finish: ${String(e).slice(0, 120)}`));
'
