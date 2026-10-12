/**
 * THE EMPLOYER'S DESCRIPTION, AND THE TRUTH ABOUT OUR COPY OF IT.
 *
 * MISSING IS OUR FAILURE (audit JL4). The pane said "This company's feed
 * doesn't publish the full description", a statement about a named employer,
 * on postings whose feed does publish one and whose text we simply had not
 * fetched or could not store (USAJOBS, Breezy, Personio and Lever rows among
 * them). Whatever the cause, the reader is told WE could not load it and is
 * handed the employer's own page — a fact about us, never about them.
 *
 * CAPPED IS SAID (STORED_DESC_CAP). A stored copy that reaches the board's
 * storage cap may stop short of the employer's posting; the note says where
 * the rest is.
 *
 * REPEATS ARE FOLDED (JL6), and the fold is disclosed in one line so a
 * reader comparing our copy with the employer's knows why it is shorter.
 *
 * Highlighting (the board's fit keywords) marks the posting's own words in
 * place; nothing is added to the text.
 */
import { Fragment, useMemo, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { possessive } from "@/lib/company-display";
import { cleanApplyUrl } from "@/lib/listing/apply-url";
import { prepareDescription, STORED_DESC_CAP } from "@/lib/listing/description";

export interface ListingDescription {
  text: string | null;
  state: "loaded" | "loading" | "unavailable";
  /** Overrides the length test when the caller knows (contracts.ts `capped`). */
  capped?: boolean;
  /** A fetch that failed can be retried; a description that does not exist cannot. */
  onRetry?: () => void;
}

export interface PostingDescriptionProps {
  description: ListingDescription;
  employer: string;
  applyUrl: string | null | undefined;
  highlight?: { have: string[]; missing: string[] };
  /** How many sections start open (the board opens the first three on a desktop, none on a phone). */
  sectionsOpen?: number;
  onSectionOpen?: (title: string) => void;
  heading?: ReactNode;
}

function highlighter(have: string[], missing: string[]) {
  const hits = have.filter((k) => k.length > 1);
  const misses = missing.filter((k) => k.length > 1);
  if (hits.length + misses.length === 0) return (text: string) => <>{text}</>;
  const hitSet = new Set(hits.map((k) => k.toLowerCase()));
  const missSet = new Set(misses.map((k) => k.toLowerCase()));
  const esc = (k: string) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${[...hits, ...misses].map(esc).join("|")})`, "gi");
  return (text: string) => (
    <>
      {text.split(re).map((part, i) => {
        const lower = part.toLowerCase();
        if (hitSet.has(lower)) return <mark key={i} className="rounded bg-success/20 px-0.5 text-foreground">{part}</mark>;
        if (missSet.has(lower)) return <mark key={i} className="rounded bg-warning/20 px-0.5 text-foreground">{part}</mark>;
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function SiteLink({ href, employer, kind }: { href: string | null; employer: string; kind: "read" | "continues" }) {
  const { t } = useTranslation();
  const label = kind === "read"
    ? employer
      ? t("listing.description.readOnSite", { defaultValue: "Read it on {{employerPossessive}} site", employerPossessive: possessive(employer), employer })
      : t("listing.description.readOnSitePlain", "Read it on the employer's site")
    : employer
      ? t("listing.description.continuesOnSite", { defaultValue: "The posting continues on {{employerPossessive}} site", employerPossessive: possessive(employer), employer })
      : t("listing.description.continuesOnSitePlain", "The posting continues on the employer's site");
  if (!href) return <>{label}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary">
      {label}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only"> {t("listing.actions.newTab", "(opens in a new tab)")}</span>
    </a>
  );
}

export function PostingDescription({ description, employer, applyUrl, highlight, sectionsOpen = 3, onSectionOpen, heading }: PostingDescriptionProps) {
  const { t, i18n } = useTranslation();
  const href = cleanApplyUrl(applyUrl);
  const prepared = useMemo(
    () => (description.state === "loaded" && description.text ? prepareDescription(description.text) : null),
    [description.state, description.text],
  );
  const mark = useMemo(() => highlighter(highlight?.have ?? [], highlight?.missing ?? []), [highlight?.have, highlight?.missing]);

  if (description.state === "loading") {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("listing.description.loading", "Loading the description…")}
      </p>
    );
  }
  if (!prepared) {
    return (
      <div className="rounded-lg border border-border bg-muted p-4 text-sm" data-description="unavailable">
        <p className="text-foreground">{t("listing.description.unavailable", "We couldn't load the full description here.")}</p>
        <p className="mt-1"><SiteLink href={href} employer={employer} kind="read" /></p>
        {description.onRetry && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={description.onRetry}>
            {t("jobsPage.retry", "Try again")}
          </Button>
        )}
      </div>
    );
  }
  const capped = description.capped ?? prepared.mayContinue;
  const hasHighlights = (highlight?.have.length ?? 0) + (highlight?.missing.length ?? 0) > 0;
  const body = "whitespace-pre-line text-sm leading-7 text-foreground";
  return (
    <section className="max-w-[68ch]" data-description="loaded">
      {heading}
      {hasHighlights && (
        <p className="mb-2 text-xs text-muted-foreground">
          <mark className="rounded bg-success/20 px-1 text-foreground">{t("jobsPage.hlHave", "in your resume")}</mark>{" · "}
          <mark className="rounded bg-warning/20 px-1 text-foreground">{t("jobsPage.hlMissing", "missing from it")}</mark>
        </p>
      )}
      <div className="prose-posting">
        {prepared.sections ? (
          <div className="space-y-1">
            {prepared.sections.map((sec, i) => sec.title ? (
              <details
                key={i}
                open={i < sectionsOpen}
                className="group rounded-lg border border-border"
                onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) onSectionOpen?.(sec.title ?? ""); }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-foreground">
                  {sec.title}
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                </summary>
                <div className={`px-3 pb-3 ${body}`}>{mark(sec.text)}</div>
              </details>
            ) : (
              <div key={i} className={body}>{mark(sec.text)}</div>
            ))}
          </div>
        ) : (
          <div className={body}>{mark(prepared.text)}</div>
        )}
      </div>
      {prepared.collapsed > 0 && (
        <p className="mt-3 text-xs text-muted-foreground" data-description-collapsed={prepared.collapsed}>
          {t("listing.description.collapsed", {
            count: prepared.collapsed,
            defaultValue_one: "We left out {{count}} paragraph that repeated another word for word.",
            defaultValue_other: "We left out {{count}} paragraphs that repeated others word for word.",
          })}
        </p>
      )}
      {capped && (
        <p className="mt-3 text-sm text-muted-foreground" data-description-capped="">
          {t("listing.description.capped", { defaultValue: "Our copy stops at {{cap}} characters.", cap: STORED_DESC_CAP.toLocaleString(i18n.language || "en") })}{" "}
          <SiteLink href={href} employer={employer} kind="continues" />
        </p>
      )}
    </section>
  );
}
