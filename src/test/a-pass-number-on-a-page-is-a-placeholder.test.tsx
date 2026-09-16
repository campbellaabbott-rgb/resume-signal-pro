// A PASS NUMBER ON A PAGE IS A PLACEHOLDER — guards 10 and 11 of the pass build.
//
// The pass puts four numbers in front of buyers: a price, a session length,
// an application count and a shelf life. Every one of them lives ONCE, in
// supabase/functions/_shared/pass.ts, and reaches the page through the PASS
// mirror in src/config/products.ts (pinned by pricing-truth.test.ts). The
// copy that names the pass therefore interpolates ({{passPrice}},
// {{passHours}}, …) and never types a digit — in any of the nine locales,
// because a locale value beats an inline English default and a translator
// never sees the constant. This file pins that as a property of the locale
// data (a walk over every pass key in every file), proves it bites on a
// mutated copy, and then checks the BEHAVIOUR the spec demands of the pages
// by rendering them: sign-in before the buy button, no buy control until the
// status endpoint answers, a refusal rendered from the function's own JSON,
// the post-purchase page never minting a key on load, exactly one hand-off
// block per host, and the consent route asking nothing of an empty request.
//
// Guard 11 — the two new routes are private: named on the sitemap-prerender
// parity allowlist, declared in the router, marked noindex, never prerendered.
//
// The homepage — the agent offer strip inside the hero band (src/pages/
// Index.tsx) renders the pass numbers from the same mirror and the free daily
// allowance from MCP_ANON_CAPS; rendered, it must contain those numbers and
// no digit sequence the mirrors did not supply, its comment-stripped source
// must spell none of the pass numbers beside the words pass/hour/application
// (proven on a mutated copy), and the crawler copy in scripts/prerender-seo.mjs
// must be the same en.json sentences filled from the same mirrors.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PASS } from "../config/products";
import { MCP_HOSTS } from "../config/mcp-tools";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
// Line comments first — a line comment holding `/*` (a path glob) would
// otherwise open a block that the block strip runs to the next `*/`.
const strip = (s: string) =>
  s.replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

// ───────────────────────── the locale walk (guard 10) ─────────────────────────

const LOCALE_DIR = resolve(ROOT, "src/i18n/locales");
const LOCALES = readdirSync(LOCALE_DIR).filter((f) => f.endsWith(".json"));
type Doc = Record<string, Record<string, unknown>>;
const docOf = (file: string): Doc => JSON.parse(readFileSync(resolve(LOCALE_DIR, file), "utf8"));
const EN = docOf("en.json");

/** Every key that names the pass: the two pass namespaces, the homepage strip, plus the pricing line. */
const passKeys = (d: Doc): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const ns of ["agentPass", "oauthConsent", "homeAgent"]) {
    for (const [k, v] of Object.entries(d[ns] ?? {})) if (typeof v === "string") out.push([`${ns}.${k}`, v]);
  }
  for (const [k, v] of Object.entries(d.pricingPage ?? {})) {
    if (k.startsWith("pass") && typeof v === "string") out.push([`pricingPage.${k}`, v]);
  }
  return out;
};
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
const withoutPlaceholders = (s: string) => s.replace(/\{\{\w+\}\}/g, "");

/** The offences a pass string can commit, as a pure function so the teeth can call it. */
function offences(locale: string, key: string, value: string, english: string): string[] {
  const out: string[] = [];
  const want = placeholders(english), got = placeholders(value);
  if (want.join(",") !== got.join(",")) out.push(`${locale} ${key}: placeholders ${got.join(",") || "none"} ≠ en ${want.join(",") || "none"}`);
  if (/\d/.test(withoutPlaceholders(value))) out.push(`${locale} ${key}: spells a digit outside a placeholder`);
  // English only, and only because this is an English number-word regex:
  // "six hours", "ten applications", "thirty days" are the spelled-out forms
  // the interpolation exists to prevent. Other languages are covered by the
  // digit rule and the placeholder parity above.
  if (locale.startsWith("en") && /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty)\s+(hours?|applications?|days?|dollars?)\b/i.test(withoutPlaceholders(value))) {
    out.push(`${locale} ${key}: spells a number word before a pass unit`);
  }
  return out;
}

