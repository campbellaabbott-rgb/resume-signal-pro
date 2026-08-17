import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A CHECKOUT REDIRECT MUST LAND ON A ROUTE THAT EXISTS, AND ANY FLAG IT CARRIES
 * MUST BE READ BY SOMETHING.
 *
 * WHAT THIS PREVENTS, measured 2026-08-15. create-agent-checkout sent every
 * paying subscriber to `/account?agent=success`. Account.tsx does not call
 * useSearchParams anywhere, so nothing had ever read that parameter — the
 * customer landed at the top of a 1,768-line account page with no banner, no
 * scroll and no prompt.
 *
 * That was not cosmetic. Buying does not create a mandate: apply-agent opens
 * with `agent_mandates WHERE active = true`, nothing at checkout writes that
 * row, and the only writers are panels the customer must find by hand. With no
 * mandate the hourly run matched zero rows and did nothing — no queue, no
 * digest, no error, indistinguishable from a quiet night. Someone could pay
 * $99, receive absolutely nothing, and see no indication anything was wrong.
 *
 * The redirect was the cheapest place to fix it, so the redirect is what this
 * locks: it must point at a real route, and a query flag it appends must be
 * consumed somewhere in src/. A flag nobody reads is decoration that looks like
 * behavior, which is exactly how the original bug read to every reviewer.
 */
const ROOT = resolve(__dirname, "../..");
const FN_DIR = resolve(ROOT, "supabase/functions");

/** Routes declared in the router — the set a redirect may legally target. */
const declaredRoutes = (): Set<string> => {
  const app = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
  return new Set([...app.matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]));
};

/** Every src/ file's text, concatenated — for "is this flag read anywhere". */
const srcText = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".test.ts")) {
        out.push(readFileSync(p, "utf8"));
      }
    }
  };
  walk(resolve(ROOT, "src"));
  return out.join("\n");
})();

interface Redirect { fn: string; kind: string; path: string; flags: string[] }

const redirects = (): Redirect[] => {
  const found: Redirect[] = [];
  for (const fn of readdirSync(FN_DIR, { withFileTypes: true })) {
    if (!fn.isDirectory()) continue;
    const idx = resolve(FN_DIR, fn.name, "index.ts");
    if (!existsSync(idx)) continue;
    const src = readFileSync(idx, "utf8");
    for (const m of src.matchAll(/(success_url|cancel_url):\s*`\$\{origin\}([^`]*)`/g)) {
      const [pathPart, queryPart] = m[2].split("?");
      const flags = queryPart
        ? queryPart.split("&").map((kv) => kv.split("=")[0]).filter(Boolean)
        : [];
      found.push({ fn: fn.name, kind: m[1], path: pathPart || "/", flags });
    }
  }
  return found;
};

describe("checkout redirects land somewhere real", () => {
  it("finds the checkout redirects to check", () => {
    expect(redirects().length, "no success_url/cancel_url found — parser drifted").toBeGreaterThan(0);
  });

  it("targets a route the router actually declares", () => {
    const routes = declaredRoutes();
    const bad = redirects()
      .filter((r) => !routes.has(r.path))
      .map((r) => `${r.fn} ${r.kind} -> ${r.path}`);
    expect(
      bad,
      "Checkout redirects pointing at routes that do not exist in App.tsx. " +
        "The customer would land on the SPA fallback after paying.",
    ).toEqual([]);
  });

  it("appends no query flag that nothing in src/ reads", () => {
    // The original defect stated plainly: `?agent=success` was emitted by the
    // edge function and read by nobody. If a redirect bothers to set a flag,
    // some component has to change behavior because of it.
    const orphans: string[] = [];
    for (const r of redirects()) {
      for (const flag of r.flags) {
        const read =
          srcText.includes(`"${flag}"`) ||
          srcText.includes(`'${flag}'`) ||
          srcText.includes(`get(${JSON.stringify(flag)})`);
        if (!read) orphans.push(`${r.fn} ${r.kind} -> ${r.path}?${flag}=… (never read in src/)`);
      }
    }
    expect(
      orphans,
      "Checkout redirects carrying query flags no component reads. Either wire " +
        "a reader (see Agent.tsx for `welcome`) or drop the flag — a parameter " +
        "that changes nothing reads as behavior in review and is not.",
    ).toEqual([]);
  });

  it("sends the agent subscriber to the page that can set the agent up", () => {
    // Named explicitly, because this is the one with money attached. /agent is
    // the only route rendering AgentSetupChecklist, and the checklist is what
    // gets an active mandate created — without which the purchase does nothing.
    const agent = redirects().filter((r) => r.fn === "create-agent-checkout" && r.kind === "success_url");
    expect(agent.length, "create-agent-checkout has no success_url").toBe(1);
    expect(
      agent[0].path,
      "A new agent subscriber must land where the mandate gets created. " +
        "/account does not render AgentSetupChecklist, so a buyer sent there " +
        "gets a silent, inert agent.",
    ).toBe("/agent");

    const agentPage = readFileSync(resolve(ROOT, "src/pages/Agent.tsx"), "utf8");
    expect(
      agentPage.includes("AgentSetupChecklist"),
      "/agent must render AgentSetupChecklist for that redirect to mean anything",
    ).toBe(true);
  });
});
