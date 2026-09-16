// Connect your agent — the human-facing page for the MCP server at
// supabase/functions/agent-mcp. A few read tools answer with no key at all,
// under a daily allowance, so a host whose connector dialog has no field for
// a key still gets an answer on its first call; any MCP-capable agent that
// can send an Authorization header can use every read tool with a free
// /data-api key; the apply tools additionally need an account-linked agent
// key minted here, an Agent plan OR a live Agent Pass, and a standing
// mandate. The page states the boundary plainly: the MCP layer is a
// translator over the existing apply pipeline, never a bypass — an agent can
// do at most what its owner could do signed in.
//
// THE PASS CARD beside the mint is the third way to hold that one
// entitlement: a one-off purchase, never a renewal. Every number on it is
// read off the PASS mirror in src/config/products.ts (pinned to
// supabase/functions/_shared/pass.ts by pricing-truth.test.ts) and every
// sentence is an i18n key — a locale value beats an inline default, so a
// typed digit anywhere would be nine stale digits the day the price moves.
// The Buy button only renders once agent-pass-status has answered for the
// signed-in visitor: the two pass functions deploy on a slower cadence than
// this page, and a button that 404s after the click is worse than none.
//
// EVERY LIST ON THIS PAGE IS RENDERED FROM A MIRROR CONSTANT, never typed
// here: the tools, the unkeyed set and its caps from src/config/mcp-tools.ts
// (pinned to the server's TOOLS registration and its constants by
// the-page-says-six-and-the-server-says-eleven.test.ts and
// a-first-call-with-no-key-gets-an-answer-not-a-wall.test.ts), the sendable
// vendors from src/config/sendable-vendors.ts (pinned to the Deno list), the
// posting count from the live board. This page once said "six tools" against
// a server registering eleven, called a count of boards an employer count,
// and told two hosts to enter a header their dialogs have no field for — each
// a sentence that was true when written and false when the thing it
// described moved.

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, KeyRound, Terminal, Copy, Check, Loader2, ShieldCheck, Search, Send, Plug, Ticket } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBoardTotals, roundedFloor } from "@/hooks/use-board-totals";
import { MCP_TOOLS, MCP_HOSTS, MCP_READ_TOOLS, MCP_PAID_TOOLS, MCP_APPLY_TOOLS, MCP_ANON_TOOLS, MCP_ANON_TOOL_NAMES, MCP_ANON_CAPS } from "@/config/mcp-tools";
import { SENDABLE_VENDOR_LABELS, SENDABLE_VENDOR_SENTENCE } from "@/config/sendable-vendors";
import { PASS } from "@/config/products";

