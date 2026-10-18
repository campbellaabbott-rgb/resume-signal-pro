/**
 * SIGN-IN AND SESSIONS (S12-060, S12-137; plan CP-007, CP-012, CP-H).
 *
 * WHAT WAS WRONG. With sign-ups confirmed automatically, an email change took
 * effect the moment it was typed, with no password and no second entry, while
 * the page said "check BOTH inboxes". A typo renamed the account away from its
 * purchases, and an unattended session could hand the account to anyone. The
 * password change asked for nothing either.
 *
 * WHAT HOLDS NOW.
 *   - Changing the password asks for the current password, or for a
 *     confirmation code mailed to the account's address (reauthenticate, then
 *     the code goes with the change). It waits for the account guard first
 *     (AuthContext.ensureGuard), so a guard clearing a pre-proof password can
 *     never land after the new one.
 *   - Changing the address is offered only once the auth server confirms
 *     address changes (mailer_autoconfirm false, read from /auth/v1/settings):
 *     then it asks for the current password and the new address twice, and
 *     says, truthfully, that both addresses must confirm. While the server
 *     still confirms on its own it is not offered, and the card says how to
 *     get the address changed.
 *   - Sign out of this device, or everywhere.
 *   - How the address was proven, and when (Account UX spec 6): the account
 *     read (get-account-data) says it, from the sign-in that proved it; an
 *     unproven address is said to be unproven.
 * Every string goes through t(key, English default).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AUTH_SUPPORT_EMAIL, MIN_PASSWORD_LENGTH } from "@/config/auth-providers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * True only when the auth server itself says it no longer confirms addresses
 * on its own. Any failure to read it is false: the change stays hidden.
 */
export function useAddressChangeConfirmed(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
    const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "");
    if (!base) { setOn(false); return; }
    fetch(`${base}/auth/v1/settings`, { headers: key ? { apikey: key } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { mailer_autoconfirm?: unknown } | null) => { if (live) setOn(s?.mailer_autoconfirm === false); })
      .catch(() => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  return on;
}

type Msg = { ok: boolean; text: string } | null;

/** How the account's address was proven, and when (get-account-data's mailboxProof). */
export type MailboxProofSummary = { how: "code" | "link" | "reset" | "provider" | "confirmation"; at: string | null };

type SecurityCardProps = {
  /** get-account-data's mailboxProven; undefined while the account read is not in. */
  proven?: boolean;
  proof?: MailboxProofSummary | null;
};

