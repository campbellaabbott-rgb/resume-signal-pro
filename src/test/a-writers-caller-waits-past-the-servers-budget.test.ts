// @vitest-environment node
/**
 * A WRITER'S CALLER WAITS PAST THE SERVER'S BUDGET (recheck of S13-001).
 *
 * The functions that bundle _shared/ai-fallback.ts run their model chain for
 * up to 125 s after the request arrives (CHAIN_DEADLINE_MS), inside the
 * platform's 150 s. The scan page asked generate-tailored-resume with a
 * 120 s client timer: a reply the chain's last model wrote after 120 s was
 * delivered to a browser that had already given up, and the account's
 * writing use was spent (the server answered 200, so it was not given
 * back). A free account has one tailored résumé a day.
 *
 * Held here by reading every client caller in src/ that sets a timer on one
 * of those functions (callEdgeFunctionWithRetry, createResilientCaller): each
 * waits longer than the platform's 150 s, so the server's own 200 or 504 (or
 * the platform's) is always the answer read. A caller that sets no timeout
 * gets the wrapper's default, which is read from its source too.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const PLATFORM_LIMIT_MS = 150_000;

/** The edge functions whose bundle runs the shared model chain. */
function writers(): Set<string> {
  const dir = join(ROOT, "supabase", "functions");
  const out = new Set<string>();
  for (const fn of readdirSync(dir)) {
    if (fn.startsWith("_") || !statSync(join(dir, fn)).isDirectory()) continue;
    const files = readdirSync(join(dir, fn)).filter((f) => f.endsWith(".ts"));
    if (files.some((f) => /_shared\/ai-fallback\.ts/.test(readFileSync(join(dir, fn, f), "utf8")))) out.add(fn);
  }
  return out;
}

function sources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "test") sources(p, acc);
    } else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

const wrapper = readFileSync(join(ROOT, "src", "lib", "resilient-edge-function.ts"), "utf8");
const DEFAULT_TIMEOUT_MS = Number(/export async function callEdgeFunctionWithRetry[\s\S]*?timeout = ([\d_]+)/.exec(wrapper)?.[1].replace(/_/g, ""));

/** Every timed client call of a function: where, which function, and how long it waits. */
function timedCalls(): Array<{ where: string; fn: string; timeoutMs: number }> {
  const calls: Array<{ where: string; fn: string; timeoutMs: number }> = [];
  for (const file of sources(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    const opener = /(callEdgeFunctionWithRetry|createResilientCaller)(?:<[^>]*>)?\(\s*['"]([a-z0-9-]+)['"]/g;
    const starts = [...text.matchAll(opener)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : text.length;
      const span = text.slice(m.index!, Math.min(end, m.index! + 2_500));
      const t = /\btimeout:\s*([\d_]+)/.exec(span);
      calls.push({ where: `${file.slice(ROOT.length + 1)}:${text.slice(0, m.index!).split("\n").length}`, fn: m[2], timeoutMs: t ? Number(t[1].replace(/_/g, "")) : DEFAULT_TIMEOUT_MS });
    });
  }
  return calls;
}

describe("a writer's client timer outlasts the server's budget", () => {
  it("the wrapper's default timeout is read from its source", () => {
    expect(Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0).toBe(true);
  });

  it("the writers are found, the tailored résumé among them", () => {
    const w = writers();
    expect(w.has("generate-tailored-resume")).toBe(true);
    expect(w.has("analyze-resume")).toBe(true);
    expect(existsSync(join(ROOT, "src", "pages", "Index.tsx"))).toBe(true);
  });

  it("every timed client call of a writer waits longer than the platform's 150 s", () => {
    const w = writers();
    const ofWriters = timedCalls().filter((c) => w.has(c.fn));
    // Not vacuous: the scan page's tailored résumé is one of them.
    expect(ofWriters.some((c) => c.fn === "generate-tailored-resume" && c.where.startsWith("src/pages/Index.tsx"))).toBe(true);
    const short = ofWriters.filter((c) => c.timeoutMs <= PLATFORM_LIMIT_MS).map((c) => `${c.where} ${c.fn} ${c.timeoutMs} ms`);
    expect(short, "a client timer that gives up before the server answers").toEqual([]);
  });
});
