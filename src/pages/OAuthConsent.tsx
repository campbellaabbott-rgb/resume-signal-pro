// THE CONSENT ROUTE — /oauth/consent?authorization_id=…
//
// Supabase's OAuth 2.1 server (once the owner enables it, Authorization Path
// set to this route) sends a person here when an agent host — claude.ai,
// ChatGPT, Claude Code's /mcp — asks to act as them on the MCP server. The
// page does exactly three things: signs the person in if they are not (and
// comes back here with the request intact, via /auth?next=), shows what is
// being asked (the client's name, the scopes, where they return to), and
// hands the decision to the Supabase client's own consent API —
// getAuthorizationDetails / approveAuthorization / denyAuthorization on
// supabase.auth.oauth (supabase-js 2.87.1). The redirect back to the host is
// the SDK's own redirect_url; nothing here builds one.
//
// CONSENT IS NEVER GATED ON PURCHASE. The pass strip below the request reads
// agent-pass-status and says "buy" or "not started · N applications", but
// Allow works either way: reading the board is free from any host, and the
// apply tools refuse in band with the buy link when nothing funds them.
//
// Private: noindex, no prerender entry, named in PRIVATE_ROUTES of the
// sitemap-prerender parity guard — a page that exists only for a host's
// authorization request has nothing to say to a crawler.

import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bot, Check, X, Loader2, Ticket } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePassStatus } from "./AgentConnect";

interface Details {
  client: { name?: string; uri?: string };
  scope: string;
  redirect_url?: string;
}

const hostOf = (uri: string | undefined): string => {
  try { return uri ? new URL(uri).hostname : ""; } catch { return ""; }
};

export default function OAuthConsent() {
  const { t } = useTranslation();
  const { session, loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";

  // Sign in first, and come back with the request intact.
  useEffect(() => {
    if (!loading && !session) {
      navigate(`/auth?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [loading, session, navigate, location.pathname, location.search]);

  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    if (!session || !authorizationId) return;
    let live = true;
    (async () => {
      const { data, error: err } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!live) return;
      if (err || !data) { setError(err?.message ?? "unknown"); return; }
      // A redirect_url on the details means consent was already given for
      // this client — send the person straight back rather than asking twice.
      if (data.redirect_url) { window.location.assign(data.redirect_url); return; }
      setDetails({ client: data.client ?? {}, scope: data.scope ?? "", redirect_url: data.redirect_url });
    })();
    return () => { live = false; };
  }, [session, authorizationId]);

  const decide = async (action: "approve" | "deny") => {
    setBusy(action); setError(null);
    try {
      const call = action === "approve"
        ? supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      const { data, error: err } = await call;
      if (err || !data?.redirect_url) { setError(err?.message ?? "no redirect"); return; }
      window.location.assign(data.redirect_url);
    } finally { setBusy(null); }
  };

  const { status } = usePassStatus();
  const pass = status?.pass;

  return (
    <>
      <SEO
        title={t("oauthConsent.title", "Connect your agent")}
        description={t("oauthConsent.metaDescription", "Allow an agent host to act as you on the Resume Booster MCP server.")}
        path="/oauth/consent"
        noIndex
      />
      <Header />
      <main className="min-h-screen flex items-start justify-center px-4 pt-24 pb-16">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Bot className="w-5 h-5 text-primary" />
              <h1 className="text-xl font-bold">{t("oauthConsent.title", "Connect your agent")}</h1>
            </div>

            {loading || !session ? (
              <p className="text-sm text-muted-foreground">{t("agentPass.checkingSignIn", "Checking sign-in…")}</p>
            ) : !authorizationId ? (
              <p className="text-sm text-muted-foreground">
                {t("oauthConsent.missingId", "This page needs an authorization request from your agent's host — start from the Connect button in the chat.")}
              </p>
            ) : error && !details ? (
              <p className="text-sm text-destructive">{t("oauthConsent.failed", "Could not read this authorization request: {{reason}}", { reason: error })}</p>
            ) : !details ? (
              <p className="text-sm text-muted-foreground inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> {t("oauthConsent.working", "Working…")}</p>
            ) : (
              <>
                <p className="text-sm text-foreground mb-2">
                  {t("oauthConsent.asks", "{{client}} is asking to act as you on the Resume Booster MCP server.", { client: details.client.name || hostOf(details.client.uri) || "An agent host" })}
                </p>
                <p className="text-sm text-muted-foreground mb-1">
                  {t("oauthConsent.scopes", "It will see: {{scopes}}.", { scopes: details.scope.split(/\s+/).filter(Boolean).join(", ") || "—" })}
                </p>
                {hostOf(details.client.uri) && (
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("oauthConsent.returnsTo", "After you allow, you return to {{host}}.", { host: hostOf(details.client.uri) })}
                  </p>
                )}
                {user?.email && (
                  <p className="text-xs text-muted-foreground mb-4">{t("oauthConsent.signedInAs", "Signed in as {{email}}.", { email: user.email })}</p>
                )}
                {error && <p className="text-sm text-destructive mb-3">{error}</p>}
                <div className="flex gap-2">
                  <button
                    type="button" onClick={() => decide("approve")} disabled={busy !== null}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {t("oauthConsent.allow", "Allow")}
                  </button>
                  <button
                    type="button" onClick={() => decide("deny")} disabled={busy !== null}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium hover:border-destructive/40 disabled:opacity-60"
                  >
                    {busy === "deny" ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} {t("oauthConsent.deny", "Deny")}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* The pass strip: informative, never a gate on Allow. Rendered only
              off an answer from agent-pass-status. */}
          {session && pass && (
            <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 text-sm flex items-start gap-2">
              <Ticket className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                {pass.state === "unactivated" ? (
                  <span>{t("oauthConsent.passUnstarted", "Pass not started · {{left}} applications waiting", { left: pass.applicationsLeft })}</span>
                ) : pass.state === "live" ? (
                  <span>{t("oauthConsent.passLive", "Pass running · {{left}} applications left", { left: pass.applicationsLeft })}</span>
                ) : (
                  <span className="text-muted-foreground">{t("oauthConsent.passNone", "No pass on this account. Reading the board is free; applications need a pass or the Agent plan.")}</span>
                )}{" "}
                <Link to={pass.state === "unactivated" || pass.state === "live" ? "/agents/pass" : "/agents"} className="text-primary hover:underline">
                  {pass.state === "unactivated" || pass.state === "live" ? t("oauthConsent.passOpen", "Your pass") : t("oauthConsent.passBuy", "Buy a pass")}
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
