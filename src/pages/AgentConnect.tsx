// Connect your agent — the human-facing page for the MCP server at
// supabase/functions/agent-mcp.
//
// THE PAGE OPENS WITH ONE QUESTION: "Which agent do you use?" The tiles are
// MCP_PAGE_HOSTS — the hosts the mirror flags `page`, in the owner's order:
// the two chat apps and Claude Code, because the people this page is for
// are not being asked to open an editor (the owner's decision, 2026-09-18).
// Under the tiles, one line sends everyone else to the install repo on
// GitHub (MCP_OTHER_AGENTS_LINE, names and link off the mirror), and the
// "Copy the prompt" fallback stays for an agent that installs from prose.
// Picking a tile reveals only that host's numbered steps, its sign-in
// sentence for TODAY's state, and how you know it worked. The steps come
// from the `steps` builders on MCP_HOSTS in src/config/mcp-tools.ts, so
// this page, the pass receipt, the prerender and the install repo render
// one list. Nothing above the fold names a key, a header, a transport or an
// HTTP status; the first use of "sign in", "key" and "address" carries its
// gloss. The developer disclosure below the fold ("Which hosts can reach
// which tools") keeps the FULL table: it describes the server's reach, not
// what a seeker should pick.
//
// KEYLESS IS THE DEFAULT STATE of every block. A keyed block exists only
// after the visitor pastes a key into the field on the page (the field only
// edits the text on this page — nothing is sent anywhere); no placeholder
// ever sits inside an Authorization value.
//
// THE SIGN-IN STATE IS ONE FACT the server computes and carries on its
// initialize result (`_meta[MCP_SIGN_IN_META_KEY].state`: on, off, unknown).
// This page reads it there — once, silently, when a panel opens (a free,
// unmetered initialize), and again when "Test the server" runs — and
// branches on `state` only. It never probes the authorization server
// itself, never bakes a state into the build, and never lets a host table
// flag decide a sentence on its own: a stale flag was how the page once told
// two hosts to sign in through a service that was switched off.
//
// "TEST THE SERVER" is a manual button (never auto-run — a crawler that runs
// scripts would spend the shared address allowance for nothing): initialize,
// tools/list, prompts/list (free) and ONE unkeyed search, and it prints the
// answer in words, numbers off the responses, and the sign-in state.
//
// THE PASS CARD beside the steps is the third way to hold the apply
// entitlement: a one-off purchase, never a renewal. Every number on it is
// read off the PASS mirror in src/config/products.ts (pinned to
// supabase/functions/_shared/pass.ts by pricing-truth.test.ts) and every
// sentence is an i18n key. The Buy button only renders once
// agent-pass-status has answered for the signed-in visitor.
//
// EVERY LIST ON THIS PAGE IS RENDERED FROM A MIRROR CONSTANT, never typed
// here: the hosts, their steps, the tools, the unkeyed set and its caps from
// src/config/mcp-tools.ts (pinned to the server's registration and its
// constants by the-page-says-six-and-the-server-says-eleven.test.ts and
// a-first-call-with-no-key-gets-an-answer-not-a-wall.test.ts), the
// troubleshooting rows (pinned to the server's own error strings by
// which-agent-do-you-use.test.tsx), the sendable vendors from
// src/config/sendable-vendors.ts, the posting count from the live board.
// This page once said "six tools" against a server registering eleven, and
// told two hosts to enter a header their dialogs have no field for — each a
// sentence that was true when written and false when the thing it described
// moved.
//
// Copy on this page is plain English, as before: the host-UI labels and
// the commands are the vendors' own words and the same in every language.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, KeyRound, Terminal, Copy, Check, Loader2, ShieldCheck, Search, Send, Plug, Ticket, MessageSquareText, FileText, ExternalLink } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useBoardTotals, roundedFloor } from "@/hooks/use-board-totals";
import {
  MCP_TOOLS, MCP_HOSTS, MCP_PAGE_HOSTS, MCP_PAGE_HOST_IDS, MCP_OTHER_AGENTS_LINE, MCP_COPY_THE_PROMPT, MCP_READ_TOOLS, MCP_PAID_TOOLS,
  MCP_APPLY_TOOLS, MCP_ANON_TOOLS, MCP_ANON_TOOL_NAMES, MCP_ANON_CAPS, MCP_FREE_KEY_DAILY_QUOTA, MCP_PROMPTS, MCP_RESOURCES,
  MCP_SERVER_ADDRESS_NOTE, MCP_ADDRESS_GLOSS, MCP_NEEDS_ACCOUNT_LINE, MCP_INSTALL_REPO_URL, MCP_TEST_QUERY, MCP_TROUBLESHOOTING,
  troubleRowsFor, stepSegments, hostTakesKey, curlInitialize, SIGN_IN_UNKNOWN, andList,
  type McpHost, type McpHostId, type McpStep, type McpMoreHost, type SignInFact, type TroubleRow,
} from "@/config/mcp-tools";
import { MCP_URL, runServerTest, describeTest, readSignInFromServer } from "@/lib/mcp-test";
import { rememberedHostChoice, rememberHostName } from "@/lib/agent-handoff";
import { postTrackEvent, getVisitorId } from "@/lib/track-transport";
import { SENDABLE_VENDOR_LABELS, SENDABLE_VENDOR_SENTENCE } from "@/config/sendable-vendors";
import { PASS } from "@/config/products";
import { FREE_KEY_RATE_PER_MIN } from "@/config/free-key-limits";

