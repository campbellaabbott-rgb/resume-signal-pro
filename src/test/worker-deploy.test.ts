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
import { existsSync } from "node:fs";

const root = resolve(__dirname, "../..");
const fly = readFileSync(resolve(root, "worker/fly.toml"), "utf8");
const dockerfile = readFileSync(resolve(root, "worker/Dockerfile"), "utf8");

/**
 * Every process.env key the DEPLOYED worker actually reads.
 *
 * REACHABILITY FROM index.ts, NOT every .ts under worker/src — and the
 * distinction has teeth. worker/src also holds standalone research tools that
 * are never launched by fly.toml or apply-worker.yml: probe-botwall.ts,
 * botwall-sweep.ts and friends. botwall-sweep reads SUPABASE_URL, which is
 * exactly a key this file asserts the worker does NOT read, and a directory
 * walk therefore failed the guard for a script that has nothing to do with
 * sending applications.
 *
 * Widening the assertion to accommodate it would have been the wrong repair:
 * it would let a genuine reintroduction of SUPABASE_URL into the SENDER pass
 * unnoticed, which is the precise bug this file exists to prevent. Following
 * the import graph keeps the guard pointed at its actual subject — the code
 * that boots in the container.
 */
function workerEnvKeys(): Set<string> {
  const dir = resolve(root, "worker/src");
  const seen = new Set<string>();
  const keys = new Set<string>();

  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src: string;
    try { src = readFileSync(file, "utf8"); } catch { return; }
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) keys.add(m[1]);
    // Relative imports only — a bare specifier is a package, not our code.
    for (const m of src.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)) {
      const spec = m[1].replace(/\.js$/, "");
      const base = resolve(file, "..", spec);
      for (const cand of [`${base}.ts`, resolve(base, "index.ts")]) {
        if (existsSync(cand)) { visit(cand); break; }
      }
    }
  };
  visit(resolve(dir, "index.ts"));

  // The walk must actually have walked. A typo in the entry path would yield an
  // empty set, and every "does not read X" assertion below would pass vacuously
  // — a guard that cannot fail is the shape this codebase has been bitten by.
  if (keys.size < 3) throw new Error(`worker import graph yielded only ${keys.size} env keys — the traversal broke, not the worker`);
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

describe("the applicant profile cannot be committed", () => {
  // applicant.example.json has instructed people to "copy to applicant.json
  // (gitignored)" since it was written. The ignore rule did not exist until
  // 2026-08-02, so that was a promise the repo did not keep — and the file it
  // describes carries a real name, email, phone, home address, postcode,
  // LinkedIn and a path to a CV. Nothing leaked, but only because nobody had
  // yet run the command the documentation asked for.
  const ignore = readFileSync(resolve(root, "worker/.gitignore"), "utf8");

  it("ignores applicant.json", () => {
    expect(ignore).toMatch(/^applicant\.json$/m);
  });

  it("still tracks the example, which carries no personal data", () => {
    expect(ignore).toMatch(/^!applicant\.example\.json$/m);
  });

  it("the example ships empty — a filled one would BE the leak", () => {
    const ex = JSON.parse(readFileSync(resolve(root, "worker/applicant.example.json"), "utf8"));
    for (const [k, v] of Object.entries(ex)) {
      if (k === "_README") continue;
      expect(v === "" || v === null || v === false, `${k} is pre-filled with ${JSON.stringify(v)}`).toBe(true);
    }
  });
});

describe("EVERY surface that launches the worker passes the right credentials", () => {
  // I fixed fly.toml and did not look for siblings. The GitHub Actions workflow
  // carried the identical stale instruction — SUPABASE_URL and
  // SUPABASE_SERVICE_ROLE_KEY — and would have exited `misconfigured` in
  // seconds. One fix, one missed instance, because the guard was written
  // against a filename instead of against a class of file.
  const SURFACES = [
    "worker/fly.toml",
    ".github/workflows/apply-worker.yml",
  ];
  const needed = workerEnvKeys();

  it.each(SURFACES)("%s passes APPLY_WORKER_SECRET", (rel) => {
    const src = readFileSync(resolve(root, rel), "utf8");
    expect(src).toMatch(/APPLY_WORKER_SECRET/);
  });

  it.each(SURFACES)("%s never SETS a credential the worker ignores", (rel) => {
    const src = readFileSync(resolve(root, rel), "utf8");
    // Assignments only — prose explaining the old mistake is allowed and
    // useful. `KEY: ${{ secrets.KEY }}` or `fly secrets set KEY` are not.
    for (const dead of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]) {
      expect(needed.has(dead), `worker unexpectedly reads ${dead}`).toBe(false);
      expect(src, `${rel} still ASSIGNS ${dead}`).not.toMatch(
        new RegExp(`^\\s*${dead}\\s*:\\s*\\$\\{\\{`, "m"));
      expect(src, `${rel} still instructs setting ${dead}`).not.toMatch(
        new RegExp(`(fly secrets set|gh secret set)\\s+${dead}`));
    }
  });
});
