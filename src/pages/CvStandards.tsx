// Per-country CV/resume standards pages — EN for every country in the
// scanner's COUNTRY_STANDARDS engine, localized variants per CV_LOCALES.
// The prerender (scripts/prerender-seo.mjs) emits the crawler-facing static
// HTML for these same routes; this component serves SPA navigation.
import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight, Camera, FileText, Ruler, User, Landmark } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { COUNTRY_STANDARDS } from "../../supabase/functions/free-keyword-scan/country-standards";
import {
  COUNTRY_SLUGS,
  CV_LOCALES,
  EN_TEMPLATE,
  fill,
  isoFromSlug,
  hreflangCluster,
} from "@/data/cv-standards-content";

const SITE = "https://resumebooster.work";

interface CvStandardsProps {
  locale?: string; // undefined = English
}

export default function CvStandards({ locale }: CvStandardsProps) {
  const { country } = useParams<{ country: string }>();

  const cfg = locale ? CV_LOCALES[locale] : null;
  const iso = locale
    ? Object.entries(cfg?.slugs ?? {}).find(([, s]) => s === country)?.[0] ?? null
    : isoFromSlug(country ?? "");
  const std = iso ? COUNTRY_STANDARDS[iso] : null;

  if (!iso || !std) return <Navigate to="/cv-standards" replace />;

  const t = cfg ? cfg.t : EN_TEMPLATE;
  const localized = cfg?.content[iso];
  const name = localized?.countryName ?? std.name;
  const vars = { name, docTerm: std.docTerm };

  const lengthNote = localized?.lengthNote ?? std.lengthNote;
  const photoNote = localized?.photoNote ?? std.photoNote;
  const personalNote = localized?.personalDataNote ?? std.personalDataNote;
  const conventions = localized?.conventions ?? std.conventions;

  const cluster = hreflangCluster(iso);
  const path = locale ? `/${cfg!.pathBase}/${country}` : `/cv-standards/${country}`;

  return (
    <div className="min-h-screen bg-background">
      <SEO title={fill(t.title, vars)} description={fill(t.metaDescription, vars)} path={path} />
      {Object.entries(cluster).map(([lang, href]) => (
        <link key={lang} rel="alternate" hrefLang={lang} href={`${SITE}${href}`} />
      ))}
      <link rel="alternate" hrefLang="x-default" href={`${SITE}${cluster.en}`} />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Home</Link> /{" "}
            <Link to="/cv-standards" className="hover:text-foreground">CV Standards</Link> /{" "}
            <span className="text-foreground">{name}</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{fill(t.h1, vars)}</h1>
          <p className="text-muted-foreground mb-8">{fill(t.intro, vars)}</p>
          {/* Visible language links — hreflang alone isn't crawlable navigation */}
          {Object.keys(cluster).length > 1 && (
            <p className="text-xs text-muted-foreground -mt-4 mb-6">
              {Object.entries(cluster)
                .filter(([lang, href]) => href !== `${SITE}${path}`.replace(SITE, "") && `${href}` !== path)
                .map(([lang, href]) => (
                  <Link key={lang} to={href} className="text-primary mr-3">
                    {{ en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", nl: "Nederlands" }[lang] ?? lang} →
                  </Link>
                ))}
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold">{t.docTermLabel}</h2>
              </div>
              <p className="text-foreground font-medium">{std.docTerm}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.paperLabel}: {std.paper}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 mb-1">
                <Ruler className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold">{t.lengthLabel}</h2>
              </div>
              <p className="text-foreground font-medium">{lengthNote}</p>
            </div>
          </div>

          <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-bold">{t.photoLabel}</h2>
              <span className="ml-auto px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                {t.photoNorms[std.photo]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{photoNote}</p>
          </section>

          <section className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-bold">{t.personalLabel}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{personalNote}</p>
          </section>

          {conventions.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center gap-2 mb-2">
                <Landmark className="w-4 h-4 text-primary" />
                <h2 className="text-lg font-bold">{t.conventionsLabel}</h2>
              </div>
              <ul className="space-y-2">
                {conventions.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
            <h2 className="text-xl font-bold mb-2">{t.ctaTitle}</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{fill(t.ctaText, vars)}</p>
            <Button asChild className="gap-2">
              <Link to="/">
                {t.ctaButton}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </section>

          <p className="text-[11px] text-muted-foreground mt-6">{t.sourceNote}</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function CvStandardsIndex() {
  const entries = Object.entries(COUNTRY_SLUGS)
    .filter(([iso]) => COUNTRY_STANDARDS[iso])
    .map(([iso, slug]) => ({ iso, slug, name: COUNTRY_STANDARDS[iso].name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="CV & Resume Standards by Country — Photo, Length, Format Rules"
        description={`What a resume or CV actually looks like in ${entries.length} countries: photo norms, expected length, personal-data rules, and formatting conventions — the live data our resume scanner applies per market.`}
        path="/cv-standards"
      />
      <Header />
      <main className="pt-20 pb-20">
        <div className="container max-w-3xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">CV &amp; resume standards by country</h1>
          <p className="text-muted-foreground mb-8">
            Resume rules change at every border — a photo is expected in Germany and gets you discarded in the US.
            These pages are the live per-country data our scanner applies when your resume targets a market: {entries.length} countries, updated whenever the engine improves.
          </p>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {entries.map(({ iso, slug, name }) => (
              <Link
                key={iso}
                to={`/cv-standards/${slug}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground hover:border-primary/50 transition-colors"
              >
                <span>{name}</span>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