// The server address is defined once, beside the client that calls it, and
// re-exported here for the modules that documented it from this page first.
export { MCP_URL };

/** The interpolation every rate sentence uses — read off the two mirrors, never typed. */
export const RATE_COPY = { ratePerMin: FREE_KEY_RATE_PER_MIN, dailyQuota: MCP_FREE_KEY_DAILY_QUOTA } as const;

/** The interpolation every pass sentence uses — read off the mirror, never typed. */
export const PASS_COPY = {
  passPrice: PASS.priceUsd,
  passHours: PASS.sessionHours,
  passApplications: PASS.applications,
  passShelfDays: PASS.shelfLifeDays,
} as const;

/** The analytics test every event on this page lands under; variants are ≤ 30 characters (track-ab-event's cap). */
const TRACK_TEST = "agents";
const trackAgents = (variant: string, metadata?: Record<string, unknown>) => {
  postTrackEvent({ testName: TRACK_TEST, variant, eventType: "view", visitorId: getVisitorId(), metadata });
};

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

/**
 * The sign-in fact, read from the server's initialize result and nowhere
 * else. `probe()` runs at most once per page load (free, unmetered); the
 * test button's own initialize refreshes it through `set`.
 */
export function useSignInFact() {
  const [fact, setFact] = useState<SignInFact>(SIGN_IN_UNKNOWN);
  const probed = useRef(false);
  const probe = useCallback(() => {
    if (probed.current) return;
    probed.current = true;
    void readSignInFromServer(MCP_URL).then(setFact);
  }, []);
  return { fact, probe, set: setFact };
}

/**
 * The fact and the chosen host, for the pass card: provided by the page so
 * the card can be mounted bare (as its guard does) and read defaults.
 */
export const SignInContext = createContext<{ fact: SignInFact; hostName: string | null }>({ fact: SIGN_IN_UNKNOWN, hostName: null });

const TIER_BADGE: Record<string, string> = { read: "any free key", paid: "paid key", apply: "agent key" };

/** "a, b and c" from a list of tool names, for prose. */
const names = (list: ReadonlyArray<{ name: string }>) => andList(list.map((t) => t.name));

/** A code block with a copy button — every setup snippet on this page uses it. */
export function CopyBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="text-xs overflow-x-auto p-3 pr-12 rounded-lg bg-muted whitespace-pre-wrap break-all"><code>{code}</code></pre>
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

/** A step's sentence with its **label** and `code` marks rendered — the same parser the prerender uses. */
export function StepText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {stepSegments(text).map((s, i) =>
        s.kind === "strong" ? <strong key={i} className="text-foreground">{s.value}</strong>
          : s.kind === "code" ? <code key={i} className="text-xs">{s.value}</code>
          : <span key={i}>{s.value}</span>)}
    </span>
  );
}

