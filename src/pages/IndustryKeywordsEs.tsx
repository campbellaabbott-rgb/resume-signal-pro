// Spanish programmatic SEO — the 15 industries with native Spanish detection
// data. Competing content in Spanish is thin across the entire web; these are
// the only data-backed versions. hreflang links pair each page with its
// English sibling.

import { useParams, Link, Navigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { INDUSTRY_KEYWORDS } from "../../supabase/functions/free-keyword-scan/industry-detection";
import { ONET_EXPECTATIONS } from "../../supabase/functions/free-keyword-scan/onet-expectations";

import { ES_INDUSTRIES, isSpanish } from "@/data/es-industries";

export default function IndustryKeywordsEs() {
  const { slug } = useParams();
  const name = slug ? ES_INDUSTRIES[slug] : undefined;
  const data = slug ? INDUSTRY_KEYWORDS[slug] : undefined;
  if (!slug || !name || !data) return <Navigate to="/industries" replace />;

  const esKeywords = [...new Set(data.primary.filter(isSpanish))].slice(0, 20);
  const esTitles = [...new Set(data.titles.filter(isSpanish))].slice(0, 14);
  const enKeywords = [...new Set(data.primary.filter((t) => !isSpanish(t)))].slice(0, 14);
  const onet = ONET_EXPECTATIONS[slug];

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`Palabras Clave para Currículum de ${name} — Qué Buscan los ATS`}
        description={`${esKeywords.slice(0, 5).join(", ")} y más: las palabras clave, títulos y certificaciones que nuestro escáner de currículums busca en el sector de ${name.toLowerCase()}. Escaneo gratis incluido.`}
        path={`/es/industrias/${slug}`}
      />
      <link rel="alternate" hrefLang="en" href={`https://resumebooster.work/industries/${slug}`} />
      <link rel="alternate" hrefLang="es" href={`https://resumebooster.work/es/industrias/${slug}`} />
      <link rel="alternate" hrefLang="x-default" href={`https://resumebooster.work/industries/${slug}`} />
      <Header />
      <main className="pt-28 pb-20">
        <div className="container max-w-3xl">
          <nav className="text-xs text-muted-foreground mb-4">
            <Link to="/" className="hover:text-foreground">Inicio</Link> / <Link to="/industries" className="hover:text-foreground">Industrias</Link> / <span className="text-foreground">{name}</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Palabras clave para currículum de {name}</h1>
          <p className="text-muted-foreground mb-8">
            Esto no es un artículo — son los datos reales que nuestro escáner usa para analizar currículums de {name.toLowerCase()},
            incluida la detección nativa en español. Cuando el motor mejora, esta página se actualiza con él.
          </p>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">Términos en español que nuestro motor reconoce</h2>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {esKeywords.map((k) => (
                <span key={k} className="px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-foreground capitalize">{k}</span>
              ))}
            </div>
            {esTitles.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-foreground mb-2">Títulos profesionales reconocidos</h3>
                <div className="flex flex-wrap gap-1.5">
                  {esTitles.map((t) => (
                    <span key={t} className="px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-muted-foreground capitalize">{t}</span>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-bold mb-2">Términos en inglés que los ATS también esperan</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Si postulas a empresas que usan sistemas ATS en inglés, estos términos suman peso:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {enKeywords.map((k) => (
                <span key={k} className="px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-foreground capitalize">{k}</span>
              ))}
            </div>
          </section>

          {onet && (
            <section className="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8">
              <h2 className="font-semibold text-foreground mb-1">Habilidades clave según el Departamento de Trabajo de EE. UU.</h2>
              <p className="text-xs text-muted-foreground mb-3">Fuente: O*NET {onet.code} — {onet.occupation} (onetonline.org, dominio público)</p>
              <div className="flex flex-wrap gap-1.5">
                {onet.skills.map((s) => (
                  <span key={s} className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium capitalize">{s}</span>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-2xl border-2 border-primary bg-card p-6 text-center">
            <h2 className="text-xl font-bold mb-2">Escanea tu currículum gratis — también en español</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Informe diagnóstico completo en segundos: qué palabras clave te faltan, cómo leen tu archivo los grandes
              sistemas ATS, tus viñetas más débiles reescritas y un plan de mejoras. Sin registro; tu currículum nunca se guarda.
            </p>
            <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors">
              Escanear mi currículum gratis <ArrowRight className="w-4 h-4" />
            </Link>
          </section>

          <nav className="mt-8 flex flex-wrap gap-2 text-xs" aria-label="Otras industrias">
            {Object.entries(ES_INDUSTRIES).filter(([s]) => s !== slug).slice(0, 8).map(([s, n]) => (
              <Link key={s} to={`/es/industrias/${s}`} className="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                {n} →
              </Link>
            ))}
            <Link to="/es/revisar-curriculum" className="px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors">
              Revisar mi currículum gratis →
            </Link>
            <Link to={`/industries/${slug}`} className="px-3 py-1.5 rounded-full border border-primary/40 text-primary hover:bg-primary/10 transition-colors">
              English version →
            </Link>
          </nav>
        </div>
      </main>
      <Footer />
    </div>
  );
}