describe("every sentence that names the pass interpolates its numbers, in every locale", () => {
  const enPass = new Map(passKeys(EN));

  it("finds the pass copy (an empty walk would pass everything below vacuously)", () => {
    expect(enPass.size).toBeGreaterThan(20);
    const used = new Set([...enPass.values()].flatMap(placeholders));
    for (const p of ["passPrice", "passHours", "passApplications", "passShelfDays", "holdFirstN", "freeCallsPerDay"]) {
      expect(used.has(p), `no pass string interpolates {{${p}}}`).toBe(true);
    }
    // The homepage namespace is in the walk (an absent namespace would be
    // skipped silently by `?? {}` and the strip would go unguarded).
    expect([...enPass.keys()].filter((k) => k.startsWith("homeAgent.")).length).toBeGreaterThanOrEqual(2);
  });

  for (const file of LOCALES) {
    it(`${file} carries every pass key with English's placeholders and no typed number`, () => {
      const d = docOf(file);
      const keys = new Map(passKeys(d));
      const missing = [...enPass.keys()].filter((k) => !keys.has(k));
      expect(missing, `${file} lacks pass keys`).toEqual([]);
      const found: string[] = [];
      for (const [k, en] of enPass) found.push(...offences(file, k, keys.get(k)!, en));
      expect(found).toEqual([]);
    });
  }

  it("the mirror's own numbers never appear bare in a pass string of any locale", () => {
    // The digit rule above already forbids this; this is the plain-language
    // version of the same property, stated against the real values so a
    // future relaxation of the digit rule still cannot let "29" through.
    const digits = [PASS.priceUsd, PASS.sessionHours, PASS.applications, PASS.shelfLifeDays].map(String);
    for (const file of LOCALES) {
      for (const [k, v] of passKeys(docOf(file))) {
        for (const n of digits) {
          expect(withoutPlaceholders(v), `${file} ${k} spells ${n}`).not.toMatch(new RegExp(`(^|\\D)${n}(\\D|$)`));
        }
      }
    }
  });

  it("teeth: a typed price, a dropped placeholder and a spelled-out count each fail", () => {
    const en = EN.agentPass.cardBody as string;
    expect(offences("en.json", "agentPass.cardBody", en, en)).toEqual([]);
    expect(offences("de.json", "agentPass.cardBody", en.replace("{{passPrice}}", String(PASS.priceUsd)), en).length).toBeGreaterThan(0);
    expect(offences("fr.json", "agentPass.cardBody", en.replace("{{passHours}} hours", "some hours"), en).length).toBeGreaterThan(0);
    expect(offences("en-GB.json", "agentPass.cardBody", en.replace("{{passHours}} hours", "six hours"), en).length).toBeGreaterThan(0);
    // A non-English file is judged by digits and placeholders, not English words.
    expect(offences("hi.json", "agentPass.cardBody", en.replace("{{passHours}} hours", "six hours"), en).length).toBeGreaterThan(0);
  });
});

