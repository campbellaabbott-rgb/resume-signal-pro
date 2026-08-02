/**
 * The deploy config has to describe the worker that exists.
 *
 * WHY THIS FILE EXISTS. fly.toml told an operator to set SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. The worker reads neither — it has not held a
 * service-role key since the broker was built. Following those instructions
 * produced a container that exited `misconfigured` on boot, and sent whoever
 * was deploying to look for a credential that CANNOT BE OBTAINED: the backend
 * is Lovable Cloud-managed and injects the service key into edge functions at
 * runtime, where nobody can list or retrieve it.
 *
 * That is the same failure this codebase keeps producing, moved into ops:
 * documentation describing a system that has since changed underneath it. Code
 * has tests; a comment block telling a human which secret to set had nothing.
 * Now it does.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";

const root = resolve(__dirname, "../..");
const fly = readFileSync(resolve(root, "worker/fly.toml"), "utf8");
const dockerfile = readFileSync(resolve(root, "worker/Dockerfile"), "utf8");

/** Every process.env key the worker actually reads. */
function workerEnvKeys(): Set<string> {
  const dir = resolve(root, "worker/src");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(resolve(d, e.name));
      else if (e.name.endsWith(".ts")) files.push(resolve(d, e.name));
    }
  };
  walk(dir);
  const keys = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) keys.add(m[1]);
  }
  return keys;
}

describe("fly.toml describes the worker that exists", () => {
  const needed = workerEnvKeys();

  it("names the credential the worker actually requires", () => {
    expect(needed.has("APPLY_WORKER_SECRET"), "worker no longer reads APPLY_WORKER_SECRET?").toBe(true);
    expect(fly).toMatch(/fly secrets set APPLY_WORKER_SECRET/);
  });

  it("does NOT ask for credentials the worker never reads", () => {
    // The exact bug. Both were instructed; neither is used; one is impossible
    // to obtain from a Lovable Cloud-managed backend.
    for (const dead of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]) {
      expect(needed.has(dead), `worker unexpectedly reads ${dead}`).toBe(false);
      expect(fly.match(new RegExp(`fly secrets set ${dead}`)),
        `fly.toml still instructs setting ${dead}, which the worker ignores`).toBeNull();
    }
  });

  it("supplies the broker URL, since the worker cannot find it alone", () => {
    expect(needed.has("APPLY_BROKER_URL")).toBe(true);
    expect(fly).toMatch(/APPLY_BROKER_URL\s*=\s*"https:\/\/[^"]+\/apply-broker"/);
  });

  it("sets the hosted worker to never idle-exit", () => {
    // The local launchd install sets a few seconds so a scheduled run stops
    // when the queue is dry. Copying that here gives a container that dies
    // within a minute of every deploy and reads as a crash loop.
    expect(fly).toMatch(/WORKER_IDLE_EXIT_MS\s*=\s*"0"/);
  });

  it("exposes no ports — this process must be unreachable from the internet", () => {
    // Strip comments first. The earlier version of this assertion matched the
    // file's own prose explaining that no service blocks are declared — a guard
    // that cannot tell configuration from documentation about configuration.
    const active = fly.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(active).not.toMatch(/\[\[services\]\]|\[http_service\]|internal_port/);
  });

  it("runs exactly one machine, so a deploy cannot overlap two browsers", () => {
    expect(fly).toMatch(/strategy\s*=\s*"immediate"/);
  });
});

describe("the container can actually launch a browser", () => {
  it("installs the browser matching the RESOLVED Playwright, not the image tag", () => {
    // Image was v1.47.0 while package.json asked ^1.62.1. npm resolves 1.62,
    // whose expected browser build id is absent from the image — which fails at
    // runtime on the first application, long after a green deploy.
    expect(dockerfile).toMatch(/npx playwright install chromium/);
  });

  it("does not run as root", () => {
    expect(dockerfile).toMatch(/^USER pwuser$/m);
  });

  it("compiles before starting, and starts the compiled entrypoint", () => {
    expect(dockerfile).toMatch(/RUN npx tsc/);
    expect(dockerfile).toMatch(/CMD \["node", "dist\/index\.js"\]/);
  });
});
