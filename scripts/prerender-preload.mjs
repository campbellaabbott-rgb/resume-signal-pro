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
  if (p === "/") return "Index";
  if (p === "/pricing") return "Pricing";
  if (p === "/jobs" || p.startsWith("/jobs/field/") || p.startsWith("/jobs/company/")) return "Jobs";
  return null;
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
