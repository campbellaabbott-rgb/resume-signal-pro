/**
 * CONNECTED AIS AND THE MAIL THIS ACCOUNT GETS (plan CP-H, Account UX spec
 * section 6; decision D12).
 *
 * A key minted for a person's AI could only be replaced by minting another,
 * and the account page never said one existed; the market pulse could only be
 * left from a link in one of its mails. Two cards, read from account-settings
 * in one call:
 *   - Connected AIs (#connected): each live key this account minted, by its
 *     prefix, with when it was made and last used, and Revoke, which stops it
 *     at once. Never the key itself: it is shown once, when minted.
 *   - Email preferences (#mail): the market pulse rows under the account's
 *     proven address, each with Stop. Saved-search alerts are switched on
 *     their own card; every other mail we send carries its own unsubscribe
 *     link. While the address is unproven the card says so instead of listing
 *     a list that may be a stranger's.
 * A failed read says so with Try again; it never shows an empty list as fact.
 * Every string goes through t(key, English default).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Bot, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type Connector = { id: string; prefix: string; name: string; createdAt: string; lastUsedAt: string | null };
export type PulseRow = { industry: string | null; state: "subscribed" | "awaiting_confirmation" | "off" };
export type AccountSettings = {
  connectors: Connector[];
  mail: { marketPulse: PulseRow[] } | null;
  mailboxProven: boolean;
};

async function errorText(error: unknown): Promise<string | undefined> {
  try {
    return ((await (error as { context?: Response } | null)?.context?.clone().json()) as { error?: string } | undefined)?.error;
  } catch {
    return undefined;
  }
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : null);

export function ConnectedAIsCard({ connectors, busy, onRevoke }: { connectors: Connector[]; busy: boolean; onRevoke: (id: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6 scroll-mt-28" id="connected" data-connected-card>
      <div className="flex items-center gap-2 mb-2">
        <Bot className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountConnected.title", "Connected AIs")}</h2>
      </div>
      {connectors.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-connected-empty>
          {t("accountConnected.none", "No AI is connected to this account.")}{" "}
          <Link to="/agents" className="text-primary hover:underline">{t("accountConnected.connect", "Connect Claude or ChatGPT")}</Link>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {connectors.map((c) => (
            <li key={c.id} className="text-xs border border-border/50 rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" data-connector={c.id}>
              <span className="font-mono text-foreground">{c.prefix}…</span>
              <span className="text-muted-foreground">{t("accountConnected.created", "Connected {{date}}", { date: day(c.createdAt) ?? "" })}</span>
              <span className="text-muted-foreground">
                {c.lastUsedAt
                  ? t("accountConnected.lastUsed", "Last used {{date}}", { date: day(c.lastUsedAt) })
                  : t("accountConnected.neverUsed", "Not used yet")}
              </span>
              <button type="button" disabled={busy} onClick={() => onRevoke(c.id)} className="ml-auto text-destructive hover:underline disabled:opacity-50">
                {t("accountConnected.revoke", "Revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">
        {t("accountConnected.note", "Revoking stops that AI from reaching your account at once. Connecting again makes a new key.")}
      </p>
    </div>
  );
}

export function EmailPreferencesCard({ mail, mailboxProven, busy, onPulseOff }: { mail: AccountSettings["mail"]; mailboxProven: boolean; busy: boolean; onPulseOff: () => void }) {
  const { t } = useTranslation();
  const pulse = mail?.marketPulse ?? [];
  const live = pulse.filter((p) => p.state !== "off");
  const stateLabel: Record<PulseRow["state"], string> = {
    subscribed: t("accountMail.pulseOn", "On"),
    awaiting_confirmation: t("accountMail.pulsePending", "Waiting for you to confirm"),
    off: t("accountMail.pulseOff", "Off"),
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6 scroll-mt-28" id="mail" data-mail-card>
      <div className="flex items-center gap-2 mb-2">
        <Mail className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountMail.title", "Email preferences")}</h2>
      </div>
      {!mailboxProven ? (
        <p className="text-xs text-muted-foreground" data-mail-unproven>
          {t("accountMail.unproven", "Sign in with an emailed code once to see the mailing lists under your address here. Every mail we send also carries its own unsubscribe link.")}
        </p>
      ) : (
        <>
          <div className="text-xs flex flex-wrap items-center gap-2" data-pulse>
            <span className="text-foreground font-medium">{t("accountMail.pulse", "Market pulse")}</span>
            {pulse.length === 0
              ? <span className="text-muted-foreground">{t("accountMail.pulseNone", "Not subscribed")}</span>
              : pulse.map((p, i) => (
                <span key={`${p.industry ?? "all"}-${i}`} className="text-muted-foreground" data-pulse-state={p.state}>
                  {p.industry ? `${p.industry.replace(/_/g, " ")}: ` : ""}{stateLabel[p.state]}
                </span>
              ))}
            {live.length > 0 && (
              <button type="button" disabled={busy} onClick={onPulseOff} className="ml-auto text-primary hover:underline disabled:opacity-50">
                {t("accountMail.pulseStop", "Stop the market pulse")}
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {t("accountMail.others", "Saved-search alerts are switched on and off on each saved search above. Every other mail we send carries its own unsubscribe link.")}
          </p>
        </>
      )}
    </div>
  );
}

/** Reads account-settings once and renders both cards; revoke and stop act through it. */
export function AccountSettingsCards() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const { data, error } = await supabase.functions.invoke("account-settings", { body: { action: "read" } });
    const body = data as AccountSettings | null;
    if (error || !body || !Array.isArray(body.connectors)) { setFailed(true); return; }
    setSettings(body);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("account-settings", { body });
      if (error || !data) {
        toast.error((await errorText(error)) ?? t("accountConnected.actionFailed", "That didn't work. Try again in a minute."));
        return;
      }
      toast.success(done);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 mb-6 scroll-mt-28" id="connected" data-settings-failed>
        <p className="text-xs text-muted-foreground">
          {t("accountConnected.readFailed", "We couldn't load your connected AIs and mail settings just now.")}{" "}
          <button type="button" onClick={() => void load()} className="text-primary hover:underline">{t("accountConnected.retry", "Try again")}</button>
        </p>
      </div>
    );
  }
  if (!settings) return null;
  return (
    <>
      <ConnectedAIsCard
        connectors={settings.connectors}
        busy={busy}
        onRevoke={(id) => void act({ action: "revoke_connector", keyId: id }, t("accountConnected.revoked", "Revoked. That AI can no longer reach your account."))}
      />
      <EmailPreferencesCard
        mail={settings.mail}
        mailboxProven={settings.mailboxProven}
        busy={busy}
        onPulseOff={() => void act({ action: "pulse_off" }, t("accountMail.pulseStopped", "The market pulse is stopped."))}
      />
    </>
  );
}
