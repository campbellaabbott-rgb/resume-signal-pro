import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_URL as MODULE_URL, RESOURCE_METADATA_URL, PRM_PATH } from "../../supabase/functions/agent-mcp/oauth";

/**
 * THE SERVER NAMES ITSELF ONCE IN THREE RUNTIMES.
 *
 * The MCP server's URL is the audience an OAuth token must carry, the
 * `resource` of the metadata document, and the string a user pastes into a
 * connector dialog. It is necessarily spelled in three places that cannot
 * import each other: the access-token hook (SQL, which binds the audience
 * because the authorization endpoint ignores a resource parameter), the
 * server module (Deno, which checks the audience and publishes the
 * metadata), and the page (React — the test-button client module the page
 * imports its URL from — which builds it from an env variable and shows it
 * to the user). If any one drifts — a trailing slash, a renamed
 * function, a different project — every token is refused or every user
 * pastes a URL the token was not minted for, and nothing else fails.
 *
 * Each spelling is READ from its runtime by a parser and the three are
 * compared to each other. The URL is never typed here.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripTs = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, " ");

// ── the three parsers ───────────────────────────────────────────────────────

/** The server module's constant: a plain string literal, no interpolation. */
function moduleUrlOf(code: string): string {
  const m = /export const MCP_URL = "([^"]+)";/.exec(code);
  if (!m) throw new Error("oauth.ts no longer declares MCP_URL as a plain string literal");
  return m[1];
}

/** The URL the hook writes as the audience, from the newest migration that defines the hook. */
function hookUrlOf(sql: string): string {
  const fn = /FUNCTION public\.custom_access_token_hook\s*\(event jsonb\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql);
  if (!fn) throw new Error("no custom_access_token_hook(event jsonb) body found");
  const m = /'\{aud\}',\s*to_jsonb\('([^']+)'::text\)/.exec(fn[1]);
  if (!m) throw new Error("the hook no longer writes the audience with to_jsonb('<url>'::text)");
  return m[1];
}

/**
 * The page's env-built string, evaluated the way Vite would: the template's
 * one interpolation is VITE_SUPABASE_URL, read from the repo's .env.
 */