// Same convention as DataApi's API_BASE: read the env the client is built
// with, so the documented URL cannot drift from the project serving it.
export const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-mcp`;

/** The placeholder a person pastes their key over; never a real key. */
export const KEY_PLACEHOLDER = "rb_live_...your key...";

/** The Claude Code one-liner, with the key filled in when there is one. */
export const claudeCodeCommand = (key: string = KEY_PLACEHOLDER) =>
  `claude mcp add --transport http resumebooster ${MCP_URL} --header "Authorization: Bearer ${key}"`;

/** The Cursor mcp.json block, with the key filled in when there is one. */
export const cursorConfig = (key: string = KEY_PLACEHOLDER) => `{
  "mcpServers": {
    "resumebooster": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`;

const CLAUDE_CODE_CMD = claudeCodeCommand();
const CURSOR_JSON = cursorConfig();

/** The interpolation every pass sentence uses — read off the mirror, never typed. */
export const PASS_COPY = {
  passPrice: PASS.priceUsd,
  passHours: PASS.sessionHours,
  passApplications: PASS.applications,
  passShelfDays: PASS.shelfLifeDays,
} as const;

/**
 * What agent-pass-status answers for the signed-in user. The pass block is
 * DERIVED from the row's timestamps by the function; the page never decides
 * liveness itself. `key` says whether a live agent key already exists, so
 * the post-purchase page can say "your key already carries the pass" instead
 * of minting a new one and revoking it.
 */
export interface PassStatus {
  pass:
    | { state: "none" }
    | {
        state: "unactivated" | "live" | "closed";
        purchasedAt: string;
        shelfExpiresAt: string;
        activatedAt: string | null;
        expiresAt: string | null;
        endsInSeconds?: number;
        sessionHours: number;
        applicationsTotal: number;
        applicationsUsed: number;
        applicationsLeft: number;
        activatedVia: string | null;
        closeReason?: string;
      };
  key: { live: false } | { live: true; prefix: string | null; createdAt: string | null };
  repair?: string;
}

/**
 * One read of agent-pass-status for the signed-in session; `null` until it
 * answers, `failed` when it cannot (a 404 before the function deploys, a 503,
 * a network fault). Callers render the Buy control ONLY off an answer.
 */
export function usePassStatus(sessionId?: string | null) {
  const { session } = useAuth();
  const [status, setStatus] = useState<PassStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => { setStatus(null); setFailed(false); setTick((n) => n + 1); }, []);
  useEffect(() => {
    if (!session) { setStatus(null); setFailed(false); return; }
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("agent-pass-status", {
          body: sessionId ? { session_id: sessionId } : {},
        });
        if (!live) return;
        const d = data as PassStatus | null;
        if (error || !d?.pass || !d?.key) { setFailed(true); return; }
        setStatus(d);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; };
  }, [session, sessionId, tick]);
  return { status, failed, refresh };
}

/**
 * Start the Stripe checkout for a pass. Resolves to the function's refusal
 * text when it refuses (alreadySubscribed, alreadyLive — each sentence
 * written by the function off the row, never typed here), to null once the
 * browser is on its way to Stripe, or to a generic failure line.
 */
export async function startPassCheckout(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("create-pass-checkout", { body: {} });
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    let message: string | null = null;
    try { message = ((await ctx?.json?.()) as { error?: string } | null)?.error ?? null; } catch { /* body unreadable */ }
    return message ?? "";
  }
  const d = data as { url?: string; error?: string; alreadySubscribed?: boolean; alreadyLive?: boolean } | null;
  if (d?.url) { window.location.href = d.url; return null; }
  return d?.error ?? "";
}

const TIER_BADGE: Record<string, string> = { read: "any free key", paid: "paid key", apply: "agent key" };

/** "a, b and c" from a list of tool names, for prose. */
const names = (list: ReadonlyArray<{ name: string }>) => {
  const n = list.map((t) => t.name);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n.join("");
};

/** A code block with a copy button — every setup snippet on this page uses it. */
export function CopyBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="text-xs overflow-x-auto p-3 pr-12 rounded-lg bg-muted"><code>{code}</code></pre>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-2 right-2 p-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

/**
 * Mint an account-linked agent key via the agent-connect function.
 * The key is shown once — only its hash is stored — and minting again
 * revokes the previous one (the function says so via `rotated`).
 */
export function MintAgentKey({ onMinted, next }: { onMinted?: (key: string) => void; next?: string } = {}) {
  const { session, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<{ key: string; rotated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sessionGone, setSessionGone] = useState(false);
  const [copied, setCopied] = useState(false);

  const mint = async () => {
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("agent-connect");
      if (error) {
        // On a non-2xx the SDK nulls `data` and puts the Response on
        // error.context — the real status and body live there (same lesson
        // ApplyCopilotPanel records).
        const ctx = (error as { context?: { status?: number; json?: () => Promise<unknown> } }).context;
        if (ctx?.status === 401) { setSessionGone(true); return; }
        let message: string | null = null;
        try { message = ((await ctx?.json?.()) as { error?: string } | null)?.error ?? null; } catch { /* body unreadable */ }
        // 409 (issuance refused) and 503 (minting unavailable) both arrive
        // here with the function's own message.
        setErr(message ?? "Could not mint a key. Try again shortly.");
        return;
      }
      const d = data as { key?: string; rotated?: boolean } | null;
      if (!d?.key) { setErr("Could not mint a key. Try again shortly."); return; }
      setMinted({ key: d.key, rotated: !!d.rotated });
      onMinted?.(d.key);
    } catch {
      setErr("Could not reach the key service. Try again shortly.");
    } finally { setBusy(false); }
  };

  if (minted) {
    return (
      <div>
        {/* Shown once, and said so plainly: only a hash is stored, so no
            screen anywhere can show it again. */}
        <p className="text-sm text-warning font-medium mb-2">
          Shown once — store it now. We keep only a hash, so this key can never be displayed again.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 px-3 py-2 rounded-lg bg-muted text-xs overflow-x-auto whitespace-nowrap">{minted.key}</code>
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(minted.key); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:text-foreground text-muted-foreground"
          >
            {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />} {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {minted.rotated && (
          <p className="text-sm text-warning mb-2">Your previous agent key was revoked when this one was minted.</p>
        )}
        <p className="text-sm text-muted-foreground">
          Paste it into your agent's Authorization header using the setup blocks below.
        </p>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Checking sign-in…</p>;
  }

  if (!session || sessionGone) {
    return (
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          {sessionGone
            ? "Your session has expired — sign in again to mint an agent key."
            : "Agent keys are minted from a signed-in session, because they act on your account."}
        </p>
        <Link
          to={next ? `/auth?next=${encodeURIComponent(next)}` : "/auth"}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Sign in to mint an agent key
        </Link>
      </div>
    );
  }

  return (
    <div>
      {err && <p className="text-sm text-destructive mb-3">{err}</p>}
      <button
        type="button" onClick={mint} disabled={busy}
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Minting…</> : <><KeyRound className="w-4 h-4" /> Mint agent key</>}
      </button>
      <p className="text-xs text-muted-foreground mt-3">
        One agent key per account — minting again revokes the previous one.
      </p>
    </div>
  );
}

/**
 * THE PASS CARD. Sign-in sits before the buy button, always: the pass binds
 * to user_id, never to an email or a key, and the sign-in link carries
 * ?next=/agents?buy=pass so the buyer lands back here with the button armed.
 * Signed in, the Buy control appears only once agent-pass-status has
 * answered (so nothing here can 404 ahead of the function deploy), and it
 * reads the answer: an open pass links to /agents/pass instead of selling a
 * second one. A refusal from create-pass-checkout (already subscribed, a
 * pass already open) is rendered from the function's own JSON — those
 * sentences state hours and applications off the row and are never typed
 * here. Cancelled checkouts come back to /agents?pass=cancelled and are
 * said so.
 */
export function PassCard() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  const cancelled = params.get("pass") === "cancelled";
  const wantsBuy = params.get("buy") === "pass";
  const { status } = usePassStatus();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const autoFired = useRef(false);

  const buy = useCallback(async () => {
    setBusy(true); setRefusal(null);
    try {
      const r = await startPassCheckout();
      if (r !== null) setRefusal(r || t("agentPass.checkoutFailed", "Could not open checkout — please try again."));
    } finally { setBusy(false); }
  }, [t]);

  // The buyer who clicked Buy signed out and came back through /auth: fire
  // the checkout once, and only once the status endpoint has answered that
  // there is nothing open on the account.
  useEffect(() => {
    if (!wantsBuy || !session || !status || autoFired.current) return;
    if (status.pass.state === "unactivated" || status.pass.state === "live") return;
    autoFired.current = true;
    const p = new URLSearchParams(params); p.delete("buy"); setParams(p, { replace: true });
    void buy();
  }, [wantsBuy, session, status, params, setParams, buy]);

  const open = status && (status.pass.state === "unactivated" || status.pass.state === "live");

  return (
    <div className="p-6 rounded-2xl bg-card border border-primary/30">
      <h3 className="font-semibold mb-2 flex items-center gap-2"><Ticket className="w-4 h-4 text-primary" /> {t("agentPass.cardTitle", "A pass for your agent")}</h3>
      <p className="text-lg font-medium mb-2">
        {t("agentPass.cardBody", "{{passHours}} hours with your agent, {{passApplications}} applications, ${{passPrice}}. Never renews.", PASS_COPY)}
      </p>
      <p className="text-sm text-muted-foreground mb-2">
        {t("agentPass.cardClock", "The clock starts at your agent's first call, not at purchase. An unstarted pass keeps for {{passShelfDays}} days.", PASS_COPY)}
      </p>
      <p className="text-sm text-muted-foreground mb-4">
        {t("agentPass.cardIncludes", "Includes the résumé scorer while it runs. Reading the board stays free; the Agent plan does the same every month and renews — the pass never does.")}
      </p>
      {cancelled && <p className="text-sm text-warning mb-3">{t("agentPass.cancelled", "Checkout cancelled — nothing was charged.")}</p>}
      {refusal && <p className="text-sm text-destructive mb-3">{refusal}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">{t("agentPass.checkingSignIn", "Checking sign-in…")}</p>
      ) : !session ? (
        <div>
          <p className="text-sm text-muted-foreground mb-3">{t("agentPass.signInWhy", "A pass is bound to your account — not to an email address, not to a key.")}</p>
          <Link
            to={`/auth?next=${encodeURIComponent("/agents?buy=pass")}`}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Ticket className="w-4 h-4" /> {t("agentPass.signInToBuy", "Sign in to buy the pass")}
          </Link>
        </div>
      ) : !status ? null : open ? (
        <Link
          to="/agents/pass"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-primary/40 text-sm font-semibold hover:bg-primary/5 transition-colors"
        >
          <Ticket className="w-4 h-4" /> {t("agentPass.holdOpen", "You hold a pass — open it")}
        </Link>
      ) : (
        <button
          type="button" onClick={buy} disabled={busy}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("agentPass.buying", "Opening checkout…")}</> : <><Ticket className="w-4 h-4" /> {t("agentPass.buy", "Buy the pass — ${{passPrice}}", PASS_COPY)}</>}
        </button>
      )}
    </div>
  );
}

export default function AgentConnect() {
  // THE POSTING COUNT IS READ, NOT TYPED. The same hook and the same floor
  // the homepage head uses; null until the board answers, and then every
  // sentence below has a variant that needs no number at all.
  const totals = useBoardTotals();
  const countClause = totals
    ? `${roundedFloor(totals.jobs).toLocaleString("en-US")}+ live postings`
    : "the live postings";
  const hostsWithHeader = MCP_HOSTS.filter((h) => h.header);
  // A host that signs you in reaches the keyed tools through your own key
  // row; only a host with neither a header field nor sign-in is limited to
  // the unkeyed tools.
  const hostsWithSignIn = MCP_HOSTS.filter((h) => !h.header && h.oauth);
  const hostsWithout = MCP_HOSTS.filter((h) => !h.header && !h.oauth);
  // Host names carry their own "and" (claude.ai and Claude Desktop), so the
  // list is joined with commas and one final "and", never "and … and".
  const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

  return (
    <>
      <SEO
        title="Connect Your Agent — MCP Server for the Live Job Board"
        description={`Point any MCP-capable AI agent at ${countClause} from employers' own hiring systems. Free keys for search; the Agent plan or a one-off pass can request applications.`}
        path="/agents"
      />
      <Header />

      <main className="min-h-screen pt-20">
        {/* Hero */}
        <section className="py-16 md:py-24 bg-gradient-to-b from-primary/5 via-background to-background">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-6">
                <Bot className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">Connect your agent</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold mb-6">
                Your AI agent can use <span className="text-primary">this job board directly</span>
              </h1>
              <p className="text-xl text-muted-foreground">
                Point an MCP-capable agent — Claude Code, Cursor, or one you built — at our MCP server.
                It can search {countClause} pulled from employers' own hiring systems, read full
                descriptions, re-verify a shortlist, and, on the Agent plan or a live pass, ask your apply agent
                to submit applications for you. It gets the same ranked search and the same honest disclosures the
                site gets — there is no second search engine behind this endpoint.
              </p>
            </div>
          </div>
        </section>

        {/* Endpoint */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <div className="p-6 rounded-2xl bg-card border border-border">
                <h2 className="font-semibold mb-3 flex items-center gap-2"><Terminal className="w-4 h-4 text-primary" /> The endpoint</h2>
                <CopyBlock code={MCP_URL} label="MCP endpoint URL" />
                <p className="text-sm text-muted-foreground mt-3">
                  Streamable HTTP transport, stateless, POST-only. Your agent sends its key as{" "}
                  <code className="text-xs">Authorization: Bearer rb_live_…</code> — tool discovery works
                  without one, so an agent can see what's here before you decide to mint anything.{" "}
                  {names(MCP_ANON_TOOLS)} answer with no key at all, {MCP_ANON_CAPS.perAddressPerDay} calls a
                  day per address (search capped at {MCP_ANON_CAPS.searchRows} rows), each answer saying how
                  many are left; every other tool call needs a credential — the key, or the sign-in a
                  connector host performs for you — and a call without one answers a sign-in challenge
                  (an HTTP 401 with a WWW-Authenticate header naming this server's metadata), which is
                  what claude.ai and ChatGPT turn into their Connect card.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Keys — the tiers the server enforces, stated from the mirror */}
        <section className="py-16 border-t border-border">
          <div className="container">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Two kinds of key</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Reading the board is free and needs no account. Acting on your account needs a key that
                knows whose account it acts on. Both meter identically: 60 requests/minute, 1,000/day per key.
              </p>
            </div>
            <div className="grid lg:grid-cols-2 gap-6 max-w-5xl mx-auto">
              <div className="p-6 rounded-2xl bg-card border border-border">
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> Read tools — any free key</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {MCP_READ_TOOLS.map((t, i) => (
                    <span key={t.name}>{i > 0 && (i === MCP_READ_TOOLS.length - 1 ? " and " : ", ")}<code className="text-xs">{t.name}</code></span>
                  ))}{" "}
                  work with any free API key — the same ones the data API issues. No account, no card.
                  {MCP_PAID_TOOLS.length > 0 && (
                    <> {names(MCP_PAID_TOOLS)} {MCP_PAID_TOOLS.length === 1 ? "needs" : "need"} a paid key, exactly like <code className="text-xs">POST /v1/fit</code> on the data API.</>
                  )}
                </p>
                <Link
                  to="/data-api"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm font-semibold hover:border-primary/40 transition-colors"
                >
                  <KeyRound className="w-4 h-4" /> Get a free key at Hiring Data &amp; API
                </Link>
              </div>
              <div className="p-6 rounded-2xl bg-card border border-border">
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> Apply tools — an agent key</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {MCP_APPLY_TOOLS.map((t, i) => (
                    <span key={t.name}>{i > 0 && (i === MCP_APPLY_TOOLS.length - 1 ? " and " : ", ")}<code className="text-xs">{t.name}</code></span>
                  ))}{" "}
                  act on your account, so they need a key minted from your signed-in session. The key alone
                  isn't enough — applying also requires an active{" "}
                  <Link to="/agent" className="text-primary hover:underline">Agent plan</Link> or a live pass
                  (below), and the mandate you set up in{" "}
                  <Link to="/account" className="text-primary hover:underline">Account</Link>.
                  Read-only keys stay read-only by design.
                </p>
                <MintAgentKey />
              </div>
            </div>
            {/* The pass, beside the mint: the one-off way to hold the same
                entitlement the Agent plan holds monthly. */}
            <div className="max-w-5xl mx-auto mt-6">
              <PassCard />
            </div>
          </div>
        </section>

        {/* Setup — per host, and honest about which hosts can carry the key.
            The claim this replaced said claude.ai/Claude Desktop and ChatGPT
            "both configure the Authorization header in their own UI". Neither
            can: Claude's custom-connector dialog takes a URL plus optional
            OAuth client credentials, and a static request header is a beta for
            a limited set of organizations entered by an org admin
            (claude.com/docs/connectors/custom/remote-mcp); ChatGPT developer
            mode offers OAuth, No Authentication or Mixed and has no field for an
            API key (developers.openai.com/apps-sdk/build/auth). What those two
            hosts CAN do is sign a person in: the server answers a keyed tool
            called with no credential with a sign-in challenge, the host shows
            its Connect card, and the call then runs on the account's own key
            row — or, with no sign-in, use the unkeyed tools, whose set and
            caps come from the same mirror the server's constants are pinned
            to. The per-host facts live in MCP_HOSTS so this section and the
            crawler copy say the same thing. */}
        <section className="py-16 border-t border-border">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold mb-4 text-center">Connect it</h2>
              <p className="text-muted-foreground text-center mb-10">
                Paste your key over <code className="text-xs">rb_live_...your key...</code> in whichever block fits your agent.
              </p>
              <div className="space-y-6">
                <div className="p-6 rounded-2xl bg-card border border-border">
                  <h3 className="font-semibold mb-3">Claude Code</h3>
                  <CopyBlock code={CLAUDE_CODE_CMD} label="Claude Code setup command" />
                </div>
                <div className="p-6 rounded-2xl bg-card border border-border">
                  <h3 className="font-semibold mb-3">Cursor <span className="text-sm font-normal text-muted-foreground">(~/.cursor/mcp.json)</span></h3>
                  <CopyBlock code={CURSOR_JSON} label="Cursor mcp.json config" />
                </div>
                <div className="p-6 rounded-2xl bg-card border border-border">
                  <h3 className="font-semibold mb-1 flex items-center gap-2"><Plug className="w-4 h-4 text-primary" /> Which hosts can reach which tools today</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Every keyed tool call carries a credential, and hosts hold it two ways. From{" "}
                    {andList(hostsWithHeader.map((h) => h.name))}: the key in an Authorization header — every
                    tool your key's tier allows.
                    {hostsWithSignIn.length > 0 && (
                      <>
                        {" "}From {andList(hostsWithSignIn.map((h) => h.name))}: paste the URL as a custom
                        connector and choose Sign in when needed — the first keyed tool shows a Connect card,
                        you sign in to this site and Allow, and the call runs on your own account key (the
                        same row, quota and pass a pasted key would use). Before sign-in, the unkeyed tools
                        — {names(MCP_ANON_TOOLS)} — still answer, {MCP_ANON_CAPS.perAddressPerDay} calls a
                        day per address, search capped at {MCP_ANON_CAPS.searchRows} rows.
                      </>
                    )}
                    {hostsWithout.length > 0 && (
                      <>
                        {" "}From {andList(hostsWithout.map((h) => h.name))}: the unkeyed tools only, under
                        the same caps — there is no field for the key and no sign-in.
                      </>
                    )}
                    {" "}Each host's own note below says which.
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-2">
                    {MCP_HOSTS.map((h) => (
                      <li key={h.name} className="flex gap-2">
                        {/* The badge is the host table's two flags: a header
                            field reaches every tool, sign-in reaches them through
                            the account's own key, neither means unkeyed only. */}
                        <span className={`shrink-0 mt-0.5 text-xs px-2 py-0.5 rounded-full border ${h.header || h.oauth ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}`}>
                          {h.header ? "reaches every tool" : h.oauth ? "sign in when needed" : "unkeyed tools only"}
                        </span>
                        <span><span className="text-foreground font-medium">{h.name}</span> — {h.how}.</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tools — rendered from the mirror, counted off it */}
        <section className="py-16 border-t border-border">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold mb-10 text-center">All {MCP_TOOLS.length} tools</h2>
              <div className="rounded-2xl bg-card border border-border divide-y divide-border">
                {MCP_TOOLS.map((t) => (
                  <div key={t.name} className="p-5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <code className="text-sm font-semibold text-primary">{t.name}</code>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${t.tier === "read" ? "border-border bg-muted text-muted-foreground" : "border-primary/30 bg-primary/10 text-primary"}`}>
                        {TIER_BADGE[t.tier]}
                      </span>
                      {MCP_ANON_TOOL_NAMES.includes(t.name) && (
                        <span className="text-xs px-2 py-0.5 rounded-full border border-success/40 bg-success/10 text-success">
                          answers with no key ({MCP_ANON_CAPS.perAddressPerDay}/day per address)
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{t.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* The boundary — the load-bearing section */}
        <section className="py-16 border-t border-border bg-muted/20">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <div className="p-6 md:p-8 rounded-2xl bg-card border border-primary/20">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  <h2 className="text-2xl font-bold">What your agent can and cannot do</h2>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Applications requested here go through the exact same pipeline as the signed-in flow —
                  the MCP layer is a translator, never a bypass. Your agent can do at most what you could
                  do yourself, signed in. Concretely:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2.5">
                  <li>• <span className="text-foreground font-medium">Your mandate's off switch always wins.</span> Agent switched off or paused in Account? Every request refuses, including from this endpoint.</li>
                  <li>• <span className="text-foreground font-medium">The honesty classifier never invents answers.</span> Application answers are drawn from your own profile; any answer it can't support blocks the send and waits for you.</li>
                  <li>• <span className="text-foreground font-medium">Only {SENDABLE_VENDOR_LABELS.length} hiring systems are agent-submittable today:</span> {SENDABLE_VENDOR_SENTENCE}. Jobs on other systems get prepared for you to send yourself — <code className="text-xs">check_apply_support</code> tells you which is which before you ask.</li>
                  <li>• <span className="text-foreground font-medium">Daily caps apply.</span> The same release caps as the signed-in agent — a connected agent doesn't get a bigger allowance.</li>
                  <li>• <span className="text-foreground font-medium">Every refusal is named.</span> A request that doesn't go out shows up in <code className="text-xs">application_status</code> with the refusing gate stated, not a silent disappearance.</li>
                </ul>
                <p className="text-xs text-muted-foreground mt-5">
                  Rate limits: 60 requests/minute, 1,000/day per key. How the agent decides what it may send
                  is documented on the <Link to="/trust" className="text-primary hover:underline">trust page</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Cross-links */}
        <section className="py-16">
          <div className="container">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-2xl font-bold mb-4">Rather integrate with code?</h2>
              <p className="text-muted-foreground mb-8">
                The MCP server is for agents. If you're writing software, the plain JSON API covers the
                same data with cursors and ETags.
              </p>
              <div className="flex flex-wrap justify-center gap-3 text-sm">
                <Link to="/data-api" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">Hiring Data &amp; API</Link>
                <Link to="/agent" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">The Apply Agent</Link>
                <Link to="/jobs" className="px-4 py-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors">The live board</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
