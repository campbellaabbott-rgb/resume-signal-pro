/**
 * /v1 AND EVERY PATH UNDER IT — THIS SITE IS NOT THE API'S ADDRESS (SEO-015).
 *
 * The bake writes noindex guidance pages at /v1, /v1/jobs, /v1/changes,
 * /v1/companies, /v1/stats and /v1/usage (people paste an API path onto the
 * site's own host), but React had no /v1 route, so the catch-all painted
 * "404 Oops! Page not found" over them for people and for every crawler that
 * runs scripts, with two robots tags in the head (the round's review,
 * 2026-10-24). This says what the baked page says: where the API lives
 * (publicApiBase, the builder the bake and /data-api use), how a request
 * carries its key, and where the how-to is. noindex, like the baked page.
 */
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { publicApiBase } from "@/config/public-endpoints";

const link = "text-primary underline decoration-primary/50 underline-offset-2 hover:decoration-primary";

export default function ApiAddress() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, "") || "/v1";
  const base = publicApiBase();
  const apiPath = path === "/v1" ? `${base}/v1` : `${base}${path}`;
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={t("apiAddressPage.metaTitle", "This is not the API address")}
        description={t("apiAddressPage.metaDescription", "The data API does not live on this site's own address; the how-to and the free keys are on /data-api.")}
        path={path}
        noIndex
      />
      <Header />
      <main id="main-content" tabIndex={-1} className="pt-20 pb-20 focus:outline-none">
        <article className="container max-w-3xl" data-api-address="">
          <h1 className="text-2xl font-bold mb-3">{t("apiAddressPage.metaTitle", "This is not the API address")}</h1>
          <p className="text-muted-foreground mb-4">{t("apiAddressPage.lead", "You asked this site for {{path}}. The API does not live here; it lives at:", { path })}</p>
          <p className="text-sm mb-4"><code className="break-all">{apiPath}</code></p>
          <p className="text-sm text-muted-foreground">
            {t("apiAddressPage.keyLine", "Requests carry a key as Authorization: Bearer rb_live_…; free keys and every endpoint are described on")}{" "}
            <Link to="/data-api" className={link}>{t("footer.links.dataApi", "Hiring Data & API")}</Link>.
          </p>
        </article>
      </main>
      <Footer />
    </div>
  );
}
