/**
 * THE RECEIPT — the exact words submitted under someone's name.
 *
 * migration 20260801050000 has been recording `sent_answers` and
 * `sent_evidence` since 1 August and NOTHING HAS EVER READ THEM. Its own header
 * makes the case better than I can: "An honest agent that cannot show its work
 * asks for the same trust as a dishonest one."
 *
 * Three facts, deliberately kept apart:
 *   answers        what apply-agent PREPARED
 *   sent_answers   what the worker actually PUT ON THE FORM
 *   sent_evidence  the employer's own confirmation text
 *
 * THE DIFF IS THE POINT, and it is why these are not one column. A learned
 * answer can resolve a question between preparation and send — a normal,
 * correct outcome — and conflating the two would destroy the only comparison
 * worth making. Where they differ, this says so, rather than showing the final
 * value as though it had always been the plan.
 *
 * Nothing here is generated. Every string is what was recorded at send time; if
 * a field is missing it is absent, not inferred. A receipt that reconstructs
 * anything is not a receipt.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ShieldCheck, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SentAnswer { category: string; label: string; value: string }

export interface ReceiptProps {
  company: string;
  title: string;
  submittedAt: string | null;
  submittedVia: string | null;
  /** What actually went onto the form. */
  sentAnswers: SentAnswer[];
  /** What was prepared, for the diff. Keyed by label. */
  preparedAnswers?: Record<string, string>;
  /** The employer's confirmation, in their words. */
  sentEvidence?: string;
}

/** Source labels the candidate can act on, rather than internal category names. */
const SOURCE_LABEL: Record<string, string> = {
  "full-name": "from your profile",
  "preferred-name": "from your profile",
  email: "from your profile",
  phone: "from your profile",
  address: "from your profile",
  city: "from your profile",
  postcode: "from your profile",
  linkedin: "from your profile",
  portfolio: "from your profile",
  "salary-expected": "from your standing answers",
  "notice-period": "from your standing answers",
  "work-authorization": "from your standing answers",
  sponsorship: "from your standing answers",
  relocation: "from your standing answers",
  "internal-applicant": "standing policy: No",
  "demographic-declined": "declined, as you asked",
  "cover-letter": "drafted from your résumé",
  unrecognised: "drafted from your résumé",
};

export function ApplicationReceipt(p: ReceiptProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!p.submittedAt) return null;

  const when = new Date(p.submittedAt).toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t("receipt.title", "What we submitted for you")}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {p.title} · {p.company} · {when}
          </span>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border p-4">
          {p.sentAnswers.length === 0 ? (
            // NOT "nothing was submitted". The application went out; what we do
            // not have is the per-field record, and saying otherwise would be a
            // worse lie than saying nothing.
            <p className="text-sm text-muted-foreground">
              {t("receipt.noRecord",
                "This application was submitted before we started keeping per-field records, so we can't show the exact wording.")}
            </p>
          ) : (
            <ul className="space-y-3">
              {p.sentAnswers.map((a, i) => {
                const prepared = p.preparedAnswers?.[a.label];
                const changed = prepared !== undefined && prepared !== a.value;
                return (
                  <li key={`${a.label}-${i}`} className="text-sm">
                    <div className="font-medium">{a.label || a.category}</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
                      {a.value}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {SOURCE_LABEL[a.category] ?? a.category}
                      </span>
                      {changed && (
                        <span className="text-[11px] text-muted-foreground">
                          {t("receipt.changedAtSend", {
                            defaultValue: "updated at send time (prepared: “{{was}}”)",
                            was: prepared!.length > 60 ? `${prepared!.slice(0, 60)}…` : prepared,
                          })}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {p.sentEvidence ? (
            <div className="rounded-md bg-muted/50 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                {t("receipt.evidence", "The employer's confirmation")}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {p.sentEvidence}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("receipt.noEvidence",
                "The form accepted this but returned no confirmation text we could capture.")}
            </p>
          )}

          {p.submittedVia && (
            <p className="text-xs text-muted-foreground">
              {t("receipt.via", { defaultValue: "Submitted via {{via}}.", via: p.submittedVia })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
