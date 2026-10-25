/**
 * "SIGNED IN AS jane@example.com. NOT YOU? SIGN OUT" (Account UX spec 4).
 *
 * A link adopted without the "Is this your account?" question (this browser
 * had started a sign-in, but one whose address it could not know, such as a
 * provider press) still names the account it signed in to, until the person
 * says it is theirs. "Not you?" signs that session out of this device only and
 * keeps the visitor's own work (AuthContext signOut keepLocalWork): the person
 * pressing it is not that account's owner.
 */
import { useTranslation } from "react-i18next";
import { useAuthStrings } from "@/i18n/auth/load";

type Props = { email: string; onDismiss: () => void; onNotYou: () => void };

export function LinkSignInBanner({ email, onDismiss, onNotYou }: Props) {
  const { t } = useTranslation();
  useAuthStrings();
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-[90] border-t border-border bg-card px-4 py-3 shadow-xl">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 text-sm">
        <p className="min-w-0 break-all text-foreground">{t("auth.banner.signedInAs", "Signed in as {{email}}.", { email })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onNotYou} className="min-h-[44px] rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            {t("auth.banner.notYou", "Not you? Sign out")}
          </button>
          <button type="button" onClick={onDismiss} className="min-h-[44px] rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
            {t("auth.banner.dismiss", "That's me")}
          </button>
        </div>
      </div>
    </div>
  );
}
