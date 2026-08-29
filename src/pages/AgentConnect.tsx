// Connect your agent — the human-facing page for the MCP server at
// supabase/functions/agent-mcp. Any MCP-capable agent (Claude, ChatGPT,
// Cursor, custom) can search the board with a free /data-api key; the apply
// tools additionally need an account-linked agent key minted here, an Agent
// plan, and a standing mandate. The page states the boundary plainly: the MCP
// layer is a translator over the existing apply pipeline, never a bypass —
// an agent can do at most what its owner could do signed in.

import { useState } from "react";
import { Link } from "react-router-dom";
import { Bot, KeyRound, Terminal, Copy, Check, Loader2, ShieldCheck, Search, Send } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Same convention as DataApi's API_BASE: read the env the client is built
// with, so the documented URL cannot drift from the project serving it.
const MCP_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-mcp`;

const TOOLS: Array<{ name: string; tier: "read" | "apply"; body: string }> = [
  { name: "search_jobs", tier: "read", body: "Search the live board. Returns compact job cards plus the board's honesty disclosures: exact totals when knowable, filters it couldn't honour, words it read as filters, spelling suggestions." },
  { name: "get_job", tier: "read", body: "Full detail for one job id, including the complete description text and when the employer's feed last confirmed it open." },
  { name: "board_stats", tier: "read", body: "Live board statistics from cache: posting totals, employer count, the category set, freshness stamp." },
  { name: "check_apply_support", tier: "read", body: "Whether the apply agent can submit to this job on your behalf, and what that requires. Non-supported jobs still return their direct apply URL for you to use." },
  { name: "request_application", tier: "apply", body: "Ask your apply agent to submit an application to a job. Passes through every gate of the signed-in flow — mandate, honesty classifier, vendor boundary, daily cap." },
  { name: "application_status", tier: "apply", body: "Status of the applications your agent has requested — queued, submitted, refused (with the refusing gate named), or failed." },
];

const CLAUDE_CODE_CMD = `claude mcp add --transport http resumebooster ${MCP_URL} --header "Authorization: Bearer rb_live_...your key..."`;

const CURSOR_JSON = `{
  "mcpServers": {
    "resumebooster": {
      "url": "${MCP_URL}",
      "headers": { "Authorization": "Bearer rb_live_...your key..." }
    }
  }
}`;

/** A code block with a copy button — every setup snippet on this page uses it. */
function CopyBlock({ code, label }: { code: string; label: string }) {
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
function MintAgentKey() {
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
          to="/auth"
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

export default function AgentConnect() {
  return (
    <>
      <SEO
        title="Connect Your Agent — MCP Server for the Live Job Board"
        description="Point any MCP-capable AI agent at 700k+ live postings pulled from employers' own hiring systems. Free keys for search; on the Agent plan, it can request applications."
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
                Point any MCP-capable agent — Claude, ChatGPT, Cursor, or one you built — at our MCP server.
                It can search 700k+ live postings pulled from employers' own hiring systems, read full
                descriptions, and, on the Agent plan, ask your apply agent to submit applications for you.
                It gets the same ranked search and the same honest disclosures the site gets — there is no
                second search engine behind this endpoint.
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
                  without one, so an agent can see what's here before you decide to mint anything.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Keys — two tiers, stated honestly */}
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
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> Search tools — any free key</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  <code className="text-xs">search_jobs</code>, <code className="text-xs">get_job</code>,{" "}
                  <code className="text-xs">board_stats</code> and <code className="text-xs">check_apply_support</code>{" "}
                  work with any free API key — the same ones the data API issues. No account, no card.
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
                  <code className="text-xs">request_application</code> and <code className="text-xs">application_status</code>{" "}
                  act on your account, so they need a key minted from your signed-in session. The key alone
                  isn't enough — applying also requires an active{" "}
                  <Link to="/agent" className="text-primary hover:underline">Agent plan</Link> and the mandate
                  you set up in <Link to="/account" className="text-primary hover:underline">Account</Link>.
                  Read-only keys stay read-only by design.
                </p>
                <MintAgentKey />
              </div>
            </div>
          </div>
        </section>

        {/* Setup */}
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
                  <h3 className="font-semibold mb-1">Claude Desktop / ChatGPT</h3>
                  <p className="text-sm text-muted-foreground">
                    Add a custom connector with the URL above — both configure the Authorization header in their own UI.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="py-16 border-t border-border">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold mb-10 text-center">The six tools</h2>
              <div className="rounded-2xl bg-card border border-border divide-y divide-border">
                {TOOLS.map((t) => (
                  <div key={t.name} className="p-5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <code className="text-sm font-semibold text-primary">{t.name}</code>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${t.tier === "apply" ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"}`}>
                        {t.tier === "apply" ? "agent key" : "any free key"}
                      </span>
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
                  <li>• <span className="text-foreground font-medium">Only five hiring systems are agent-submittable today:</span> Breezy, Oracle, Personio, Pinpoint, and Teamtailor. Jobs on other systems get prepared for you to send yourself — <code className="text-xs">check_apply_support</code> tells you which is which before you ask.</li>
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
