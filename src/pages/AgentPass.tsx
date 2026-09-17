// THE POST-PURCHASE PAGE — /agents/pass?session_id=…
//
// Stripe sends the buyer here the moment the card clears, usually a few
// seconds BEFORE the checkout.session.completed webhook has granted the pass.
// So the first thing this page does is call agent-pass-status with the
// session id: the function repairs a late webhook by retrieving the session
// from Stripe (paid, this user's, a pass by product_type) and granting through
// the same idempotent RPC. Whichever of the two arrives second finds the row.
//
// What the page then shows, top to bottom, is the SPEC's list and nothing
// more: the clock (not started until the agent's first call — never at
// purchase), the applications left, exactly ONE hand-off block for the host
// the buyer picks (remembered per browser, under the same key /agents and
// the board use), the agent's two-step setup checklist, and four honest
// expectation lines. Every number is read off the pass row the function
// returns or off the PASS mirror; every sentence of the page's own is an
// i18n key. The hand-off block renders the host's `steps` from the same
// builders /agents renders (src/config/mcp-tools.ts) — vendor labels and
// commands, the same words in every language — and its sign-in sentence
// from the server's runtime fact (read off one free initialize), never from
// a host-table flag alone: a connector host's "choose Sign in when needed"
// line renders ONLY while the server says sign-in is on.
//
// IT NEVER MINTS A KEY ON LOAD. api_key_issue_agent revokes every live key
// the account holds, so a returning Claude Code or Cursor buyer would lose
// the key already in their config. When a live key exists the block says so
// and offers "mint a new one (revokes the old)" as a deliberate click; when
// none exists it offers the existing mint button, and the freshly minted key
// (shown once, as everywhere) fills into the block.
//
// Private: noindex, and named in PRIVATE_ROUTES of the sitemap-prerender
// parity guard with its reason — a session-bound receipt page has no
// crawler-facing copy to bake.

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Ticket, Timer, KeyRound, Loader2, RefreshCw, ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MCP_HOSTS, andList, type McpHost, type SignInFact } from "@/config/mcp-tools";
import { PASS } from "@/config/products";
import { AgentSetupChecklist } from "@/components/account/AgentSetupChecklist";
import {
  MintAgentKey, MCP_URL, PASS_COPY, StepList, StepText,
  usePassStatus, startPassCheckout, useSignInFact,
} from "./AgentConnect";

const HOST_STORAGE_KEY = "rb_pass_host";

/** The host the buyer chose last time, if this browser remembers one. */
function rememberedHost(): string {
  try {
    const v = localStorage.getItem(HOST_STORAGE_KEY);
    if (v && MCP_HOSTS.some((h) => h.name === v)) return v;
  } catch { /* storage blocked — the first host is the default */ }
  return MCP_HOSTS[0].name;
}

const fmtDate = (iso: string | null | undefined, lang: string) =>
  iso ? new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) : "";

/**
 * The one hand-off block for one host: the host's steps from the shared
 * builders, then — for a host that carries a key — the keyed sub-steps
 * with the freshly minted key filled into the ONE line that takes it (an
 * empty export line and "paste your key" until then; never a placeholder
 * inside an Authorization value). For a chat host, the sign-in sentence
 * follows the server's fact: `oauth` is the host's capability, the fact is
 * whether it works today, and the "choose Sign in when needed" line renders
 * only when both hold.
 */
function HandoffBlock({ host, keyValue, fact }: { host: McpHost; keyValue: string | null; fact: SignInFact }) {
  const { t } = useTranslation();
  const ctx = { url: MCP_URL, key: keyValue ?? undefined, signIn: fact.state };
  const headerHosts = andList(MCP_HOSTS.filter((h) => h.header && h.id !== "more").map((h) => h.name));
  return (
    <div className="space-y-3" data-handoff={host.id}>
      <p className="text-sm text-muted-foreground">{t("agentPass.stepsTitle", "Steps for {{host}}:", { host: host.name })}</p>
      <StepList steps={host.steps(ctx)} />
      {host.keyed && (
        <div className="pt-3 border-t border-border">
          <p className="text-sm text-muted-foreground mb-2">{t("agentPass.keyedTitle", "Then add your agent key — it carries the pass:")}</p>
          <StepList steps={host.keyed.steps(ctx)} />
        </div>
      )}
      {!host.header && host.oauth && (
        <p className="text-sm text-muted-foreground" data-sign-in={fact.state}>
          {fact.state === "on"
            ? t("agentPass.connectorOauth", "Choose Sign in when needed, then click Connect in the chat and Allow.")
            : t("agentPass.connectorNoOauth2", "Sign-in for this host is not switched on yet, so from here only the unkeyed tools answer. To spend the pass, connect from {{headerHosts}} with your agent key.", { headerHosts })}
        </p>
      )}
      <p className="text-xs text-muted-foreground"><StepText text={host.verify} /></p>
    </div>
  );
}

