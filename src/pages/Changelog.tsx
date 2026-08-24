import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { SEO } from "@/components/seo/SEO";
import { Footer } from "@/components/Footer";
import { cn } from "@/lib/utils";
import { changelog, ChangelogTag } from "@/data/changelog";
import { loadChangelogStrings } from "@/i18n";
import { Sparkles, TrendingUp, Wrench } from "lucide-react";

const tagIcons: Record<ChangelogTag, typeof Sparkles> = {
  new: Sparkles,
  improved: TrendingUp,
  fixed: Wrench,
};

const tagClassNames: Record<ChangelogTag, string> = {
  new: "bg-primary/10 text-primary border-primary/20",
  improved: "bg-success/10 text-success border-success/20",
  fixed: "bg-warning/10 text-warning border-warning/20",
};

function formatEntryDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function Changelog() {
  // Release-note strings are not in the main bundle — fetch them here.
  //
  // GATED ON ARRIVAL, because this effect runs AFTER the first paint while the
  // list below renders immediately: until the bundle lands, t() returns the
  // key it was given, so a cold load of this page painted a full column of
  // "changelogEntries.jobDescriptionsCutShort.title" at the visitor. Caught on
  // production 2026-08-24 while verifying a release. Skeletons until the
  // strings are here.
  //
  // The flag flips on failure too: if the bundle cannot load, the old
  // raw-key rendering is a bad outcome, but a skeleton that never resolves is
  // a worse one — it would hide the entire changelog behind a loading state
  // with nothing to break the tie.
  const [stringsReady, setStringsReady] = useState(false);
  useEffect(() => { void loadChangelogStrings().finally(() => setStringsReady(true)); }, []);

  const { t, i18n } = useTranslation();

  return (
    <div className="min-h-screen bg-background">
      <SEO title={t('changelogPage.metaTitle')} description={t('changelogPage.metaDescription')} path="/changelog" />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-2xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-bold mb-3">{t('changelogPage.title')}</h1>
            <p className="text-muted-foreground">
              {t('changelogPage.subtitle')}
            </p>
          </div>

          <div className="relative">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" aria-hidden="true" />
            <div className="space-y-10">
              {!stringsReady && Array.from({ length: 6 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="relative pl-8" aria-hidden="true">
                  <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-muted border-2 border-background" />
                  <div className="h-3 w-28 rounded bg-muted animate-pulse mb-2" />
                  <div className="h-5 w-3/4 rounded bg-muted animate-pulse mb-2" />
                  <div className="h-3 w-full rounded bg-muted animate-pulse mb-1" />
                  <div className="h-3 w-5/6 rounded bg-muted animate-pulse" />
                </div>
              ))}
              {stringsReady && changelog.map((entry, i) => (
                <div key={i} className="relative pl-8">
                  <div className="absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-primary border-2 border-background ring-2 ring-primary/20" aria-hidden="true" />
                  <p className="text-xs text-muted-foreground font-medium mb-1.5">{formatEntryDate(entry.date, i18n.language)}</p>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h2 className="text-lg font-bold text-foreground">{t(`changelogEntries.${entry.id}.title`)}</h2>
                    {entry.tags.map((tag) => {
                      const Icon = tagIcons[tag];
                      return (
                        <span
                          key={tag}
                          className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border", tagClassNames[tag])}
                        >
                          <Icon className="w-3 h-3" />
                          {t(`changelogPage.tags.${tag}`)}
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t(`changelogEntries.${entry.id}.description`)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