describe("the 'Agent plan only' sentences on /agents now name the pass", () => {
  const PAGE = strip(read("src/pages/AgentConnect.tsx"));
  const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
  const sentenceWith = (anchor: string) => {
    const i = PAGE.indexOf(anchor);
    expect(i, `anchor "${anchor}" present`).toBeGreaterThanOrEqual(0);
    return PAGE.slice(Math.max(0, i - 400), i + anchor.length + 400);
  };
  it("the meta description", () => {
    const desc = /description=\{`([^`]*)`\}/.exec(PAGE)?.[1] ?? "";
    expect(desc).toMatch(/Agent plan/);
    expect(desc).toMatch(/pass/i);
  });
  it("the hero sentence about asking the apply agent", () => {
    expect(sentenceWith("ask your apply agent")).toMatch(/pass/i);
  });
  it("the apply-tools sentence about what the key alone is not enough for", () => {
    expect(sentenceWith("applying also requires")).toMatch(/live pass/i);
  });
  // The served HTML for /agents is the prerender, not the SPA: a crawler or a
  // curl with a Googlebot UA reads scripts/prerender-seo.mjs's copy. The
  // three sentences it shares with the page must say the same thing (review
  // C-1: the page said "or a live pass" while the bake still said "Agent plan
  // only", on the same push).
  describe("and the prerendered /agents says the same", () => {
    const BAKE = read("scripts/prerender-seo.mjs");
    const block = BAKE.slice(BAKE.indexOf('path: "/agents",'), BAKE.indexOf("</section>", BAKE.indexOf("Two kinds of key", BAKE.indexOf('path: "/agents",'))));
    it("the meta description is the page's, word for word", () => {
      const page = /description=\{`([^`]*)`\}/.exec(PAGE)?.[1] ?? "";
      const bake = /description: `([^`]*)`/.exec(block)?.[1] ?? "";
      expect(page.length).toBeGreaterThan(0);
      expect(bake).toBe(page);
    });
    it("the hero sentence names the pass", () => {
      const i = block.indexOf("ask your apply agent");
      expect(i).toBeGreaterThan(-1);
      expect(block.slice(i - 200, i)).toMatch(/live pass/);
    });
    it("the apply-tools sentence names the pass beside the Agent plan", () => {
      const i = block.indexOf('<a href="/agent">Agent plan</a>');
      expect(i).toBeGreaterThan(-1);
      expect(block.slice(i, i + 160)).toMatch(/live pass/);
    });
  });

  it("the page renders the pass card beside the mint, from the mirror", () => {
    expect(PAGE).toMatch(/<PassCard \/>/);
    expect(PAGE).toMatch(/from "@\/config\/products"/);
    expect(PAGE).toMatch(/passPrice: PASS\.priceUsd/);
    expect(PAGE).toMatch(/passHours: PASS\.sessionHours/);
    expect(PAGE).toMatch(/passApplications: PASS\.applications/);
    expect(PAGE).toMatch(/passShelfDays: PASS\.shelfLifeDays/);
  });
  it("the host table carries the oauth flag and the page reads it", () => {
    for (const h of MCP_HOSTS) expect(typeof h.oauth, `${h.name} has no oauth flag`).toBe("boolean");
    expect(PAGE).toMatch(/h\.oauth/);
  });
  it("a host claims sign-in only when the server answers the handshake: the flag agrees with the dispatcher", () => {
    // The flag was false on every host until the integration lane wired the
    // OAuth module; now it is true exactly for the connector hosts, and the
    // claim is honest only while the dispatcher imports the module's
    // challenge and serves its metadata — read off the comment-stripped
    // server, so a page cannot promise a sign-in the server stopped
    // answering.
    const serverAnswers = /import \{[^}]*\bunauthorized\b[^}]*\} from "\.\/oauth\.ts"/.test(MCP) && /protectedResourceResponse\(cors\)/.test(MCP);
    for (const h of MCP_HOSTS.filter((x) => !x.header)) {
      expect(h.oauth, `${h.name} claims OAuth but the server answers no challenge`).toBe(serverAnswers);
    }
    // The key hosts stay on the key: their primary path is the header, and a
    // page that sent a Claude Code or Cursor user through a browser sign-in
    // when a pasted key already works would be the slower path dressed up.
    for (const h of MCP_HOSTS.filter((x) => x.header)) expect(h.oauth, `${h.name} carries the key; sign-in is not its path`).toBe(false);
    // A host marked for sign-in says so in its own note.
    for (const h of MCP_HOSTS.filter((x) => x.oauth)) expect(h.how, `${h.name} is marked oauth but its note never mentions signing in`).toMatch(/sign in|OAuth|Allow/i);
  });
});

// ───────────────────────── the routes are private (guard 11) ──────────────────

describe("the pass page and the consent route are private routes", () => {
  const ROUTES = ["/agents/pass", "/oauth/consent"];
  it("both are declared in the router", () => {
    const app = strip(read("src/App.tsx"));
    for (const r of ROUTES) expect(app).toMatch(new RegExp(`<Route path="${r}"`));
  });
  it("both are on the sitemap-prerender parity allowlist with a reason", () => {
    const src = read("src/test/sitemap-prerender-parity.test.ts");
    const list = /const PRIVATE_ROUTES = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
    for (const r of ROUTES) {
      expect(list, `${r} not in PRIVATE_ROUTES`).toContain(`"${r}"`);
      // The reason sits in a comment directly above the entry.
      const before = list.slice(0, list.indexOf(`"${r}"`));
      expect(before.trimEnd().split("\n").slice(-2).join("\n"), `${r} has no reason above it`).toMatch(/\/\//);
    }
  });
  it("both pages mark themselves noindex and neither is prerendered", () => {
    for (const f of ["src/pages/AgentPass.tsx", "src/pages/OAuthConsent.tsx"]) {
      const page = strip(read(f));
      expect(page, `${f} must render <SEO … noIndex>`).toMatch(/<SEO[\s\S]*?noIndex[\s\S]*?\/>/);
    }
    const prerender = strip(read("scripts/prerender-seo.mjs"));
    for (const r of ROUTES) expect(prerender, `${r} has a prerender write`).not.toMatch(new RegExp(`path:\\s*"${r}"`));
  });
  it("the sign-in return honours only same-origin relative paths", async () => {
    const { safeNextPath, DEFAULT_AFTER_AUTH } = await vi.importActual<typeof import("../contexts/AuthContext")>("../contexts/AuthContext");
    for (const ok of ["/agents/pass?session_id=cs_x", "/oauth/consent?authorization_id=abc", "/agents?buy=pass"]) {
      expect(safeNextPath(ok)).toBe(ok);
    }
    for (const bad of [null, undefined, "", "https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/a b", "/x:y"]) {
      expect(safeNextPath(bad), `${bad} must fall back`).toBe(DEFAULT_AFTER_AUTH);
    }
  });
});

// ───────────────────────── behaviour, rendered ────────────────────────────────

// vi.mock factories are hoisted, so everything they close over is hoisted
// with them via vi.hoisted.
const { invoke, auth, oauthApi } = vi.hoisted(() => ({
  invoke: vi.fn(),
  auth: { session: null as null | { user: { id: string; email: string } }, loading: false },
  oauthApi: { getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: auth.session, user: auth.session?.user ?? null, loading: auth.loading }),
  safeNextPath: (s: string) => s,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    auth: { oauth: oauthApi },
    // The homepage's stat readers (scan totals, scan insights) go through
    // rpc; they answer nothing here and the strip must not need them.
    rpc: async () => ({ data: null, error: null }),
  },
}));
function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "eq", "is", "not", "order", "limit"]) th[k] = self;
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(ok);
  return th;
}

import { PassCard } from "../pages/AgentConnect";
import AgentPass from "../pages/AgentPass";
import OAuthConsent from "../pages/OAuthConsent";
import Index, { AgentOfferStrip } from "../pages/Index";
import { MCP_ANON_CAPS } from "../config/mcp-tools";

const USER = { id: "u1", email: "buyer@example.com" };
const mount = (node: React.ReactNode, at = "/agents") =>
  render(<HelmetProvider><MemoryRouter initialEntries={[at]}>{node}</MemoryRouter></HelmetProvider>);
const calls = (fn: string) => invoke.mock.calls.filter((c) => c[0] === fn);
const openRow = (state: "unactivated" | "live", left: number) => ({
  state, purchasedAt: "2026-09-16T10:00:00Z", shelfExpiresAt: "2026-10-16T10:00:00Z",
  activatedAt: state === "live" ? "2026-09-16T11:00:00Z" : null,
  expiresAt: state === "live" ? new Date(Date.now() + 3 * 3_600_000).toISOString() : null,
  sessionHours: PASS.sessionHours, applicationsTotal: PASS.applications,
  applicationsUsed: PASS.applications - left, applicationsLeft: left, activatedVia: null,
});

describe("the pass card on /agents", () => {
  beforeEach(() => { invoke.mockReset(); auth.session = null; auth.loading = false; });

  it("signed out: a sign-in link that comes back to buy, and no function call at all", () => {
    mount(<PassCard />);
    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link.getAttribute("href")).toBe(`/auth?next=${encodeURIComponent("/agents?buy=pass")}`);
    expect(invoke).not.toHaveBeenCalled();
    // The card states the mirror's numbers, and states them from the mirror.
    expect(screen.getByText(new RegExp(`\\$${PASS.priceUsd}\\b`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${PASS.sessionHours} hours`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${PASS.applications} applications`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${PASS.shelfLifeDays} days`))).toBeInTheDocument();
  });

  it("signed in but the status endpoint fails: no buy control, so nothing can 404 after a click", async () => {
    auth.session = { user: USER };
    invoke.mockResolvedValue({ data: null, error: new Error("404") });
    mount(<PassCard />);
    await waitFor(() => expect(calls("agent-pass-status").length).toBe(1));
    expect(screen.queryByRole("button", { name: /buy/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /open it/i })).toBeNull();
    expect(calls("create-pass-checkout").length).toBe(0);
  });

  it("signed in with nothing open: the buy button calls create-pass-checkout, and a refusal is shown from the function's own JSON", async () => {
    auth.session = { user: USER };
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "agent-pass-status") return { data: { pass: { state: "none" }, key: { live: false } }, error: null };
      if (fn === "create-pass-checkout") return { data: { alreadySubscribed: true, error: "Your Agent plan already includes applications — from the function" }, error: null };
      return { data: null, error: null };
    });
    mount(<PassCard />);
    const btn = await screen.findByRole("button", { name: new RegExp(`buy.*\\$${PASS.priceUsd}`, "i") });
    fireEvent.click(btn);
    await waitFor(() => expect(calls("create-pass-checkout").length).toBe(1));
    expect(await screen.findByText(/from the function/)).toBeInTheDocument();
  });

  it("signed in with a pass open: links to the pass page instead of selling a second one", async () => {
    auth.session = { user: USER };
    invoke.mockResolvedValue({ data: { pass: openRow("live", 7), key: { live: true, prefix: "rb_live_ab", createdAt: "2026-09-01T00:00:00Z" } }, error: null });
    mount(<PassCard />);
    const link = await screen.findByRole("link", { name: /open it/i });
    expect(link.getAttribute("href")).toBe("/agents/pass");
    expect(screen.queryByRole("button", { name: /buy/i })).toBeNull();
  });

  it("returning from sign-in with ?buy=pass fires the checkout once, only after the status answers", async () => {
    auth.session = { user: USER };
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "agent-pass-status") return { data: { pass: { state: "none" }, key: { live: false } }, error: null };
      if (fn === "create-pass-checkout") return { data: { error: "refused for the test" }, error: null };
      return { data: null, error: null };
    });
    mount(<PassCard />, "/agents?buy=pass");
    await waitFor(() => expect(calls("create-pass-checkout").length).toBe(1));
    await screen.findByText(/refused for the test/);
    expect(calls("create-pass-checkout").length).toBe(1);
  });
});

