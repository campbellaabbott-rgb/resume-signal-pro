// Which route chunk each baked page preloads (SEO-023). Pure: the caller
// lists dist/assets and reads the chunk files; nothing here touches disk.
//
// MEASURED 2026-10-18: every posting page preloaded Footer and the 370 KB
// Jobs chunk, which a posting page never runs, and not JobPosting, which it
// does; / and /pricing preloaded no route chunk at all. The router finds the
// route's chunk only after the entry has downloaded and parsed, so the hint is
// the difference between one round trip and three. Vite's own manifest
// (build.manifest) is not switched on in this build, and the bake runs after
// the bundle is hashed, so the chunks' static imports are read from the chunk
// files themselves: `from"./X.js"` and `import"./X.js"`, never a dynamic
// import("./X.js"), which loads only when the page asks for it.

/** The route chunk's name prefix a baked page runs, or null for a page whose chunk the bake does not name. */
export function routeChunkPrefix(path) {
  const p = String(path ?? "");
  if (p.startsWith("/jobs/posting/")) return "JobPosting";
  // The board-first homepage and the new pricing page (homepage switch-over,
  // step 10): their lazy chunks are named after their files.
  if (p === "/") return "HomePage";
  if (p === "/pricing") return "PricingPage";
  // The scanner's landings (App.tsx renders Index at each): every old address
  // of the scanner lands on /resume-checker now, so its chunk is preloaded
  // there as the old "/" preloaded it (review round 2026-10-26).
  if (p === "/resume-checker" || p === "/ats-resume-test" || p === "/resume-score" || p === "/es/revisar-curriculum") return "Index";
  if (p === "/jobs" || p.startsWith("/jobs/field/") || p.startsWith("/jobs/company/")) return "Jobs";
  return null;
}

/**
 * ONE ROUTE-CHUNK HINT, AT LOW PRIORITY (PERF-01, SEO/GEO audit 2026-11-07).
 *
 * Every baked page paints from its own HTML and one render-blocking
 * stylesheet; no preloaded script feeds that paint (the LCP element is baked
 * text on every page type measured). At the default priority the twelve hints
 * a company, field, posting, /jobs or /pricing page writes shared the line
 * with that stylesheet: on the phone lab profile (4x CPU, 150 ms, 1.6 Mbps)
 * the stylesheet finished 1,290-1,360 ms in and LCP followed it; with the
 * hints at low priority and no font preload (index.html) it finished at
 * 1,150-1,190 and LCP came 200-250 ms sooner on company, field and posting
 * pages (Domino's 1,576-1,656 ms to 1,328-1,384). The hint still starts the
 * chunk before the entry asks for it, so hydration keeps its one round trip.
 * The attribute comes after href, so a reader that matches the tag up to its
 * href still reads it.
 */
export const modulepreloadTag = (file) => `<link rel="modulepreload" href="/assets/${file}" fetchpriority="low">`;

/**
 * THE HEAD OF THE ROOT index.html, WHICH IS ALSO THE SPA FALLBACK.
 *
 * Lovable serves dist/index.html for every address the bake did not write:
 * /auth, /account, an unbaked posting, an unknown company token. Its static
 * head therefore names only what every page needs (Footer, `always`); the
 * homepage's own route chunks are added by a script that runs only on "/".
 * With the homepage's twelve chunks written into the static head (about
 * 103 KB gzip a page never runs), /auth measured LCP 3,192 ms on a phone
 * against 2,696 ms without them (the round's review, 2026-10-24).
 */
export function fallbackPreloadHtml(files, { always = [], scanner = null } = {}) {
  const head = always.map(modulepreloadTag).join("");
  const ok = (list) => (list ?? []).filter((f) => !always.includes(f) && /^[\w.-]+\.js$/.test(f));
  const rest = ok(files);
  // A scanner address of "/" (src/lib/scanner-address.ts scannerAddressScript)
  // is redirected to /resume-checker before the homepage loads: it preloads
  // the scanner's chunks, never the homepage's (review round 2026-10-26).
  const scannerFiles = scanner && scanner.predicate ? ok(scanner.files) : [];
  if (!rest.length && !scannerFiles.length) return head;
  const add = 'function(f){var l=document.createElement("link");l.rel="modulepreload";l.fetchPriority="low";l.href="/assets/"+f;document.head.appendChild(l);}';
  const pick = scanner && scanner.predicate ? `(${scanner.predicate}?${JSON.stringify(scannerFiles)}:${JSON.stringify(rest)})` : JSON.stringify(rest);
  return `${head}<script data-home-preload="1">if(location.pathname==="/"){${pick}.forEach(${add});}</script>`;
}

/** The chunk files a chunk imports statically, by file name, in the order they appear. */
export function staticImportsOf(code) {
  const out = [];
  const seen = new Set();
  for (const m of String(code ?? "").matchAll(/(?:\bfrom\s*|\bimport\s*)"\.\/([\w.-]+\.js)"/g)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

/**
 * The files to preload for a route chunk: the chunk, then everything it
 * imports statically, transitively, leaving out the entry (the page's own
 * script tag already loads it) and anything in `skip`. Capped, because a hint
 * list longer than the page's own critical path costs more than it saves.
 */
export function preloadClosure(chunk, { readChunk, entry = null, skip = [], cap = 12 }) {
  if (!chunk) return [];
  const out = [];
  const seen = new Set([...(entry ? [entry] : []), ...skip]);
  const queue = [chunk];
  while (queue.length && out.length < cap) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    out.push(f);
    let code = null;
    try { code = readChunk(f); } catch { code = null; }
    for (const dep of staticImportsOf(code)) if (!seen.has(dep)) queue.push(dep);
  }
  return out;
}

/**
 * WHAT A HEAD'S FONTS ASK FOR, CHECKED AGAINST THE BUILD (B12, PERF-01).
 *
 * The build writes each face's hashed /assets/ address into index.html's
 * inline style, and every page the bake writes copies that head. A face that
 * names anything else (the old /fonts/ copies, which carry no cache header, or
 * a source path the build did not rewrite) or a file the build did not emit
 * would cost every page its font; a font preload competes with the one
 * render-blocking stylesheet. Pure: the caller hands it the head and the
 * names in dist/assets. Returns the problems, empty when there are none.
 */
export function fontHeadProblems(html, assetFiles = []) {
  const head = (/<head[^>]*>([\s\S]*?)<\/head>/i.exec(String(html ?? ""))?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const files = new Set(assetFiles);
  const problems = [];
  const css = [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => (/url\(\s*["']?([^"')]+)["']?\s*\)/.exec(m[1]) || [])[1] || "");
  if (!faces.length) problems.push("the head declares no @font-face");
  for (const src of faces) {
    const m = /^\/assets\/([\w.-]+\.woff2)$/.exec(src);
    if (!m) problems.push(`a face names ${src || "no file"}, not a hashed /assets/*.woff2`);
    else if (!files.has(m[1])) problems.push(`a face names /assets/${m[1]}, which the build did not emit`);
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    if (/\brel=["']?preload\b/i.test(tag) && /\bas=["']?font\b/i.test(tag)) problems.push(`the head preloads a font (${(/href=["']?([^"'\s>]+)/.exec(tag) || [])[1] || "?"}), which competes with the stylesheet`);
  }
  return problems;
}
