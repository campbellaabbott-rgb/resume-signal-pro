// THE AGENT IS THE HALLMARK, AND IT SPEAKS FOR ITSELF.
//
// The old top-of-page order pitched the board first and the agent second, as a
// brochure: four static feature cards in the third person. This hero inverts
// it — the agent opens the page, in the first person, holding live numbers.
//
// EVERY NUMBER COMES FROM THE STATUS PAYLOAD OR IS NOT RENDERED. The sendable
// count (how many postings the agent can finish unattended) and the board
// total move daily; a hardcoded "35,000" would be the claim-drift failure this
// codebase has paid for repeatedly — copy going false because the thing it
// describes moved. Absence renders as absence: the headline works without
// numbers, and the inventory line appears only once measured.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bot, ShieldCheck, MessageSquareText, FileText, BellRing, ArrowRight, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AgentInventory {
  sendable: number | null;
  total: number | null;
  questionVendors: number | null;
}

/** Scrolls the visitor to the CV intake — the hero's one action. The uploader
 *  already exposes `data-scan-button` for the floating CTA; reusing that
 *  anchor keeps one source of truth for "where does uploading start". */
const scrollToUploader = () => {
  const el = document.querySelector('[data-scan-button="true"]') ?? document.querySelector('[data-resume-loaded]');
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
};

export function AgentHero() {
  const { t, i18n } = useTranslation();
  const [inv, setInv] = useState<AgentInventory>({ sendable: null, total: null, questionVendors: null });

  useEffect(() => {
    let dead = false;
    // Best-effort, one shot. The status action is the single anon-readable
    // surface that knows the sendable inventory; if it is slow or down the
    // hero simply renders without the inventory line — never a made-up number,
    // never a zero.
    void supabase.functions.invoke("job-board", { body: { action: "status" } }).then(({ data }) => {
      if (dead || !data || typeof data !== "object") return;
      const d = data as { sendable?: { postings?: number }; totalPostings?: number; questionVendors?: string[] };
      setInv({
        sendable: typeof d.sendable?.postings === "number" && d.sendable.postings > 0 ? d.sendable.postings : null,
        total: typeof d.totalPostings === "number" && d.totalPostings > 0 ? d.totalPostings : null,
        questionVendors: Array.isArray(d.questionVendors) && d.questionVendors.length > 0 ? d.questionVendors.length : null,
      });
    }).catch(() => { /* the hero stands without numbers */ });
    return () => { dead = true; };
  }, []);

  const nf = (n: number) => n.toLocaleString(i18n.language);

  const PROOF = [
    { icon: FileText, label: t("agentHero.proofTailored", "Tailored materials for every application — never a blast") },
    { icon: MessageSquareText, label: t("agentHero.proofQuestions", "Answers the employer's real screening questions") },
    { icon: ShieldCheck, label: t("agentHero.proofHonest", "Sworn to honesty: it will say what you don't have") },
    { icon: BellRing, label: t("agentHero.proofTracks", "Tracks every application and tells you what happened") },
  ] as const;

  return (
    <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-primary/[0.07] via-background to-background">
      <div className="container py-14 md:py-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/25 mb-6">
            <Bot className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-primary">{t("agentHero.badge", "Your AI apply agent")}</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground mb-4">
            {t("agentHero.headline", "I apply to jobs while you sleep.")}
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground mb-3 max-w-2xl mx-auto">
            {t("agentHero.sub", "Feed me your CV. I search a live board of verified openings, pick the roles that fit, write each application honestly, and submit where employers allow it — you approve, I do the legwork.")}
          </p>

          {/* The inventory line — the sentence only a live count can earn.
              Rendered when measured; absent while loading or unavailable. */}
          {inv.sendable !== null && inv.total !== null && (
            <p className="text-sm text-foreground/80 mb-8 font-medium">
              {t("agentHero.inventory", "Right now: {{sendable}} openings I can submit end-to-end, out of {{total}} live verified postings I search for you.", {
                sendable: nf(inv.sendable),
                total: nf(inv.total),
              })}
            </p>
          )}
          {(inv.sendable === null || inv.total === null) && <div className="mb-8" aria-hidden="true" />}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <button
              type="button"
              onClick={scrollToUploader}
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
            >
              <Upload className="w-5 h-5" />
              {t("agentHero.ctaPrimary", "Feed it your CV — free")}
            </button>
            <Link
              to="/agent"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl border border-border bg-card/60 text-foreground font-medium hover:border-primary/50 transition-colors"
            >
              {t("agentHero.ctaSecondary", "Watch it work")}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-left max-w-2xl mx-auto">
            {PROOF.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <Icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
