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
//
// 2026-10-11, THE APPLY PIVOT (owner decision): the Agent Pass, the Agent
// plan and the Apply Assistant are retired and the server-side apply agent is
// switched off. The pass is sold nowhere now, so the guards that pinned HOW
// it was sold become guards that it is NOT: the homepage strip, /pricing and
// /agents name no pass number and no plan as on offer, /agents renders no
// pass card in any auth state, /agents/pass is a retirement notice that reads
// and mints nothing, and the locale walk still holds every remaining pass
// string (the consent screen's strip for a past buyer) to placeholders. The
// crawler bakes are owned elsewhere; where they still sell the pass, the
// divergence is DECLARED below and expires on its own.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PASS } from "../config/products";
import { MCP_HOSTS, claudeInstallLink } from "../config/mcp-tools";

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

  it("finds the pass copy that remains, and the homepage and pricing strings name no pass number", () => {
    // Not vacuous: the consent screen's pass strip, the retirement notice,
    // the homepage strip and the pricing line are all in the walk.
    expect(enPass.size).toBeGreaterThan(20);
    const used = new Set([...enPass.values()].flatMap(placeholders));
    expect(used.has("left"), "the consent screen's pass strip still interpolates what is left").toBe(true);
    for (const ns of ["homeAgent.", "pricingPage.", "agentPass."]) {
      expect([...enPass.keys()].filter((k) => k.startsWith(ns)).length, `${ns} is in the walk`).toBeGreaterThanOrEqual(2);
    }
    // The apply pivot: nothing on the homepage, on /pricing or on the
    // retirement notice interpolates a pass number, because no pass is sold.
    for (const [k, v] of enPass) {
      if (/^(homeAgent|pricingPage|agentPass)\./.test(k)) expect(placeholders(v).filter((x) => /^pass/.test(x)), `${k} still prices a pass`).toEqual([]);
    }
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
    // The retired card's sentence, kept here as the fixture the rule is proven on.
    const en = "{{passHours}} hours with your agent, {{passApplications}} applications, ${{passPrice}}. Never renews.";
    expect(offences("en.json", "agentPass.cardBody", en, en)).toEqual([]);
    expect(offences("de.json", "agentPass.cardBody", en.replace("{{passPrice}}", String(PASS.priceUsd)), en).length).toBeGreaterThan(0);
    expect(offences("fr.json", "agentPass.cardBody", en.replace("{{passHours}} hours", "some hours"), en).length).toBeGreaterThan(0);
    expect(offences("en-GB.json", "agentPass.cardBody", en.replace("{{passHours}} hours", "six hours"), en).length).toBeGreaterThan(0);
    // A non-English file is judged by digits and placeholders, not English words.
    expect(offences("hi.json", "agentPass.cardBody", en.replace("{{passHours}} hours", "six hours"), en).length).toBeGreaterThan(0);
  });
});

