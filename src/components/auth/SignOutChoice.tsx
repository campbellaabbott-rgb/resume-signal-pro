/**
 * A SIGN-OUT THAT ASKS BEFORE IT DELETES THE ONLY COPY (S14X-097).
 *
 * A deliberate sign-out clears what the person left in this browser, and that
 * included the builder's résumé and Freelance Boost's details, which exist
 * nowhere else: there is no server copy. So when either holds something
 * typed, the button asks first, with three answers: open the builder to
 * download the résumé (no sign-out), keep the work on this device and sign
 * out, or delete it and sign out. With nothing typed it signs out at once.
 * Account deletion does not come through here: it clears everything.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useAuthStrings } from "@/i18n/auth/load";
import { localWork } from "@/lib/local-resume-copies";

type Props = {
  /** Every device, not only this one. */
  everywhere?: boolean;
  className?: string;
  children: ReactNode;
  /** Where the page goes once signed out. */
  after?: string;
};

export function SignOutChoice({ everywhere = false, className, children, after = "/" }: Props) {
  const { t } = useTranslation();
  useAuthStrings();
  const navigate = useNavigate();
  const { signOut, signOutEverywhere } = useAuth();
  const [asking, setAsking] = useState<{ builder: boolean; freelance: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  // The question takes focus when it opens, and gives it back to the button
  // that opened it when it closes (WCAG 2.4.3): Cancel and Escape would
  // otherwise leave focus on a button that no longer exists.
  useEffect(() => {
    if (asking) { wasAsking.current = true; firstRef.current?.focus(); return; }
    if (wasAsking.current) { wasAsking.current = false; triggerRef.current?.focus(); }
  }, [asking]);

  const leave = async (keepLocalDrafts: boolean) => {
    setBusy(true);
    try {
      if (everywhere) await signOutEverywhere({ keepLocalDrafts });
      else await signOut({ keepLocalDrafts });
    } finally {
      setBusy(false);
      setAsking(null);
    }
    navigate(after);
  };

  const press = () => {
    const work = localWork();
    if (work.builder || work.freelance) { setAsking(work); return; }
    void leave(false);
  };

  // The question keeps focus on its answers (WCAG 2.4.3); Escape is Cancel.
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); setAsking(null); return; }
    if (e.key !== "Tab") return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
    if (buttons.length === 0) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const answer = "inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-60";

  return (
    <>
      <button ref={triggerRef} type="button" onClick={press} disabled={busy} className={className}>{children}</button>
      {asking && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
          <div
            onKeyDown={keys}
            role="dialog"
            aria-modal
            aria-labelledby="rb-sign-out-title"
            aria-describedby="rb-sign-out-body"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-left shadow-xl"
          >
            <h2 id="rb-sign-out-title" className="mb-2 text-lg font-semibold text-foreground">
              {t("auth.signOut.title", "Before you sign out")}
            </h2>
            <div id="rb-sign-out-body" className="mb-5 space-y-2 text-sm text-muted-foreground">
              {asking.builder && <p>{t("auth.signOut.builder", "Your builder résumé is saved only in this browser, and signing out deletes it.")}</p>}
              {asking.freelance && <p>{t("auth.signOut.freelance", "Your Freelance Boost details are saved only in this browser, and signing out deletes them.")}</p>}
            </div>
            {asking.builder && (
              <button ref={firstRef} type="button" disabled={busy} onClick={() => { setAsking(null); navigate("/builder"); }}
                className={`${answer} mb-2 bg-primary font-semibold text-primary-foreground hover:bg-primary/90`}>
                {t("auth.signOut.openBuilder", "Open the builder to download it")}
              </button>
            )}
            <button ref={asking.builder ? undefined : firstRef} type="button" disabled={busy} onClick={() => void leave(true)}
              className={`${answer} mb-2 border border-border text-foreground hover:border-primary/40 hover:bg-primary/5`}>
              {t("auth.signOut.keep", "Keep it on this device and sign out")}
            </button>
            <button type="button" disabled={busy} onClick={() => void leave(false)}
              className={`${answer} mb-2 border border-border text-destructive hover:bg-destructive/5`}>
              {t("auth.signOut.delete", "Delete it and sign out")}
            </button>
            <button type="button" disabled={busy} onClick={() => setAsking(null)}
              className={`${answer} text-muted-foreground hover:text-foreground`}>
              {t("auth.signOut.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
