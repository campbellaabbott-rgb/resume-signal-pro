// /agents/pass — WHAT HAPPENED TO THE AGENT PASS.
//
// This was the post-purchase page of the six-hour Agent Pass. The apply
// pivot (owner decision 2026-10-11) retired the Agent Pass, the Agent plan
// and the $7 Apply Assistant, and switched the server-side apply agent off:
// Resume Booster no longer sends applications for anyone. The one apply path
// left is the person's own AI helping them apply, for free, with the person
// pressing Submit on the employer's own site.
//
// So the page now says exactly that, to anyone who lands here — a buyer
// following an old receipt link, a bookmark, a link from an old email:
//   - the pass, the plan and the Apply Assistant are no longer sold, and we
//     do not send applications;
//   - a buyer from before the retirement is refunded or honoured by the
//     owner, by writing to support (the owner handles each one by hand);
//   - the free path, and a link to the page that sets it up.
//
// It sells nothing and calls nothing: no checkout, no status read, no key
// mint, no sign-in wall (a retirement notice behind a sign-in would hide
// the answer from the person most likely to need it). It stays noindex and
// on the sitemap-prerender parity guard's PRIVATE_ROUTES, because it is a
// notice for people who bought something, not a page to rank.
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Ticket, ArrowRight, Mail, ClipboardCheck } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/** Where a buyer from before the retirement writes; the same address every support line on the site names. */
const SUPPORT_EMAIL = "resumeboostersupp@gmail.com";

export default function AgentPass() {
  const { t } = useTranslation();
  return (
    <>
      <SEO
        title={t("agentPass.retiredPageTitle", "The Agent Pass is retired")}
        description={t("agentPass.retiredMeta", "We no longer sell the Agent Pass or the Agent plan, and we do not send applications. Here is what changed, and the free way to apply with your own AI.")}
        path="/agents/pass"
        noIndex
      />
      <Header />
      <main className="min-h-screen pt-24 pb-20">
        <div className="container max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border">
            <Ticket className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">{t("agentPass.retiredBadge", "Retired")}</span>
          </div>

          <section className="p-6 rounded-2xl bg-card border border-border" data-pass-retired>
            <h1 className="text-2xl font-bold mb-3">{t("agentPass.retiredPageTitle", "The Agent Pass is retired")}</h1>
            <p className="text-muted-foreground mb-3">
              {t("agentPass.retiredBody", "We no longer sell the Agent Pass, the Agent plan or the Apply Assistant, and our own apply agent is switched off: Resume Booster does not send applications for anyone.")}
            </p>
            <p className="text-muted-foreground flex items-start gap-2" data-pass-buyers>
              <Mail className="w-4 h-4 mt-1 shrink-0 text-primary" aria-hidden />
              <span>
                {t("agentPass.retiredBuyers", "Bought one before? We will refund it or honour it. Write to us from the address you paid with:")}{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">{SUPPORT_EMAIL}</a>
              </span>
            </p>
          </section>

          <section className="p-6 rounded-2xl bg-card border border-primary/30" data-free-path>
            <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-primary" aria-hidden /> {t("agentPass.freePathTitle", "The free way: apply yourself, with your own AI")}
            </h2>
            <p className="text-muted-foreground mb-4">
              {t("agentPass.freePathBody", "Connect Resume Booster to Claude or ChatGPT at no cost. Your AI searches the board with you, reads the posting — and, where the employer's system publishes it, the application form — and helps you write your answers. You check everything and press Submit on the employer's own site.")}
            </p>
            <Link
              to="/agents"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
            >
              {t("agentPass.freePathCta", "Connect your AI")} <ArrowRight className="w-4 h-4" />
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