describe("the post-purchase page /agents/pass", () => {
  beforeEach(() => { invoke.mockReset(); auth.session = { user: USER }; auth.loading = false; try { localStorage.clear(); } catch { /* blocked */ } });

  it("reads the pass with the session id, never mints a key on load, and shows the row's numbers with one hand-off block", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "agent-pass-status") return { data: { pass: openRow("unactivated", PASS.applications), key: { live: false } }, error: null };
      return { data: null, error: null };
    });
    mount(<AgentPass />, "/agents/pass?session_id=cs_test_123");
    await screen.findByText(/Not started/);
    expect(calls("agent-pass-status")[0][1]).toEqual({ body: { session_id: "cs_test_123" } });
    expect(calls("agent-connect").length, "the page must never mint a key on load").toBe(0);
    expect(screen.getByText(`${PASS.applications} of ${PASS.applications} applications`)).toBeInTheDocument();
    // Exactly one copy block for the chosen host.
    expect(document.querySelectorAll("pre").length).toBe(1);
    // The mint button is offered, not pressed.
    expect(screen.getByRole("button", { name: /mint agent key/i })).toBeInTheDocument();
    expect(calls("agent-connect").length).toBe(0);
  });

  it("a live key already carries the pass: says so, offers a deliberate re-mint, still mints nothing", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "agent-pass-status") return { data: { pass: openRow("live", 4), key: { live: true, prefix: "rb_live_ab", createdAt: "2026-09-01T00:00:00Z" } }, error: null };
      return { data: null, error: null };
    });
    mount(<AgentPass />, "/agents/pass");
    await screen.findByText(/already carries the pass/);
    expect(screen.getByText(`4 of ${PASS.applications} applications`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mint agent key/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /mint a new one/i }));
    expect(screen.getByRole("button", { name: /mint agent key/i })).toBeInTheDocument();
    expect(calls("agent-connect").length).toBe(0);
  });

  it("switching host swaps the single block and is remembered", async () => {
    invoke.mockImplementation(async (fn: string) => {
      if (fn === "agent-pass-status") return { data: { pass: openRow("unactivated", PASS.applications), key: { live: false } }, error: null };
      return { data: null, error: null };
    });
    mount(<AgentPass />, "/agents/pass");
    await screen.findByText(/Not started/);
    const cursor = MCP_HOSTS.find((h) => h.handoff === "cursor")!;
    fireEvent.click(screen.getByRole("tab", { name: cursor.name }));
    expect(document.querySelectorAll("pre").length).toBe(1);
    expect(document.querySelector("pre")!.textContent).toMatch(/mcpServers/);
    expect(localStorage.getItem("rb_pass_host")).toBe(cursor.name);
    // A connector host renders the line its oauth flag earns: sign-in when
    // the server answers the handshake, otherwise today's unkeyed-only truth.
    const connector = MCP_HOSTS.find((h) => h.handoff === "connector")!;
    fireEvent.click(screen.getByRole("tab", { name: connector.name }));
    if (connector.oauth) {
      expect(screen.getByText(/Sign in when needed/)).toBeInTheDocument();
      expect(screen.queryByText(/only the unkeyed tools answer/)).toBeNull();
    } else {
      expect(screen.getByText(/only the unkeyed tools answer/)).toBeInTheDocument();
      expect(screen.queryByText(/Sign in when needed/)).toBeNull();
    }
  });

  it("with no pass: offers a purchase and no hand-off block", async () => {
    invoke.mockResolvedValue({ data: { pass: { state: "none" }, key: { live: false } }, error: null });
    mount(<AgentPass />, "/agents/pass");
    await screen.findByText(/No pass on this account yet/);
    expect(screen.getByRole("button", { name: /buy a pass/i })).toBeInTheDocument();
    expect(document.querySelectorAll("pre").length).toBe(0);
    expect(calls("create-pass-checkout").length).toBe(0);
  });
});