/** The proof line, or null when the account read has not said. */
export function proofLine(
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => string,
  proven: boolean | undefined,
  proof: MailboxProofSummary | null | undefined,
  locale?: string,
): string | null {
  if (proven === false) return t("accountSettings.unproven", "Your address isn't proven yet, so purchases made under it without signing in don't show on this page.");
  if (proven !== true || !proof) return null;
  const how = {
    code: t("accountSettings.provenHow.code", "by a sign-in code we emailed to it"),
    link: t("accountSettings.provenHow.link", "by a sign-in link we emailed to it"),
    reset: t("accountSettings.provenHow.reset", "by a password-reset email we sent to it"),
    provider: t("accountSettings.provenHow.provider", "by a Google or Apple sign-in that verified it"),
    confirmation: t("accountSettings.provenHow.confirmation", "by confirming the email we sent to it"),
  }[proof.how];
  if (!how) return null;
  const at = proof.at ? new Date(proof.at) : null;
  return at && Number.isFinite(at.getTime())
    ? t("accountSettings.provenOn", "Your address was proven {{how}} on {{date}}.", { how, date: at.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" }) })
    : t("accountSettings.proven", "Your address was proven {{how}}.", { how });
}

export function SecurityCard({ proven, proof }: SecurityCardProps = {}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, session, signOut, signOutEverywhere, ensureGuard } = useAuth();
  const addressChangeOn = useAddressChangeConfirmed();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [codeAsked, setCodeAsked] = useState(false);
  const [code, setCode] = useState("");
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const [emailCurrent, setEmailCurrent] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmail2, setNewEmail2] = useState("");
  const [emailMsg, setEmailMsg] = useState<Msg>(null);

  /** The current password is right: asked of the auth server, never assumed. */
  const passwordIsRight = async (password: string): Promise<boolean> => {
    const email = user?.email ?? "";
    if (!email || !password) return false;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return !error;
  };

  const askForCode = async () => {
    setPwMsg(null);
    const { error } = await supabase.auth.reauthenticate();
    if (error) { setPwMsg({ ok: false, text: t("accountSettings.codeFailed", "We couldn't ask for a confirmation code right now. Try again in a minute.") }); return; }
    setCodeAsked(true);
    setPwMsg({ ok: true, text: t("accountSettings.codeOnItsWay", "If your address can receive mail, a confirmation code is on its way to {{email}}.", { email: user?.email ?? "" }) });
  };

  const changePassword = async () => {
    setPwMsg(null);
    if (next.length < MIN_PASSWORD_LENGTH) { setPwMsg({ ok: false, text: t("accountSettings.pwTooShort", "A new password needs at least {{n}} characters.", { n: MIN_PASSWORD_LENGTH }) }); return; }
    if (!current && !code.trim()) { setPwMsg({ ok: false, text: t("accountSettings.pwNeedsProof", "Enter your current password, or ask for a confirmation code.") }); return; }
    setBusy(true);
    try {
      // The account guard answers first: a password set before the address
      // was proven is cleared by it, and must never clear this one.
      await ensureGuard(session);
      if (current && !(await passwordIsRight(current))) {
        setPwMsg({ ok: false, text: t("accountSettings.pwWrong", "That isn't your current password.") });
        return;
      }
      const { error } = await supabase.auth.updateUser(code.trim() && !current ? { password: next, nonce: code.trim() } : { password: next });
      if (error) { setPwMsg({ ok: false, text: error.message }); return; }
      setCurrent(""); setNext(""); setCode(""); setCodeAsked(false);
      setPwMsg({ ok: true, text: t("accountSettings.pwChanged", "Password changed.") });
    } finally {
      setBusy(false);
    }
  };

  const changeEmail = async () => {
    setEmailMsg(null);
    const a = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(a)) { setEmailMsg({ ok: false, text: t("accountSettings.emailInvalid", "Enter a valid new address.") }); return; }
    if (a !== newEmail2.trim().toLowerCase()) { setEmailMsg({ ok: false, text: t("accountSettings.emailMismatch", "The two addresses don't match.") }); return; }
    setBusy(true);
    try {
      if (!(await passwordIsRight(emailCurrent))) { setEmailMsg({ ok: false, text: t("accountSettings.pwWrong", "That isn't your current password.") }); return; }
      const { error } = await supabase.auth.updateUser({ email: a });
      if (error) { setEmailMsg({ ok: false, text: error.message }); return; }
      setEmailCurrent(""); setNewEmail(""); setNewEmail2("");
      setEmailMsg({ ok: true, text: t("accountSettings.emailConfirmBoth", "Nothing has changed yet: we've asked both your current and your new address to confirm. Your address changes once both are confirmed.") });
    } finally {
      setBusy(false);
    }
  };

  const input = "flex-1 min-w-0 px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";
  const button = "shrink-0 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6 scroll-mt-28" id="security" data-security-card>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-foreground text-sm">{t("accountSettings.title", "Sign-in and security")}</h2>
      </div>
      {(() => {
        const line = proofLine((k, d, v) => t(k, d, v), proven, proof, i18n.language);
        return line ? <p className="text-xs text-muted-foreground mb-3" data-proof-line={proven ? (proof?.how ?? "") : "unproven"}>{line}</p> : null;
      })()}

      <div className="grid sm:grid-cols-2 gap-5 mb-4">
        <div>
          <p className="text-xs font-medium text-foreground mb-1">{t("accountSettings.pwTitle", "Change password")}</p>
          <div className="space-y-2">
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)}
              placeholder={t("accountSettings.pwCurrent", "Current password")} aria-label={t("accountSettings.pwCurrent", "Current password")} className={`${input} w-full`} />
            {!current && (
              codeAsked ? (
                <input inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder={t("accountSettings.codeField", "Confirmation code from the email")} aria-label={t("accountSettings.codeField", "Confirmation code from the email")} className={`${input} w-full`} />
              ) : (
                <button type="button" onClick={() => void askForCode()} className="text-[11px] text-primary hover:underline">
                  {t("accountSettings.noPassword", "No password yet, or forgotten it? Email me a confirmation code instead")}
                </button>
              )
            )}
            <div className="flex gap-2">
              <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
                placeholder={t("accountSettings.pwNew", "New password ({{n}}+ characters)", { n: MIN_PASSWORD_LENGTH })} aria-label={t("accountSettings.pwNewLabel", "New password")} className={input} />
              <button type="button" onClick={() => void changePassword()} disabled={busy || !next} className={button}>{t("accountSettings.update", "Update")}</button>
            </div>
          </div>
          {pwMsg && <p className={`text-xs mt-2 ${pwMsg.ok ? "text-success" : "text-destructive"}`} role="status">{pwMsg.text}</p>}
        </div>

        <div>
          <p className="text-xs font-medium text-foreground mb-1">{t("accountSettings.emailTitle", "Change sign-in address")}</p>
          {addressChangeOn ? (
            <div className="space-y-2" data-email-change>
              <input type="password" autoComplete="current-password" value={emailCurrent} onChange={(e) => setEmailCurrent(e.target.value)}
                placeholder={t("accountSettings.pwCurrent", "Current password")} aria-label={t("accountSettings.emailPwLabel", "Current password, to change your address")} className={`${input} w-full`} />
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder={t("accountSettings.emailNew", "New address")} aria-label={t("accountSettings.emailNew", "New address")} className={`${input} w-full`} />
              <div className="flex gap-2">
                <input type="email" value={newEmail2} onChange={(e) => setNewEmail2(e.target.value)} placeholder={t("accountSettings.emailNewAgain", "New address again")} aria-label={t("accountSettings.emailNewAgain", "New address again")} className={input} />
                <button type="button" onClick={() => void changeEmail()} disabled={busy || !newEmail || !emailCurrent} className={button}>{t("accountSettings.update", "Update")}</button>
              </div>
              <p className="text-[11px] text-muted-foreground">{t("accountSettings.emailNote", "Purchases made under your current address stay with that address until the new one is confirmed and proven.")}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-email-change-hidden>
              {addressChangeOn === null
                ? "…"
                : t("accountSettings.emailNotYet", "Changing your sign-in address needs both addresses to confirm, which this site can't ask for yet. Write to {{support}} from your current address and we'll change it for you.", { support: AUTH_SUPPORT_EMAIL })}
            </p>
          )}
          {emailMsg && <p className={`text-xs mt-2 ${emailMsg.ok ? "text-success" : "text-destructive"}`} role="status">{emailMsg.text}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/60">
        <span className="text-xs text-muted-foreground mr-auto">{t("accountSettings.sessions", "Signed in as {{email}}", { email: user?.email ?? "" })}</span>
        <button type="button" onClick={async () => { await signOut(); navigate("/"); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground">
          <LogOut className="w-3.5 h-3.5" /> {t("accountSettings.signOutHere", "Sign out of this device")}
        </button>
        <button type="button" onClick={async () => { await signOutEverywhere(); navigate("/"); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground">
          {t("accountSettings.signOutEverywhere", "Sign out everywhere")}
        </button>
      </div>
    </div>
  );
}