describe("the /agents page names no pass and no plan as on offer", () => {
  const PAGE = strip(read("src/pages/AgentConnect.tsx"));
  const MCP = strip(read("supabase/functions/agent-mcp/index.ts"));
  it("the meta description sells nothing", () => {
    const desc = /description=\{`([^`]*)`\}/.exec(PAGE)?.[1] ?? "";
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).not.toMatch(/Agent plan|\bpass\b|\$\d/i);
    expect(desc).toMatch(/apply yourself/);
  });
  it("no sentence asks an apply agent or says what applying requires on our side", () => {
    expect(PAGE).not.toMatch(/ask your apply agent|applying also requires/);
  });
  // The served HTML for /agents is the prerender (scripts/prerender-seo.mjs),
  // which the profiles and design branches own; this wave may not change it.
  // Until its owner bakes the new copy, the divergence is DECLARED here and
  // checked to still be real, so the flag cannot outlive its reason: the day
  // the bake says what the page says, this fails until the flag is cleared,
  // and the word-for-word check returns.
  describe("and the prerendered /agents", () => {
    const BAKE_STILL_SELLS_THE_PASS = true;
    const BAKE = read("scripts/prerender-seo.mjs");
    const block = BAKE.slice(BAKE.indexOf('path: "/agents",'), BAKE.indexOf("</section>", BAKE.indexOf("Two kinds of key", BAKE.indexOf('path: "/agents",'))));
    it("the meta description is the page's, word for word — or the bake's pass-selling divergence is declared and still real", () => {
      const page = /description=\{`([^`]*)`\}/.exec(PAGE)?.[1] ?? "";
      const bake = /description: `([^`]*)`/.exec(block)?.[1] ?? "";
      expect(page.length).toBeGreaterThan(0);
      expect(bake.length).toBeGreaterThan(0);
      if (BAKE_STILL_SELLS_THE_PASS) {
        expect(bake, "the bake no longer differs: clear BAKE_STILL_SELLS_THE_PASS so the word-for-word check returns").not.toBe(page);
        expect(bake, "the declared reason (the bake sells the pass) is gone: clear the flag").toMatch(/pass/i);
      } else {
        expect(bake).toBe(page);
        expect(block).not.toMatch(/\bAgent Pass\b|live pass/);
      }
    });
  });

  it("the page renders no pass card and reads no pass mirror", () => {
    expect(PAGE).not.toMatch(/<PassCard\b/);
    expect(PAGE).not.toMatch(/from "@\/config\/products"/);
    expect(PAGE).not.toMatch(/\bPASS\./);
  });
  it("the host table carries the oauth flag and the page reads it — and no rendered sentence branches on the flag alone", () => {
    for (const h of MCP_HOSTS) expect(typeof h.oauth, `${h.name} has no oauth flag`).toBe("boolean");
    expect(PAGE).toMatch(/h\.oauth/);
    // Every sign-in sentence is a function of the server's runtime state.
    for (const h of MCP_HOSTS) {
      const on = h.signIn("on"), off = h.signIn("off"), unknown = h.signIn("unknown");
      expect(on, `${h.name} on`).not.toBe(off);
      expect(unknown, `${h.name} unknown`).not.toBe(on);
      expect(off, `${h.name} off names sign-in as off`).toMatch(/not switched on|sign-in is off/i);
    }
    // The host panel's sign-in line reads the server's fact, not the flag.
    expect(PAGE).toMatch(/host\.signIn\(fact\.state\)/);
    expect(PAGE).not.toMatch(/host\.oauth\s*\?/);
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

import AgentConnect, { MCP_URL } from "../pages/AgentConnect";
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

describe("/agents sells nothing in any auth state", () => {
  beforeEach(() => { invoke.mockReset(); auth.session = null; auth.loading = false; });
  const PASS_ROW = { data: { pass: openRow("live", 3), key: { live: true, prefix: "rb_live_ab", createdAt: null } }, error: null };

  for (const signedIn of [false, true]) {
    it(`${signedIn ? "signed in, holding a pass from before the retirement" : "signed out"}: no buy control, no price, no pass call`, async () => {
      auth.session = signedIn ? { user: USER } : null;
      invoke.mockImplementation(async (fn: string) => (fn === "agent-pass-status" ? PASS_ROW : { data: null, error: null }));
      mount(<AgentConnect />, "/agents?buy=pass");
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByRole("button", { name: /buy|pass/i })).toBeNull();
      expect(screen.queryByRole("link", { name: /buy|sign in to buy|your pass/i })).toBeNull();
      expect(calls("agent-pass-status").length, "the page asks the pass endpoint").toBe(0);
      expect(calls("create-pass-checkout").length).toBe(0);
      expect(document.body.textContent ?? "").not.toContain(`$${PASS.priceUsd}`);
      // A past buyer is pointed at the notice, never at a purchase.
      expect(screen.getByRole("link", { name: /bought a pass or a plan/i }).getAttribute("href")).toBe("/agents/pass");
    });
  }
});

describe("the old post-purchase address /agents/pass is a retirement notice", () => {
  beforeEach(() => { invoke.mockReset(); auth.session = { user: USER }; auth.loading = false; });

  it("arriving from an old Stripe receipt: reads nothing, mints nothing, hands nothing to an agent, and says what changed", async () => {
    invoke.mockResolvedValue({ data: { pass: openRow("unactivated", PASS.applications), key: { live: false } }, error: null });
    mount(<AgentPass />, "/agents/pass?session_id=cs_test_123");
    await screen.findByRole("heading", { level: 1, name: EN.agentPass.retiredPageTitle as string });
    expect(invoke).not.toHaveBeenCalled();
    expect(document.querySelectorAll("pre").length, "a hand-off block").toBe(0);
    expect(document.querySelector("main")!.querySelector("button"), "a control on the notice").toBeNull();
    const buyers = document.querySelector("[data-pass-buyers]")!;
    expect(buyers.querySelector("a")!.getAttribute("href")).toBe("mailto:resumeboostersupp@gmail.com");
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
    // The client's self-declared homepage is never named as where access goes
    // (S8-081); with no pending redirect in the details, no host is named.
    expect(screen.queryByText(/claude\.ai/)).toBeNull();
    expect(screen.getByText(/does not say where access will go/)).toBeInTheDocument();
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

describe("the connect-your-AI strip on the homepage", () => {
  const INDEX_RAW = read("src/pages/Index.tsx");

  beforeEach(() => {
    invoke.mockReset();
    // The page's live reads (board status, totals) answer nothing; the strip
    // must stand without them.
    invoke.mockResolvedValue({ data: null, error: null });
    auth.session = null; auth.loading = false;
  });

  it("mounts the whole homepage and renders the strip inside the hero band, with no number and no price", () => {
    mount(<Index />, "/");
    const hero = document.querySelector('section[aria-labelledby="home-hero-heading"]');
    expect(hero, "the fused hero is on the page").not.toBeNull();
    const el = hero!.querySelector("[data-agent-offer]");
    expect(el, "the strip is INSIDE the hero band, not a second hero").not.toBeNull();
    const text = el!.textContent ?? "";
    // Count-free on purpose: the allowance's figures move with an owner
    // decision, and no pass is sold.
    expect(text).not.toMatch(/\d/);
    expect(text).toMatch(/no account/i);
    expect(text).toMatch(/never submits an application for you/);
    expect(el!.querySelector("h1, h2, h3")).toBeNull();
    expect(el!.querySelector("button")).toBeNull();
    expect(document.querySelectorAll("h1").length).toBe(1);
    // The hero itself claims no submissions either.
    expect(hero!.textContent ?? "").not.toMatch(/applies for you|can submit for you|submits where/i);
  });

  for (const signedIn of [false, true]) {
    it(`${signedIn ? "signed in" : "signed out"}: links /agents, offers no pass page, and calls nothing`, () => {
      auth.session = signedIn ? { user: USER } : null;
      mount(<AgentOfferStrip />, "/");
      expect(screen.getByRole("link", { name: /connect your ai/i }).getAttribute("href")).toBe("/agents");
      expect(screen.queryByRole("link", { name: /pass/i })).toBeNull();
      expect(invoke).not.toHaveBeenCalled();
    });
  }

  it("Add to Claude appears only behind its flag, as the documented install link", () => {
    const { unmount } = mount(<AgentOfferStrip />, "/");
    expect(document.querySelector("[data-add-to-claude]"), "the button shows while the flag is off").toBeNull();
    unmount();
    mount(<AgentOfferStrip addToClaude />, "/");
    const a = document.querySelector("[data-add-to-claude]");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe(claudeInstallLink(MCP_URL));
  });

  it("Index.tsx reads no pass mirror and spells none of the pass numbers beside pass/hour/application", () => {
    const code = strip(INDEX_RAW);
    expect(code).not.toMatch(/\bPASS\b/);
    expect(code).not.toMatch(/\{\{pass\w*\}\}/);
    expect(code).toMatch(/<HomeHero agentOffer=\{<AgentOfferStrip \/>\} \/>/);
    expect(spelledPassNumbers(INDEX_RAW)).toEqual([]);
  });

  it("teeth: a copy of Index.tsx with the price, the hours or the applications spelled fails, and a comment does not", () => {
    const at = "export function AgentOfferStrip(";
    expect(INDEX_RAW).toContain(at);
    for (const line of [`const X = "a $${PASS.priceUsd} pass";`, `const X = "${PASS.sessionHours} hours";`, `const X = "${PASS.applications} applications";`]) {
      expect(spelledPassNumbers(INDEX_RAW.replace(at, `${line}\n${at}`)).length, line).toBeGreaterThan(0);
    }
    expect(spelledPassNumbers(INDEX_RAW.replace(at, `/* the pass cost $${PASS.priceUsd} */\n${at}`))).toEqual([]);
  });

  describe("and the crawler copy for / says the same, from the same mirrors", () => {
    const BAKE = read("scripts/prerender-seo.mjs");
    // The block the script evaluates, run here against the real en.json and
    // the real mirrors — so what a Googlebot-UA curl of / carries is proven,
    // not inferred from a regex over template text.
    // The offer block fills its placeholders through the script's one shared
    // filler (fillCopy, declared at helper scope), so the harness slices that
    // declaration in beside the block: what runs here is the real filler.
    const FILLER = (() => {
      const at = BAKE.indexOf("const fillCopy = ");
      expect(at, "the shared filler is no longer declared").toBeGreaterThan(-1);
      return BAKE.slice(at, BAKE.indexOf("\n", at));
    })();
    const offer = (() => {
      const start = BAKE.indexOf("const AGENT_OFFER = (() => {");
      expect(start).toBeGreaterThan(-1);
      const end = BAKE.indexOf("})();", start) + "})();".length;
      const D = { EN_LOCALE: EN, PASS, MCP_ANON_CAPS };
      return new Function("D", `${FILLER}\n${BAKE.slice(start, end)}; return AGENT_OFFER;`)(D) as { lead: string; connect: string; pass: string; cta: string };
    })();
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(({ passPrice: PASS.priceUsd, passHours: PASS.sessionHours, passApplications: PASS.applications, freeCallsPerDay: MCP_ANON_CAPS.perAddressPerDay } as Record<string, number>)[k]));
    const homeAgent = EN.homeAgent as Record<string, string>;

    it("the bundle entry exports the PASS mirror", () => {
      expect(BAKE).toMatch(/export \{[^}]*\bPASS\b[^}]*\} from "\.\.\/src\/config\/products"/);
    });
    it("the sentences are en.json's homeAgent lines — the new ones, under the names the bake reads — and sell nothing", () => {
      expect(offer.connect).toBe(fill(homeAgent.connectLine2));
      expect(offer.pass).toBe(fill(homeAgent.passLine));
      expect(offer.lead).toBe(homeAgent.lead);
      expect(offer.cta).toBe(homeAgent.connectCta);
      // The apply pivot: the line the bake calls "pass" now says we never
      // submit, and neither sentence carries a number or a price.
      expect(offer.pass).toMatch(/never submits an application for you/);
      for (const t of [offer.connect, offer.pass]) expect(t).not.toMatch(/\d|\$/);
      expect(offer.connect).toMatch(/no account/i);
    });
    it("a placeholder with no mirror throws instead of baking a raw brace", () => {
      const start = BAKE.indexOf("const AGENT_OFFER = (() => {");
      const end = BAKE.indexOf("})();", start) + "})();".length;
      const D = { EN_LOCALE: { homeAgent: { ...homeAgent, passLine: "{{passSomethingElse}} hours" } }, PASS, MCP_ANON_CAPS };
      expect(() => new Function("D", `${FILLER}\n${BAKE.slice(start, end)}; return AGENT_OFFER;`)(D)).toThrow(/no mirror/);
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