describe("the consent route /oauth/consent", () => {
  beforeEach(() => { invoke.mockReset(); oauthApi.getAuthorizationDetails.mockReset(); auth.session = { user: USER }; auth.loading = false; });

  it("with no authorization request asks nothing of the auth server", async () => {
    invoke.mockResolvedValue({ data: { pass: { state: "none" }, key: { live: false } }, error: null });
    mount(<OAuthConsent />, "/oauth/consent");
    await screen.findByText(/needs an authorization request/);
    expect(oauthApi.getAuthorizationDetails).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /allow/i })).toBeNull();
  });

  it("renders the client, the scopes and the pass strip, and Allow goes through the SDK's consent API", async () => {
    invoke.mockResolvedValue({ data: { pass: openRow("unactivated", PASS.applications), key: { live: true, prefix: "rb_live_ab", createdAt: null } }, error: null });
    oauthApi.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: "Claude", uri: "https://claude.ai" }, scope: "email" }, error: null });
    oauthApi.approveAuthorization.mockResolvedValue({ data: { redirect_url: "https://claude.ai/callback?code=x" }, error: null });
    mount(<OAuthConsent />, "/oauth/consent?authorization_id=auth_1");
    await screen.findByText(/Claude is asking/);
    expect(screen.getByText(/It will see: email/)).toBeInTheDocument();
    expect(screen.getByText(/return to claude\.ai/)).toBeInTheDocument();
    // Consent is never gated on purchase: the strip informs, Allow is enabled.
    expect(await screen.findByText(new RegExp(`Pass not started · ${PASS.applications} applications`))).toBeInTheDocument();
    const allow = screen.getByRole("button", { name: /allow/i });
    expect(allow).not.toBeDisabled();
    fireEvent.click(allow);
    await waitFor(() => expect(oauthApi.approveAuthorization).toHaveBeenCalledWith("auth_1", { skipBrowserRedirect: true }));
  });
});