/** The numbered steps of one host, each with its copy button when there is something to paste. */
export function StepList({ steps }: { steps: McpStep[] }) {
  return (
    <ol className="list-decimal pl-5 space-y-3 text-sm text-muted-foreground">
      {steps.map((s, i) => (
        <li key={i} className="pl-1">
          <StepText text={s.text} />
          {s.copy !== undefined && <div className="mt-2"><CopyBlock code={s.copy} label={s.copyLabel ?? "this"} /></div>}
          {s.note && <p className="text-xs mt-1.5"><StepText text={s.note} /></p>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The key field. It only edits the text on this page: the value never
 * leaves the browser, nothing is sent anywhere, and the blocks below it
 * re-render with the value in the ONE line that carries it.
 */
function KeyField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="block text-xs font-medium text-foreground mb-1">Paste your key here to fill the blocks below</label>
      <input
        id={id} type="password" autoComplete="off" spellCheck={false} value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="rb_live_…"
        className="w-full max-w-md px-3 py-2 rounded-lg border border-border bg-background text-sm"
      />
      <p className="text-xs text-muted-foreground mt-1">Nothing is sent anywhere — the field only edits the text on this page.</p>
    </div>
  );
}

/** One block of the long tail — on this page, only the "Copy the prompt" fallback under the tiles. */
function MoreHostBlock({ host, url, keyValue, state }: { host: McpMoreHost; url: string; keyValue: string; state: SignInFact["state"] }) {
  const ctx = { url, key: keyValue || undefined, signIn: state };
  return (
    <div className="p-4 rounded-xl border border-border bg-background/50">
      <h4 className="font-semibold mb-2">{host.name}{host.caveat && <span className="text-xs font-normal text-muted-foreground"> ({host.caveat})</span>}</h4>
      <StepList steps={host.steps(ctx)} />
      {host.keyed && (
        <details className="mt-3">
          <summary className="text-sm cursor-pointer text-foreground">{host.keyed.title}</summary>
          <div className="mt-2"><StepList steps={host.keyed.steps(ctx)} /></div>
        </details>
      )}
      {state === "on" && host.signInOn && <p className="text-xs text-muted-foreground mt-2"><StepText text={host.signInOn} /></p>}
    </div>
  );
}

/**
 * The chosen host's panel: steps, the sign-in sentence for TODAY's state,
 * how you know it worked, the deep links, and — for header hosts — the
 * optional "with a free key" sub-steps behind the key field.
 */
export function HostPanel({ host, url, fact, keyValue, onKey }: {
  host: McpHost; url: string; fact: SignInFact; keyValue: string; onKey: (v: string) => void;
}) {
  const ctx = { url, key: keyValue || undefined, signIn: fact.state };
  const links = host.deeplinks?.(ctx) ?? [];
  return (
    <section id={host.id} aria-labelledby={`${host.id}-title`} className="p-6 rounded-2xl bg-card border border-border">
      <h3 id={`${host.id}-title`} className="text-lg font-semibold mb-1">{host.name}{host.small && <span className="text-sm font-normal text-muted-foreground"> — {host.small}</span>}</h3>
      {links.length > 0 && (
        <p className="flex flex-wrap gap-2 my-3">
          {links.map((l) => (
            <a key={l.label} href={l.href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              <Plug className="w-4 h-4" /> {l.label}
            </a>
          ))}
        </p>
      )}
      <StepList steps={host.steps(ctx)} />
      <p className="text-sm text-muted-foreground mt-4" data-sign-in={fact.state}><StepText text={host.signIn(fact.state)} /></p>
      <p className="text-sm mt-3"><span className="font-medium text-foreground">How you know it worked:</span> <StepText text={host.verify} className="text-muted-foreground" /></p>
      <p className="text-xs text-muted-foreground mt-2"><StepText text={MCP_NEEDS_ACCOUNT_LINE} /></p>
      <p className="text-xs text-muted-foreground mt-2">{MCP_ADDRESS_GLOSS}</p>
      {host.keyed && (
        <div className="mt-5 pt-4 border-t border-border">
          <h4 className="font-medium text-sm mb-1">{host.keyed.title}</h4>
          {hostTakesKey(host) && <KeyField id={`${host.id}-key`} value={keyValue} onChange={onKey} />}
          <div className="mt-3"><StepList steps={host.keyed.steps(ctx)} /></div>
        </div>
      )}
    </section>
  );
}

/** The host the URL hash names, if it names a tile (a hash for a host the page sends to GitHub opens nothing). */
function hostFromHash(): McpHostId | null {
  try {
    const h = window.location.hash.replace(/^#/, "");
    return (MCP_PAGE_HOST_IDS as readonly string[]).includes(h) ? (h as McpHostId) : null;
  } catch { return null; }
}

/**
 * THE SWITCHBOARD: one question, the page's tiles, one open panel, and one
 * line to GitHub for everyone else. The choice is remembered under the same
 * key /agents/pass and the board's hand-off use, so the receipt page opens
 * on the host the person chose here; the URL hash also selects a tile, so
 * the README and llms.txt can link straight to one host's steps.
 */
/** The host to open on load: the URL hash first, else a pick this browser remembers — never a default, and only ever a tile. */
export function initialHostId(): McpHostId | null {
  const fromHash = hostFromHash();
  if (fromHash) return fromHash;
  const remembered = rememberedHostChoice();
  return remembered ? (MCP_PAGE_HOSTS.find((h) => h.name === remembered)?.id ?? null) : null;
}

export function Switchboard({ fact, probe, picked, onPick }: { fact: SignInFact; probe: () => void; picked: McpHostId | null; onPick: (id: McpHostId) => void }) {
  const [keyValue, setKeyValue] = useState("");
  useEffect(() => { if (picked) probe(); }, [picked, probe]);
  const pick = (h: McpHost) => {
    onPick(h.id);
    rememberHostName(h.name);
    try { window.history.replaceState(null, "", `#${h.id}`); } catch { /* no history — the state still moved */ }
    trackAgents("agents_host_pick", { host: h.id });
  };
  const host = picked ? MCP_PAGE_HOSTS.find((h) => h.id === picked) ?? null : null;
  return (
    <div>
      <h2 className="text-3xl font-bold mb-2 text-center">Which agent do you use?</h2>
      <p className="text-muted-foreground text-center mb-6">Pick one. You will see only the steps for that app.</p>
      <div role="group" aria-label="Which agent do you use?" className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
        {MCP_PAGE_HOSTS.map((h) => (
          <button
            key={h.id} type="button" onClick={() => pick(h)} aria-pressed={h.id === picked} data-host={h.id}
            className={`p-4 rounded-2xl border text-left transition-colors ${h.id === picked ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}
          >
            <span className="block text-lg font-semibold text-foreground">{h.name}</span>
            {h.small && <span className="block text-xs text-muted-foreground mt-0.5">{h.small}</span>}
          </button>
        ))}
      </div>
      {/* Everyone else: one line, names and link off the mirror. The
          long tail's steps live in the install repo's README. */}
      <p data-other-agents className="text-sm text-muted-foreground text-center mb-8">
        {MCP_OTHER_AGENTS_LINE.lead}{" "}
        <a href={MCP_OTHER_AGENTS_LINE.href} className="text-primary hover:underline">{MCP_OTHER_AGENTS_LINE.link}</a>
      </p>
      {host && <HostPanel host={host} url={MCP_URL} fact={fact} keyValue={keyValue} onKey={setKeyValue} />}
    </div>
  );
}

/**
 * THE PROSE FALLBACK: the long tail's "Copy the prompt" entry, for an agent
 * that installs a server from a sentence. Below the test block, not among
 * the tiles: the prompt is written for the agent and names the transport,
 * which nothing above the fold may do.
 */
export function CopyThePrompt({ fact }: { fact: SignInFact }) {
  if (!MCP_COPY_THE_PROMPT) return null;
  return (
    <details data-copy-the-prompt className="p-6 rounded-2xl bg-card border border-border">
      <summary className="font-semibold cursor-pointer">{MCP_COPY_THE_PROMPT.name} — for any agent that installs a server from a sentence</summary>
      <div className="mt-3"><MoreHostBlock host={MCP_COPY_THE_PROMPT} url={MCP_URL} keyValue="" state={fact.state} /></div>
    </details>
  );
}

/**
 * "TEST THE SERVER": four calls from this browser, one of them metered, and
 * the answer in words. Disabled for a minute after a run.
 */
export function TestServer({ fact, onFact, hostId }: { fact: SignInFact; onFact: (f: SignInFact) => void; hostId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const report = await runServerTest(MCP_URL);
      setText(describeTest(report));
      if (report.reached) onFact(report.signIn);
      trackAgents("agents_test_server", { host: hostId, state: report.reached ? report.signIn.state : "unreached" });
    } finally {
      setBusy(false);
      setCooldown(true);
      setTimeout(() => setCooldown(false), 60_000);
    }
  };
  return (
    <div className="p-6 rounded-2xl bg-card border border-border">
      <h2 className="font-semibold mb-2 flex items-center gap-2"><Terminal className="w-4 h-4 text-primary" /> Test the server</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Asks the server what it is, lists its tools and prompts, and runs one search for "{MCP_TEST_QUERY}" — from this browser, with no key.
        This spends one of your {MCP_ANON_CAPS.perAddressPerDay} free calls for today.
      </p>
      <button
        type="button" onClick={run} disabled={busy || cooldown}
        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Testing…</> : <><Search className="w-4 h-4" /> Test the server</>}
      </button>
      <p role="status" aria-live="polite" data-test-result className="text-sm mt-3 whitespace-pre-wrap">{text ?? "Results appear here."}</p>
      {fact.state !== "unknown" && text === null && (
        <p className="text-xs text-muted-foreground mt-1">Sign-in for the chat apps, as the server last reported it: {fact.state}.</p>
      )}
      <details className="mt-3">
        <summary className="text-xs cursor-pointer text-muted-foreground">Copy the same test as a curl command</summary>
        <div className="mt-2"><CopyBlock code={curlInitialize(MCP_URL)} label="the curl line" /></div>
      </details>
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
          Paste it into the key field of your app's steps above — the blocks fill themselves.
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
 *
 * When the remembered host is a chat host and the server's sign-in fact is
 * not `on`, one sentence says the pass is spendable from that host only
 * once sign-in is switched on — the sentence is gated on the fact, the Buy
 * button is not (a pass is spendable from a key host on the same account).
 */
export function PassCard() {
  const { t } = useTranslation();
  const { fact: signIn, hostName } = useContext(SignInContext);
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
  const host = hostName ? MCP_PAGE_HOSTS.find((h) => h.name === hostName) : undefined;
  const gated = host && !host.header && host.oauth && signIn.state !== "on";
  // "Use it from …": the key-carrying TILES — a person is sent to an app above, never to one the page sends to GitHub.
  const headerHosts = andList(MCP_PAGE_HOSTS.filter((h) => h.header).map((h) => h.name));

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
      {gated && (
        <p className="text-sm text-warning mb-3" data-pass-gate>
          {t("agentPass.connectorPassGate", "From {{host}} the pass can be used only once sign-in is switched on; today, use it from {{headerHosts}} with your agent key.", { host: host.name, headerHosts })}
        </p>
      )}
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

/** The troubleshooting table for a state: rows keyed to the server's own strings. */
export function TroubleTable({ rows }: { rows: readonly TroubleRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-xs text-muted-foreground border-b border-border">
            <th className="py-2 pr-3 font-medium">What you see</th>
            <th className="py-2 pr-3 font-medium">Why</th>
            <th className="py-2 font-medium">What to do</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-trouble={r.id} className="border-b border-border align-top">
              <td className="py-2 pr-3 text-foreground"><StepText text={r.see} /></td>
              <td className="py-2 pr-3 text-muted-foreground"><StepText text={r.why} /></td>
              <td className="py-2 text-muted-foreground"><StepText text={r.fix} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AgentConnect() {
  const { t } = useTranslation();
  // THE POSTING COUNT IS READ, NOT TYPED. The same hook and the same floor
  // the homepage head uses; null until the board answers, and then every
  // sentence below has a variant that needs no number at all.
  const totals = useBoardTotals();
  const countClause = totals
    ? `${roundedFloor(totals.jobs).toLocaleString("en-US")}+ live postings`
    : "the live postings";
  const { fact, probe, set } = useSignInFact();
  const [picked, setPicked] = useState<McpHostId | null>(initialHostId);
  const pickedName = picked ? MCP_PAGE_HOSTS.find((h) => h.id === picked)?.name ?? null : null;
  // The developer disclosure: the server's reach over the FULL table.
  const hostsWithHeader = MCP_HOSTS.filter((h) => h.header);
  const hostsWithSignIn = MCP_HOSTS.filter((h) => !h.header && h.oauth);
  const troubleRows = troubleRowsFor(fact.state);

  return (
    <>
      <SEO
        title="Connect Your Agent — MCP Server for the Live Job Board"
        description={`Point any MCP-capable AI agent at ${countClause} from employers' own hiring systems. Free keys for search; the Agent plan or a one-off pass can request applications.`}
        path="/agents"
      />
      <Header />

      <main className="min-h-screen pt-20">
        {/* Hero — two sentences, the count derived, and nothing above the
            fold that names a key, a header, a transport or a status code. */}
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
                Search {countClause} from employers' own hiring systems, read full postings, check a shortlist is
                still open, and — on the Agent plan or a live pass — ask your apply agent to submit applications for you.
              </p>
            </div>
          </div>
        </section>

        {/* The switchboard */}
        <section className="py-12">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <Switchboard fact={fact} probe={probe} picked={picked} onPick={setPicked} />
            </div>
          </div>
        </section>

        {/* The connection test */}
        <section className="py-8">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <TestServer fact={fact} onFact={set} hostId={picked} />
            </div>
          </div>
        </section>

        {/* The prose fallback for any agent at all */}
        <section className="py-8">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <CopyThePrompt fact={fact} />
            </div>
          </div>
        </section>

        {/* The pass, beside the steps: the one-off way to hold the same
            entitlement the Agent plan holds monthly. */}
        <section className="py-8">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <SignInContext.Provider value={{ fact, hostName: pickedName }}>
                <PassCard />
              </SignInContext.Provider>
            </div>
          </div>
        </section>

        {/* If it does not work — rows keyed to the server's own strings */}
        <section className="py-8">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <details className="p-6 rounded-2xl bg-card border border-border" data-trouble-count={troubleRows.length}>
                <summary className="font-semibold cursor-pointer">If it does not work</summary>
                <p className="text-sm text-muted-foreground mt-3 mb-3">
                  Each row quotes what the server or your app actually says. {MCP_TROUBLESHOOTING.length - troubleRows.length > 0 ? "Rows for the other sign-in state are hidden." : ""}
                </p>
                <TroubleTable rows={troubleRows} />
              </details>
            </div>
          </div>
        </section>

        {/* For developers — everything that was on the page before the
            switchboard, below the fold: the address and its one sentence,
            the transport, the two kinds of key, the tools, prompts and
            resources, the boundary, the install repo and the cross-links. */}
        <section className="py-8 pb-16">
          <div className="container">
            <div className="max-w-3xl mx-auto">
              <details className="p-6 rounded-2xl bg-card border border-border">
                <summary className="font-semibold cursor-pointer">For developers</summary>
                <div className="mt-4 space-y-8">
                  <div>
                    <h2 className="font-semibold mb-3 flex items-center gap-2"><Terminal className="w-4 h-4 text-primary" /> The server address</h2>
                    <CopyBlock code={MCP_URL} label="MCP endpoint URL" />
                    <p className="text-sm text-muted-foreground mt-3">
                      {MCP_SERVER_ADDRESS_NOTE} Streamable HTTP transport, stateless, POST only. Your agent sends its key as{" "}
                      <code className="text-xs">Authorization: Bearer rb_live_…</code> — tool discovery works
                      without one, so an agent can see what's here before you decide to mint anything.{" "}
                      {names(MCP_ANON_TOOLS)} answer with no key at all, {MCP_ANON_CAPS.perAddressPerDay} calls a
                      day per network address (search capped at {MCP_ANON_CAPS.searchRows} rows), each answer saying how
                      many are left; every other tool call needs a credential — the key, or the sign-in a
                      chat host performs for you while the server's sign-in service is on. Press Test the server above for today's state.
                    </p>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold mb-3">Two kinds of key</h2>
                    <p className="text-muted-foreground mb-6">
                      Reading the board is free and needs no account. Acting on your account needs a key that
                      knows whose account it acts on.{" "}
                      {t("agentConnect.rateLine", "A free key meters at {{ratePerMin}} requests a minute and {{dailyQuota}} calls a day; a live pass raises both for its hours.", RATE_COPY)}
                    </p>
                    <div className="grid lg:grid-cols-2 gap-6">
                      <div className="p-5 rounded-2xl bg-background border border-border">
                        <h3 className="font-semibold mb-2 flex items-center gap-2"><Search className="w-4 h-4 text-primary" /> Read tools — any free key</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          {MCP_READ_TOOLS.map((tool, i) => (
                            <span key={tool.name}>{i > 0 && (i === MCP_READ_TOOLS.length - 1 ? " and " : ", ")}<code className="text-xs">{tool.name}</code></span>
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
                      <div className="p-5 rounded-2xl bg-background border border-border">
                        <h3 className="font-semibold mb-2 flex items-center gap-2"><Send className="w-4 h-4 text-primary" /> Apply tools — an agent key</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          {MCP_APPLY_TOOLS.map((tool, i) => (
                            <span key={tool.name}>{i > 0 && (i === MCP_APPLY_TOOLS.length - 1 ? " and " : ", ")}<code className="text-xs">{tool.name}</code></span>
                          ))}{" "}
                          act on your account, so they need a key minted from your signed-in session. The key alone
                          isn't enough — applying also requires an active{" "}
                          <Link to="/agent" className="text-primary hover:underline">Agent plan</Link> or a live pass
                          (above), and the mandate you set up in{" "}
                          <Link to="/account" className="text-primary hover:underline">Account</Link>.
                          Read-only keys stay read-only by design.
                        </p>
                        <MintAgentKey />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-1 flex items-center gap-2"><Plug className="w-4 h-4 text-primary" /> Which hosts can reach which tools</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Every keyed tool call carries a credential, and hosts hold it two ways. From{" "}
                      {andList(hostsWithHeader.map((h) => h.name))}: the key in an Authorization header — every
                      tool your key's tier allows.
                      {hostsWithSignIn.length > 0 && (
                        <>
                          {" "}From {andList(hostsWithSignIn.map((h) => h.name))}: a sign-in instead of a key, while the
                          server's sign-in service is on — the call then runs on your own account key (the same row,
                          quota and pass a pasted key would use). Before sign-in, or while it is off, the unkeyed tools
                          — {names(MCP_ANON_TOOLS)} — still answer.
                        </>
                      )}
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      {MCP_HOSTS.map((h) => (
                        <li key={h.id} className="flex gap-2">
                          <span className={`shrink-0 mt-0.5 text-xs px-2 py-0.5 rounded-full border ${h.header || h.oauth ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground"}`}>
                            {h.header ? "reaches every tool" : h.oauth ? "sign in when needed" : "unkeyed tools only"}
                          </span>
                          <span><span className="text-foreground font-medium">{h.name}</span> — {h.how}.</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold mb-4">All {MCP_TOOLS.length} tools</h2>
                    <div className="rounded-2xl bg-background border border-border divide-y divide-border">
                      {MCP_TOOLS.map((tool) => (
                        <div key={tool.name} className="p-4">
                          <div className="flex items-center gap-3 flex-wrap">
                            <code className="text-sm font-semibold text-primary">{tool.name}</code>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${tool.tier === "read" ? "border-border bg-muted text-muted-foreground" : "border-primary/30 bg-primary/10 text-primary"}`}>
                              {TIER_BADGE[tool.tier]}
                            </span>
                            {MCP_ANON_TOOL_NAMES.includes(tool.name) && (
                              <span className="text-xs px-2 py-0.5 rounded-full border border-success/40 bg-success/10 text-success">
                                answers with no key ({MCP_ANON_CAPS.perAddressPerDay}/day per network address)
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">{tool.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* THE ATTACH MENU — what a host lists beside the tools. Rendered
                      from MCP_PROMPTS and MCP_RESOURCES, the mirrors pinned to the
                      server's registries by the-attach-menu-lists-what-the-server-
                      registers; nothing here is typed, and no copy claims a host
                      renders a job's resource link (host rendering is undocumented). */}
                  <div>
                    <h2 className="text-2xl font-bold mb-2">{t("agentConnect.attachTitle", "Prompts and resources your host can list")}</h2>
                    <p className="text-muted-foreground mb-6">
                      {t("agentConnect.attachLead", "Beside the tools, the server registers ready-made prompts and a few readable documents. Hosts that list them (claude.ai's attach menu, Claude Code's slash list, Cursor's panel) show them under the server's name; listing costs no call and needs no key.")}
                    </p>
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="rounded-2xl bg-background border border-border divide-y divide-border">
                        <div className="p-4 font-semibold flex items-center gap-2"><MessageSquareText className="w-4 h-4 text-primary" /> {t("agentConnect.promptsHeading", "Prompts")}</div>
                        {MCP_PROMPTS.map((p) => (
                          <div key={p.name} className="p-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-sm font-semibold text-primary">{p.name}</code>
                              <span className="text-xs text-muted-foreground">{p.title}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{p.body}</p>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-2xl bg-background border border-border divide-y divide-border">
                        <div className="p-4 font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-primary" /> {t("agentConnect.resourcesHeading", "Resources")}</div>
                        {MCP_RESOURCES.map((r) => (
                          <div key={r.uri} className="p-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-sm font-semibold text-primary">{r.uri}</code>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${r.keyed ? "border-primary/30 bg-primary/10 text-primary" : "border-success/40 bg-success/10 text-success"}`}>
                                {r.keyed ? t("agentConnect.resourceKeyed", "needs a key or sign-in") : t("agentConnect.resourceUnkeyed", "reads with no key")}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{r.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-4">
                      {t("agentConnect.handoffLead", "On the board, every posting and every search has a control that copies a prompt for your agent — it names the posting's id or the search's arguments and this server's URL.")}{" "}
                      <Link to="/jobs" className="text-primary hover:underline">{t("agentConnect.handoffCta", "Open the board")}</Link>
                    </p>
                  </div>

                  {/* The boundary — the load-bearing section */}
                  <div className="p-5 rounded-2xl bg-background border border-primary/20">
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
                      {t("agentConnect.rateLine", "A free key meters at {{ratePerMin}} requests a minute and {{dailyQuota}} calls a day; a live pass raises both for its hours.", RATE_COPY)}{" "}
                      How the agent decides what it may send
                      is documented on the <Link to="/trust" className="text-primary hover:underline">trust page</Link>.
                    </p>
                  </div>

                  <div>
                    <h2 className="text-2xl font-bold mb-3">Rather integrate with code?</h2>
                    <p className="text-muted-foreground mb-4">
                      The MCP server is for agents. If you're writing software, the plain JSON API covers the
                      same data with cursors and ETags. The install blocks for every host — the apps above and the rest — are published as a repository, with a README
                      that says the same things in the same order.
                    </p>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <Link to="/data-api" className="px-4 py-2 rounded-lg bg-background border border-border hover:border-primary/40 transition-colors">Hiring Data &amp; API</Link>
                      <Link to="/agent" className="px-4 py-2 rounded-lg bg-background border border-border hover:border-primary/40 transition-colors">The Apply Agent</Link>
                      <Link to="/jobs" className="px-4 py-2 rounded-lg bg-background border border-border hover:border-primary/40 transition-colors">The live board</Link>
                      <a href={MCP_INSTALL_REPO_URL} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-background border border-border hover:border-primary/40 transition-colors">Install repository <ExternalLink className="w-3.5 h-3.5" /></a>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
