# SEO round of 2026-10-18, speed (branch seo/speed): what the first paint
# waits for and what the share cards and home-screen icons are. A FRONTEND
# deploy (no edge function, no migration), judged on the served files with
# the browser UA. Read-only: GETs of the homepage, a prerendered posting
# page, the app's entry script and stylesheet, and three images. Pre-deploy
# the new claims FAIL by design; nothing here may crash.
#   SEO-020  the app stylesheet imports nothing; no font stylesheet is
#            requested: the head declares the faces inline (font-display
#            optional), so the face is known at the first layout and is used
#            (the media-swap head of the round's first try rendered Inter on
#            no load at all); no Stripe preconnect
#   B12      (SEO/GEO audit 2026-11-07, F06, PERF-02) every face names a
#            hashed /assets/*.woff2 the build emitted, and the Inter latin
#            file answers as a woff2 with an immutable year-long cache (the
#            /fonts/ copies carried no Cache-Control and never a 304)
#   PERF-01  no font is preloaded, and every route-chunk hint on / and
#            /pricing (the static ones and the ones the homepage script
#            adds) asks at fetchpriority low, so the stylesheet is the first
#            paint's one high-priority fetch
#   SEO-021  the entry carries the code that keeps the prerendered page on
#            screen (its mount attribute); that #root never empties is a
#            browser measurement, recorded in the round's report
#   SEO-040  the entry and its static imports are within 220 KB gzip, carry
#            the namespace registry and none of the job board's strings
#   IMG      /og-image.png is a PNG of 1200x630 within 200 KB, served as
#            image/png, and the head says 630; /apple-touch-icon.png is a
#            180 px PNG within 30 KB the head links; /favicon.png is 48-96 px
#            within 3 KB; /favicon.ico answers 200 as an icon type
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
  const inlineCss = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const faces = [...inlineCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  const interFaces = faces.filter((f) => /font-family:\s*[\x27"]?Inter[\x27"]?\s*;/.test(f));
  const srcOf = (f) => ((f.match(/url\(([^)]+)\)/) || [])[1] || "").replace(/[\x27"]/g, "");
  const latinSrc = srcOf(interFaces.find((f) => /unicode-range:\s*U\+0000-00FF/.test(f)) || "");
  const fontPreloads = links.filter((l) => attr(l, "rel") === "preload" && attr(l, "as") === "font").map((l) => attr(l, "href"));
  const optional = faces.length > 0 && faces.every((f) => /font-display:\s*optional/.test(f));
  const hashed = faces.length > 0 && faces.every((f) => /^\/assets\/[a-z0-9-]+-[A-Za-z0-9_-]{6,}\.woff2$/.test(srcOf(f)));
  if (!fontSheets.length && interFaces.length && optional && hashed && !fontPreloads.length) out("PASS", `the head declares ${faces.length} faces inline, font-display optional, each a hashed /assets/ woff2, and preloads no font: no font stylesheet request, the face is known at the first layout, never re-wraps the page and never competes with the stylesheet (SEO-020, B12, PERF-01)`);
  else out("FAIL", `the font head: ${fontSheets.length} font stylesheet request(s), ${interFaces.length} inline Inter face(s), ${optional ? "all" : "not all"} optional, ${hashed ? "all" : "not all"} hashed /assets/ files (first: ${srcOf(faces[0] || "") || "none"}), ${fontPreloads.length} font preload(s)${fontPreloads.length ? ` (${fontPreloads[0]})` : ""} (want inline optional faces on hashed /assets/ files and no font preload) (SEO-020, B12, PERF-01)`);
  // B12: the latin face as served. Hashed /assets/ files carry the host\x27s immutable cache; /fonts/ did not.
  if (!latinSrc) out("FAIL", "no Inter face covers latin (U+0000-00FF): the font file\x27s cache cannot be read (B12)");
  else {
    let font = { status: 0, cc: "", magic: "" };
    try {
      const r = await fetch(latinSrc.startsWith("http") ? latinSrc : SITE + latinSrc, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      const b = Buffer.from(await r.arrayBuffer());
      font = { status: r.status, cc: r.headers.get("cache-control") || "", magic: b.subarray(0, 4).toString("latin1") };
    } catch (e) { /* judged below */ }
    const maxAge = Number((font.cc.match(/max-age=(\d+)/) || [])[1] || 0);
    if (font.status === 200 && font.magic === "wOF2" && /\bimmutable\b/.test(font.cc) && maxAge >= 31536000) out("PASS", `${latinSrc} is a woff2 served with Cache-Control: ${font.cc}: a repeat load reads it from the disk cache (B12)`);
    else out("FAIL", `${latinSrc} answered ${font.status}, ${font.magic === "wOF2" ? "a woff2" : "not a woff2"}, Cache-Control: ${font.cc || "none"} (want a woff2 with an immutable cache of a year or more) (B12)`);
  }
  const stripe = links.filter((l) => /^(preconnect|dns-prefetch)$/.test(attr(l, "rel") || "") && /stripe\.com/.test(attr(l, "href") || ""));
  if (stripe.length) out("FAIL", `the head still opens a connection to ${attr(stripe[0], "href")}, which no page loads (SEO-020)`);
  else out("PASS", "the head opens no connection to Stripe (SEO-020)");

  // ---- PERF-01: route-chunk hints ask at low priority ----
  {
    const pricing = await get("/pricing");
    const hintTags = (h) => tags(headOf(h), "link").filter((l) => (attr(l, "rel") || "") === "modulepreload");
    const pages = [["/", home.body], ["/pricing", pricing.status === 200 ? pricing.body : ""]];
    const counted = pages.map(([p, h]) => [p, hintTags(h)]);
    const loud = counted.flatMap(([p, ts]) => ts.filter((t) => attr(t, "fetchpriority") !== "low").map((t) => `${p} ${attr(t, "href")}`));
    const homeScript = (home.body.match(/<script data-home-preload="1">([\s\S]*?)<\/script>/) || [])[1] || "";
    const scriptLoud = homeScript && !/\.fetchPriority="low"/.test(homeScript);
    const empty = counted.filter(([, ts]) => !ts.length).map(([p]) => p);
    if (pricing.status !== 200) out("FAIL", `/pricing answered ${pricing.status}: its route-chunk hints cannot be read (PERF-01)`);
    else if (!empty.length && !loud.length && !scriptLoud) out("PASS", `every route-chunk hint on / and /pricing (${counted.map(([p, ts]) => `${p}: ${ts.length}`).join(", ")}${homeScript ? ", and the ones the homepage script adds" : ""}) asks at fetchpriority low: none competes with the stylesheet (PERF-01)`);
    else out("FAIL", `route-chunk hints that compete with the stylesheet: ${empty.length ? `no hint at all on ${empty.join(", ")}; ` : ""}${loud.length} without fetchpriority low${loud.length ? ` (${loud.slice(0, 2).join(", ")})` : ""}${scriptLoud ? "; the homepage script adds hints at the default priority" : ""} (PERF-01)`);
  }

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
  if (touch.status === 200 && tSize && tSize.w === 180 && tSize.h === 180 && /^image\/png/.test(touch.type) && touch.bytes.length <= 30 * 1024) out("PASS", `/apple-touch-icon.png is a 180x180 PNG of ${touch.bytes.length} B served as ${touch.type}`);
  else out("FAIL", `/apple-touch-icon.png answered ${touch.status} as "${touch.type}", ${tSize ? `${tSize.w}x${tSize.h}` : "not a PNG"}, ${touch.bytes.length} B (want a 180x180 PNG within 30 KB)`);
  if (touchLink && attr(touchLink, "href") === "/apple-touch-icon.png") out("PASS", "the homepage head links /apple-touch-icon.png as its touch icon");
  else out("FAIL", `the homepage head\x27s touch icon is ${touchLink ? attr(touchLink, "href") : "absent"} (want /apple-touch-icon.png)`);
  const fav = await get("/favicon.png");
  const fSize = png(fav.bytes);
  if (fav.status === 200 && fSize && fSize.w >= 48 && fSize.w <= 96 && fSize.w === fSize.h && fav.bytes.length <= 3 * 1024 && /^image\/png/.test(fav.type)) out("PASS", `/favicon.png is a ${fSize.w} px PNG of ${fav.bytes.length} B served as ${fav.type}`);
  else out("FAIL", `/favicon.png answered ${fav.status} as "${fav.type}", ${fSize ? `${fSize.w}x${fSize.h}` : "not a PNG"}, ${fav.bytes.length} B (want 48-96 px, within 3 KB)`);

  const ico = await get("/favicon.ico");
  const icoMagic = ico.bytes.length >= 4 && ico.bytes.readUInt32BE(0) === 0x00000100;
  if (ico.status === 200 && /^image\/(?:vnd\.microsoft\.icon|x-icon)/.test(ico.type) && icoMagic && ico.bytes.length <= 10 * 1024) out("PASS", `/favicon.ico is an icon of ${ico.bytes.length} B served as ${ico.type}`);
  else out("FAIL", `/favicon.ico answered ${ico.status} as "${ico.type}", ${icoMagic ? "an icon" : "not an icon file"}, ${ico.bytes.length} B (want an .ico within 10 KB served as image/vnd.microsoft.icon or image/x-icon)`);

  // ---- OBS-3: no description says verified ----
  const said = ["description", "og:description", "twitter:description"].map((k) => [k, meta(head, k) || ""]).filter(([, v]) => /verif/i.test(v));
  if (said.length) out("FAIL", `the homepage ${said[0][0]} says "${said[0][1].slice(0, 80)}" (owner: never "verified")`);
  else out("PASS", "no description in the homepage head says verified");
})().catch((e) => out("FAIL", `section 98 could not finish: ${String(e).slice(0, 120)}`));
'