// ───────────────────────── the homepage strip ─────────────────────────────────

/**
 * The offences a page source can commit, as a pure function so the teeth can
 * feed it a mutated copy: any of the pass numbers (read off the mirror, never
 * spelled here) within one line of the words pass / hour / application, in
 * either order, with or without a currency sign. Comment-stripped first — a
 * comment explaining the rule must not fail it.
 */
function spelledPassNumbers(code: string): string[] {
  const nums = [PASS.priceUsd, PASS.sessionHours, PASS.applications].map(String).join("|");
  const unit = "(?:pass(?:es)?|hours?|applications?)";
  const re = new RegExp(`(?:\\$\\s*)?\\b(?:${nums})\\b[^\\n]{0,40}?\\b${unit}\\b|\\b${unit}\\b[^\\n]{0,40}?(?:\\$\\s*)?\\b(?:${nums})\\b`, "gi");
  return strip(code).match(re) ?? [];
}

describe("the agent offer on the homepage", () => {
  const INDEX_RAW = read("src/pages/Index.tsx");
  const allowed = new Set([PASS.priceUsd, PASS.sessionHours, PASS.applications, MCP_ANON_CAPS.perAddressPerDay].map(String));
  const digitRuns = (s: string) => s.match(/\d+/g) ?? [];

  beforeEach(() => {
    invoke.mockReset();
    // The page's live reads (board status, totals) answer nothing; the strip
    // must stand without them, from the mirrors alone.
    invoke.mockResolvedValue({ data: null, error: null });
    auth.session = null; auth.loading = false;
  });

  it("mounts the whole homepage and renders the strip inside the hero band, every number from a mirror", () => {
    mount(<Index />, "/");
    const hero = document.querySelector('section[aria-labelledby="home-hero-heading"]');
    expect(hero, "the fused hero is on the page").not.toBeNull();
    const el = hero!.querySelector("[data-agent-offer]");
    expect(el, "the strip is INSIDE the hero band, not a second hero").not.toBeNull();
    const text = el!.textContent ?? "";
    expect(text).toContain(`$${PASS.priceUsd}`);
    expect(text).toContain(`${PASS.sessionHours} hours`);
    expect(text).toContain(`${PASS.applications} jobs`);
    expect(text).toContain(`${MCP_ANON_CAPS.perAddressPerDay} calls a day`);
    const stray = digitRuns(text).filter((n) => !allowed.has(n));
    expect(stray, "a digit the mirrors did not supply").toEqual([]);
    // The strip is one strip: it lives under the hero's single h1 and adds
    // no heading and no second primary-weight button of its own.
    expect(el!.querySelector("h1, h2, h3")).toBeNull();
    expect(el!.querySelector("button")).toBeNull();
    expect(document.querySelectorAll("h1").length).toBe(1);
  });

  it("names sign-in as the condition for the pass, never for connecting, and links to /agents for everyone", () => {
    mount(<AgentOfferStrip />, "/");
    const el = document.querySelector("[data-agent-offer]")!;
    const [connect, pass] = Array.from(el.querySelectorAll("p")).map((p) => p.textContent ?? "");
    expect(connect).toMatch(/no account/i);
    expect(connect).not.toMatch(/sign in/i);
    expect(pass).toMatch(/sign in/i);
    expect(pass).toMatch(/never renews/i);
    expect(screen.getByRole("link", { name: /connect your agent/i }).getAttribute("href")).toBe("/agents");
    expect(screen.queryByRole("link", { name: /pass/i }), "no pass-page link while signed out").toBeNull();
  });

  it("signed in, adds one link to the pass page and no checkout call", () => {
    auth.session = { user: USER };
    mount(<AgentOfferStrip />, "/");
    expect(screen.getByRole("link", { name: /pass/i }).getAttribute("href")).toBe("/agents/pass");
    expect(screen.getByRole("link", { name: /connect your agent/i }).getAttribute("href")).toBe("/agents");
    expect(calls("create-pass-checkout").length).toBe(0);
    expect(calls("agent-pass-status").length, "the homepage never asks the status endpoint").toBe(0);
  });

  it("Index.tsx renders the strip from the mirrors and spells none of the pass numbers beside pass/hour/application", () => {
    const code = strip(INDEX_RAW);
    expect(code).toMatch(/from "@\/config\/products"/);
    expect(code).toMatch(/from "@\/config\/mcp-tools"/);
    expect(code).toMatch(/passPrice: PASS\.priceUsd/);
    expect(code).toMatch(/passHours: PASS\.sessionHours/);
    expect(code).toMatch(/passApplications: PASS\.applications/);
    expect(code).toMatch(/freeCallsPerDay: MCP_ANON_CAPS\.perAddressPerDay/);
    expect(code).toMatch(/<HomeHero agentOffer=\{<AgentOfferStrip \/>\} \/>/);
    // Not vacuous: the placeholders are there to be replaced.
    for (const p of ["{{passPrice}}", "{{passHours}}", "{{passApplications}}", "{{freeCallsPerDay}}"]) expect(code).toContain(p);
    expect(spelledPassNumbers(INDEX_RAW)).toEqual([]);
  });

  it("teeth: a copy of Index.tsx with the price, the hours or the applications spelled fails", () => {
    const priced = INDEX_RAW.replace("${{passPrice}}", `$${PASS.priceUsd}`);
    expect(priced).not.toBe(INDEX_RAW);
    expect(spelledPassNumbers(priced).length).toBeGreaterThan(0);
    const houred = INDEX_RAW.replace("{{passHours}} hours", `${PASS.sessionHours} hours`);
    expect(houred).not.toBe(INDEX_RAW);
    expect(spelledPassNumbers(houred).length).toBeGreaterThan(0);
    const applied = INDEX_RAW.replace("apply to {{passApplications}} jobs", `apply to ${PASS.applications} jobs — that is ${PASS.applications} applications`);
    expect(applied).not.toBe(INDEX_RAW);
    expect(spelledPassNumbers(applied).length).toBeGreaterThan(0);
    // And a spelling inside a comment alone does NOT fail it — the rule is
    // about what renders, and a comment is where the reasoning lives.
    const commented = INDEX_RAW.replace("export function AgentOfferStrip()", `/* the pass costs $${PASS.priceUsd} */\nexport function AgentOfferStrip()`);
    expect(commented).not.toBe(INDEX_RAW);
    expect(spelledPassNumbers(commented)).toEqual([]);
  });

  describe("and the crawler copy for / says the same, from the same mirrors", () => {
    const BAKE = read("scripts/prerender-seo.mjs");
    // The block the script evaluates, run here against the real en.json and
    // the real mirrors — so what a Googlebot-UA curl of / carries is proven,
    // not inferred from a regex over template text.
    const offer = (() => {
      const start = BAKE.indexOf("const AGENT_OFFER = (() => {");
      expect(start).toBeGreaterThan(-1);
      const end = BAKE.indexOf("})();", start) + "})();".length;
      const D = { EN_LOCALE: EN, PASS, MCP_ANON_CAPS };
      return new Function("D", `${BAKE.slice(start, end)}; return AGENT_OFFER;`)(D) as { lead: string; connect: string; pass: string; cta: string };
    })();
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(({ passPrice: PASS.priceUsd, passHours: PASS.sessionHours, passApplications: PASS.applications, freeCallsPerDay: MCP_ANON_CAPS.perAddressPerDay } as Record<string, number>)[k]));
    const homeAgent = EN.homeAgent as Record<string, string>;

    it("the bundle entry exports the PASS mirror", () => {
      expect(BAKE).toMatch(/export \{[^}]*\bPASS\b[^}]*\} from "\.\.\/src\/config\/products"/);
    });
    it("the sentences are en.json's homeAgent lines with the mirrors filled in", () => {
      expect(offer.connect).toBe(fill(homeAgent.connectLine));
      expect(offer.pass).toBe(fill(homeAgent.passLine));
      expect(offer.lead).toBe(homeAgent.lead);
      expect(offer.pass).toContain(`$${PASS.priceUsd}`);
      expect(offer.pass).toContain(`${PASS.sessionHours} hours`);
      expect(offer.pass).toContain(`${PASS.applications} jobs`);
      expect(offer.connect).toContain(`${MCP_ANON_CAPS.perAddressPerDay} calls a day`);
      expect(offer.connect).toMatch(/no account/i);
      expect(offer.pass).toMatch(/sign in/i);
    });
    it("a placeholder with no mirror throws instead of baking a raw brace", () => {
      const start = BAKE.indexOf("const AGENT_OFFER = (() => {");
      const end = BAKE.indexOf("})();", start) + "})();".length;
      const D = { EN_LOCALE: { homeAgent: { ...homeAgent, passLine: "{{passSomethingElse}} hours" } }, PASS, MCP_ANON_CAPS };
      expect(() => new Function("D", `${BAKE.slice(start, end)}; return AGENT_OFFER;`)(D)).toThrow(/no mirror/);
    });
    it("the homepage block and the llms-full MCP line both emit them", () => {
      const home = BAKE.slice(BAKE.indexOf('path: "/",'), BAKE.indexOf('path: "/cv-standards"'));
      expect(home).toContain("${esc(AGENT_OFFER.connect)}");
      expect(home).toContain("${esc(AGENT_OFFER.pass)}");
      expect(home).toContain('<a href="/agents"');
      const llms = BAKE.slice(BAKE.indexOf('lines.push("## Free tools");'), BAKE.indexOf('writeFileSync(join(dist, "llms-full.txt")'));
      expect(llms).toContain("${AGENT_OFFER.connect} ${AGENT_OFFER.pass}");
    });
    it("no crawler sentence spells a pass number of its own", () => {
      // The template must interpolate; a typed price beside the pass in the
      // homepage block would be a second spelling the mirror cannot move.
      const home = BAKE.slice(BAKE.indexOf('path: "/",'), BAKE.indexOf('path: "/cv-standards"'));
      expect(spelledPassNumbers(home)).toEqual([]);
    });
  });
});
