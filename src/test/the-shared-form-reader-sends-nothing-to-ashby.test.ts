// @vitest-environment node
/**
 * THE SHARED FORM READER SENDS NOTHING TO ASHBY (OD14-ASHBY, owner option
 * "stop", 2026-11-18; lane SH).
 *
 * WHAT HAPPENED. The connector (OD14-ASHBY-1) and /v1 (OD14-ASHBY-2) stopped
 * reading Ashby's application forms by leaving Ashby out of the vendor list
 * each passes to the shared reader. The reader itself, in
 * _shared/application-form.ts, kept its Ashby branch: a caller that passed no
 * list, or a list that named Ashby, still POSTed to Ashby's form API, a path
 * Ashby's robots file disallows, and the request lived on in every function
 * that bundles the module.
 *
 * THE PROPERTY. readApplicationForm answers an Ashby posting
 * { kind: "withheld", vendor: "ashby" } before it reads the cache or sends a
 * single request, whatever vendor list the caller passes or omits
 * (FORM_STOPPED_VENDORS). The Ashby reader is deleted, so no file in _shared
 * names Ashby's form API path in its code, and lifting the stop alone would
 * not resume the read: it would take a reader. FORM_READER_VENDORS is left as
 * it was, so the connector's and /v1's mirrors of it keep their meaning, and
 * every other reader still reads.
 *
 * THE BUILD. Every function that bundles the module (an import walk from
 * each index.ts) carries a build at or above the one the verifier's SH1 line
 * waits for, so SH1 cannot pass on a build without the stop, and an
 * integrator who moves a stamp below it is told here, not by a line that
 * stays INFO for ever.
 *
 * TEETH. The recording fetch and cache are shown hearing a Greenhouse read,
 * so "nothing was sent" is not a deaf recorder; the stop list is lifted at
 * run time and the reader is shown reaching the cache, so the list is what
 * answers; an Ashby posting whose apply URL is on Pinpoint's domain is shown
 * not to fall through to the Pinpoint reader once the stop is lifted; the
 * path scan reads code through the repository's one comment stripper
 * (helpers/strip-comments.ts) and is shown flagging a fixture that names the
 * path in code, including on a line that opens with a block comment, while
 * passing one that names it only in comments (leading, trailing or block),
 * and shown reading the real files (it finds the module and a path the
 * module does fetch); the import walk is shown finding both known bundlers,
 * and a build one below SH1's is shown judged below it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { buildAtLeast, buildOf } from "../../scripts/deploy-ledger.mjs";
import {
  FORM_READER_VENDORS,
  FORM_STOPPED_VENDORS,
  PUBLIC_API_FORM_VENDORS,
  readApplicationForm,
  type FormCache,
  type FormCacheRow,
  type PostingRef,
} from "../../supabase/functions/_shared/application-form";

const ROOT = resolve(__dirname, "../..");
const SHARED = resolve(ROOT, "supabase/functions/_shared");
const ASHBY_FORM_PATH = "jobs.ashbyhq.com/api/";
const NOW = Date.parse("2026-11-18T18:00:00Z");

const ASHBY: PostingRef = {
  id: "ashby:acme:5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f",
  source: "ashby",
  token: "acme",
  applyUrl: "https://jobs.ashbyhq.com/acme/5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f",
};
const GREENHOUSE: PostingRef = { id: "greenhouse:acme:4012345", source: "greenhouse", token: "acme", applyUrl: null };

/** A fetch that records every request and answers each with a form any reader could parse. */
function recordingFetch() {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    calls.push(String(url instanceof Request ? url.url : url));
    return new Response(JSON.stringify({
      questions: [{ label: "Why Acme?", required: true, fields: [{ type: "textarea" }] }],
      data: { jobPosting: { applicationForm: { sections: [{ fieldEntries: [{ isRequired: true, field: { title: "Name", type: "String" } }] }] } } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

/** A cache holding a fresh, readable form for every posting: consulting it would answer "read", not "withheld". */
function spyCache() {
  const get = vi.fn(async (postingId: string): Promise<FormCacheRow | null> => ({
    vendor: postingId.split(":")[0],
    ok: true,
    form: { questions: [{ label: "Cached question", required: false, type: "text" }], documents: [], alsoOnForm: [], sectioned: true },
    read_at: new Date(NOW - 60_000).toISOString(),
  }));
  const put = vi.fn(async () => {});
  const cache: FormCache = { get, put };
  return { cache, get, put };
}

/** Every file under a folder, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

/** The files whose code names the path: comments gone, strings (and the URLs in them) kept. */
function filesNaming(files: Array<{ name: string; src: string }>, path: string): string[] {
  return files.filter((x) => codeOf(x.src).includes(path)).map((x) => x.name);
}

const sharedFiles = () => filesUnder(SHARED).map((p) => ({ name: relative(ROOT, p), src: readFileSync(p, "utf8") }));

describe("an Ashby posting is withheld before the cache or the network", () => {
  const lists: Array<[string, readonly string[] | undefined]> = [
    ["no vendor list", undefined],
    ["every reader's list", FORM_READER_VENDORS],
    ["a list naming only Ashby", ["ashby"]],
    ["the ChatGPT list", PUBLIC_API_FORM_VENDORS],
  ];

  it.each(lists)("%s: withheld, zero requests, the cache neither read nor written", async (_label, vendors) => {
    const { f, calls } = recordingFetch();
    const { cache, get, put } = spyCache();
    const r = await readApplicationForm(ASHBY, { fetch: f, cache, now: () => NOW, ...(vendors ? { vendors } : {}) });
    expect(r).toEqual({ kind: "withheld", vendor: "ashby" });
    expect(calls, "a request left the reader").toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("withheld without a cache as well", async () => {
    const { f, calls } = recordingFetch();
    expect(await readApplicationForm(ASHBY, { fetch: f, now: () => NOW })).toEqual({ kind: "withheld", vendor: "ashby" });
    expect(calls).toEqual([]);
  });

  it("the stop list names Ashby", () => {
    expect([...FORM_STOPPED_VENDORS]).toContain("ashby");
  });
});

describe("TEETH: the recorders hear, and the stop list is what answers", () => {
  // On a tree without the stop list every case below still runs (and fails), rather than the file failing to load.
  const stopped = (FORM_STOPPED_VENDORS ?? []) as string[];
  const saved = [...stopped];
  afterEach(() => { stopped.splice(0, stopped.length, ...saved); });

  it("a Greenhouse posting is still read: the same fetch records its request and the same cache is consulted", async () => {
    const { f, calls } = recordingFetch();
    const { cache, get } = spyCache();
    get.mockResolvedValueOnce(null);
    const r = await readApplicationForm(GREENHOUSE, { fetch: f, cache, now: () => NOW });
    expect(r.kind).toBe("read");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^https:\/\/boards-api\.greenhouse\.io\//);
    expect(get).toHaveBeenCalledWith(GREENHOUSE.id);
  });

  it("with the stop lifted the reader reaches the cache, and still sends Ashby nothing: the reader is gone", async () => {
    stopped.splice(0, stopped.length, ...saved.filter((v) => v !== "ashby"));
    const { f, calls } = recordingFetch();
    const { cache, get } = spyCache();
    get.mockResolvedValueOnce(null);
    const r = await readApplicationForm(ASHBY, { fetch: f, cache, now: () => NOW });
    expect(get, "the stop list is not what kept the cache untouched").toHaveBeenCalledWith(ASHBY.id);
    expect(r.kind).not.toBe("withheld");
    expect(calls.filter((u) => /ashbyhq\.com/.test(u))).toEqual([]);
  });

  it("with the stop lifted, an Ashby posting on Pinpoint's domain does not fall through to the Pinpoint reader", async () => {
    stopped.splice(0, stopped.length, ...saved.filter((v) => v !== "ashby"));
    const { f, calls } = recordingFetch();
    const odd: PostingRef = { ...ASHBY, applyUrl: "https://acme.pinpointhq.com/en/postings/5f2c9a1e-1b2c-4d3e-8f90-0a1b2c3d4e5f" };
    const r = await readApplicationForm(odd, { fetch: f, now: () => NOW });
    expect(r.kind).toBe("absent");
    expect(calls).toEqual([]);
  });
});

describe("no file in _shared names Ashby's form API path in its code", () => {
  it("the scan finds none", () => {
    expect(filesNaming(sharedFiles(), ASHBY_FORM_PATH)).toEqual([]);
  });

  it("TEETH: the scan reads the real files, and finds a path the module does fetch", () => {
    const files = sharedFiles();
    expect(files.map((x) => x.name)).toContain("supabase/functions/_shared/application-form.ts");
    expect(files.length).toBeGreaterThan(50);
    expect(filesNaming(files, ".recruitee.com/api/offers/")).toContain("supabase/functions/_shared/application-form.ts");
  });

  it("TEETH: code naming the path is flagged, even on a line that opens with a block comment; comments naming it are not", () => {
    const inCode = {
      name: "in-code.ts",
      src: [
        "async function readIt(o: ReadOptions) {",
        `  const res = await get(o, "https://${ASHBY_FORM_PATH}non-user-graphql?op=ApiJobPosting", { method: "POST" });`,
        "  return res;",
        "}",
      ].join("\n"),
    };
    const blockLed = {
      name: "block-led.ts",
      src: `/* reader */ const res = await get(o, "https://${ASHBY_FORM_PATH}non-user-graphql");`,
    };
    const inComments = {
      name: "in-comments.ts",
      src: [
        "/**",
        ` * The reader used to POST to ${ASHBY_FORM_PATH}, which robots disallows.`,
        " */",
        `// was: https://${ASHBY_FORM_PATH}non-user-graphql`,
        `export const NOTHING = 1; // was: https://${ASHBY_FORM_PATH}non-user-graphql`,
        `export const ALSO = /* was https://${ASHBY_FORM_PATH} */ 2;`,
      ].join("\n"),
    };
    expect(filesNaming([inCode, blockLed, inComments], ASHBY_FORM_PATH)).toEqual(["in-code.ts", "block-led.ts"]);
  });
});

// ── the build SH1 waits for ─────────────────────────────────────────────────

const FUNCTIONS = resolve(ROOT, "supabase/functions");
const READER = resolve(SHARED, "application-form.ts");
const SH1_SECTION = resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-public-api.sh");

/** The relative modules a file imports (static, re-exported or dynamic), resolved to paths. */
function importsOf(file: string): string[] {
  const src = codeOf(readFileSync(file, "utf8"));
  const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  return specs.map((s) => resolve(dirname(file), s));
}

/** The functions whose bundle reaches the module: every index.ts, its relative imports followed to the end. */
function bundlersOf(target: string): string[] {
  const out: string[] = [];
  for (const fn of readdirSync(FUNCTIONS).sort()) {
    const entry = join(FUNCTIONS, fn, "index.ts");
    try { statSync(entry); } catch { continue; }
    const seen = new Set<string>();
    const todo = [entry];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      try { todo.push(...importsOf(f)); } catch { /* a path that is not a file is not followed */ }
    }
    if (seen.has(target)) out.push(fn);
  }
  return out;
}

/** The build SH1 waits for, read from the section's code (its comments stripped), as "<day>.<n>". */
function sh1Minimum(): string | null {
  const code = readFileSync(SH1_SECTION, "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const m = /\bVDBA_SH_DAY=(\d{4}-\d{2}-\d{2})\b[\s\S]*?\bVDBA_SH_N=(\d+)\b/.exec(code);
  return m ? `${m[1]}.${m[2]}` : null;
}

describe("every function that bundles the stop ships at or above the build SH1 waits for", () => {
  const bundlers = bundlersOf(READER);

  it("each bundler's build is at or above SH1's", () => {
    const min = sh1Minimum();
    expect(min, "the SH1 line names no build to wait for").not.toBeNull();
    for (const fn of bundlers) {
      const build = buildOf(fn, readFileSync(join(FUNCTIONS, fn, "index.ts"), "utf8"));
      expect(buildAtLeast(build, `${fn}.${min}`), `${fn} ships ${build}, below the ${fn}.${min} that SH1 waits for`).toBe(true);
    }
  });

  it("TEETH: the walk finds both known bundlers, and a build one below SH1's is judged below it", () => {
    expect(bundlers).toEqual(expect.arrayContaining(["agent-mcp", "public-api"]));
    const [day, n] = String(sh1Minimum()).split(/\.(?=\d+$)/);
    expect(buildAtLeast(`public-api.${day}.${Number(n) - 1}`, `public-api.${day}.${n}`)).toBe(false);
    expect(buildAtLeast(`public-api.${day}.${n}`, `public-api.${day}.${n}`)).toBe(true);
  });
});