function pageUrlOf(code: string, env: Record<string, string>): string {
  const m = /export const MCP_URL = `([^`]+)`;/.exec(code);
  if (!m) throw new Error("src/lib/mcp-test.ts no longer builds MCP_URL from a template");
  const holes = [...m[1].matchAll(/\$\{([^}]*)\}/g)].map((h) => h[1]);
  if (holes.length !== 1 || holes[0] !== "import.meta.env.VITE_SUPABASE_URL") {
    throw new Error(`the page template interpolates ${JSON.stringify(holes)}, not import.meta.env.VITE_SUPABASE_URL alone`);
  }
  const base = env.VITE_SUPABASE_URL;
  if (!base) throw new Error("VITE_SUPABASE_URL is not set in .env");
  return m[1].replace(/\$\{[^}]*\}/, base);
}

function envOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const MIG_DIR = resolve(ROOT, "supabase/migrations");
const hookMigration = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort()
  .filter((f) => /FUNCTION public\.custom_access_token_hook\s*\(/.test(read(`supabase/migrations/${f}`))).pop();

const MODULE = stripTs(read("supabase/functions/agent-mcp/oauth.ts"));
const HOOK = hookMigration ? stripSql(read(`supabase/migrations/${hookMigration}`)) : "";
// The page's one spelling lives in the test-button client the page and the
// hand-off module import it from (the page re-exports it).
const PAGE = stripTs(read("src/lib/mcp-test.ts"));
const ENV = envOf(read(".env"));
const PROJECT_ID = /^project_id = "([a-z]+)"/m.exec(read("supabase/config.toml"))?.[1] ?? "";

const spellings = () => ({
  module: moduleUrlOf(MODULE),
  hook: hookUrlOf(HOOK),
  page: pageUrlOf(PAGE, ENV),
});

describe("three spellings, one URL", () => {
  it("the hook migration exists and is selected by the DDL unique to it", () => {
    expect(hookMigration, "no migration defines custom_access_token_hook").toBeTruthy();
  });

  it("the module, the hook and the page name the same server", () => {
    const s = spellings();
    expect(s.hook, "hook migration vs oauth.ts").toBe(s.module);
    expect(s.page, "src/lib/mcp-test.ts (env-built) vs oauth.ts").toBe(s.module);
  });

  it("the parsed module constant is the value the module exports at runtime", () => {
    expect(moduleUrlOf(MODULE)).toBe(MODULE_URL);
    expect(RESOURCE_METADATA_URL).toBe(`${MODULE_URL}${PRM_PATH}`);
  });

  it("the URL is the shape a user pastes: https, this project's host, the function path, no trailing slash, no query", () => {
    const u = new URL(MODULE_URL);
    expect(u.protocol).toBe("https:");
    expect(PROJECT_ID, "config.toml lost its project_id").not.toBe("");
    expect(u.host).toBe(`${PROJECT_ID}.supabase.co`);
    expect(u.pathname).toBe("/functions/v1/agent-mcp");
    expect(u.search).toBe("");
    expect(u.hash).toBe("");
    expect(MODULE_URL.endsWith("/")).toBe(false);
    expect(MODULE_URL).toBe(u.href);
  });

  it("the hook writes the literal ONCE, into the audience claim, and only when the claims carry a client_id", () => {
    const body = /\$\$([\s\S]*?)\$\$/.exec(HOOK)![1];
    const occurrences = body.split(hookUrlOf(HOOK)).length - 1;
    expect(occurrences).toBe(1);
    expect(body).toMatch(/event->'claims'->>'client_id'/);
    expect(body).toMatch(/'\{aud\}'/);
    // The guard that a bug here can never take out website sign-in.
    expect(body).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RETURN event;/);
  });

  it("the hook is executable by the auth server and by nobody else, revoked by name", () => {
    expect(HOOK).toMatch(/REVOKE ALL ON FUNCTION public\.custom_access_token_hook\(jsonb\)\s+FROM PUBLIC, anon, authenticated;/);
    expect(HOOK).toMatch(/GRANT EXECUTE ON FUNCTION public\.custom_access_token_hook\(jsonb\) TO supabase_auth_admin;/);
    expect(HOOK).not.toMatch(/TO service_role/);
    expect(HOOK).not.toMatch(/TO authenticated/);
    expect(HOOK).not.toMatch(/TO anon/);
    // The migration never enables the hook: that is a dashboard toggle.
    expect(HOOK).not.toMatch(/auth\.config|hook_custom_access_token|ALTER SYSTEM|app\.settings/i);
  });
});

describe("teeth: each parser catches the drift it exists for", () => {
  it("a trailing slash in the module is a mismatch against both others", () => {
    const drifted = MODULE.replace(/export const MCP_URL = "([^"]+)";/, 'export const MCP_URL = "$1/";');
    expect(drifted).not.toBe(MODULE);
    expect(moduleUrlOf(drifted)).not.toBe(hookUrlOf(HOOK));
    expect(moduleUrlOf(drifted)).not.toBe(pageUrlOf(PAGE, ENV));
  });

  it("a hook that binds the audience to some other server is caught", () => {
    const url = hookUrlOf(HOOK);
    const drifted = HOOK.replace(`to_jsonb('${url}'::text)`, `to_jsonb('${url.replace("agent-mcp", "public-api")}'::text)`);
    expect(drifted).not.toBe(HOOK);
    expect(hookUrlOf(drifted)).not.toBe(moduleUrlOf(MODULE));
  });

  it("a page that builds from a different variable, or from a literal, is caught by the parser itself", () => {
    const otherVar = PAGE.replace("${import.meta.env.VITE_SUPABASE_URL}", "${import.meta.env.VITE_MCP_ORIGIN}");
    expect(otherVar).not.toBe(PAGE);
    expect(() => pageUrlOf(otherVar, ENV)).toThrow(/interpolates/);
    const literal = PAGE.replace(/export const MCP_URL = `[^`]+`;/, 'export const MCP_URL = "https://example.test/functions/v1/agent-mcp";');
    expect(literal).not.toBe(PAGE);
    expect(() => pageUrlOf(literal, ENV)).toThrow(/template/);
  });

  it("a page pointed at a different project drifts from the module", () => {
    expect(pageUrlOf(PAGE, { VITE_SUPABASE_URL: "https://otherproject.supabase.co" })).not.toBe(moduleUrlOf(MODULE));
  });

  it("a module whose constant becomes an interpolation is refused by the parser, not silently read as a literal", () => {
    const templated = MODULE.replace(/export const MCP_URL = "[^"]+";/, "export const MCP_URL = `${Deno.env.get(\"SUPABASE_URL\")}/functions/v1/agent-mcp`;");
    expect(templated).not.toBe(MODULE);
    expect(() => moduleUrlOf(templated)).toThrow(/plain string literal/);
  });

  it("the comment stripper hides a URL written in prose from every parser", () => {
    const withProse = `// export const MCP_URL = "https://prose.example/functions/v1/agent-mcp";\n${read("supabase/functions/agent-mcp/oauth.ts")}`;
    expect(moduleUrlOf(stripTs(withProse))).toBe(MODULE_URL);
    const sqlProse = `-- '{aud}', to_jsonb('https://prose.example/functions/v1/agent-mcp'::text)\n${read(`supabase/migrations/${hookMigration}`)}`;
    expect(hookUrlOf(stripSql(sqlProse))).toBe(hookUrlOf(HOOK));
  });
});
