/**
 * THE CONNECTOR PAGE NEVER SAID WHICH SYSTEMS IT WITHHOLDS.
 *
 * Owner decision 4 (2026-10-08): SmartRecruiters postings are withheld from
 * the MCP connector and the paid /v1 API until SmartRecruiters (SAP) grants
 * permission, as the U.S. federal feed is. Both servers refuse them, the
 * data-API page says so, and the connector's own refusals say so; but /agents,
 * the page that sells the connector, the guide resource an agent reads first,
 * and the crawler copy of /data-api named neither system, so a reader learned
 * of the gap only by meeting the refusal.
 *
 * The page is mounted and the list it names is held to both servers' own
 * lists; the guide is read the way an agent reads it in the connector's
 * harness test (the-connector-handed-on-smartrecruiters-...).
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => stubTable(),
    rpc: async () => ({ data: null, error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null, loading: false }), safeNextPath: (s: string) => s }));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit", "in"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
  return th;
}

import { MCP_WITHHELD_SOURCES, MCP_WITHHELD_NOTE } from "../config/mcp-tools";
import AgentConnect from "../pages/AgentConnect";

vi.setConfig({ testTimeout: 30_000 });

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const listIn = (src: string): string[] => {
  const m = /const NO_REDISTRIBUTION_SOURCES = \[([^\]]*)\] as const;/.exec(src);
  expect(m, "NO_REDISTRIBUTION_SOURCES is no longer a literal list").toBeTruthy();
  return [...m![1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1]!);
};

describe("the systems the connector withholds are named where it is sold and where it is read", () => {
  it("the page's list is the connector's and the data API's own", () => {
    expect([...MCP_WITHHELD_SOURCES]).toEqual(listIn(read("supabase/functions/agent-mcp/index.ts")));
    expect([...MCP_WITHHELD_SOURCES]).toEqual(listIn(read("supabase/functions/public-api/index.ts")));
    expect(MCP_WITHHELD_SOURCES).toContain("smartrecruiters");
  });

  it("/agents says it, naming SmartRecruiters and the federal feed", () => {
    render(<HelmetProvider><MemoryRouter initialEntries={["/agents"]}><AgentConnect /></MemoryRouter></HelmetProvider>);
    const note = screen.getByText(MCP_WITHHELD_NOTE);
    expect(note.textContent).toMatch(/SmartRecruiters/);
    expect(note.textContent).toMatch(/federal/);
  });

  it("the crawler copy of /agents and /data-api carries the same sentence", () => {
    const bake = read("scripts/prerender-seo.mjs");
    const agents = bake.slice(bake.indexOf("const envText3 ="), bake.indexOf('path: "/freelance-boost"'));
    expect(agents).toMatch(/\$\{h\(D\.MCP_WITHHELD_NOTE\)\}/);
    const dataApi = bake.slice(bake.indexOf('path: "/data-api"'), bake.indexOf("jsonLd", bake.indexOf('path: "/data-api"')));
    // The /data-api block runs before the /agents block declares h(); it uses the helper-scope esc().
    expect(dataApi).toMatch(/\$\{esc\(D\.MCP_WITHHELD_NOTE\)\}/);
    expect(bake).toMatch(/export \{[^}]*\bMCP_WITHHELD_NOTE\b[^}]*\} from "\.\.\/src\/config\/mcp-tools"/);
  });
});