export default function AgentPass() {
  const { t, i18n } = useTranslation();
  const { session, loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Stripe's ids are cs_… strings; anything else is not sent to the function.
  const sessionId = useMemo(() => {
    const v = params.get("session_id") ?? "";
    return /^cs_[A-Za-z0-9_]+$/.test(v) ? v : null;
  }, [params]);

  // Signed out → sign in and come straight back here, receipt and all.
  useEffect(() => {
    if (!loading && !session) {
      navigate(`/auth?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [loading, session, navigate, location.pathname, location.search]);

  const { status, failed, refresh } = usePassStatus(sessionId);
  // The sign-in fact, read once off a free initialize when the page has a
  // pass to hand over; unknown until then, which renders as "not on".
  const { fact, probe } = useSignInFact();

  // The clock, re-read once a minute while a pass is live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status?.pass.state !== "live") return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [status?.pass.state]);

  // The host, remembered per browser; the key, only if minted on THIS page.
  const [hostName, setHostName] = useState(rememberedHost);
  const host = MCP_HOSTS.find((h) => h.name === hostName) ?? MCP_HOSTS[0];
  const pickHost = (name: string) => {
    setHostName(name);
    try { localStorage.setItem(HOST_STORAGE_KEY, name); } catch { /* per-browser convenience only */ }
  };
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [wantsNewKey, setWantsNewKey] = useState(false);

  // hold_first_n is the buyer's own mandate setting, read from their row; a
  // person with no mandate yet gets the count-free line rather than a number
  // this page would have to type.
  const [holdFirstN, setHoldFirstN] = useState<number | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    let live = true;
    supabase.from("agent_mandates").select("hold_first_n").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => { if (live && typeof data?.hold_first_n === "number") setHoldFirstN(data.hold_first_n); });
    return () => { live = false; };
  }, [user?.id]);

  const [buying, setBuying] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const buy = async () => {
    setBuying(true); setRefusal(null);
    try {
      const r = await startPassCheckout();
      if (r !== null) setRefusal(r || t("agentPass.checkoutFailed", "Could not open checkout — please try again."));
    } finally { setBuying(false); }
  };

  const pass = status?.pass;
  const open = pass && (pass.state === "unactivated" || pass.state === "live");
  useEffect(() => { if (open) probe(); }, [open, probe]);
  // The pass row carries its own numbers (copied in at grant); the mirror
  // fills them only when there is no row to read.
  const passHours = pass && pass.state !== "none" ? pass.sessionHours : PASS.sessionHours;
  const passApplications = pass && pass.state !== "none" ? pass.applicationsTotal : PASS.applications;
  const lang = i18n.language || "en";

  const clockLine = () => {
    if (!pass || pass.state === "none") return t("agentPass.clockNone", "No pass on this account yet.");
    if (pass.state === "unactivated") {
      return t("agentPass.clockUnstarted", "Not started. Your {{passHours}} hours begin at your agent's first call — expires unused on {{date}}.", { passHours, date: fmtDate(pass.shelfExpiresAt, lang) });
    }
    if (pass.state === "live") {
      const left = Math.max(0, (pass.expiresAt ? Date.parse(pass.expiresAt) : now) - now);
      const hours = Math.floor(left / 3_600_000);
      const minutes = Math.floor((left % 3_600_000) / 60_000);
      return t("agentPass.clockLive", "Running — {{hours}}h {{minutes}}m of {{passHours}} hours left, ends {{date}}.", { hours, minutes, passHours, date: fmtDate(pass.expiresAt, lang) });
    }
    return pass.closeReason === "shelf_expired"
      ? t("agentPass.clockShelfExpired", "Your last pass expired unused on {{date}}.", { date: fmtDate(pass.shelfExpiresAt, lang) })
      : t("agentPass.clockEnded", "Your last pass ended on {{date}}.", { date: fmtDate(pass.expiresAt ?? pass.shelfExpiresAt, lang) });
  };

  return (
    <>
      <SEO
        title={t("agentPass.pageTitle", "Your Agent Pass")}
        description={t("agentPass.metaDescription", "Your pass — its clock, its applications, and the one block your agent needs.")}
        path="/agents/pass"
        noIndex
      />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
            <Ticket className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-primary">{t("agentPass.pageTitle", "Your Agent Pass")}</span>
          </div>

          {loading || (!session) ? (
            <p className="text-sm text-muted-foreground">{t("agentPass.checkingSignIn", "Checking sign-in…")}</p>
          ) : failed ? (
            <div className="p-6 rounded-2xl bg-card border border-border">
              <p className="text-sm text-muted-foreground mb-3">
                {t("agentPass.readFailed", "Could not read your pass right now. If you just paid, nothing is lost — the purchase is on Stripe's record and shows here once the read succeeds.")}
              </p>
              <button type="button" onClick={refresh} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium hover:border-primary/40">
                <RefreshCw className="w-4 h-4" /> {t("agentPass.retry", "Retry")}
              </button>
            </div>
          ) : !status || !pass ? (
            <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t("agentPass.reading", "Reading your pass…")}</p>
          ) : (
            <>
              {/* (1) the clock */}
              <section className="p-6 rounded-2xl bg-card border border-primary/30">
                <h1 className="text-xl font-bold mb-2 flex items-center gap-2"><Timer className="w-5 h-5 text-primary" /> {clockLine()}</h1>
                {status.repair && (
                  <p className="text-sm text-warning mb-2">
                    {t("agentPass.repairPending", "This checkout is not matched to a pass yet ({{reason}}). If you just paid, give it a minute and retry — the receipt arrives on its own.", { reason: status.repair })}{" "}
                    <button type="button" onClick={refresh} className="underline">{t("agentPass.retry", "Retry")}</button>
                  </p>
                )}
                {/* (2) applications left */}
                {open && (
                  <>
                    <p className="text-2xl font-semibold">
                      {t("agentPass.applications", "{{left}} of {{passApplications}} applications", { left: pass.applicationsLeft, passApplications })}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t("agentPass.applicationsBasis", "Each accepted request spends one. A request a gate refuses spends nothing, and a send that never happened gives its application back.")}
                    </p>
                  </>
                )}
                {!open && (
                  <div className="mt-3">
                    {refusal && <p className="text-sm text-destructive mb-2">{refusal}</p>}
                    <button
                      type="button" onClick={buy} disabled={buying}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
                    >
                      {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
                      {buying ? t("agentPass.buying", "Opening checkout…") : t("agentPass.buyAnother", "Buy a pass")}
                    </button>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("agentPass.cardBody", "{{passHours}} hours with your agent, {{passApplications}} applications, ${{passPrice}}. Never renews.", PASS_COPY)}
                    </p>
                  </div>
                )}
              </section>

              {/* (3) one hand-off block for the chosen host */}
              {open && (
                <section className="p-6 rounded-2xl bg-card border border-border">
                  <h2 className="font-semibold mb-3 flex items-center gap-2"><KeyRound className="w-4 h-4 text-primary" /> {t("agentPass.handoffTitle", "Hand it to your agent")}</h2>
                  <div className="mb-4">
                    <p className="text-xs text-muted-foreground mb-2">{t("agentPass.whichAgent", "Which agent?")}</p>
                    <div role="tablist" className="flex flex-wrap gap-2">
                      {MCP_HOSTS.map((h) => (
                        <button
                          key={h.name} type="button" role="tab" aria-selected={h.name === host.name}
                          onClick={() => pickHost(h.name)}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${h.name === host.name ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                        >
                          {h.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* The key: never minted on load. */}
                  {host.header && (
                    <div className="mb-4">
                      {mintedKey ? null : status.key.live && !wantsNewKey ? (
                        <div>
                          <p className="text-sm text-foreground font-medium">{t("agentPass.keyCarries", "Your existing agent key already carries the pass — nothing to paste.")}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("agentPass.keyDetail", "Key {{prefix}}…, minted {{date}}.", { prefix: status.key.prefix ?? "rb_live_", date: fmtDate(status.key.createdAt, lang) })}{" "}
                            <button type="button" onClick={() => setWantsNewKey(true)} className="underline">{t("agentPass.mintNew", "Mint a new one (revokes the old)")}</button>
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">{t("agentPass.keyMintFirst", "Mint your agent key first — it is shown once and fills into the block below.")}</p>
                          <MintAgentKey onMinted={setMintedKey} next={location.pathname + location.search} />
                        </div>
                      )}
                    </div>
                  )}
                  <HandoffBlock host={host} keyValue={mintedKey} fact={fact} />
                </section>
              )}

              {/* (4) the agent's own setup — a key with no mandate is ready: false */}
              {open && user && (
                <section>
                  <h2 className="font-semibold mb-3">{t("agentPass.checklistTitle", "Before the first application")}</h2>
                  <AgentSetupChecklist userId={user.id} onGo={(tab) => navigate(`/agent?tab=${tab}`)} />
                  <Link to="/agent" className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-3">
                    {t("agentPass.toAgent", "Open the agent")} <ArrowRight className="w-4 h-4" />
                  </Link>
                </section>
              )}

              {/* (5) honest expectations */}
              {open && (
                <section className="p-6 rounded-2xl bg-muted/30 border border-border">
                  <ul className="text-sm text-muted-foreground space-y-2">
                    <li>• {holdFirstN !== null
                      ? t("agentPass.expectHold", "Your first {{holdFirstN}} releases are held for your approval in Account.", { holdFirstN })
                      : t("agentPass.expectHoldPlain", "Your first few releases are held for your approval in Account.")}</li>
                    <li>• {t("agentPass.expectPrepare", "Packets are prepared within about a minute of a request.")}</li>
                    <li>• {t("agentPass.expectLapse", "Applications you do not use lapse when the clock ends.")}</li>
                    <li>• {t("agentPass.expectFinish", "Sends already requested finish even after the clock ends.")}</li>
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
