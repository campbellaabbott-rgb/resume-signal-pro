/**
 * THE TWO ADDRESSES A MACHINE NEEDS, SPELLED ONCE (SEO-014, SEO-015).
 *
 * No crawler-readable page named the data API's host, and neither llms file
 * named the MCP server's address: /data-api printed "/v1" and nothing in front
 * of it, so an answer engine could tell a person the API existed and not where.
 * The React page builds the API base from VITE_SUPABASE_URL
 * (src/pages/DataApi.tsx); the bake builds both from the same variable through
 * these functions, so the page, both llms files and the bake's /agents and
 * /data-api pages print one address each.
 *
 * The project address is public (it is in every served page that talks to the
 * board) and fixed for the life of the project; it is the fallback for a build
 * that has no environment, so an llms file is never written without the
 * address it exists to give.
 */
export const SUPABASE_PROJECT_URL = "https://bwhdazbotpblihdxcmho.supabase.co";
export const PUBLIC_API_PATH = "/functions/v1/public-api";
export const MCP_SERVER_PATH = "/functions/v1/agent-mcp";

const base = (supabaseUrl?: string | null): string => String(supabaseUrl || SUPABASE_PROJECT_URL).trim().replace(/\/+$/, "");

/** The data API's base: requests go to `${publicApiBase()}/v1/jobs`. */
export const publicApiBase = (supabaseUrl?: string | null): string => `${base(supabaseUrl)}${PUBLIC_API_PATH}`;

/** The MCP server's address (Streamable HTTP). */
export const mcpServerUrl = (supabaseUrl?: string | null): string => `${base(supabaseUrl)}${MCP_SERVER_PATH}`;
